# Unit 0.4 — GCS Call Recordings Bucket Security Policy

**Status:** ⬜ Pending
**Approver:** TBD
**Date signed off:** —

## Goal

Define and approve the security baseline for the GCS bucket that retains raw call mp3s. This bucket is a second copy of customer-controlled call recordings — its security posture must match (or exceed) Kixie's.

## Bucket Specification

| Setting | Value | Rationale |
|---|---|---|
| **Name** | `savvy-call-recordings` | Single bucket, no environment suffix (we don't have a separate dev pipeline; backfill happens in prod) |
| **Project** | `savvy-gtm-analytics` | Existing GCP project; same as analyst-bot, mcp-server |
| **Location** | `us-east1` (regional) | Matches Cloud Run Job region; minimizes egress cost |
| **Storage class** | Standard | Read frequency on retention copies is rare but unpredictable |
| **Public access prevention** | `enforced` | No object should ever be publicly accessible; this prevents accidental allUsers/allAuthenticatedUsers grants |
| **Uniform bucket-level access (UBLA)** | `enabled` | Forces IAM-only ACLs; legacy ACLs disabled |
| **Encryption** | CMEK with Cloud KMS key `projects/savvy-gtm-analytics/locations/us-east1/keyRings/call-recordings/cryptoKeys/default` | Customer-managed key for audit + revocation control |
| **Versioning** | `disabled` | We don't need version history; retention policy handles deletion |
| **Lifecycle rule** | Delete objects after `365` days | Per Bucket 2 Q2 user decision (2026-04-27) |
| **Retention policy** | Not set | Lifecycle rule is sufficient; retention policy locks against admin override which we don't need |
| **Logging** | Cloud Audit Logs `DATA_READ`, `DATA_WRITE`, `ADMIN_READ` enabled at project level | Forensic trail for any access |
| **Object path** | `recordings/{YYYY}/{MM}/{taskId}.mp3` | Date-partitioned for sane listing |

## IAM Spec

Single dedicated service account: `call-transcriber-runner@savvy-gtm-analytics.iam.gserviceaccount.com`.

| Principal | Role | Scope | Purpose |
|---|---|---|---|
| `call-transcriber-runner@...` | `roles/storage.objectAdmin` | bucket `savvy-call-recordings` only | Upload mp3s, read for retention, delete on lifecycle |
| `call-transcriber-runner@...` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | KMS key | Encrypt/decrypt objects |
| Specific admin users (named individually) | `roles/storage.objectViewer` | bucket only | Forensic / audit access; granted ad-hoc, not standing |

**No other principals.** No `allAuthenticatedUsers`. No `allUsers`. No project-default service account access.

## Setup Procedure

The setup commands are documented in `04-gcs-bucket-setup-commands.sh` (alongside this file). **DO NOT EXECUTE** until this policy is signed off.

After sign-off:
1. Run the script
2. Verify each setting via `gcloud storage buckets describe gs://savvy-call-recordings --format=json`
3. Run the audit-log verification: confirm Cloud Audit Logs are emitting `DATA_WRITE` entries for a test object upload

## Verification Steps Post-Setup

```bash
# 1. Public access prevention
gcloud storage buckets describe gs://savvy-call-recordings \
  --format='value(iamConfiguration.publicAccessPrevention)'
# Expected: enforced

# 2. UBLA
gcloud storage buckets describe gs://savvy-call-recordings \
  --format='value(iamConfiguration.uniformBucketLevelAccess.enabled)'
# Expected: True

# 3. CMEK
gcloud storage buckets describe gs://savvy-call-recordings \
  --format='value(encryption.defaultKmsKeyName)'
# Expected: projects/savvy-gtm-analytics/.../call-recordings/cryptoKeys/default

# 4. Lifecycle
gcloud storage buckets describe gs://savvy-call-recordings \
  --format='json(lifecycle)'
# Expected: rule with action=Delete, condition.age=365

# 5. IAM (no surprises)
gcloud storage buckets get-iam-policy gs://savvy-call-recordings \
  --format='json(bindings)'
# Expected: only call-transcriber-runner@ + named admins; no allUsers/allAuthenticatedUsers
```

## Security Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Accidental public exposure | LOW | HIGH | `publicAccessPrevention = enforced` (cannot be overridden without explicit policy change) |
| Unauthorized read by GCP engineer | LOW | MEDIUM | UBLA + CMEK (Google can't decrypt without our KMS key) + audit logs |
| Service account key compromise | LOW | MEDIUM | Service account uses ADC on Cloud Run (no exported keys); rotate KMS key annually |
| Retention violation (data kept too long) | LOW | LOW (operational, not legal) | Lifecycle rule is automated; verify in audit |
| KMS key deletion / revocation | LOW | HIGH (data unreadable) | Don't grant key-deletion to service account; only project owners can delete; CMEK has 30-day soft-delete |

## Cost Estimate

| Storage volume | Annual cost (us-east1 Standard) |
|---|---|
| 6,222 calls × 6 MB avg = ~37 GB | ~$9/year |
| Steady-state: ~100 MB/day = ~37 GB/year | ~$9/year |
| Total at steady state with 1-year retention | ~$10/year |

Negligible. Audit log volume + KMS key operations add maybe another $5-10/year.

## Sign-Off

**Spec reviewed:** [ ] Yes
**Lifecycle period (365 days) approved:** [ ] Yes (per Bucket 2 Q2 user decision) | [ ] Override: ___________
**CMEK key location approved:** [ ] Yes | [ ] Override: ___________
**IAM grants approved:** [ ] Yes (only `call-transcriber-runner@`)
**Setup commands ready to execute:** [ ] Yes (`04-gcs-bucket-setup-commands.sh`)

**Approver:** ___________________________
**Date:** ___________

## References

- [Google Cloud Storage Best Practices](https://cloud.google.com/storage/docs/best-practices)
- [GCS Uniform Bucket-Level Access](https://cloud.google.com/storage/docs/uniform-bucket-level-access)
- [GCS Public Access Prevention](https://cloud.google.com/storage/docs/public-access-prevention)
- [GCS Customer-Managed Encryption Keys](https://cloud.google.com/storage/docs/encryption/using-customer-managed-keys)
