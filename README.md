# min-n8n-factory

n8n を使って GitHub Issue から Claude Code を自動実行するローカル AI 工場。

## 背景

設計思想のベースは [llm-factory](https://github.com/kojihayashi81/llm-factory) にある。本来は Mac Studio 128GB + ローカル LLM（Ollama 70B）+ RAG で自律開発環境を構築する計画だったが、Apple Silicon Mac の入手に時間がかかるため、手持ちの Mac + Claude Code + n8n で先に自動化ワークフローを組み立てている。ローカル LLM を使わない分、構成はシンプルになっている。

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

### MCP ドキュメントサーバー（オプション）

プロジェクトのドキュメント・ワークフロー・スクリプトを MCP サーバー経由で Claude Code に公開する。Claude Code セッションから仕様確認や仕様と実装の差分検出ができる。

> **Note:** `.mcp.json` に接続設定が含まれています。`make mcp-up` でサーバーを起動してから Claude Code セッションを開始してください。サーバー未起動時は MCP 接続エラーが表示されますが、他の機能には影響しません。

```bash
# 起動
make mcp-up

# 停止
make mcp-down
```

詳細は [docs/mcp/README.md](docs/mcp/README.md) を参照。

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

| コマンド        | 内容                              |
| --------------- | --------------------------------- |
| `make setup`    | `.env` を生成                     |
| `make up`       | n8n 起動                          |
| `make down`     | n8n 停止                          |
| `make mcp-up`   | MCP ドキュメントサーバー起動      |
| `make mcp-down` | MCP ドキュメントサーバー停止      |
| `make auth`     | GitHub CLI 認証（1Password 連携） |

## 開発フック（Husky + lint-staged）

ルートに `package.json` を置き、Husky + lint-staged でコミット・プッシュ前に自動チェックを走らせている。初回クローン時は以下を一度だけ実行する:

```bash
npm install
```

`npm install` 時に `husky` フックが `.husky/` からインストールされる。

### pre-commit

ステージされたファイルに対して lint-staged が以下を実行する:

- `*.md` — `markdownlint --fix` と `prettier --write`（自動修正はコミットに含まれる）
- `*.{js,ts,json,yml,yaml}` — `prettier --write`
- `scripts/**` に変更があれば `npm run test:scripts`
- `mcp-server/src/**` に変更があれば `npm run test:mcp`

テストに失敗した場合はコミットがブロックされる。対象外テストはスキップされるので、小さな変更では数秒で完了する。

### pre-push

プッシュ直前に以下を実行する:

- `npm run lint` — `markdownlint` によるリポジトリ全体の Markdown リント
- `npm test` — `scripts/` と `mcp-server/` 両方の全テスト

いずれかが失敗するとプッシュはブロックされる。

### フックを一時的に回避したい場合

`git commit --no-verify` / `git push --no-verify` で回避できるが、原則として使わない。フックで落ちた場合は原因を直してから再度コミットする。
