# ai-issue-processor

`ai-ready` ラベルが付いた GitHub Issue を検知して Claude Code を起動し、調査結果を Draft PR にまとめるメインの調査ワークフロー。

## 目的

人間が Issue に `ai-ready` ラベルを付けたら、Claude Code が自動で調査・仕様化・Draft PR 作成までを行う。人間は承認と最終レビューだけに集中できるようにする。

## トリガー

10 分間隔の Schedule Trigger。

## ラベルのライフサイクル

```text
ai-ready → ai-processing → ai-investigated （成功）
                         ↘ ai-failed       （失敗）
```

- `ai-ready`: 人間が調査を依頼する起点
- `ai-processing`: n8n が処理中の状態。二重起動防止のガードにも使う
- `ai-investigated`: 調査完了、Draft PR 作成済み
- `ai-failed`: タイムアウトまたはエラー発生。人間がリトライ判断する

再試行時(`ai-failed → ai-ready` の付け直し)は、初回実行時の Slack スレッドに処理開始 / 成功 / 失敗の通知が追記される。Issue と Slack スレッドが 1:1 で紐付くため、履歴を 1 か所で追える。

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
Run Claude Code (/opt/scripts/n8n-run-claude.sh)
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
| `Run Claude Code` | `/opt/scripts/n8n-run-claude.sh` を呼び出して Claude Code で調査を実行。stdout に PR URL、エラー時は `error`/`stderr` フィールドに内容を出力 |
| `Post PR Link to Issue` | 成功時、Issue に Draft PR リンクをコメント投稿。`onError: continueRegularOutput`（コメント投稿失敗で Slack 成功通知を道連れにしない） |
| `Set ai-investigated label` | 成功時、ラベルを `ai-investigated` に変更。`onError: continueRegularOutput`（ラベル変更失敗は `ai-stuck-cleanup` が後で回収する。ここで halt すると Slack 成功通知が届かない） |
| `Build success payload` | Code ノード。`slack-notify-pkg` の `buildPayloadForContext({ kind: 'success', ... })` を呼ぶ。内部で `extractPrUrl` が `Run Claude Code` の stdout から PR URL を正規表現抽出し、見つからなければ PR ボタン自体を Block Kit から除外する（Slack に "PR #—" プレースホルダーを出さない）。`threadTs` は `$getWorkflowStaticData('global').slackThreads[issueNumber]` を直接参照（Persist thread ts 済みの不変条件） |
| `Slack: 調査完了` | Slack ノード。成功時、元スレッドに返信しつつ `reply_broadcast: true` でチャンネルにも再露出 |
| `Set ai-failed label` | 失敗時、ラベルを `ai-failed` に変更 |
| `Build failure payload` | Code ノード。`slack-notify-pkg` の `buildPayloadForContext({ kind: 'failure', ... })` を呼び、Block Kit payload と「秘匿スクラブ済みエラーテキスト」(`errorText`)、および `$env.EXECUTION_LOG_BASE_URL` ベースの `executionUrl` を出力する。エラーテキストは `resolveFailureError` → `scrubSecrets` を経由して Slack トークン / GitHub PAT / Anthropic API key / `Authorization: Bearer` ヘッダーを `[REDACTED]` に置換済み |
| `Post Error Comment` | 失敗時、`Build failure payload` が生成した `errorText` をそのまま GitHub Issue コメント本文に使い、`resolveFailureError` のロジックを workflow 側に重複させない |
| `Slack: 処理失敗` | Slack ノード。`$('Build failure payload').first().json` から payload を参照し、元スレッドに返信しつつ `reply_broadcast: true` でチャンネルにも再露出（Post Error Comment の出力は GitHub API レスポンスなので `$json` からは直接取れない） |

## タイムアウトとリトライ

- **Claude Code タイムアウト**: `CLAUDE_TIMEOUT_SEC`（デフォルト 600秒）。`n8n-run-claude.sh` 内で制御
- **ワークフロー実行タイムアウト**: `WORKFLOW_TIMEOUT_SEC`（デフォルト 780秒 = `CLAUDE_TIMEOUT_SEC` + Slack/GitHub API + devcontainer 起動バッファ 180秒）。n8n の `EXECUTIONS_TIMEOUT` に設定される
- **スタック判定しきい値**: `STUCK_THRESHOLD_SEC`（デフォルト 1200秒）。`WORKFLOW_TIMEOUT_SEC` と同値にすると「ギリギリ終わったジョブがスタック扱いされる」境界競合が起きるため、`WORKFLOW_TIMEOUT_SEC` の約 1.5 倍を持たせる
- **リトライ**: 失敗 Issue には `ai-failed` が付く。人間が `ai-ready` に戻せば次回のスキャンで再実行される。Slack スレッドは初回実行時のものが `$getWorkflowStaticData` 経由で再利用される
- **スタック検知**: 何らかの理由で `ai-processing` のまま残った Issue は [ai-stuck-cleanup](./ai-stuck-cleanup.md) が回収する
- **親メッセージ投稿失敗時**: `Slack: 処理開始` は `onError` を設定しておらず、失敗するとワークフロー全体が停止する（`ai-processing` ラベルが残り、`STUCK_THRESHOLD_SEC` 経過後に ai-stuck-cleanup が `ai-failed` に回収）。この方針は「1 Issue = 1 スレッド」の不変条件を守るため

## Slack 通知の設計

### 1 Issue = 1 スレッド集約 + ハイブリッドブロードキャスト

- **親メッセージ**は Issue ごとに 1 本だけチャンネルに投稿され、以降の処理開始 / 成功 / 失敗通知はすべてその**スレッド返信**にまとめられる
- **最終成果(成功/失敗)はチャンネル再露出**: 成功/失敗通知は `reply_broadcast: true` を付けてスレッド内に残しつつチャンネルにも再表示される。日常の進捗ノイズはスレッドに封じ込めつつ、重要な結果だけはチャンネルで拾える
- **再試行時も同じスレッドに集約**: `ai-failed → ai-ready` で付け直した場合、処理開始通知も元スレッドへの返信として投稿される(チャンネルには出ない)

### 実装メカニズム: workflow static data での ts 永続化

- `Build start payload` が `$getWorkflowStaticData('global').slackThreads[issueNumber]` を参照し、既存があれば `threadTs` として `buildStartMessage` に渡す
- `Slack: 処理開始` の返り値は n8n Slack ノード固有のキー `message_timestamp` で取得する(`ts` ではない点に注意)
- 初回実行時のみ `Persist thread ts`（`rememberThread` を呼び、LRU cap `MAX_THREAD_ENTRIES=200` で古い ts から eviction）が `slackThreads[issueNumber] = message_timestamp` を書き込む
- `Build success payload` / `Build failure payload` は `$getWorkflowStaticData('global').slackThreads[issueNumber]` を直接参照する。`Slack: 処理開始` が `stopWorkflow` + `Persist thread ts` も `stopWorkflow` なので、ここに到達した時点で値は必ず存在する不変条件（以前存在した `$('Slack: 処理開始').first().json.message_timestamp` フォールバックは到達不能コードとして削除済み）
- static data は n8n の DB に永続化されるため、ワークフローの再起動・再インポートをまたいでも維持される

### テンプレート管理

- Block Kit テンプレート本体は [`scripts/slack-notify-pkg/index.js`](../../scripts/slack-notify-pkg/index.js) に集約
- n8n の Code ノードからは `require('slack-notify')` で参照する。`docker-compose.yml` で `/opt/n8n-user-modules/node_modules/slack-notify` にマウントし、`NODE_PATH=/opt/n8n-user-modules/node_modules` + `NODE_FUNCTION_ALLOW_EXTERNAL=slack-notify` で Code ノードから解決可能にしている。n8n 本体の `node_modules` を触らないため、n8n バージョンアップで壊れない
- セットアップ手順の詳細は [docs/notification/slack-setup.md](../notification/slack-setup.md) を参照

## 関連ワークフロー

- [ai-stuck-cleanup](./ai-stuck-cleanup.md) — タイムアウト・中断で `ai-processing` のまま残った Issue を回収する
