# AI Issue Processor アーキテクチャ

本ドキュメントは `ai-issue-processor` ワークフローの全体像と、DevContainer + Worktree + 4 段エージェントパイプラインという構成を採った理由をまとめる。目次は [README.md](./README.md)、n8n 側のノード構成・失敗通知・タイムアウト設計などの詳細は兄弟ドキュメント（[flow.md](./flow.md) / [slack.md](./slack.md) / [agent_pipeline.md](./agent_pipeline.md)）を参照。

## 全体フロー

```text
n8n (Docker コンテナ)
  │ 10 分ごとに ai-ready ラベルの Issue をポーリング
  │
  ├─ Issue あり
  │   ├─ 1. ai-processing ラベルを付与
  │   ├─ 2. n8n-run-claude-pipeline.sh <issue-number> を executeCommand で呼び出し
  │   │     ├─ 2a. create-worktree.sh      → ホストに git worktree を作成（冪等）
  │   │     ├─ 2b. start-devcontainer.sh   → worktree 上で DevContainer を起動（冪等）
  │   │     └─ 2c. DevContainer 内で 4 段エージェントパイプラインを順次実行
  │   │          Collector → Code Investigator → Web Investigator
  │   │          → Synthesizer → Gatekeeper
  │   │          （Gatekeeper fail 時のみ Synthesizer / Gatekeeper rerun）
  │   ├─ 3. シェル側で git commit + push + gh pr create を実行
  │   ├─ 4. cleanup-worktree.sh で worktree / DevContainer を片付け（成功時のみ）
  │   └─ 5. Issue に PR URL をコメント投稿 → ai-investigated ラベル付与
  │
  └─ Issue なし → 何もしない

失敗時:
  → Set ai-failed label
  → Post Error Comment（失敗エージェント名 + 秘匿スクラブ済みエラー本文）
  → Slack に失敗通知（スレッド返信 + チャンネル再露出）
  → worktree は調査用に残す（ai-stuck-cleanup が後で回収）
```

---

## なぜ DevContainer + Worktree + 4 段パイプラインなのか

### 選択の経緯

| 案                                  | 問題点                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| ホストで直接実行                    | ホストに Claude Code / gh CLI をグローバルインストールが必要                        |
| SSH 経由でホスト実行                | macOS リモートログイン設定・鍵管理が煩雑。`:ro` マウントで known_hosts 書き込み不可 |
| 専用コンテナ（claude-runner）       | 開発者の環境と AI の環境が乖離する                                                  |
| **DevContainer + Worktree（採用）** | 開発者と同じ環境で AI が動く・並列実行可能・ホストを汚染しない                      |

| 調査方式                                 | 問題点                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| 単発 `claude --print /investigate {N}`   | 1 プロセスに全部詰めるのでコンテキスト汚染・長時間化・部分失敗の扱いが雑になる      |
| **4 段エージェントパイプライン（採用）** | 役割ごとに context を絞り、品質を Gatekeeper で自動採点し、失敗の粒度を細かく取れる |

### DevContainer のメリット

- 開発者が VS Code で使う環境と同一 → 「手元では動くのに AI が失敗する」を排除
- 対象リポジトリの Docker Compose も起動可能 → 開発環境を完全に再現
- インターネット接続・ソースコード参照・MCP サーバー参照が可能

### Worktree のメリット

- 並列実行: Issue ごとに独立した作業ディレクトリ
- 高速: `.git` を共有するためクローン不要
- 省ディスク: ソースコードのコピーのみ

### 4 段エージェントパイプラインのメリット

- **コンテキスト分離**: 各 agent は独立した `claude --print` 呼び出しなので、前段の試行錯誤が後段の context を食い潰さない
- **役割特化**: Collector は Issue 解析、Code Investigator はコードベース探索、Web Investigator は外部情報調査、Synthesizer は統合と Markdown 生成、Gatekeeper は品質採点 — それぞれシステムプロンプトで許可ツールを絞り込める
- **品質の自動ゲート**: Gatekeeper が 100 点満点（Web 調査スキップ時は 80 点満点）で採点し、pass 閾値未満なら Synthesizer を feedback 付きで 1 回だけ再実行する
- **失敗の粒度**: パイプライン側で各 agent の exit code / stdout / stderr を個別に捕捉し、失敗通知で「どの agent でどんな内容を出して落ちたか」を Slack / GitHub コメントに秘匿スクラブ済みで流せる
- **決定論的な git 操作**: commit / push / PR 作成はシェルから実行するので、LLM の揺らぎの影響を受けない

---

## コンポーネント構成

```text
min-n8n-factory/
├── docker-compose.yml              # n8n サービス（docker socket / scripts / prompts マウント）
├── Dockerfile.n8n                  # n8n + docker CLI + git + jq + devcontainer CLI
├── scripts/
│   ├── n8n-run-claude-pipeline.sh  # 4 段パイプラインのエントリポイント
│   ├── create-worktree.sh          # worktree 作成（冪等）
│   ├── start-devcontainer.sh       # DevContainer 起動（冪等）
│   ├── cleanup-worktree.sh         # worktree / DevContainer 片付け
│   ├── import-workflow.sh          # ワークフローインポート（冪等）
│   ├── setup-labels.sh             # ラベル配布
│   ├── setup-issue-template.sh     # Issue テンプレート配布
│   ├── setup-skills.sh             # Claude Skills 配布
│   ├── setup-devcontainer.sh       # DevContainer 設定配布
│   └── slack-notify-pkg/           # n8n Code ノードが require する Slack 通知ロジック
├── prompts/
│   └── agents/                     # 4 段パイプラインの system prompt 5 本
│       ├── collector.md
│       ├── code-investigator.md
│       ├── web-investigator.md
│       ├── synthesizer.md
│       └── gatekeeper.md
├── templates/
│   ├── devcontainer/               # DevContainer テンプレート（Dockerfile / devcontainer.json）
│   ├── skills/                     # Claude Skills テンプレート
│   └── scripts/                    # 対象リポジトリ用スクリプト
└── workflows/
    ├── ai-issue-processor.json     # n8n メインワークフロー定義
    └── ai-stuck-cleanup.json       # stuck Issue 回収ワークフロー

対象リポジトリ（例: gomoku-nextjs）
├── .devcontainer/                  # setup-devcontainer で配布済み
├── .claude/skills/                 # setup-skills で配布済み
├── .worktrees/                     # .gitignore に追加
│   ├── issue-2/                    # Issue #2 用の作業コピー
│   └── issue-5/                    # Issue #5 用の作業コピー（並列実行時）
└── src/
```

---

## 各スクリプトの役割

### n8n-run-claude-pipeline.sh

4 段エージェントパイプラインのエントリポイント。n8n の `Run Claude Code`（ExecuteCommand）ノードから `/opt/scripts/n8n-run-claude-pipeline.sh <issue-number>` で呼ばれる。

- positive integer バリデーション、タイムアウト予算の不変条件 runtime check
- `create-worktree.sh` / `start-devcontainer.sh` の順に呼び出し、以降は `dc_exec`（= `devcontainer exec`）経由で各 agent を順次実行
- agent ごとに stdout / stderr / exit code を個別 temp file にキャプチャし、`jq -e` でスキーマ検証
- `search_hints` が空なら Web Investigator をスキップし 80 点満点に切り替え。Web Investigator が失敗したケースも同様にスキップ扱いとし、`WEB_SKIP_REASON=no_hints|web_failed` を stdout に emit
- Gatekeeper の `.pass` はシェル側で `SCORE >= PASS_THRESHOLD` に再計算（agent のハルシネーション対策）
- 低スコア時のみ Synthesizer と Gatekeeper を 1 回だけ rerun し、通知用に `QUALITY_SCORE_RERUN=X/Y` も stdout に emit
- 成功時のみ `cleanup-worktree.sh` を呼ぶ。失敗時は worktree を残して調査可能にする
- 失敗時は `=== pipeline failed at agent=<name> (exit=<N>, reason=<text>) ===` デリミタ付きで stderr に出力し、n8n 側の `resolveFailureError` → `scrubSecrets` 経路に合流する

### create-worktree.sh

```bash
PROJECT_PATH=/path/to/repo bash scripts/create-worktree.sh <issue-number>
# stdout: /path/to/repo/.worktrees/issue-42
```

- `origin/main` を起点に `issues/{number}` ブランチを作成
- 既に worktree が存在する場合はパスだけ返す（冪等）
- リモートにブランチがあればそれをチェックアウト

### start-devcontainer.sh

```bash
bash scripts/start-devcontainer.sh <worktree-path>
# stdout: d151d705f073...  (コンテナ ID)
```

- `devcontainer up --workspace-folder <worktree-path>` で DevContainer を起動
- 既に起動済みなら再利用（冪等）
- 初回はイメージビルドが発生（2 回目以降はキャッシュ利用）

### cleanup-worktree.sh

- DevContainer を停止し、worktree を削除
- パイプラインが成功したときだけ呼ばれる。失敗時は意図的に worktree を残す

---

## 認証方式

### Claude Code（Max プラン）

`CLAUDE_CODE_OAUTH_TOKEN` 環境変数で認証する。API キーは不要。

- `claude setup-token` で 1 年間有効な OAuth トークンを生成（[公式ドキュメント](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)）
- トークンは `.env` に保存 → `docker-compose.yml` で n8n コンテナに渡す → `devcontainer.json` の `remoteEnv` + `${localEnv:...}` で DevContainer に渡る
- Max プランの OAuth トークンは macOS キーチェーンに保存されるため、ファイルマウント方式ではコンテナに渡せない。環境変数方式を採用（[環境変数リファレンス](https://code.claude.com/docs/en/env-vars)）

```bash
# トークン生成
claude setup-token

# .env に保存
CLAUDE_CODE_OAUTH_TOKEN=<生成されたトークン>
```

> 詳細な検討経緯は [run-claude-design.md](../../devcontainer/run-claude-design.md) を参照。

### GitHub

- **n8n GitHub ノード用**: Fine-grained PAT を n8n Credentials に登録（暗号化保存）
- **DevContainer 内の gh / git 用**: `GH_TOKEN` 環境変数で渡す（`devcontainer.json` の `remoteEnv`）。パイプラインスクリプトの commit / push / `gh pr create` でも同じトークンを使う
- **n8n コンテナ内の git fetch 用**: `GH_TOKEN` で SSH → HTTPS 変換（`git config url.insteadOf`）

---

## n8n ワークフローの実行フロー

```text
Schedule 10min
  → Get oldest ai-ready Issue（Repository → Get Issues + ラベルフィルタ）
  → If（Issue が存在するか: !!$json.number）
  → Set ai-processing label
  → Slack: 処理開始（親メッセージ、以降はすべてスレッド返信）
  → Run Claude Code（/opt/scripts/n8n-run-claude-pipeline.sh {N} を executeCommand）
  → Post PR Link to Issue
  → Set ai-investigated label
  → Slack: 調査完了（品質スコア付き、reply_broadcast=true）

エラー時:
  → Set ai-failed label
  → Build failure payload（resolveFailureError → scrubSecrets）
  → Post Error Comment（GitHub Issue）
  → Slack: 処理失敗（スレッド返信 + reply_broadcast=true）
```

- ノードの役割一覧は [flow.md](./flow.md)
- Slack 通知の設計は [slack.md](./slack.md)
- 4 段パイプラインの JSON スキーマ / 採点基準 / 再実行ポリシー / コスト構造は [agent_pipeline.md](./agent_pipeline.md)

---

## 関連ドキュメント

- [README.md](./README.md) — このワークフローの目次
- [flow.md](./flow.md) — 実行フロー全体図、n8n ノードの役割表、タイムアウトとリトライ
- [slack.md](./slack.md) — Slack 通知の設計（品質スコア、失敗通知、ts 永続化）
- [agent_pipeline.md](./agent_pipeline.md) — 4 段エージェントの JSON スキーマ、採点基準、コスト構造
- [../../devcontainer/env-flow.md](../../devcontainer/env-flow.md) — 環境変数とトークンフロー、docker-compose.yml のマウント / 環境変数、パス規約の不変条件
- [../../devcontainer/run-claude-design.md](../../devcontainer/run-claude-design.md) — `claude --print` 実行方式の検討経緯と失敗モード
- [../../devcontainer/setup-devcontainer.md](../../devcontainer/setup-devcontainer.md) — 対象リポジトリへの DevContainer 配布手順
- [../../devcontainer/references.md](../../devcontainer/references.md) — 外部参考リンク集
