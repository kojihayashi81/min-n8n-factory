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
Slack: 処理開始 (親メッセージ投稿、ts を取得)
  ↓
Run Claude Code (/opt/scripts/n8n-run-claude.sh)
  ├─ 成功 → Post PR Link to Issue → Set ai-investigated label → Slack: 調査完了 (スレッド返信)
  └─ 失敗 → Set ai-failed label → Post Error Comment → Slack: 処理失敗 (スレッド返信)
```

## ノードの役割

| ノード | 役割 |
| --- | --- |
| `Schedule 10min` | 10 分間隔でワークフローを起動 |
| `Get oldest ai-ready Issue` | 最も古い `ai-ready` Issue を 1 件取得（`resource: repository` + `getRepositoryIssuesFilters`） |
| `If` | Issue が存在し、かつ `ai-processing` が付いていないことを確認（二重起動防止） |
| `Set ai-processing label` | 処理開始時にラベルを `ai-processing` に変更 |
| `Slack: 処理開始` | `slack-notify.js` の `start` 型で親メッセージを投稿し、`ts` を stdout に出力 |
| `Run Claude Code` | `/opt/scripts/n8n-run-claude.sh` を呼び出して Claude Code で調査を実行。stdout に PR URL、stderr に実行ログを出力 |
| `Post PR Link to Issue` | 成功時、Issue に Draft PR リンクをコメント投稿 |
| `Set ai-investigated label` | 成功時、ラベルを `ai-investigated` に変更 |
| `Slack: 調査完了` | 成功時、`success` 型でスレッド返信（Issue / PR ボタン付き） |
| `Set ai-failed label` | 失敗時、ラベルを `ai-failed` に変更 |
| `Post Error Comment` | 失敗時、Issue にエラー内容とリトライ手順をコメント投稿 |
| `Slack: 処理失敗` | 失敗時、`failure` 型でスレッド返信（エラー詳細 + リトライ案内 + n8n 実行ログボタン付き） |

## タイムアウトとリトライ

- **Claude Code タイムアウト**: `CLAUDE_TIMEOUT_SEC`（デフォルト 600秒）。`n8n-run-claude.sh` 内で制御
- **ワークフロー実行タイムアウト**: `WORKFLOW_TIMEOUT_SEC`（デフォルト 660秒）。n8n の `EXECUTIONS_TIMEOUT` に設定される
- **リトライ**: 失敗 Issue には `ai-failed` が付く。人間が `ai-ready` に戻せば次回のスキャンで再実行される
- **スタック検知**: 何らかの理由で `ai-processing` のまま残った Issue は [ai-stuck-cleanup](./ai-stuck-cleanup.md) が回収する

## Slack 通知の設計

- Issue 単位でスレッドを作り、成功/失敗の結果はスレッド返信で追加する
- 親メッセージ（処理開始）の `ts` を `$('Slack: 処理開始').item.json.stdout.trim()` で参照し、スレッド返信の `thread_ts` に渡す
- メッセージフォーマットの詳細は [docs/notification/message-format.md](../notification/message-format.md) を参照

## 関連ワークフロー

- [ai-stuck-cleanup](./ai-stuck-cleanup.md) — タイムアウト・中断で `ai-processing` のまま残った Issue を回収する
