# min-n8n-factory

n8n を使って GitHub Issue から Claude Code を自動実行するローカル AI 工場。

## 必要ツール

- Docker
- [GitHub CLI](https://cli.github.com/)
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)

## セットアップ

```bash
# 1. .env 生成
make setup

# 2. .env を開いて以下を記入
#    GITHUB_REPO=owner/repo-name
#    PROJECT_PATH=/path/to/your-repo

# 3. n8n 起動
make up
```

→ `http://localhost:5678` で n8n UI を開く

詳細は [docs/setup.md](docs/setup.md) を参照。

## トラブルシュート

### `make auth` で 1Password のセッションエラーが出る

```text
[ERROR] You are not currently signed in. Please run `op signin --help` for instructions
```

1Password のセッションが切れています。以下を実行してから `make auth` を再実行してください:

```bash
eval $(op signin) && make auth
```

再発を防ぐには 1Password アプリの **Settings → Security → Touch ID でロック解除** を有効にしてください。

---

## コマンド

| コマンド | 内容 |
| --- | --- |
| `make setup` | `.env` を生成 |
| `make up` | n8n 起動 |
| `make down` | n8n 停止 |
| `make auth` | GitHub CLI 認証（1Password 連携） |
~