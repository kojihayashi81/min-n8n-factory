# Slack アプリセットアップ

## 前提

- 個人課金の Slack ワークスペースがあること
- Slack アプリの管理者権限があること
- n8n が起動済みであること（`make up`）

## 1. Slack アプリ作成

1. [Slack API: Your Apps](https://api.slack.com/apps) にアクセス
2. **Create New App** → **From scratch** を選択
3. アプリ名: `min-factory-bot`（任意）
4. ワークスペースを選択して **Create App**

## 2. Bot Token Scopes 設定

左メニュー **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** に以下を追加:

| スコープ               | 用途                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `chat:write`           | メッセージ送信                                             |

## 3. ワークスペースへのインストール

1. 左メニュー **OAuth & Permissions** → **Install to Workspace**
2. 権限を確認して **Allow**
3. **Bot User OAuth Token**（`xoxb-` で始まる）をコピーする

## 4. 通知チャンネルの準備

1. Slack で通知用チャンネルを作成（例: `#min-factory`）
2. チャンネルにアプリを招待: `/invite @min-factory-bot`
3. チャンネル ID を控える（チャンネル名を右クリック → **チャンネル詳細を表示** → 最下部に表示）

## 5. .env への追加

トークンとチャンネル ID を `.env` に設定する。`scripts/slack-notify.js` が環境変数から読み取る。

```bash
# Slack 通知
SLACK_BOT_TOKEN=xoxb-...          # Bot User OAuth Token
SLACK_CHANNEL_ID=C0XXXXXXXXX      # 通知先チャンネル ID
```

`docker-compose.yml` には設定済み（`SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID`）。

## 動作確認

### ユニットテスト

`scripts/slack-notify.js` の Block Kit メッセージ生成ロジックをユニットテストで検証する。Slack API 呼び出しはモックしないので、実環境への副作用はない。

```bash
node --test scripts/slack-notify.test.js
```

全テストが合格すれば、メッセージ生成ロジックに問題はない。メッセージ種別（start / success / failure / stuck / stuck-batch）を追加・修正したときは、`scripts/slack-notify.test.js` にテストを追加する。

### 実送信テスト

n8n コンテナ内でスクリプトを直接実行して、実際にチャンネルへメッセージが届くかを確認する。

```bash
docker compose exec n8n node /opt/scripts/slack-notify.js \
  "$(node -e "process.stdout.write(encodeURIComponent(JSON.stringify({type:'start',issueNumber:0,issueTitle:'テスト通知'})))")"
```

チャンネルにメッセージが届き、stdout に `ts`（タイムスタンプ）が出力されれば成功。
