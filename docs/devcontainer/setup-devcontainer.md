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

`ANTHROPIC_API_KEY`（API 課金）は使わず、Max プランの OAuth トークンを環境変数で渡す。

- 公式ドキュメント: [Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)
- 環境変数リファレンス: [Claude Code Environment Variables](https://code.claude.com/docs/en/env-vars)

> **変更履歴**: 当初は `~/.claude/credentials.json` のファイルマウントを検討したが、Max プランの OAuth トークンは macOS キーチェーンに保存されるためコンテナからアクセスできなかった。`CLAUDE_CODE_OAUTH_TOKEN` 環境変数方式に変更。詳細は [run-claude-design.md](run-claude-design.md) を参照。

### セットアップ

```bash
# 1. ホストで1年間有効な OAuth トークンを生成
claude setup-token

# 2. .env に保存（.gitignore 済み）
CLAUDE_CODE_OAUTH_TOKEN=<生成されたトークン>
```

### トークンの流れ

```text
.env
  → docker-compose.yml で n8n コンテナに渡す
  → devcontainer.json の remoteEnv + ${localEnv:...} で DevContainer に渡る
  → DevContainer 内の claude --print が認証に使用
```

トークンが期限切れ（1年後）になったらホストで `claude setup-token` を再実行し、`.env` を更新する。

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

```text
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
