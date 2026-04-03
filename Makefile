.PHONY: setup up down

setup:
	@cp -n .env.example .env || true
	@sed -i '' "s|N8N_BASIC_AUTH_PASSWORD=$$|N8N_BASIC_AUTH_PASSWORD=$$(openssl rand -hex 16)|" .env
	@sed -i '' "s|N8N_ENCRYPTION_KEY=$$|N8N_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" .env
	@sed -i '' "s|HOST_SSH_USER=$$|HOST_SSH_USER=$$(whoami)|" .env
	@mkdir -p data/n8n
	@echo "✅ .env を生成しました。GITHUB_REPO と PROJECT_PATH を設定してください。"

up:
	docker compose up -d

down:
	docker compose down
