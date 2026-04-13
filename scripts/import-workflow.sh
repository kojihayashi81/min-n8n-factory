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
    response=$(curl -s -w "\n%{http_code}" -X PUT "$N8N_URL/api/v1/workflows/$existing_id" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$workflow_file")
    method="update"
  else
    response=$(curl -s -w "\n%{http_code}" -X POST "$N8N_URL/api/v1/workflows" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      -d @"$workflow_file")
    method="create"
  fi

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    result_id=$(echo "$body" | jq -r '.id // "unknown"')
    echo "  ✅ ${method}d: $wf_name (id=$result_id)"
  else
    echo "  ❌ ${method} failed (HTTP $http_code)"
    echo "  response: $body"
    exit 1
  fi
done

echo ""
echo "⚠️  インポート後に n8n UI で GitHub ノードの Credential を手動で紐付けてください。"
