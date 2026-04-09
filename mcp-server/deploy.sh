#!/bin/bash
set -euo pipefail

PROJECT_ID="savvy-gtm-analytics"
SERVICE_NAME="savvy-mcp-server"
REGION="us-east1"
SERVICE_ACCOUNT="dashboard-bigquery-reader@${PROJECT_ID}.iam.gserviceaccount.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_SOURCE="${SCRIPT_DIR}/../.claude/schema-config.yaml"

# Source DATABASE_URL from .env if not already set
if [ -z "${DATABASE_URL:-}" ] && [ -f "${SCRIPT_DIR}/../.env" ]; then
  DATABASE_URL=$(grep "^DATABASE_URL=" "${SCRIPT_DIR}/../.env" | cut -d= -f2-)
  echo "Loaded DATABASE_URL from .env"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set and .env not found."
  exit 1
fi

echo "Building and deploying ${SERVICE_NAME} to Cloud Run..."

# Copy schema-config.yaml from source of truth (.claude/) into build context
if [ ! -f "${SCHEMA_SOURCE}" ]; then
  echo "ERROR: ${SCHEMA_SOURCE} not found. This is the source of truth for MCP schema context."
  exit 1
fi
cp "${SCHEMA_SOURCE}" "${SCRIPT_DIR}/schema-config.yaml"
echo "Copied schema-config.yaml from .claude/ (source of truth)"

# Build container and push to GCR
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  .

# Deploy to Cloud Run
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SERVICE_ACCOUNT}" \
  --set-env-vars="DATABASE_URL=${DATABASE_URL}" \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --allow-unauthenticated \
  --ingress=all

echo "Deployment complete."
gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
