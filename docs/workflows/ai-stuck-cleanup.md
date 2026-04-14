# ai-stuck-cleanup

`ai-processing` ラベルが付いたまま一定時間以上更新されていない Issue を検知し、`ai-failed` に切り替えて Slack に一括通知するワークフロー。

## 目的

調査フロー（ai-issue-processor）がタイムアウト・中断・異常終了した場合、Issue は `ai-processing` ラベルのまま残る。人間が気づかない限り放置されるので、定期的にスキャンしてリカバリ可能な状態（`ai-failed`）に戻す。

## トリガー

30 分間隔の Schedule Trigger。

## スタック判定のしきい値

`STUCK_THRESHOLD_SEC`（デフォルト: 1620秒 = 27分）。

AI Issue Processor のワークフロー実行上限 `WORKFLOW_TIMEOUT_SEC`（デフォルト 1080秒）よりも広めに取る。同値にしてしまうと「ギリギリ正常終了した Issue がスタック扱いされる」境界競合が起きるため、明示的に別 env として分離している。値の管理は `.env` の `STUCK_THRESHOLD_SEC` に集約されており、docker-compose.yml 経由で n8n コンテナに渡される。`Build stuck-batch payload` から呼ばれる `buildPayloadForContext({ kind: 'stuck-batch', env })` も同じ変数を参照するため、通知本文の「⏰ 1620秒以上経過」表示としきい値が常に一致する。

## フロー

```text
Schedule 30min
  ↓
Get ai-processing Issues (最大100件)
  ↓ n8n が自動で1件ずつに分割
Stale? (updated_at > STUCK_THRESHOLD_SEC)
  ↓ true のみ
Set ai-failed label (Issue ごと)
  ↓
Post Stuck Comment (Issue ごと)
  ↓
Aggregate Stuck Issues ← 全件を1件にまとめる
  ↓
Build stuck-batch payload (Code)
  ↓
Slack: スタック検知 (一括) ← 1メッセージで通知
```

## ノードの役割

| ノード | 役割 |
| --- | --- |
| `Schedule 30min` | 30 分間隔でワークフローを起動 |
| `Get ai-processing Issues` | `ai-processing` ラベルの open Issue を最大 100 件取得（`resource: repository` + `getRepositoryIssuesFilters`） |
| `Stale? (updated_at > TIMEOUT)` | 各 Issue の `updated_at` と現在時刻の差が `STUCK_THRESHOLD_SEC` を超えているかを判定 |
| `Set ai-failed label` | スタック判定された Issue のラベルを `ai-failed` に置き換える |
| `Post Stuck Comment` | スタック判定された Issue に GitHub コメントでリトライ手順を通知 |
| `Aggregate Stuck Issues` | スタック判定された Issue の `number`, `title`, `updated_at` を配列に集約して 1 アイテムにまとめる |
| `Build stuck-batch payload` | Code ノード。`require('slack-notify')` で `buildStuckBatchMessage` を呼び Block Kit payload を生成 |
| `Slack: スタック検知 (一括)` | Slack ノード。1 メッセージとして通知 |

## 通知の集約方針

Issue ごとの GitHub 操作（ラベル変更・コメント投稿）は個別に行うが、Slack 通知だけは Aggregate ノードで 1 件にまとめる。

理由:

- 同時に複数 Issue がスタックした場合、Issue ごとに通知するとチャンネルが埋もれる
- スタック検知は「一覧でまとめて把握したい」性質の情報であり、個別通知の必要性が低い
- 1 Issue にスタック通知が分散してもスレッドでまとめる必要がない（親メッセージが存在しないため）

テンプレート本体は [`scripts/slack-notify-pkg/index.js`](../../scripts/slack-notify-pkg/index.js)、セットアップ手順は [docs/notification/slack-setup.md](../notification/slack-setup.md) を参照。

## 関連ワークフロー

- [ai-issue-processor](../../workflows/ai-issue-processor.json) — 正常系の調査フロー。ここでタイムアウトや失敗が起きたときに残る `ai-processing` Issue を、ai-stuck-cleanup が回収する。
