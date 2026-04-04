.PHONY: setup up down auth setup-labels

-include .env
export

setup:
	@cp -n .env.example .env || true
	@sed -i '' "s|N8N_BASIC_AUTH_PASSWORD=.*|N8N_BASIC_AUTH_PASSWORD=$$(openssl rand -hex 16)|" .env
	@sed -i '' "s|N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" .env
	@sed -i '' "s|HOST_SSH_USER=.*|HOST_SSH_USER=$$(whoami)|" .env
	@mkdir -p data/n8n
	@echo "✅ .env を生成しました。GITHUB_REPO と PROJECT_PATH を設定してください。"

up:
	docker compose up -d

down:
	docker compose down

# .envのGITHUB_REPOで指定したリポジトリにAIワークフロー用ラベルを一括作成する
setup-labels:
	@bash scripts/setup-labels.sh

# このリポジトリへの git push 用に GitHub CLI を認証する（PAT 期限切れ時に再実行）
auth:
	@op read "op://$(OP_VAULT_ID)/GitHub PAT min-factory/token" | gh auth login --with-token
