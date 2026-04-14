# Slack アプリセットアップ

## 前提

- 個人課金の Slack ワークスペースがあること
- Slack アプリの管理者権限があること
- n8n が起動済みであること(`make up`)

## 1. Slack アプリ作成

1. [Slack API: Your Apps](https://api.slack.com/apps) にアクセス
2. **Create New App** → **From scratch** を選択
3. アプリ名: `min-factory-bot`(任意)
4. ワークスペースを選択して **Create App**

## 2. Bot Token Scopes 設定

左メニュー **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** に以下を追加:

| スコープ     | 用途           |
| ------------ | -------------- |
| `chat:write` | メッセージ送信 |

## 3. ワークスペースへのインストール

1. 左メニュー **OAuth & Permissions** → **Install to Workspace**
2. 権限を確認して **Allow**
3. **Bot User OAuth Token**(`xoxb-` で始まる)をコピーする

## 4. 通知チャンネルの準備

1. Slack で通知用チャンネルを作成(例: `#min-factory`)
2. チャンネルにアプリを招待: `/invite @min-factory-bot`
3. チャンネル ID を控える(チャンネル名を右クリック → **チャンネル詳細を表示** → 最下部に表示)

## 5. n8n 側の設定

### 5-1. Slack credential を登録

Bot Token は **n8n の credential** として登録する(env 変数では持たせない)。

1. n8n UI → 左下の **Credentials** → **Add Credential**
2. 検索で `Slack API` を選択
3. **Access Token** に `xoxb-...` を貼り付け
4. **Name** を `Slack Bot` に設定(ワークフロー JSON が参照する名前と一致させる)
5. **Save**

以後、ワークフロー内の Slack ノードは自動的にこの credential を参照する。

### 5-2. チャンネル ID を .env に設定

送信先チャンネル ID は引き続き環境変数で管理する(運用中の切り替えやワークフロー間の共通化のため)。

```bash
# Slack 通知
SLACK_CHANNEL_ID=C0XXXXXXXXX      # 通知先チャンネル ID
```

Code ノードが `$env.SLACK_CHANNEL_ID` として読み取り、Block Kit payload の `channel` に埋め込む。変更時は `.env` を編集して `docker compose up -d --force-recreate n8n` で反映する。

## アーキテクチャ

n8n のワークフローでは、各 Slack 通知を次の 2 段構成で送信する。

1. **Code ノード**: `require('slack-notify')` でテンプレート関数を呼び、Block Kit payload を生成
2. **Slack ノード**: 生成された payload(`channel` / `text` / `blocks` / `thread_ts`)を受け取り、credential 経由で `chat.postMessage` を叩く

テンプレート関数は [`scripts/slack-notify-pkg/index.js`](../../scripts/slack-notify-pkg/index.js) に集約されており、docker-compose.yml から `/opt/n8n-user-modules/node_modules/slack-notify` へマウントされている。`NODE_PATH=/opt/n8n-user-modules/node_modules` で Node のモジュール解決に載せ、`NODE_FUNCTION_ALLOW_EXTERNAL=slack-notify` が Code ノードの require を許可している。マウント先を n8n 本体の `node_modules` ではなくプロジェクト専用 prefix に置くことで、n8n バージョンアップで内部レイアウトが変わっても壊れない設計にしている。

テンプレートの変更手順:

1. `scripts/slack-notify-pkg/index.js` の `buildXxxMessage` を編集
2. `node --test scripts/slack-notify.test.js` で回帰確認
3. `docker compose restart n8n`(マウントは即反映だが Code ノードのキャッシュをクリアするため推奨)

## 動作確認

### ユニットテスト

Block Kit メッセージ生成ロジックをユニットテストで検証する。Slack API 呼び出しは発生しないので、実環境への副作用はない。

```bash
node --test scripts/slack-notify.test.js
```

全テストが合格すれば、メッセージ生成ロジックに問題はない。メッセージ種別(start / success / failure / stuck / stuck-batch)を追加・修正したときは、`scripts/slack-notify.test.js` にテストを追加する。

### n8n 上での動作確認

1. n8n UI でワークフローを開く
2. `Build start payload` ノードを単体実行して `channel` / `text` / `blocks` が出力されることを確認
3. `Slack: 処理開始` ノードを単体実行してチャンネルにメッセージが届くことを確認
4. 返り値に `ts` が含まれることを確認(後続のスレッド返信で使用)
