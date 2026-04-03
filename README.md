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

## コマンド

| コマンド | 内容 |
| --- | --- |
| `make setup` | `.env` を生成 |
| `make up` | n8n 起動 |
| `make down` | n8n 停止 |
| `make auth` | GitHub CLI 認証（1Password 連携） |
