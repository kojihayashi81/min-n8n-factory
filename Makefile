.PHONY: help setup up down mcp-up mcp-down auth setup-labels setup-issue-template setup-skills setup-devcontainer import-workflow lint lint-fix
.DEFAULT_GOAL := help

-include .env
export

# 利用可能なコマンドを表示する
help:
	@grep -E '^# ' $(MAKEFILE_LIST) | grep -B0 -A0 -E '^#' > /dev/null; \
	awk '/^# /{desc=substr($$0,3)} /^[a-zA-Z_-]+:/{if(desc){printf "  \033[36m%-20s\033[0m %s\n",$$1,desc; desc=""}}' $(MAKEFILE_LIST) | sed 's/://'

# .env を生成する
setup:
	@cp -n .env.example .env || true
	@sed -i '' "s|N8N_BASIC_AUTH_PASSWORD=.*|N8N_BASIC_AUTH_PASSWORD=$$(openssl rand -hex 16)|" .env
	@sed -i '' "s|N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" .env
	@mkdir -p data/n8n
	@echo "✅ .env を生成しました。GITHUB_REPO と PROJECT_PATH を設定してください。"

# n8n を起動する
up:
	docker compose up -d

# n8n を停止する
down:
	docker compose down

# MCP ドキュメントサーバーを起動する
mcp-up:
	docker compose -f compose.mcp.yml up -d --build

# MCP ドキュメントサーバーを停止する
mcp-down:
	docker compose -f compose.mcp.yml down

# .envのGITHUB_REPOで指定したリポジトリにAIワークフロー用ラベルを一括作成する
setup-labels:
	@bash scripts/setup-labels.sh

# .envのGITHUB_REPOで指定したリポジトリにAI Issue Formテンプレートを配布・コミットする
setup-issue-template:
	@bash scripts/setup-issue-template.sh

# .envのGITHUB_REPOで指定したリポジトリにAI Skill テンプレートを配布・コミットする
setup-skills:
	@bash scripts/setup-skills.sh

# .envのGITHUB_REPOで指定したリポジトリのDevContainerにClaudeCode設定を追加・配布する
setup-devcontainer:
	@bash scripts/setup-devcontainer.sh

# workflows/ 配下の JSON を n8n にインポートする（N8N_API_KEY が必要）
import-workflow:
	@bash scripts/import-workflow.sh

# Markdown のリントチェック
lint:
	@markdownlint "**/*.md" --ignore node_modules --ignore "mcp-server/node_modules" --ignore data

# Markdown の自動修正
lint-fix:
	@markdownlint "**/*.md" --ignore node_modules --ignore "mcp-server/node_modules" --ignore data --fix

# このリポジトリへの git push 用に GitHub CLI を認証する（PAT 期限切れ時に再実行）
auth:
	@op read "op://$(OP_VAULT_ID)/GitHub PAT min-factory/token" | gh auth login --with-token
