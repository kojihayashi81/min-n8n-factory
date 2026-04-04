#!/bin/bash
set -e

if [ -z "$N8N_API_KEY" ]; then
  echo "Error: N8N_API_KEY is not set."
  echo "Set it in .env: N8N_API_KEY=your-api-key"
  echo "Generate it in n8n UI: Settings → API → Create an API key"
  exit 1
fi

N8N_URL="${N8N_URL:-http://localhost:5678}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_DIR="$SCRIPT_DIR/../workflows"

for workflow_file in "$WORKFLOW_DIR"/*.json; do
  name=$(basename "$workflow_file")
  echo "Importing $name..."
  curl -s -X POST "$N8N_URL/api/v1/workflows" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d @"$workflow_file" | jq '.id, .name'
  echo "done: $name"
done
