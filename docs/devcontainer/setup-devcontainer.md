# DevContainer 配布の仕組み

## なぜ DevContainer を配布するのか

n8n ワークフローから Claude Code を実行する際、ホスト環境を汚染せずプロジェクトに閉じた隔離環境で動かすため。

### 選択の経緯

| 案 | 問題点 |
| --- | --- |
| ホストで直接実行 | ホストに Claude Code・gh CLI をグローバルインストールが必要 |
| SSH 経由 | ホストのリモートログイン設定が必要・セキュリティリスク |
| 専用コンテナ（claude-runner） | 開発者の環境と AI の環境が乖離する |
| **DevContainer（採用）** | 開発者と同じ環境で AI が動く・ホストを汚染しない |

開発者が VS Code で使う DevContainer をそのまま n8n からも起動することで、「手元では動くのに AI が失敗する」という環境差異を排除する。

---

## 認証方針

`ANTHROPIC_API_KEY`（API 課金）は使わず、Max プランの OAuth 認証情報を使う。

### セットアップ

```bash
mkdir -p ./data/claude-auth
cp ~/.claude/credentials.json ./data/claude-auth/credentials.json
```

- `data/` は `.gitignore` 済みなので誤 commit しない
- **ディレクトリごとマウントしない**（対象リポジトリの `.claude/` 設定・会話履歴を上書きするため）
- `credentials.json` のみをマウントして最小限の権限にする

### n8n からの渡し方

```bash
docker run --rm \
  -v $(pwd)/data/claude-auth/credentials.json:/home/node/.claude/credentials.json:ro \
  -e GH_TOKEN=$GH_TOKEN \
  ghcr.io/owner/repo:latest \
  claude --print ...
```

認証トークンが期限切れになったらホストで `claude auth login` を再実行し、`credentials.json` を再コピーする。

---

## `make setup-devcontainer` の仕様

### 実行コマンド

```bash
make setup-devcontainer
```

### 前提条件

- `GITHUB_REPO` が `.env` に設定済み
- `jq` がインストール済み（`brew install jq`）
- `gh auth login` 済み

### 処理フロー

```
gh repo clone → .devcontainer/devcontainer.json の有無を確認
      │
      ├─ あり（既存設定をマージ）
      │    ├─ features に gh CLI・Node.js v22 を追記（既存 features は保持）
      │    └─ postCreateCommand が未設定の場合のみ claude code インストールを追記
      │       postCreateCommand が既存の場合は警告のみ（上書きしない）
      │
      └─ なし（テンプレートから新規作成）
           ├─ templates/devcontainer/Dockerfile をコピー
           └─ templates/devcontainer/devcontainer.json をコピー
```

### 追記される features（既存ありの場合）

```json
{
  "ghcr.io/devcontainers/features/github-cli:1": {},
  "ghcr.io/devcontainers/features/node:1": { "version": "22" }
}
```

`postCreateCommand` がなければ以下を追加:

```json
"postCreateCommand": "npm install -g @anthropic-ai/claude-code"
```

### 注意事項

- `postCreateCommand` が既存の場合は上書きしない。`@anthropic-ai/claude-code` のインストールを既存コマンドに手動で追記すること
- ベースイメージ・拡張機能・ポート設定など他の設定には一切触れない

---

## テンプレートファイル（devcontainer.json がない場合に使用）

### `templates/devcontainer/Dockerfile`

Microsoft 公式の VS Code DevContainer ベースイメージ（`mcr.microsoft.com/devcontainers/base:ubuntu`）を使用。gh CLI・Node.js 22・Claude Code CLI を含む。

### `templates/devcontainer/devcontainer.json`

最小構成。`GH_TOKEN` を環境変数から渡す設定のみ。プロジェクト固有の設定（拡張機能・ポート等）は対象リポジトリで追記する。
