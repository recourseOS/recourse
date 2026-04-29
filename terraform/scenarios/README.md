# Test Scenarios

These Terraform configurations create realistic dangerous infrastructure patterns for testing `blast`.

They are also the seed corpus for classifier evaluation. AWS scenarios validate deterministic handlers; future GCP/Azure scenarios should validate BitNet's unknown-resource classification without adding provider-specific rules.

## Scenarios

| Scenario | What it tests |
|----------|--------------|
| `rds-unprotected/` | RDS with `skip_final_snapshot=true`, no backups, no deletion protection |
| `s3-no-versioning/` | S3 bucket without versioning containing objects |
| `dynamodb-no-pitr/` | DynamoDB table without point-in-time recovery |
| `cloudwatch-logs/` | Log groups with years of retention (audit/compliance logs) |
| `kms-short-deletion/` | KMS key with 7-day deletion window + resources encrypted with it |

## Classifier Fixtures

When adding scenarios for unknown-resource classification, include both the risky and safer variants. For example:

- Storage without versioning or soft delete should not be marked safe.
- Storage with versioning should surface backup-based recovery evidence.
- Databases with deletion protection should be blocked or reversible.
- Soft-delete resources should distinguish recovery windows from immediate deletion.

These cases are especially important for BitNet validation because the goal is to learn provider-neutral recoverability patterns, not memorize AWS resource type ranges.

## Usage

You do NOT need to actually create these resources. Just generate plans.

```bash
# From any scenario directory:
cd rds-unprotected
terraform init
terraform plan -out=plan.bin
terraform show -json plan.bin > plan.json

# Now test blast against it:
blast plan plan.json
```

## Generating destroy plans

To test how blast handles resource deletion:

```bash
# First, create a plan that would create resources
terraform plan -out=create.bin
terraform show -json create.bin > create-plan.json

# Then, remove resources from main.tf (or delete the file)
# and create a destroy plan
terraform plan -out=destroy.bin
terraform show -json destroy.bin > destroy-plan.json

# Test blast against the destroy plan
blast plan destroy-plan.json
```

## Quick test (no AWS account needed)

You can generate plans without AWS credentials by using `-target` on resources that don't need remote state:

```bash
terraform init
terraform plan -refresh=false -out=plan.bin 2>/dev/null || true
terraform show -json plan.bin > plan.json 2>/dev/null || true
```

This may produce incomplete plans but enough to test the parser and classifier.
