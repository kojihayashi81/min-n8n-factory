# ai-pr-refiner（提案）

初回調査で作成された Draft PR に対して、**PR 側のレビュー起点で追加調査を回す**ための新規ワークフロー設計案。現時点では実装されていない。

> この提案は `issue-draft-revise.md`（Issue ラベル `ai-revise` 起点の修正モード案）を統合したもの。トリガーは PR 側に寄せ、Git 戦略は「既存ブランチへの追加コミット」を採る。

## 背景

現在 `ai-issue-processor` は初回調査からコミット/push/Draft PR 作成までを 1 本のパイプラインで処理している。一方で「既存 PR が存在する Issue に対して `ai-ready` ラベルを付け直すと、同じパイプラインがフル再実行される」という問題がある。

現状の実際の動き(PR 既存時):

```text
ラベル ai-ready
  ↓
Collector            実行（~30-60秒）
Code Investigator    実行（~100秒）
Web Investigator     実行（~100-200秒）
Synthesizer          実行（~60-180秒、既存ノートを上書き生成）
Gatekeeper           実行（~30-60秒）
                     ↓
git add note.md      ファイル内容が前回と変わらなければ no-op
                     ↓ (nothing to commit → continuing)
git push             Everything up-to-date
                     ↓
gh pr list           既存 PR #7 を検出
                     ↓
Slack に PR #7 の URL を再通知
```

つまり **同じ調査を 5-7 分かけて再生成している**。Synthesizer が毎回 Markdown を出力するので、claude の生成ゆらぎで微妙に違う文章が生成されれば新 commit が発生し PR が更新されるが、文章が同一なら no-op で終わる。

## 現状の構造的問題

現在のモデルの負債:

- **Issue ラベルが Issue の進捗と再実行意図で兼用されている**（`ai-failed → ai-ready` の往復が「失敗リトライ」と「追加調査依頼」で意味が混ざる）
- **ラベル再付与だけでは「何をどう直してほしいか」の意図が伝わらない**（同じ結果になりやすい）
- **再調査のコンテキストが pipeline に渡らない**（なぜ再調査したいかという情報が欠落）
- **Issue workflow を回すと毎回フルエージェント実行**（5-10 分）
- **同じ Issue に対して 2 本目の PR が並行して作られる可能性**がある

## 提案構成（PR コメント + PR 専用ラベル + 別ワークフロー）

```text
                     Issue #1                    PR #7 (Draft)
                        │                            │
                        │ [ai-ready]                 │ [ai-refine-requested]
                        │                            │
                        ▼                            ▼
            ┌────────────────────────┐   ┌──────────────────────────┐
            │ ai-issue-processor     │   │ ai-pr-refiner            │
            │ (既存ワークフロー)      │   │ (新規ワークフロー)        │
            │                        │   │                          │
            │ 初回調査:              │   │ 追加調査:                │
            │  - 全エージェント実行  │   │  - PR コメントを読む     │
            │  - 調査ノート生成      │   │  - 既存ノート+コメントを │
            │  - Draft PR 作成       │   │    Synthesizer に投入    │
            │  - Issue:ai-investigated│  │  - ノートを更新          │
            │                        │   │  - 既存ブランチに追加    │
            └────────────────────────┘   │    コミット              │
                                         │  - 通常 push             │
                                         │  - PR に結果コメント     │
                                         │  - PR:ai-refined         │
                                         └──────────────────────────┘
```

## ラベル / 状態の設計

### Issue 側（既存）

- `ai-ready` → `ai-processing` → `ai-investigated`（初回完了）
- ここから先は触らない（Issue の役割は "初回依頼" で固定）
- **二重起動ガード**: `ai-investigated` が付いた Issue への `ai-ready` 再付与は初回ワークフロー側で無視する

### PR 側（新設、PR に付けるラベル）

- `ai-refine-requested`: 「このドラフトを改善してほしい」という依頼
- `ai-refining`: 「改善中」
- `ai-refined`: 「改善完了」
- `ai-refine-failed`: 「改善試行が失敗」

### ラベルの汎用化: 全パイプライン共通で 1 セット

将来 ai-spec-processor / ai-impl-processor が入ると、それぞれの Draft PR にも「修正してほしい」トリガーが必要になる。パイプラインごとにラベルを分けると（`ai-investigate-refine-requested` / `ai-spec-refine-requested` / ...）人間が覚えきれない。

**方針: ラベルは `ai-refine-requested` の 1 セットだけ。どのパイプラインに回すかは PR の文脈から自動判別する。**

判別に使える既存の命名規約:

| パイプライン | branch prefix | PR title prefix | 判別例 |
| --- | --- | --- | --- |
| 調査 (ai-issue-processor) | `issues/N` | `investigate: ...` | head branch が `issues/` で始まる |
| 仕様 (ai-spec-processor) | `specs/issue-N` | `spec: ...` | head branch が `specs/` で始まる |
| 実装 (ai-impl-processor) | `impl/issue-N` | `impl: ...` | head branch が `impl/` で始まる |

ブランチ名と PR タイトルの命名規約は各 proposal で既に決まっているため、新たな規約は不要。人間は **「この PR を直してほしい」→ `ai-refine-requested` を貼る** だけで、ルーティングはシステムが行う。

実装上は、ai-pr-refiner ワークフローの先頭で branch prefix を見て対応するパイプラインスクリプト（`n8n-run-refine-pipeline.sh` / `n8n-run-spec-refine-pipeline.sh` 等）にディスパッチする Code ノードを 1 つ挟む。

### トリガーの選択肢

#### 案 T1: PR ラベル方式

- 人が PR に `ai-refine-requested` ラベルを貼る
- n8n Schedule が定期スキャンして拾う
- **pros**: 既存 ai-issue-processor と対称、実装が軽い
- **cons**: 「なぜ改善してほしいか」の文脈がラベル以外にない

#### 案 T2: PR コメントコマンド方式

- 人が PR に `/ai-refine XXX` のようなスラッシュコマンドコメントを投稿
- n8n が **GitHub Webhook** または **定期ポーリング** で検知
- コメント本文（`XXX` の部分）を再調査の追加コンテキストとして agent に渡せる
- **pros**: 再調査の意図 / フォーカスを伝えられる、レビュアーの UX が良い
- **cons**: webhook 設定 or コメントポーリングロジックが増える

#### 案 T3: ハイブリッド

- PR コメント `/ai-refine` or ラベル `ai-refine-requested` どちらでも受ける
- コメントは優先的に本文を拾う

**推奨は案 T2（コメント）**。理由:

1. **レビュアーの自然な UX**: 「ここの定義が曖昧なので再調査して」と PR 上で書ける = そのまま agent に渡る
2. **文脈が乗る**: Collector の代わりに "PR コメント本文 + 既存調査ノート" を初期入力に使える
3. **Issue 経路と完全分離**: Issue 側には一切触らない

### なぜコメントが重要か: PR に載っていないコードの探索精度

Agent（Code Investigator）は `Read`, `Grep`, `Glob`, `git log`, `git blame` でコードベースを自由に探索できるため、PR diff に含まれないファイルも調査可能。ただし **探索の起点となるヒントの有無で精度が大きく変わる**。

| ケース | AI の挙動 |
| --- | --- |
| コメントで「認証ミドルウェアとの整合性を確認して」 | `Grep` で auth middleware を探し、関連ファイルを `Read` して確認できる |
| コメントで「`src/billing/` の課金ロジックも影響するはず」 | 指定パスを直接 Read できるので確実 |
| ラベルだけ（`ai-refine-requested`） | 既存の調査ノートと PR diff しか手がかりがない。何が不足しているかを AI が自力で発見する必要があり、見落としのリスクが高い |

人間が「ここを見ろ」とヒントを出すほど精度が上がるのは、AI でも人間の同僚でも同じ。T1（ラベル）は最小構成として動くが、**実運用で価値が出るのは T2（コメントで探索の起点を渡せる方式）**。

### 静的解析ツールとの併用

PR に載っていない影響範囲（重複コード、類似パターン、未使用の依存関係など）を漏れなく検出するには、AI の自由探索だけに頼るより **静的解析ツールの出力を Agent の入力に含める** 方が確実。

想定する併用パターン:

| 検出対象 | ツール例 | 併用方式 |
| --- | --- | --- |
| 重複・類似コード | jscpd, PMD CPD | refine pipeline の前段で実行し、検出結果を Agent のコンテキストに注入 |
| 未使用 export / dead code | ts-prune, knip | 同上 |
| 依存関係の影響範囲 | madge, dependency-cruiser | 変更ファイルから影響グラフを辿り、Agent に「このファイルも確認すべき」と渡す |
| 型の不整合 | tsc --noEmit | 型エラーのリスト自体が「見るべき場所」のヒントになる |

**方針: Phase 1 では静的解析を組み込まない。** まず T2 コメント方式で人間がヒントを渡す運用を確立し、「人間が毎回同じ種類の指摘を繰り返す」パターンが見えたら、その指摘を静的解析ツールで自動化する。ツールの選定は対象リポジトリの言語・フレームワークに依存するため、汎用パイプラインに組み込むのではなく **対象リポジトリの devcontainer に静的解析ツールをインストールし、refine pipeline の前段で実行 → 結果を Agent に渡す** 構成にする。これなら ai-pr-refiner 自体は言語非依存のまま保てる。

### 案 T2 の具体化: 最新メンション方式

スレッド内で **最新のメンション 1 件** だけを追加調査のトリガーにする。これにより「同じスレッドで何度も言い直しても最新の指示だけが反映される」という自然な UX になり、過去の処理済みメンションを再実行する心配もない。

#### "最新" の定義: 案 B（bot 返信を state marker にする）

候補が 3 つある:

- **案 A: 単純に timestamp の最大** — 毎回 "最新のメンション" を取りに行く。stateless で実装は一番軽いが、bot が処理済みでも再起動時に再処理されてしまう
- **案 B: 最後の bot 返信より新しいメンション（推奨）** — bot が refine 完了コメントを投稿したあと、そのコメントより新しいメンションがあれば処理対象にする。GitHub の comment history を state machine として使うため、n8n static data に状態を持たせなくて済む
- **案 C: 処理済み comment ID を n8n static data に LRU で持つ** — 案 B と同等の効果だが state を n8n 側に寄せる。workflow import でリセットされうる懸念あり

**推奨は案 B**。GitHub 側の comment を signal source にしている以上、GitHub の comment history を state machine として使う方が整合性が取れる。実装は `gh api` の出力を降順で舐めて "bot 返信より前の最新メンション" を 1 件拾うだけで済む。

```bash
# 擬似コード（実装イメージ）
gh api "/repos/${OWNER}/${REPO}/issues/${PR_NUM}/comments" \
  --jq '
    sort_by(.created_at)
    | . as $all
    | (map(select(.user.login == "min-factory-bot")) | last) as $last_bot
    | $all
    | map(select(.user.login != "min-factory-bot"))
    | map(select(
        ($last_bot == null) or (.created_at > $last_bot.created_at)
      ))
    | map(select(.body | test("@min-factory-bot")))
    | last
  '
```

この 1 クエリが空配列を返せば「処理すべき新しいメンションなし」= ワークフローは何もせず終了。1 件返れば「その 1 件」を今回の refine トリガーとして処理する。

#### スレッドの範囲

「スレッド内」をどう解釈するかで拾うコメントの集合が変わる:

- **(a) PR 本体の conversation コメント** — `/repos/O/R/issues/N/comments`
- **(b) PR review コメント（コード行に紐付く）** — `/repos/O/R/pulls/N/comments`
- **(c) 両方**

**推奨は (c)**。(b) のほうがコード上の具体的な行に紐付いていて文脈が濃いので、拾わないとむしろ損。両方を取得して降順ソート → bot 返信を区切りに最新メンション 1 件を採用する。(b) の review コメントはさらに `in_reply_to_id` で review thread を遡れるので、Agent に渡すコンテキストを組み立てるときに活用する（後述）。

#### メンション識別子

トリガー文字列は `@claude` ではなく **`@min-factory-bot` のような自前 identifier** を使う。理由は Anthropic 公式の [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) が `@claude` メンションを使っており、将来同じリポジトリに公式 Action を入れたときに「どちらが反応するか曖昧」になるのを避けるため。

bot identifier は

- GitHub 上の bot user（Fine-grained PAT の owner となる machine user）の login 名と一致させる
- `min-factory-bot` や `<project>-investigator-bot` のような、役割と紐付いた名前にする
- `.env` 経由で `REFINE_BOT_LOGIN` として pipeline script に注入可能にしておく

#### Agent に渡すコンテキスト

トリガーは「最新メンション 1 件」だが、Agent に渡す input は **そのメンションが所属するスレッド全体 + 既存調査ノート + PR diff** にする。最新メンションだけを渡すと文脈（なぜその指摘が来たのか、前の議論で何が決まっていたのか）が失われ、Synthesizer の差分更新の精度が落ちる。

具体的には次の 4 つを Collector の代替として組み立て、Code Investigator 以降に渡す:

1. **最新メンションの本文** — 指示そのもの。Gatekeeper の feedback と同じ扱い
2. **最新メンションが所属するスレッドの全コメント** — (b) review コメントなら `in_reply_to_id` を遡って thread を再構築、(a) PR conversation なら単純に時系列で前後 N 件
3. **既存の調査ノート** (`openspec/investigations/issue-N-investigation.md`)
4. **PR の diff** — Synthesizer が「今ノートはこの実装前提で書かれている」と理解するため

これにより Synthesizer は差分モード（既存ノートをベースに該当箇所だけ修正 + 必要に応じて新セクション追加）で走れる。

## Git 戦略: 既存ブランチへの追加コミット

再調査では **既存ブランチに追加コミットを積む** 方式を採る。force push や履歴刷新はしない。

```bash
# 再調査 workflow の末尾
git fetch origin
git checkout issues/${N}                        # 既存ブランチに切り替え
# Synthesizer が既存 note を差分モードで更新
git add note.md
git commit -m "investigate: refine investigation note for issue #${N} (round ${R})"
git push origin issues/${N}                     # 通常 push
```

### なぜ force push ではなく追加コミットか

- **PR レビューコメントの行アンカーが壊れない** — force push で履歴を刷新すると、レビュアーが付けたコード行コメントの紐付きが失われる。追加コミットなら既存コメントはそのまま残り、レビュー文脈が積み上がっていく
- **「何回目の改善で何が変わったか」が PR のコミット履歴にそのまま残る** — commit message に `(round ${R})` を入れて追跡可能にする
- **force-with-lease の race を考えなくて済む** — 通常 push で完結する
- **PR 自体は一度も破壊されない** — Draft PR の identity（番号・URL・レビュー履歴）が保たれる

### round 番号の採番

round は `git log --grep="refine investigation note for issue #${N}"` の件数 +1 で決める。state を外に持たず、ブランチの履歴だけから決定する。

## 新ワークフローの agent 構成

初回と違って "全部再調査" はコストが高いので、以下のように軽量化できる:

```text
ai-pr-refiner:
  Collector (省略可)    – 既存ノートと PR コメントから context を組み立てるだけ
  Code Investigator     – コメントで指摘された箇所に focus
  Web Investigator      – コメントで指摘された外部情報に focus
  Synthesizer (diff)    – 既存ノートをベースに差分更新（Write ツール）
  Gatekeeper            – 品質確認
```

特に **Synthesizer が「既存ノートをベースに差分で更新」する** プロンプトに切り替えるのがキー。全文書き直しではなく、指摘箇所だけを修正 + 必要なら新セクション追加。

## PR に結果コメントを返す

再調査が完了したら PR に結果サマリコメントを投稿する想定:

```text
@reviewer のフィードバックに基づいて以下を更新しました (round 2):

- 活三の定義を RIF 公式ルール (renju.net) に準拠する形で修正
- 三三禁手の例外条件 (Rule 9.3) を追加
- 品質スコア: 71 → 82

差分: https://github.com/.../pull/7/commits/<new-sha>
```

これで `/ai-refine` → 結果 PR コメント → 人間がそれを見て approve or 次の refine 依頼、のループが人と AI の間で自然に回る。

## Slack 通知

初回調査と修正モードは Slack 上でも区別できるようにする:

- **初回**: 既存の通知フォーマット（新規 PR 作成を告知）
- **修正**: 同じ PR スレッドに「refine round N 完了」として追記、または prefix で区別
- どちらも同じ PR の Slack スレッドにまとまるのが理想

## 実装難易度の比較

| 要素                    | 案 T1（ラベル）    | 案 T2（コメント）                               |
| --------------------- | ------------ | ---------------------------------------- |
| n8n Trigger           | Schedule（既存） | Schedule + Issue Comment node or Webhook |
| Workflow 数            | +1           | +1                                       |
| Synthesizer prompt 分岐 | 不要（全文生成のまま）  | 差分モード prompt が欲しい                        |
| Git 戦略                | 追加コミット       | 追加コミット                                   |
| Slack 通知              | 既存の仕組み流用可    | 既存流用 + コメント本文を通知に含めると親切                  |
| 実装コスト                 | 小            | 中                                        |

## 段階的な移行計画

まず **案 T1（PR ラベル方式）を最小構成で作って** 動作を確立し、その後 **案 T2（コメントコマンド）に拡張** するのが無理のない進め方。

### 最小構成の実装チェックリスト

1. [ ] 新ワークフロー `ai-pr-refiner.json` を新設（Schedule 15 分間隔）
2. [ ] `labels.json` に `ai-refine-requested` / `ai-refining` / `ai-refined` / `ai-refine-failed` を定義
3. [ ] `gh pr list --label "ai-refine-requested" --state open` で対象 PR を取得
4. [ ] PR の head branch から worktree 作成（既存 create-worktree.sh 流用）
5. [ ] `ai-refining` にラベル付け替え（ガード）
6. [ ] 新 pipeline script `n8n-run-refine-pipeline.sh`（現 pipeline の派生、Synthesizer を差分モードに）
7. [ ] `n8n-run-claude.sh` をモード切り替え対応に拡張（初回 / refine で別プロンプトを選択）
8. [ ] PR レビューコメントを取得して Agent の入力に含める
9. [ ] 既存ブランチに追加コミット + 通常 push（force push しない）
10. [ ] PR にコメント投稿（新しい diff URL + スコア + round 番号）
11. [ ] `ai-refined` or `ai-refine-failed` に遷移
12. [ ] Slack 通知（既存 Slack スレッドに追記、初回 / refine で区別）
13. [ ] Issue 側の二重起動ガード: `ai-investigated` が付いた Issue への `ai-ready` 再付与を初回ワークフローで無視

## 完了条件

- PR 側のトリガー（ラベル or コメント）で修正モードが起動する
- 修正モードでは既存 PR が特定され、PR レビューコメントが Agent の入力に含まれる
- 既存ブランチに追加コミットが積まれ、新規 PR は作られない
- force push は行われず、レビューコメントの行アンカーが保たれる
- `ai-investigated` が付いた Issue への `ai-ready` 再付与は初回フローで無視される
- Slack 通知で初回と修正が区別できる（または同じ PR スレッドにまとまる）
- 再調査完了時に PR に結果サマリコメントが投稿される

## 全体アーキテクチャとしての位置づけ

現状の ai-issue-processor を進化させる上で **Issue workflow のパターン A 化（既存 PR があれば早期リターン）と、この PR refine workflow の新設はセット** で考えるとスッキリする。

- **Issue workflow** = 「まだ PR が無い Issue」だけを処理
- **PR workflow** = 「既に PR がある状態で追加調査したい」を処理
- それぞれ別のトリガー、別のラベル、別のロジック

このほうが全体アーキテクチャとして綺麗になる。

## 関連ドキュメント

- [ai-issue-processor](../ai-issue-processor/README.md) — 初回調査ワークフロー
- [ai-stuck-cleanup](../ai-stuck-cleanup.md) — スタック検知・回収ワークフロー
