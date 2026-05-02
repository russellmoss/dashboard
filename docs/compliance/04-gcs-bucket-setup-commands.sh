#!/usr/bin/env bash
# GCS Call Recordings Bucket — Setup Commands
#
# Spec: docs/compliance/04-gcs-call-recordings-policy.md
# Status: DO NOT RUN until Unit 0.4 is signed off.
#
# Usage:
#   bash docs/compliance/04-gcs-bucket-setup-commands.sh
#
# Idempotent. Safe to re-run.

set -euo pipefail

PROJECT="savvy-gtm-analytics"
REGION="us-east1"
BUCKET="savvy-call-recordings"
KMS_LOCATION="us-east1"
KMS_KEYRING="call-recordings"
KMS_KEY="default"
SA_NAME="call-transcriber-runner"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "==> Sanity check: gcloud + project"
gcloud config set project "$PROJECT"
gcloud config get-value project

echo "==> Step 1: Create KMS keyring (idempotent)"
gcloud kms keyrings create "$KMS_KEYRING" \
  --location="$KMS_LOCATION" \
  --project="$PROJECT" \
  2>/dev/null || echo "    keyring already exists, skipping"

echo "==> Step 2: Create KMS key (idempotent)"
gcloud kms keys create "$KMS_KEY" \
  --keyring="$KMS_KEYRING" \
  --location="$KMS_LOCATION" \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)" \
  --project="$PROJECT" \
  2>/dev/null || echo "    key already exists, skipping"

KMS_KEY_NAME="projects/${PROJECT}/locations/${KMS_LOCATION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}"
echo "    KMS key: $KMS_KEY_NAME"

echo "==> Step 3: Create service account (idempotent)"
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Call Transcriber Runner" \
  --description="Cloud Run Job service account for call-transcriber. See packages/call-transcriber/" \
  --project="$PROJECT" \
  2>/dev/null || echo "    service account already exists, skipping"

echo "==> Step 4: Grant KMS encrypt/decrypt to service account"
gcloud kms keys add-iam-policy-binding "$KMS_KEY" \
  --keyring="$KMS_KEYRING" \
  --location="$KMS_LOCATION" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter \
  --project="$PROJECT"

echo "==> Step 4b: Grant KMS encrypt/decrypt to GCS service agent"
GCS_SA=$(gcloud storage service-agent --project="$PROJECT")
gcloud kms keys add-iam-policy-binding "$KMS_KEY" \
  --keyring="$KMS_KEYRING" \
  --location="$KMS_LOCATION" \
  --member="serviceAccount:${GCS_SA}" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter \
  --project="$PROJECT"

echo "==> Step 5: Create bucket (idempotent)"
if gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    bucket already exists, skipping creation"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="$PROJECT" \
    --location="$REGION" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --default-encryption-key="$KMS_KEY_NAME"
fi

echo "==> Step 6: Apply lifecycle rule (delete after 365 days)"
LIFECYCLE_TMP=$(mktemp)
cat > "$LIFECYCLE_TMP" <<'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "age": 365 }
      }
    ]
  }
}
EOF
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="$LIFECYCLE_TMP" \
  --project="$PROJECT"
rm -f "$LIFECYCLE_TMP"

echo "==> Step 7: Grant service account objectAdmin on bucket"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/storage.objectAdmin \
  --project="$PROJECT"

echo "==> Step 8: Verify configuration"
echo "--- Bucket settings ---"
gcloud storage buckets describe "gs://${BUCKET}" \
  --format='yaml(location,storageClass,iamConfiguration,encryption,lifecycle)' \
  --project="$PROJECT"

echo "--- IAM policy ---"
gcloud storage buckets get-iam-policy "gs://${BUCKET}" \
  --format='yaml(bindings)' \
  --project="$PROJECT"

echo ""
echo "✅ Setup complete."
echo ""
echo "Next steps:"
echo "  1. Verify Cloud Audit Logs are enabled at project level for Cloud Storage:"
echo "     gcloud logging sinks list --project=${PROJECT}"
echo "     If DATA_READ / DATA_WRITE not configured, enable in IAM & Admin → Audit Logs UI."
echo "  2. Test upload:"
echo "     echo 'test' > /tmp/test.txt"
echo "     gcloud storage cp /tmp/test.txt gs://${BUCKET}/test/test.txt --project=${PROJECT}"
echo "     gcloud storage rm gs://${BUCKET}/test/test.txt --project=${PROJECT}"
echo "  3. Mark Unit 0.4 as ✅ in docs/compliance/00-INDEX-phase-0-signoffs.md"
