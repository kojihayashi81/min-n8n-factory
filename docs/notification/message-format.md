# メッセージフォーマット定義

## 概要

全ワークフローの通知メッセージを Block Kit で統一する。Issue 単位でスレッドにまとめ、GitHub Issue / PR / n8n 実行ログへのリンクはボタンで表示する。成功・失敗・スタック検知の3パターンを定義する。

## スレッド構造

処理開始時に親メッセージを投稿し、結果はスレッド返信で追記する。

```text
🔄 処理開始: #42 ログイン画面のエラーハンドリング改善     ← 親メッセージ
  ├─ ✅ 調査完了  ⏱️ 3分12秒                             ← スレッド返信（成功）
  │   [ 📋 Issue #42 ]  [ 🔀 PR #43 ]
  └─ ❌ 処理失敗  ⚠️ タイムアウト                         ← スレッド返信（失敗の場合）
      [ 📋 Issue #42 ]  [ 🔗 n8n実行ログ ]
```

n8n 実装上の注意:

- 親メッセージ投稿時に `ts`（タイムスタンプ）を取得し、スレッド返信の `thread_ts` に渡す
- `reply_broadcast` は使わない（チャンネルが埋まるため）

## 親メッセージ（処理開始）

処理開始時にチャンネルに投稿する。Issue へのリンクをボタンで表示する。

```text
[Header]  🔄 処理開始
[Section] #42 ログイン画面のエラーハンドリング改善
[Context] owner/repo | issues/42 | 2026-04-12 14:30
[Actions] [ 📋 Issue #42 ]
```

## 成功時メッセージ（スレッド返信）

```text
[Header]  ✅ 調査完了
[Section] • エラーハンドリングの現状を調査
          • try-catch の不足箇所を特定
          • 修正方針をまとめて Draft PR を作成
[Context] owner/repo | issues/42 → PR #43 | ⏱️ 3分12秒
[Actions] [ 📋 Issue #42 ]  [ 🔀 PR #43 ]
```

## 失敗時メッセージ（スレッド返信）

```text
[Header]  ❌ 処理失敗
[Section] • Claude Code がタイムアウト（600秒超過）
          • stderr: process exited with code 1
          • 👉 Issue に ai-ready ラベルを再付与してリトライしてください
[Context] owner/repo | issues/42 | ⏱️ 10分01秒
[Actions] [ 📋 Issue #42 ]  [ 🔗 n8n実行ログ ]
```

## スタック検知メッセージ（一括通知）

スタック検知済みの Issue を1メッセージにまとめてチャンネルに投稿する。ワークフローの処理フロー詳細は [docs/workflows/ai-stuck-cleanup.md](../workflows/ai-stuck-cleanup.md) を参照。

```text
[Header]  ⏰ スタック検知 (3件)
[Section] ai-processing のまま 1200秒以上経過した Issue を検知しました。
          全て ai-failed に変更済みです。

          • #42 ログイン画面のエラーハンドリング改善
            最終更新: 2026-04-12 14:20
          • #43 バリデーションの修正
            最終更新: 2026-04-12 14:25
          • #44 ヘッダーのリンク切れ
            最終更新: 2026-04-12 14:30
[Context] owner/repo | リトライ: ai-ready ラベルを再付与してください
```

## Block Kit JSON

### JSON: 親メッセージ（処理開始）

```json
{
  "channel": "C0XXXXXXXXX",
  "text": "🔄 処理開始: #42 ログイン画面のエラーハンドリング改善",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🔄 処理開始" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "<https://github.com/owner/repo/issues/42|#42 ログイン画面のエラーハンドリング改善>"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "owner/repo | issues/42 | 2026-04-12 14:30"
        }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "📋 Issue #42" },
          "url": "https://github.com/owner/repo/issues/42"
        }
      ]
    }
  ]
}
```

### JSON: 成功時（スレッド返信）

```json
{
  "channel": "C0XXXXXXXXX",
  "thread_ts": "{{親メッセージの ts}}",
  "text": "✅ 調査完了: #42 ログイン画面のエラーハンドリング改善",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "✅ 調査完了" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "• エラーハンドリングの現状を調査\n• try-catch の不足箇所を特定\n• 修正方針をまとめて Draft PR を作成"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "owner/repo | issues/42 → PR #43 | ⏱️ 3分12秒"
        }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "📋 Issue #42" },
          "url": "https://github.com/owner/repo/issues/42"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "🔀 PR #43" },
          "url": "https://github.com/owner/repo/pull/43"
        }
      ]
    }
  ]
}
```

### JSON: 失敗時（スレッド返信）

```json
{
  "channel": "C0XXXXXXXXX",
  "thread_ts": "{{親メッセージの ts}}",
  "text": "❌ 処理失敗: #42 ログイン画面のエラーハンドリング改善",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "❌ 処理失敗" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "• Claude Code がタイムアウト（600秒超過）\n• stderr: process exited with code 1\n• 👉 Issue に ai-ready ラベルを再付与してリトライしてください"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "owner/repo | issues/42 | ⏱️ 10分01秒"
        }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "📋 Issue #42" },
          "url": "https://github.com/owner/repo/issues/42"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "🔗 n8n実行ログ" },
          "url": "http://localhost:5678/execution/xxx"
        }
      ]
    }
  ]
}
```

### JSON: スタック検知（一括通知）

```json
{
  "channel": "C0XXXXXXXXX",
  "text": "⏰ スタック検知: 3件",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "⏰ スタック検知 (3件)" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "`ai-processing` のまま 1200秒以上経過した Issue を検知しました。\n全て `ai-failed` に変更済みです。\n\n• <https://github.com/owner/repo/issues/42|#42> ログイン画面のエラーハンドリング改善\n  最終更新: 2026-04-12 14:20\n• <https://github.com/owner/repo/issues/43|#43> バリデーションの修正\n  最終更新: 2026-04-12 14:25\n• <https://github.com/owner/repo/issues/44|#44> ヘッダーのリンク切れ\n  最終更新: 2026-04-12 14:30"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "<https://github.com/owner/repo|owner/repo> | リトライ: `ai-ready` ラベルを再付与してください"
        }
      ]
    }
  ]
}
```
