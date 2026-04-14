# フローとノード

`ai-issue-processor` ワークフローの実行フロー図、n8n ノードの役割、およびタイムアウト・リトライ設定。全体像は [README.md](./README.md)、調査処理そのものの設計は [agent_pipeline.md](./agent_pipeline.md) を参照。

## フロー

```text
Schedule 10min
  ↓
Get oldest ai-ready Issue (最も古い ai-ready Issue を1件取得)
  ↓
If (Issue が存在する && ai-processing が付いていない)
  ↓
Set ai-processing label (二重起動防止)
  ↓
Build start payload (Code) → Slack: 処理開始 (初回=親 / 再試行=元スレ返信)
  ↓
Persist thread ts (Code) (初回のみ workflow static data に ts を保存)
  ↓
Run Claude Code (/opt/scripts/n8n-run-claude-pipeline.sh)
  │
  │  ┌─────────────────────────────────────────────────────┐
  │  │ パイプライン内部（シェルスクリプト内で制御）         │
  │  │                                                     │
  │  │ 1. Collector      → context.json                    │
  │  │ 2. Code Investigator → code-result.json             │
  │  │ 3. Web Investigator  → web-result.json              │
  │  │ 4. Synthesizer    → 調査ノート.md                   │
  │  │ 5. Gatekeeper     → gate-result.json                │
  │  │ 6. (条件付き) Synthesizer 再実行 → 調査ノート.md    │
  │  │ 7. git commit + push + gh pr create                 │
  │  └─────────────────────────────────────────────────────┘
  │
  ├─ 成功 → Post PR Link to Issue → Set ai-investigated label → Build success payload (Code) → Slack: 調査完了 (スレッド返信 + channel broadcast)
  └─ 失敗 → Set ai-failed label → Build failure payload (Code) → Post Error Comment → Slack: 処理失敗 (スレッド返信 + channel broadcast)
```

## ノードの役割

| ノード | 役割 |
| --- | --- |
| `Schedule 10min` | 10 分間隔でワークフローを起動 |
| `Get oldest ai-ready Issue` | 最も古い `ai-ready` Issue を 1 件取得（`resource: repository` + `getRepositoryIssuesFilters` の `sort: created` + `direction: asc`） |
| `If` | Issue が存在し、かつ `ai-processing` が付いていないことを確認（二重起動防止） |
| `Set ai-processing label` | 処理開始時にラベルを `ai-processing` に変更 |
| `Build start payload` | Code ノード。`require('slack-notify')` で `buildStartMessage` を呼び Block Kit payload を生成。`$getWorkflowStaticData('global').slackThreads[issueNumber]` を参照し、既存があれば `threadTs` として渡す(再試行時はスレッド返信になる) |
| `Slack: 処理開始` | Slack ノード。初回は親メッセージ、再試行時は元スレッドへの返信として投稿する |
| `Persist thread ts` | Code ノード。`Slack: 処理開始` の返り値 `message_timestamp` を workflow static data に保存する。初回実行時のみ書き込み、再試行時はスキップ |
| `Run Claude Code` | `/opt/scripts/n8n-run-claude-pipeline.sh` を呼び出してエージェントパイプラインを実行する。成功時は stdout に PR URL を含む。失敗時はスクリプト内で各エージェントの exit code を捕捉し、失敗したエージェント名とエラー内容を stderr に出力してスクリプトを非 0 終了する。n8n ExecuteCommand ノードは失敗時に `error` / `stderr` フィールドへその内容を格納するので、後段の `Build failure payload` → `resolveFailureError` に実際の失敗理由が到達する |
| `Post PR Link to Issue` | 成功時、Issue に Draft PR リンクをコメント投稿。`onError: continueRegularOutput`（コメント投稿失敗で Slack 成功通知を道連れにしない） |
| `Set ai-investigated label` | 成功時、ラベルを `ai-investigated` に変更。`onError: continueRegularOutput`（ラベル変更失敗は `ai-stuck-cleanup` が後で回収する。ここで halt すると Slack 成功通知が届かない） |
| `Build success payload` | Code ノード。`slack-notify-pkg` の `buildPayloadForContext({ kind: 'success', ... })` を呼ぶ。内部で `extractPrUrl` が `Run Claude Code` の stdout から PR URL を正規表現抽出し、見つからなければ PR ボタン自体を Block Kit から除外する（Slack に "PR #—" プレースホルダーを出さない）。`threadTs` は `$getWorkflowStaticData('global').slackThreads[issueNumber]` を直接参照（Persist thread ts 済みの不変条件）。Gatekeeper の score が stdout に含まれる場合、成功メッセージに品質スコアを付記する |
| `Slack: 調査完了` | Slack ノード。成功時、元スレッドに返信しつつ `reply_broadcast: true` でチャンネルにも再露出 |
| `Set ai-failed label` | 失敗時、ラベルを `ai-failed` に変更 |
| `Build failure payload` | Code ノード。`slack-notify-pkg` の `buildPayloadForContext({ kind: 'failure', ... })` を呼び、Block Kit payload と「秘匿スクラブ済みエラーテキスト」(`errorText`)、および `$env.EXECUTION_LOG_BASE_URL` ベースの `executionUrl` を出力する。エラーテキストは `resolveFailureError` → `scrubSecrets` を経由して Slack トークン / GitHub PAT / Anthropic API key / `Authorization: Bearer` ヘッダーを `[REDACTED]` に置換済み。パイプラインのどのエージェントで失敗したかも `errorText` に含まれる |
| `Post Error Comment` | 失敗時、`Build failure payload` が生成した `errorText` をそのまま GitHub Issue コメント本文に使い、`resolveFailureError` のロジックを workflow 側に重複させない |
| `Slack: 処理失敗` | Slack ノード。`$('Build failure payload').first().json` から payload を参照し、元スレッドに返信しつつ `reply_broadcast: true` でチャンネルにも再露出（Post Error Comment の出力は GitHub API レスポンスなので `$json` からは直接取れない） |

## タイムアウトとリトライ

- **Claude Code タイムアウト**: `CLAUDE_TIMEOUT_SEC`（デフォルト 600秒）。`n8n-run-claude-pipeline.sh` 内で各エージェントの `claude --print` 呼び出しに個別のタイムアウトを設定する。パイプライン全体のタイムアウトは `timeout(1)` で制御し、超過時は現在実行中のエージェントと部分的な出力を stderr に含めて非 0 終了する。エージェントごとの内訳は [agent_pipeline.md のエージェントごとのタイムアウト](./agent_pipeline.md#エージェントごとのタイムアウト) を参照
- **ワークフロー実行タイムアウト**: `WORKFLOW_TIMEOUT_SEC`（デフォルト 780秒 = `CLAUDE_TIMEOUT_SEC` + Slack/GitHub API + devcontainer 起動バッファ 180秒）。n8n の `EXECUTIONS_TIMEOUT` に設定される
- **スタック判定しきい値**: `STUCK_THRESHOLD_SEC`（デフォルト 1200秒）。`WORKFLOW_TIMEOUT_SEC` と同値にすると「ギリギリ終わったジョブがスタック扱いされる」境界競合が起きるため、`WORKFLOW_TIMEOUT_SEC` の約 1.5 倍を持たせる
- **リトライ**: 失敗 Issue には `ai-failed` が付く。人間が `ai-ready` に戻せば次回のスキャンで再実行される。Slack スレッドは初回実行時のものが `$getWorkflowStaticData` 経由で再利用される
- **スタック検知**: 何らかの理由で `ai-processing` のまま残った Issue は [ai-stuck-cleanup](../ai-stuck-cleanup.md) が回収する
- **親メッセージ投稿失敗時**: `Slack: 処理開始` は `onError` を設定しておらず、失敗するとワークフロー全体が停止する（`ai-processing` ラベルが残り、`STUCK_THRESHOLD_SEC` 経過後に ai-stuck-cleanup が `ai-failed` に回収）。この方針は「1 Issue = 1 スレッド」の不変条件を守るため
