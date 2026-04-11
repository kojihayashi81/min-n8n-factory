#!/bin/bash
set -e

if [ -z "$N8N_API_KEY" ]; then
  echo "Error: N8N_API_KEY is not set."
  echo "Set it in .env: N8N_API_KEY=your-api-key"
  echo "Generate it in n8n UI: Settings → API → Create an API key"
  exit 1
fi

: "${N8N_URL:=http://localhost:5678}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_DIR="$SCRIPT_DIR/../workflows"

for workflow_file in "$WORKFLOW_DIR"/*.json; do
  file_name=$(basename "$workflow_file")
  wf_name=$(jq -r '.name' "$workflow_file")
  echo "Importing $file_name ($wf_name)..."

  # 既存ワークフローを名前で検索
  existing_id=$(curl -s "$N8N_URL/api/v1/workflows" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    | jq -r --arg name "$wf_name" '.data[] | select(.name == $name) | .id')

  if [ -n "$existing_id" ]; then
    echo "  found existing workflow (id=$existing_id), updating..."
    curl -s -X PUT "$N8N_URL/api/v1/workflows/$existing_id" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$workflow_file" | jq '.id, .name'
    echo "  updated: $wf_name"
  else
    curl -s -X POST "$N8N_URL/api/v1/workflows" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$workflow_file" | jq '.id, .name'
    echo "  created: $wf_name"
  fi
done

echo ""
echo "⚠️  インポート後に n8n UI で GitHub ノードの Credential を手動で紐付けてください。"
