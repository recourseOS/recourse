# recourse

AI-ready consequence analysis for infrastructure changes.

Recourse is a rules-first, BitNet-ready consequence evaluator for infrastructure changes. It reads Terraform plans, shell commands, or MCP tool calls and classifies each mutation by recoverability: reversible, recoverable with effort, recoverable from backup, unrecoverable, or needs review.

The public CLI is local-first. No account or cloud service is required.

## What It Does

- Analyzes Terraform plan JSON before `terraform apply`.
- Evaluates shell commands and MCP tool calls as mutation intents.
- Renders an operator-friendly terminal preflight view for humans reviewing agent actions.
- Runs as an MCP stdio server so agents can ask RecourseOS before they act.
- Classifies destructive AWS, GCP, and Azure resources with deterministic provider rules.
- Uses a provider-neutral semantic classifier for unknown resource types when `--classifier` is enabled.
- Produces human-readable blast-radius reports and machine-readable consequence JSON.
- Can collect read-only AWS evidence for S3, RDS, DynamoDB, IAM roles, and KMS keys.
- Can optionally submit local reports to a configured Recourse Cloud endpoint.

## Why Not Just Terraform Plan?

Terraform plan is a diff. Recourse is a consequence engine.

Terraform tells you what will change:

```text
- aws_db_instance.main will be destroyed
```

Recourse tells you what that means:

```text
aws_db_instance.main
recoverability: unrecoverable
reason: skip_final_snapshot=true, backup_retention_period=0, deletion_protection=false
decision: block
```

The difference is recoverability. Recourse answers the question Terraform does not: if this mutation happens, can we actually get it back?

This is not limited to Terraform. Terraform plan is one input source. The same consequence report model also supports shell commands and MCP tool calls, so infrastructure changes from humans, CI jobs, and agents can be evaluated through the same recoverability policy.

## Install

```bash
npm install -g recourse-cli
```

Or run without installing:

```bash
npx recourse-cli plan plan.json
```

The installed command is `recourse`.

## Quick Start

```bash
terraform plan -out=plan.bin
terraform show -json plan.bin > plan.json

recourse plan plan.json
```

Open the product TUI for a proposed action:

```bash
recourse preflight terraform plan.json --classifier
recourse preflight shell 'aws s3 rm s3://prod-audit-logs --recursive'
recourse preflight mcp '{"server":"aws","tool":"s3.delete_bucket","arguments":{"bucket":"prod-audit-logs"}}'
```

Fail CI if a plan contains unrecoverable changes:

```bash
recourse plan plan.json --fail-on unrecoverable
```

Use JSON output:

```bash
recourse plan plan.json --format json
```

Enable the unknown-resource classifier for provider types without deterministic rules:

```bash
recourse plan plan.json --classifier
```

## Example Output

```text
BLAST RADIUS REPORT
===================

DIRECT CHANGES

  X DELETE aws_db_instance.main
    Recoverability: unrecoverable
    skip_final_snapshot=true, no backup retention; data will be lost

  X DELETE google_storage_bucket.audit
    Recoverability: recoverable-from-backup
    GCS bucket versioning is enabled; object generations may be recoverable

  ~ DELETE azurerm_role_assignment.reader
    Recoverability: reversible
    Azure role assignment/definition is config-only and can be reapplied

SUMMARY
  Unrecoverable:         1 resource
  Recoverable (backup):  1 resource
  Reversible:            1 resource
```

## Recoverability Tiers

| Tier | Label | Meaning |
| --- | --- | --- |
| 1 | `reversible` | Can be undone with another apply or API call. |
| 2 | `recoverable-with-effort` | Can be recreated, but requires coordinated work. |
| 3 | `recoverable-from-backup` | Requires a backup, snapshot, version, or retention window. |
| 4 | `unrecoverable` | Data, identity, key material, or recovery points may be permanently lost. |
| 5 | `needs-review` | Evidence is insufficient to classify safely. |

## Commands

### Terraform Plan Analysis

```bash
recourse plan plan.json
recourse plan plan.json --state terraform.tfstate
recourse plan plan.json --format json
recourse plan plan.json --classifier
```

`plan` is optimized for Terraform plan JSON from `terraform show -json`. It uses prior state embedded in the plan when available, or an explicit state file when provided.

### Explain a Verdict

```bash
recourse explain plan.json aws_db_instance.main
recourse explain plan.json aws_db_instance.main --format json
```

`explain` shows the checks, missing evidence, limitations, and counterfactuals behind a classification.

### Generic Consequence Reports

```bash
recourse evaluate terraform plan.json --classifier
recourse evaluate shell 'aws s3 rm s3://prod-audit-logs --recursive'
recourse evaluate mcp '{"server":"aws","tool":"s3.delete_bucket","arguments":{"bucket":"prod-audit-logs"}}'
```

`evaluate` emits a normalized consequence report for Terraform, shell, or MCP inputs. The same report shape is used by the CLI, MCP server, and configured submission endpoints.

### Terminal Preflight

```bash
recourse preflight terraform plan.json --classifier
recourse preflight shell 'kubectl delete namespace payments'
recourse preflight mcp mcp-call.json
```

`preflight` is the human product surface. It renders a terminal cockpit showing the input adapter, normalized mutation, evaluation pipeline, decision, missing evidence, and agent-safe response. Use `--format json` when you want the same command to emit the machine-readable consequence report.

### Agent Interface

RecourseOS can run as the consequence layer agents call before they act:

```bash
recourse mcp serve
```

The MCP server exposes `recourse_evaluate_terraform`, `recourse_evaluate_shell`, `recourse_evaluate_mcp_call`, and `recourse_supported_resources`. The public MCP tool contract and agent decision semantics are documented in `docs/agent-interface.md`.

MCP client setup and smoke-test instructions are documented in `docs/mcp-setup.md`.

```bash
npm run mcp:smoke
```

### Read-Only AWS Evidence

```bash
recourse evidence aws-s3 prod-audit-logs --region us-east-1 > s3-evidence.json
recourse evidence aws-rds prod-db --region us-east-1 > rds-evidence.json

recourse evaluate shell 'aws s3 rb s3://prod-audit-logs --force' \
  --aws-s3-evidence s3-evidence.json
```

Supported evidence providers: `aws-s3`, `aws-rds`, `aws-dynamodb`, `aws-iam-role`, and `aws-kms-key`.

### Supported Resource List

```bash
recourse resources
```

The coverage reference is in `docs/resource-coverage.md`, with the landing-page themed version at `docs/resource-coverage.html`.

## Multi-Cloud Coverage

Known resources use hand-written deterministic rules and remain authoritative.

AWS coverage includes:
- Databases and caches: RDS instances/clusters, DynamoDB tables, ElastiCache, and Neptune.
- Storage: S3 buckets/objects, EBS volumes/snapshots, and EFS file systems.
- Compute: EC2 instances, Lambda functions, and AMIs.
- Networking: VPCs, subnets, security groups, EIPs, load balancers, and Route53.
- IAM and platform services: IAM roles/policies/users, KMS, Secrets Manager, SNS/SQS, and CloudWatch logs.

GCP coverage includes:
- Storage: `google_storage_bucket`, bucket objects, and bucket IAM.
- Databases and analytics: `google_sql_database_instance`, databases, users, and BigQuery datasets/tables.
- IAM and secrets: project IAM, service accounts, service account keys, and Secret Manager secrets/versions/IAM.
- Core: DNS records, persistent disks, snapshots, KMS keys, and GKE clusters/node pools.

Azure coverage includes:
- Storage: `azurerm_storage_account`, containers, blobs, shares, queues, and tables.
- Databases: Azure SQL/MSSQL, PostgreSQL Flexible Server, MySQL Flexible Server, MariaDB, and Cosmos DB.
- IAM: role assignments/definitions and Azure AD applications/service principals/passwords.
- Core: DNS records, managed disks, snapshots, Key Vault vaults/keys/secrets/certificates/access policies, and AKS clusters/node pools.

## Unknown Resources and BitNet Path

For known AWS, GCP, and Azure resources, deterministic rules win.

For unknown resource types, `--classifier` enables a provider-neutral semantic profile and classifier. It recognizes abstract safety signals such as:

- `deletion_protection=true`
- storage versioning and soft delete
- backup retention and point-in-time recovery
- `recovery_window_in_days` and `deletion_window_in_days`
- IAM/config-only relationship resources
- credential material that cannot be recovered after deletion

If evidence is weak, the classifier returns `needs-review` rather than marking the change safe. This path is intentionally BitNet-compatible: model-backed unknown-resource classification can preserve the same consequence report contract while deterministic rules remain authoritative.

## Golden Fixtures

Stable provider fixtures live in `tests/fixtures/plans/`:

- `aws-golden.json`
- `gcp-golden.json`
- `azure-golden.json`
- `unknown-semantic-golden.json`

Run their contract tests with:

```bash
npm run build
npx vitest --run tests/golden-plan-fixtures.test.ts
```

See `docs/golden-fixtures.md` for expected decisions and coverage.

## Optional Recourse Cloud Submission

Cloud is optional. Local evaluation remains authoritative.

```bash
RECOURSE_CLOUD_URL=https://recourse-cloud.example.com \
RECOURSE_ORGANIZATION_ID=org_123 \
RECOURSE_ACTOR_ID=agent/deploy \
recourse evaluate terraform plan.json \
  --environment production \
  --classifier \
  --submit
```

Cloud submission status is written to stderr so stdout stays parseable JSON. If submission fails, the local report still completes and the exit code is based on `--fail-on`.

Configuration:

- `RECOURSE_CLOUD_URL`: Recourse Cloud API base URL.
- `RECOURSE_ORGANIZATION_ID`: organization scope.
- `RECOURSE_ACTOR_ID` or `--actor`: actor identity.
- `RECOURSE_ENVIRONMENT` or `--environment`: optional environment label.

## Development

```bash
npm install
npm run build
npm test
npm run test:all
npm run test:docs:visual
```

Focused test suites:

```bash
npx vitest --run tests/multicloud-rules.test.ts
npx vitest --run tests/semantic-unknown-classifier.test.ts
npx vitest --run tests/golden-plan-fixtures.test.ts
npx vitest --run tests/resource-coverage-doc.test.ts
npx vitest --run tests/doc-pages.test.ts
```

`npm run test:docs:visual` runs Playwright against the generated docs site in desktop and mobile Chromium viewports and writes ignored screenshots to `docs-visual-screenshots/`. If Chromium is not installed yet, run `npx playwright install chromium` once.

Regenerate public documentation after changing resource handlers or Markdown-backed docs:

```bash
npm run docs:all
```

## Limitations

Recourse analyzes the plan, state, command, and evidence you provide. It cannot:

- Prove that out-of-band backups exist unless evidence is supplied.
- Inspect every object, row, secret, or dependency behind a resource.
- Guarantee cross-account or cross-region recovery.
- Predict races between planning and applying.
- Replace human review for opaque destructive resources.

The safety posture is conservative: when evidence is incomplete, Recourse should warn, block, or require review rather than understate risk.

## License

MIT
