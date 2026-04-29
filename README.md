# recourse

Know what you can't undo before you `terraform apply`.

Recourse analyzes Terraform plans for blast radius and recoverability. It tells you which changes are reversible, which need backups to recover, and which will permanently destroy data.

## Installation

```bash
npm install -g recourse-cli
```

Or run directly:

```bash
npx recourse-cli plan plan.json
```

## Usage

```bash
# Generate a plan JSON
terraform plan -out=plan.bin
terraform show -json plan.bin > plan.json

# Analyze it
recourse-cli plan plan.json
```

## Example Output

```
BLAST RADIUS REPORT
═══════════════════

DIRECT CHANGES

  ✗ DELETE aws_db_instance.main
    Recoverability: unrecoverable
    skip_final_snapshot=true, no backup retention; data will be lost

  ✗ DELETE aws_s3_bucket.logs
    Recoverability: unrecoverable
    Bucket deletion is permanent; versioning does not survive bucket deletion

  ~ UPDATE aws_security_group.web
    Recoverability: reversible

SUMMARY
  Unrecoverable:         2 resources
  Recoverable (backup):  0 resources
  Recoverable (effort):  0 resources
  Reversible:            1 resource

⚠️  This plan contains unrecoverable changes.
```

## Recoverability Tiers

| Tier | Label | Meaning |
|------|-------|---------|
| 1 | `reversible` | Can undo with another apply (e.g., re-enable a setting) |
| 2 | `recoverable-with-effort` | Can recreate but requires work (e.g., EC2 from AMI) |
| 3 | `recoverable-from-backup` | Requires backup/snapshot to restore (e.g., RDS from snapshot) |
| 4 | `unrecoverable` | Data is gone (e.g., RDS with skip_final_snapshot=true) |

## Explain a Classification

Don't trust a verdict? See exactly why:

```bash
recourse-cli explain plan.json aws_db_instance.main
```

```
VERDICT
══════════════════════════════════════════════════

aws_db_instance.main → unrecoverable (high confidence)

skip_final_snapshot=true, no backup retention; data will be lost

CLASSIFICATION TRACE
──────────────────────────────────────────────────

  ✓ deletion_protection
      → false
      No deletion protection

  ✗ skip_final_snapshot
      → true
      No automatic snapshot on deletion

  ✗ backup_retention_period
      → 0
      No automated backups

WHAT WOULD CHANGE THIS
──────────────────────────────────────────────────

  • If deletion_protection were set to true
    → Verdict would be: blocked
    Apply would fail; AWS blocks deletion when protection is enabled

  • If skip_final_snapshot were false
    → Verdict would be: recoverable-from-backup
    A final snapshot would be created before deletion
```

## CI Integration

Fail the pipeline if any change is unrecoverable:

```bash
recourse-cli plan plan.json --fail-on unrecoverable
```

Exit codes:
- `0` — No changes at or above the specified tier
- `1` — At least one change meets or exceeds the tier

Options for `--fail-on`: `unrecoverable`, `backup`, `effort`, `reversible`

## Recourse Cloud Submission

`evaluate` can submit its consequence report to a private Recourse Cloud control plane while still printing the local JSON report to stdout:

```bash
RECOURSE_CLOUD_URL=https://recourse-cloud.example.com \
RECOURSE_ORGANIZATION_ID=org_123 \
RECOURSE_ACTOR_ID=agent/deploy \
recourse-cli evaluate shell 'aws s3 rm s3://prod-audit-logs --recursive' \
  --environment production \
  --submit
```

Cloud submission status is written to stderr so JSON output remains parseable. If submission fails, local evaluation still completes and the exit code is based on `--fail-on`.

Configuration:

- `RECOURSE_CLOUD_URL`: private API base URL.
- `RECOURSE_ORGANIZATION_ID`: organization scope for the evaluation.
- `RECOURSE_ACTOR_ID` or `--actor`: actor identity sent in auth headers and request body.
- `RECOURSE_ENVIRONMENT` or `--environment`: optional environment label.

## Supported Resources

### AWS (70+ resource types, hand-written rules)

- **Databases**: RDS instances/clusters, DynamoDB tables
- **Storage**: S3 buckets/objects, EBS volumes/snapshots
- **Compute**: EC2 instances, Lambda functions, AMIs
- **Networking**: VPCs, subnets, security groups, EIPs, load balancers
- **IAM**: Roles, policies, users
- **Other**: KMS keys, Route53 zones, SNS/SQS, CloudWatch logs

Run `recourse-cli resources` to see the full list.

Golden provider fixtures live in `tests/fixtures/plans/` and are documented in `docs/golden-fixtures.md`. They cover AWS, GCP, Azure, and unknown provider semantics for stable local and future cloud ingestion tests.

### GCP & Azure

GCP and Azure now have first-class deterministic handlers for common destructive resources. The unknown-resource classifier remains available for ambiguous resource types, but deterministic rules win when a provider-specific handler exists.

**GCP coverage includes:**
- Storage: `google_storage_bucket`, bucket objects, bucket IAM
- Databases: `google_sql_database_instance`, databases, users
- IAM: project IAM, service accounts, service account keys
- Core: DNS records, persistent disks, snapshots, KMS keys, GKE clusters/node pools

**Azure coverage includes:**
- Storage: `azurerm_storage_account`, containers, blobs, shares, queues, tables
- Databases: Azure SQL/MSSQL, PostgreSQL Flexible Server, MySQL Flexible Server, MariaDB
- IAM: role assignments/definitions, Azure AD applications/service principals/passwords
- Core: DNS records, managed disks, snapshots, Key Vault keys/vaults, AKS clusters/node pools

**Examples of provider-specific safety checks:**
- GCS bucket versioning and Azure Storage soft delete/versioning can move destructive storage changes to `recoverable-from-backup`.
- Cloud SQL deletion protection produces a blocked/reversible verdict.
- Cloud SQL and Azure SQL backup retention produce `recoverable-from-backup`.
- Service account keys and service principal passwords are treated as unrecoverable credential material.

## Classifier Roadmap

Known AWS, GCP, and Azure resources use hand-written rules and remain the source of truth. Unknown resource types now go through a provider-neutral semantic classifier before the legacy AWS-trained decision tree. This public path is BitNet-ready: it uses the same abstract safety signals a compact model will learn, while keeping today's runtime dependency-free.

The semantic classifier recognizes provider-neutral recoverability signals such as:

- `deletion_protection=true` on any managed resource means the apply is blocked or reversible.
- `versioning=true` on storage resources means recovery may come from versioned data.
- `recovery_window_in_days` and `deletion_window_in_days` are related soft-delete signals.
- database backup retention and PITR imply `recoverable-from-backup`.
- unknown destructive resources with weak evidence return `needs-review` instead of being marked safe.

The safety boundary does not change: deterministic rules win for known resources, and unknown destructive verdicts remain conservative until backed by evidence. BitNet can replace the semantic scorer later without changing the public classifier contract.

## JSON Output

```bash
recourse-cli plan plan.json --format json
recourse-cli explain plan.json aws_db_instance.main --format json
```

## Limitations

Recourse analyzes what's in the Terraform plan and state. It cannot:

- Verify backups exist outside Terraform (AWS Backup, manual snapshots)
- Check cross-account or cross-region configurations
- Know what's actually in your S3 buckets or databases
- Predict race conditions between plan and apply

The tool is conservative: when it can't verify something, it tells you in the limitations section of `--explain`.

## License

MIT
