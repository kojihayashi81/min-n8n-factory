.PHONY: setup up down auth setup-labels setup-issue-template setup-skills setup-devcontainer import-workflow lint lint-fix

-include .env
export

setup:
	@cp -n .env.example .env || true
	@sed -i '' "s|N8N_BASIC_AUTH_PASSWORD=.*|N8N_BASIC_AUTH_PASSWORD=$$(openssl rand -hex 16)|" .env
	@sed -i '' "s|N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" .env
	@mkdir -p data/n8n
	@echo "✅ .env を生成しました。GITHUB_REPO と PROJECT_PATH を設定してください。"

up:
	docker compose up -d

down:
	docker compose down

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
	@markdownlint "**/*.md" --ignore node_modules --ignore data

# Markdown の自動修正
lint-fix:
	@markdownlint "**/*.md" --ignore node_modules --ignore data --fix

# このリポジトリへの git push 用に GitHub CLI を認証する（PAT 期限切れ時に再実行）
auth:
	@op read "op://$(OP_VAULT_ID)/GitHub PAT min-factory/token" | gh auth login --with-token
