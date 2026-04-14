# Slack 通知の設計

`ai-issue-processor` ワークフローが Slack に流す通知の設計方針と実装メカニズム。全体像は [README.md](./README.md)、ノード名との対応は [flow.md のノードの役割](./flow.md#ノードの役割) を参照。

## 1 Issue = 1 スレッド集約 + ハイブリッドブロードキャスト

- **親メッセージ**は Issue ごとに 1 本だけチャンネルに投稿され、以降の処理開始 / 成功 / 失敗通知はすべてその**スレッド返信**にまとめられる
- **最終成果(成功/失敗)はチャンネル再露出**: 成功/失敗通知は `reply_broadcast: true` を付けてスレッド内に残しつつチャンネルにも再表示される。日常の進捗ノイズはスレッドに封じ込めつつ、重要な結果だけはチャンネルで拾える
- **再試行時も同じスレッドに集約**: `ai-failed → ai-ready` で付け直した場合、処理開始通知も元スレッドへの返信として投稿される(チャンネルには出ない)

## 品質スコアの通知

成功時の Slack メッセージに Gatekeeper の品質スコアを **`X / Y` 形式**（例: `75 / 100`、Web 調査スキップ時は `56 / 80`）で付記する。これにより人間は Draft PR を開く前に調査ノートの信頼度を把握できる。採点基準の詳細は [agent_pipeline.md の Gatekeeper 節](./agent_pipeline.md#agent-4-gatekeeper) を参照。

**再実行ありの場合の表示**: Synthesizer が再実行されたケースでは、Gatekeeper も 2 回走る（2 回目は通知用スコア取得のみ、閾値判定はしない）。このとき Slack メッセージには **「初回 X / Y → 再実行後 X' / Y」** の形式でスコアの変化を表示し、再実行で品質が改善したかが一目でわかるようにする。スコアが改善していない / 悪化しているケースは Gatekeeper プロンプトや Synthesizer プロンプトの改善候補として別途運用ログで拾う。

## 失敗通知の情報量

失敗時の Slack メッセージおよび GitHub Issue エラーコメントには、**パイプラインのどのエージェントで失敗したか**と、**Claude Code の実際の stderr / exit code が秘匿スクラブ済みで**そのまま載る。

以前は `n8n-run-claude.sh` が `CLAUDE_OUTPUT=$(timeout … claude …)` というコマンド置換で claude を呼んでおり、`set -euo pipefail` の下で claude が非 0 終了すると **置換そのものが失敗 → スクリプトが即 exit → 後続の `echo "$CLAUDE_OUTPUT"` に到達せず** stderr も届かなかった。その結果、n8n の `ExecuteCommand` ノードは中身のない失敗を受け取り、`resolveFailureError` は常にフォールバック文字列「タイムアウトまたは不明なエラー」を返していた（**全ての失敗が見かけ上「タイムアウト」として通知される**静かな観測性バグ）。

現在は:

1. `n8n-run-claude-pipeline.sh` が各エージェントの stdout / stderr を個別 temp file に退避
2. `set +e` / `set -e` で各 `timeout … claude …` を囲み、exit code を安全に捕捉
3. 失敗時はスクリプト stderr に失敗エージェント名 + 両ストリームをデリミタ付きで吐いた上で、exit code をそのまま `exit`
4. n8n ExecuteCommand ノードが `error` / `stderr` フィールドにその内容を格納
5. `Build failure payload` が `resolveFailureError({ error, stderr }, env.CLAUDE_TIMEOUT_SEC)` → `scrubSecrets` を通し、auth エラー / tool 失敗 / レートリミット等の実際の原因を Slack block と Issue コメントの両方に反映

## 実装メカニズム: workflow static data での ts 永続化

- `Build start payload` が `$getWorkflowStaticData('global').slackThreads[issueNumber]` を参照し、既存があれば `threadTs` として `buildStartMessage` に渡す
- `Slack: 処理開始` の返り値は n8n Slack ノード固有のキー `message_timestamp` で取得する(`ts` ではない点に注意)
- 初回実行時のみ `Persist thread ts`（`rememberThread` を呼び、LRU cap `MAX_THREAD_ENTRIES=200` で古い ts から eviction）が `slackThreads[issueNumber] = message_timestamp` を書き込む
- `Build success payload` / `Build failure payload` は `$getWorkflowStaticData('global').slackThreads[issueNumber]` を直接参照する。`Slack: 処理開始` が `stopWorkflow` + `Persist thread ts` も `stopWorkflow` なので、ここに到達した時点で値は必ず存在する不変条件（以前存在した `$('Slack: 処理開始').first().json.message_timestamp` フォールバックは到達不能コードとして削除済み）
- static data は n8n の DB に永続化されるため、ワークフローの再起動・再インポートをまたいでも維持される

## テンプレート管理

- Block Kit テンプレート本体は [`scripts/slack-notify-pkg/index.js`](../../../scripts/slack-notify-pkg/index.js) に集約
- n8n の Code ノードからは `require('slack-notify')` で参照する。`docker-compose.yml` で `/opt/n8n-user-modules/node_modules/slack-notify` にマウントし、`NODE_PATH=/opt/n8n-user-modules/node_modules` + `NODE_FUNCTION_ALLOW_EXTERNAL=slack-notify` で Code ノードから解決可能にしている。n8n 本体の `node_modules` を触らないため、n8n バージョンアップで壊れない
- セットアップ手順の詳細は [docs/notification/slack-setup.md](../../notification/slack-setup.md) を参照
