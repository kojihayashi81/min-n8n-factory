# エージェントパイプライン

`ai-issue-processor` ワークフローが `Run Claude Code` ノードで実行する 4 段エージェントパイプラインの設計詳細。

全体像は [README.md](./README.md)、n8n ノードの配線は [flow.md](./flow.md)、Slack 通知の設計は [slack.md](./slack.md) を参照。

## 設計の狙い

単発の `claude --print` で「Issue 解析 + コード調査 + Web 調査 + 調査ノート生成 + PR 作成」を全部やらせると、
Web 検索結果やツール呼び出し履歴がコンテキストを肥大化させ、後半の「調査ノートをテンプレート通りに書く」フェーズの品質が落ちやすい。
役割ごとに `claude --print` を分離し、各エージェントのコンテキストウィンドウを最小化することで、同じコストでも出力品質を安定させる。

## パイプライン概要

```text
Collector（軽量）
  ↓  Issue 解析結果 + 関連ファイル一覧（JSON）
Investigator
  ├─ Code（コードベース調査）
  │    ↓  コード調査結果（JSON）
  └─ Web（外部情報調査、Code 結果を入力に使用）
       ↓  Web 調査結果（JSON）
Synthesizer
  ↓  調査ノート（Markdown、テンプレート準拠）
Gatekeeper（軽量）
  ├─ pass (score ≧ 70) → PR 作成 + Slack 通知
  └─ fail (score < 70) → Synthesizer を feedback 付きで 1 回だけ再実行
                          → 再実行後は score に関わらず PR 作成 + Slack 通知
```

## Agent 1: Collector

Issue の内容を解析し、後続エージェントに渡すコンテキストを整理する。自身ではコード読みや Web 検索を行わない。

| 項目 | 内容 |
| --- | --- |
| 目的 | Issue 本文・ラベル・コメントから調査方針を立て、初期コンテキストを構造化する |
| 入力 | `gh issue view` の JSON 出力（number, title, body, labels, comments） |
| 出力 | JSON: `issue_summary`, `investigation_focus`, `initial_keywords`, `linked_urls` |
| ツール | なし（入力テキストの解析のみ） |
| max-turns | 1 |
| 制約 | コード読み・Web 検索を行わない。Issue 本文に含まれる URL は `linked_urls` に抽出するが、フェッチしない |

出力スキーマ:

```json
{
  "issue_summary": "Issue の内容を 1〜2 文で要約",
  "investigation_focus": ["最初に調べるべきポイント1", "ポイント2"],
  "initial_keywords": ["検索キーワード候補1", "候補2"],
  "linked_urls": ["Issue 本文中の URL1", "URL2"]
}
```

## Agent 2: Investigator

調査の本体。Code → Web の直列構成で、Code の結果が Web の検索クエリを決定する。

### Agent 2a: Code Investigator

コードベースを調査し、現状の実装を把握する。

| 項目 | 内容 |
| --- | --- |
| 目的 | 関連ファイル・関数・型を特定し、現状の実装パターンと影響範囲を明らかにする |
| 入力 | Collector の出力 JSON |
| 出力 | JSON: `related_files`, `tech_stack`, `current_behavior`, `impact_scope`, `existing_investigations`, `search_hints` |
| ツール | Read, Grep, Glob, Bash(git log / git blame / cat), 既存調査ノート参照 |
| max-turns | 制限なし（コードベースの規模に依存） |
| 制約 | Web 検索を行わない。実装コードを書かない |

出力スキーマ:

```json
{
  "related_files": [
    {
      "path": "src/auth/token.ts",
      "lines": "42-78",
      "summary": "JWT トークン検証ロジック"
    }
  ],
  "tech_stack": [
    {"name": "jsonwebtoken", "version": "8.5.1", "usage": "トークン署名・検証"}
  ],
  "current_behavior": "現状の動作を 1〜3 文で記述",
  "impact_scope": ["src/auth/*", "src/middleware/auth.ts", "tests/auth/*"],
  "existing_investigations": [
    {"path": "openspec/investigations/issue-15-investigation.md", "summary": "類似の認証問題"}
  ],
  "search_hints": [
    "jsonwebtoken expiresIn not refreshing",
    "JWT token renewal best practice Node.js"
  ]
}
```

`search_hints` は Code Investigator がコード調査を踏まえて「Web で何を調べるべきか」を明示的に指示するフィールド。Issue 文面だけでは検索クエリの解像度が不足するケースを解消する。

### Agent 2b: Web Investigator

Code Investigator の結果を踏まえて、外部情報を調査する。

| 項目 | 内容 |
| --- | --- |
| 目的 | 特定されたライブラリの既知問題・公式ドキュメント・類似 Issue・移行ガイドを調査する |
| 入力 | Collector の出力 JSON + Code Investigator の出力 JSON |
| 出力 | JSON: `official_docs`, `similar_issues`, `constraints`, `migration_notes` |
| ツール | WebSearch |
| max-turns | 3 |
| 制約 | コードベースを読まない。`search_hints` を優先的に検索する。Collector が抽出した `linked_urls` も確認する |

出力スキーマ:

```json
{
  "official_docs": [
    {"url": "https://...", "finding": "v3.x で expiresIn の挙動が変更された"}
  ],
  "similar_issues": [
    {"url": "https://github.com/.../issues/234", "finding": "同様の問題、workaround あり"}
  ],
  "constraints": "ライブラリ X は Node 18 以上が必須（v2.0 breaking change）",
  "migration_notes": "v2 → v3 移行ガイド: https://..."
}
```

`search_hints` が空の場合（Code Investigator が Web 検索不要と判断した場合）、Web Investigator は `initial_keywords`（Collector 出力）をフォールバックとして使用する。

## Agent 3: Synthesizer

Code と Web の調査結果を統合し、調査ノートを生成する。

| 項目 | 内容 |
| --- | --- |
| 目的 | 2 つの調査結果を突き合わせ、矛盾を検出し、テンプレートに沿った調査ノートを生成する |
| 入力 | Collector の出力 JSON + Code Investigator の出力 JSON + Web Investigator の出力 JSON |
| 出力 | Markdown: `investigation-note-template.md` に準拠した調査ノート |
| ツール | Write（調査ノートの保存）, Bash(git / gh) |
| max-turns | 制限なし |
| 制約 | 新たなコード読みや Web 検索を行わない。入力された情報のみで構成する。矛盾する情報は要確認事項に残す（憶測で解決しない） |

Synthesizer の責務:

1. **情報の突き合わせ**: コード上の実装と Web 上のドキュメント/既知問題を照合し、ギャップや矛盾を発見する（例: 「コード上は v2 の API を使用しているが、Web 調査で v3 で非推奨と判明」）
2. **重み付け**: 一次情報（公式ドキュメント・ソースコード）を二次情報（フォーラム・Stack Overflow）より優先する
3. **テンプレート準拠**: `investigation-note-template.md` の全セクションを埋める。Code Investigator の `related_files` は「調査プロセス」セクションに、Web Investigator の URL は「外部参考ソース」セクションにそれぞれ配置する
4. **矛盾の明示**: 調査結果間で矛盾する情報は「要確認事項」に残し、憶測で解決しない（`investigation-guide.md` の方針に従う）

再実行時（Gatekeeper fail 後）は、Gatekeeper の `feedback` を追加入力として受け取り、指摘箇所を改善した調査ノートを再生成する。

## Agent 4: Gatekeeper

調査ノートの品質を採点し、pass / fail を判定する。

| 項目 | 内容 |
| --- | --- |
| 目的 | 調査ノートをチェックリストで採点し、品質が基準を満たすか判定する |
| 入力 | Synthesizer が生成した調査ノート（Markdown） |
| 出力 | JSON: `score`, `pass`, `details`, `feedback` |
| ツール | なし（入力テキストの評価のみ） |
| max-turns | 1 |
| 制約 | 調査ノートの内容を修正しない。採点と feedback の出力のみ |

採点基準（各 0〜20 点、合計 100 点）:

| # | チェック項目 | 観点 |
| --- | --- | --- |
| 1 | 調査プロセスの透明性 | 検索したファイル・関数が具体的に記載されているか。「認証周辺」のような曖昧な記述ではなく `src/auth/token.ts:42-78` レベルの解像度があるか |
| 2 | 根拠の具体性 | 主張にファイルパス・行番号・URL が紐付いているか。根拠のない推測が含まれていないか |
| 3 | 影響範囲の網羅性 | 変更が波及するファイル・モジュール・テストを漏れなく特定しているか |
| 4 | 要確認事項の誠実さ | 不確かな点を憶測で埋めず正直に残しているか。逆に、調査で判明しているはずの内容を不必要に「要確認」にしていないか |
| 5 | テンプレート準拠 | `investigation-note-template.md` の全セクションが埋まっているか。「外部参考ソース」に URL が記載されているか（Web 調査の成果が反映されているか） |

出力スキーマ:

```json
{
  "score": 75,
  "pass": true,
  "details": {
    "process_transparency": {"score": 18, "note": "ファイルパスが具体的"},
    "evidence_specificity": {"score": 15, "note": "一部の主張に根拠 URL がない"},
    "impact_coverage": {"score": 14, "note": "テストファイルへの影響が未記載"},
    "honesty_of_unknowns": {"score": 16, "note": "要確認事項が適切"},
    "template_compliance": {"score": 12, "note": "外部参考ソースが空"}
  },
  "feedback": "テストファイルへの影響範囲を追加し、外部参考ソースに Web 調査で見つかった URL を記載してください"
}
```

## 再実行ポリシー

- Gatekeeper の `pass` が `false`（score < 70）の場合、Synthesizer を `feedback` 付きで **1 回だけ** 再実行する
- 再実行時の Synthesizer は、元の入力（Collector + Code + Web の各出力）に加えて Gatekeeper の `feedback` を受け取り、指摘箇所を改善した調査ノートを再生成する
- 再実行後は Gatekeeper を再度実行 **しない**。score に関わらず PR 作成と Slack 通知に進む（無限ループ防止）
- Collector・Code Investigator・Web Investigator は再実行しない（調査のやり直しではなく、統合・記述の品質を改善するため）

## パイプラインのエラーハンドリング

各エージェントは独立した `claude --print` 呼び出しのため、個別に失敗し得る。

| 失敗箇所 | 挙動 |
| --- | --- |
| Collector | パイプライン全体を失敗として扱う。後続エージェントの入力が作れないため |
| Code Investigator | パイプライン全体を失敗として扱う。コード調査なしでは調査ノートの品質が担保できないため |
| Web Investigator | **パイプラインを続行する**。Web 調査結果を空 JSON として Synthesizer に渡す。コード調査だけでも調査ノートは生成可能 |
| Synthesizer | パイプライン全体を失敗として扱う |
| Gatekeeper | **パイプラインを続行する**。採点なしで PR 作成に進む（品質チェックはベストエフォート） |
| Synthesizer 再実行 | **パイプラインを続行する**。初回の調査ノートで PR 作成に進む |

パイプライン全体の失敗時は、既存の失敗フロー（`Set ai-failed label` → `Build failure payload` → `Post Error Comment` → `Slack: 処理失敗`）がそのまま動作する。詳細は [slack.md の失敗通知の情報量](./slack.md#失敗通知の情報量) を参照。

## エージェントごとのタイムアウト

パイプライン全体のタイムアウトは `CLAUDE_TIMEOUT_SEC`（デフォルト 600 秒）で制御し、各エージェントには個別のタイムアウトを持たせる。

| エージェント | 個別タイムアウト | 備考 |
| --- | --- | --- |
| Collector | 60 秒 | テキスト解析のみのため短い |
| Code Investigator | 300 秒 | コードベースの規模に依存 |
| Web Investigator | 120 秒 | 検索 3 ターンまで |
| Synthesizer | 180 秒 | 統合・テンプレート適用 |
| Gatekeeper | 60 秒 | JSON 採点のみ |
| Synthesizer 再実行 | 180 秒 | Gatekeeper fail 後のみ |

全体のタイムアウト（`WORKFLOW_TIMEOUT_SEC` / `STUCK_THRESHOLD_SEC` との関係）は [flow.md のタイムアウトとリトライ](./flow.md#タイムアウトとリトライ) を参照。

## コスト構造

| エージェント | 相対コスト | 備考 |
| --- | --- | --- |
| Collector | 0.1x | テキスト解析のみ、ツール呼び出しなし |
| Code Investigator | 0.5x | コード読みに集中、Web 検索のコンテキスト汚染なし |
| Web Investigator | 0.3x | Code 結果ベースの高精度検索 |
| Synthesizer | 0.4x | 統合・テンプレート適用 |
| Gatekeeper | 0.1x | JSON 採点のみ |
| Synthesizer 再実行 | 0.4x | 発生率 30〜40% 想定 |

通常ケース（再実行なし）: 約 1.4x。再実行ありのケース: 約 1.8x。

単発実行と比較してコスト増は 1.4〜1.8 倍だが、各エージェントのコンテキストウィンドウが小さい（不要なツール結果が混入しない）ため、実際のトークン消費はこの見積もりより低くなる可能性がある。
