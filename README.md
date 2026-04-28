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

## Supported Resources

### AWS (70+ resource types, hand-written rules)

- **Databases**: RDS instances/clusters, DynamoDB tables
- **Storage**: S3 buckets/objects, EBS volumes/snapshots
- **Compute**: EC2 instances, Lambda functions, AMIs
- **Networking**: VPCs, subnets, security groups, EIPs, load balancers
- **IAM**: Roles, policies, users
- **Other**: KMS keys, Route53 zones, SNS/SQS, CloudWatch logs

Run `recourse-cli resources` to see the full list.

### GCP & Azure (Experimental)

GCP and Azure resources are classified via a classifier that reads abstract safety patterns from your plans. The classifier learned from AWS rules and generalizes across clouds.

**What's tested (8 resource types):**
- GCP: `google_project_iam_binding`, `google_sql_database_instance`, `google_storage_bucket`
- Azure: `azurerm_role_assignment`, `azurerm_dns_a_record`, `azurerm_storage_account`

**What works:**
- IAM/access control resources (via naming patterns)
- Databases with `deletion_protection` (via abstract feature transfer)
- DNS records (config-only, always reversible)

**What's not yet validated:**
- Full coverage across all resource types
- Correct `unrecoverable` verdicts for storage without versioning/backups

We're actively looking for testers. Run `recourse-cli plan` with `--classifier` on your GCP/Azure plans and tell us what we got wrong.

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
