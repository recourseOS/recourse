<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://recourseos.com/brand/logo-mark-light-512.png">
    <source media="(prefers-color-scheme: light)" srcset="https://recourseos.com/brand/logo-mark-512.png">
    <img src="https://recourseos.com/brand/logo-mark-512.png" alt="RecourseOS" width="120" />
  </picture>
</p>

<h1 align="center">RecourseOS</h1>

<p align="center">
  <strong>Consequence layer for AI agents</strong><br>
  Check recoverability before destructive actions
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/recourse-cli"><img src="https://img.shields.io/npm/v/recourse-cli.svg" alt="npm version"></a>
  <a href="https://github.com/recourseOS/recourse/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-Registry-10b981.svg" alt="MCP Registry"></a>
</p>

<p align="center">
  <a href="https://recourseos.com">Website</a> ·
  <a href="https://recourseos.com/mcp-setup.html">MCP Setup</a> ·
  <a href="https://recourseos.com/console.html">Console</a> ·
  <a href="https://recourseos.com/resource-coverage.html">Coverage</a>
</p>

---

Recourse is an MCP server that evaluates Terraform plans, shell commands, and tool calls before execution. It returns structured facts — recoverability tier, evidence assessment, and risk level — so callers can make context-aware decisions. Agents call Recourse before they act; humans see what the agent checked.

## Add to Your Agent

One config block. Works with Claude Desktop, Claude Code, Cursor, and any MCP-compatible client.

```json
{
  "mcpServers": {
    "recourseos": {
      "command": "npx",
      "args": ["-y", "recourse-cli@latest", "mcp", "serve"]
    }
  }
}
```

The server exposes five tools:

| Tool | Purpose |
|------|---------|
| `recourse_evaluate_terraform` | Check Terraform plans before `terraform apply` |
| `recourse_evaluate_shell` | Check shell commands before execution |
| `recourse_evaluate_mcp_call` | Check other MCP tool calls before invocation |
| `recourse_evaluate_with_evidence` | Re-evaluate with verification evidence |
| `recourse_supported_resources` | List resources with deterministic rules |

Plus a resource agents can read:

| Resource | Purpose |
|----------|---------|
| `recourse://instructions` | Safety protocol — when to call, how to interpret results |

Each tool returns:
- **riskAssessment**: engine's summary read — `allow`, `warn`, `escalate`, or `block`
- **recoverability**: tier and reasoning for each mutation
- **evidence**: what was found, what's missing, what's needed for confident classification

The engine emits facts. Callers interpret them in context — a `block` assessment in staging might be acceptable; in production it might require approval.

## What Agents Get

Terraform plan says:

```text
- aws_db_instance.main will be destroyed
```

Recourse tells the agent what that means:

```text
aws_db_instance.main
recoverability: unrecoverable
reason: skip_final_snapshot=true, backup_retention_period=0, deletion_protection=false
riskAssessment: block
```

The agent can interpret these facts: *"Recourse assessed this as block-level risk — deletes the database with no backup. Should I proceed?"*

That's different from *"I deleted your production database."*

## Agent Instructions

Agents can read the built-in safety protocol from `recourse://instructions`. Or use this prompt:

```
Before executing destructive operations, call RecourseOS:
- Shell commands → recourse_evaluate_shell
- Terraform plans → recourse_evaluate_terraform
- Other MCP tools → recourse_evaluate_mcp_call

Interpret the riskAssessment:
- allow: proceed
- warn: proceed with caution, inform user
- escalate: stop and ask user for approval
- block: do not proceed without human review

If escalate/block includes verificationSuggestions, run those commands
and call recourse_evaluate_with_evidence to potentially upgrade the assessment.
```

## CLI Install

For humans running preflight checks directly:

```bash
npm install -g recourse-cli@latest
recourse --version
```

Run a preflight check:

```bash
recourse preflight shell 'aws s3 rm s3://prod-audit-logs --recursive'
```

Or run without installing:

```bash
npx -y recourse-cli@latest preflight shell 'aws s3 rm s3://prod-audit-logs --recursive'
```

## Quick Start

```bash
terraform plan -out=plan.bin
terraform show -json plan.bin > plan.json

recourse plan plan.json
```

Open the interactive terminal UI:

```bash
recourse tui
recourse tui --source shell --input 'aws s3 rm s3://prod-audit-logs --recursive'
```

Fail CI if a plan contains unrecoverable changes:

```bash
recourse plan plan.json --fail-on unrecoverable
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

## Multi-Cloud Coverage

Known resources use hand-written deterministic rules and remain authoritative.

**AWS**: RDS, DynamoDB, S3, EBS, EFS, EC2, Lambda, AMIs, VPCs, security groups, EIPs, load balancers, Route53, IAM, KMS, Secrets Manager, SNS/SQS, CloudWatch logs, ElastiCache, Neptune.

**GCP**: Cloud Storage (versioning), Cloud SQL (protection, backups), BigQuery, Secret Manager, IAM, service accounts, DNS, persistent disks, snapshots, KMS, GKE.

**Azure**: Storage accounts (soft delete), Azure SQL/MSSQL, PostgreSQL/MySQL Flexible Server, MariaDB, Cosmos DB, Key Vault, role assignments, Azure AD, DNS, managed disks, AKS.

For unknown resource types, Recourse uses a three-layer classification system:

1. **Exact mappings**: ~180 manually verified resource → category mappings across AWS, GCP, Azure, and OCI.
2. **BitNet classifier**: A 1-bit quantized neural network trained on 400+ resource types across 10+ cloud providers.
3. **Pattern fallback**: Regex-based classification for the long tail.

Production accuracy is **90.5%** on a held-out test set. Low-confidence classifications return `needs-review` rather than false approval.

## Commands

### Terraform Plan Analysis

```bash
recourse plan plan.json
recourse plan plan.json --state terraform.tfstate
recourse plan plan.json --format json
recourse plan plan.json --classifier
```

### Explain a Verdict

```bash
recourse explain plan.json aws_db_instance.main
recourse explain plan.json aws_db_instance.main --format json
```

### Generic Consequence Reports

```bash
recourse evaluate terraform plan.json --classifier
recourse evaluate shell 'aws s3 rm s3://prod-audit-logs --recursive'
recourse evaluate mcp '{"server":"aws","tool":"s3.delete_bucket","arguments":{"bucket":"prod-audit-logs"}}'
```

### Terminal Preflight

```bash
recourse preflight terraform plan.json --classifier
recourse preflight shell 'kubectl delete namespace payments'
recourse preflight mcp mcp-call.json
```

### Interactive TUI

```bash
recourse tui
recourse tui --source shell --input 'aws s3 rm s3://prod-audit-logs --recursive'
recourse tui --source terraform --input plan.json --classifier
```

### MCP Server

```bash
recourse mcp serve
```

See [docs/mcp-setup.md](docs/mcp-setup.md) for full setup and [docs/agent-interface.md](docs/agent-interface.md) for the schema reference.

### Shell Wrapper

Automatically check RecourseOS before dangerous shell commands execute. Add to your shell profile:

```bash
eval "$(recourse wrap)"
```

Now `rm`, `aws`, `kubectl`, and `terraform` commands check RecourseOS first:

```bash
rm -rf /tmp/important
# recourse: escalate - Recoverability needs human review
# Proceed? [y/N]
```

Or execute with explicit checking:

```bash
recourse exec "rm -rf /tmp/test"
```

### Attestation

Every evaluation response includes a cryptographic attestation (Ed25519 signature). Verify with:

```bash
recourse verify attestation.json
```

Or pipe from stdin:

```bash
cat response.json | jq '.attestation' | recourse verify -
```

### Read-Only AWS Evidence

```bash
recourse evidence aws-s3 prod-audit-logs --region us-east-1 > s3-evidence.json
recourse evidence aws-rds prod-db --region us-east-1 > rds-evidence.json

recourse evaluate shell 'aws s3 rb s3://prod-audit-logs --force' \
  --aws-s3-evidence s3-evidence.json
```

Supported: `aws-s3`, `aws-rds`, `aws-dynamodb`, `aws-iam-role`, `aws-kms-key`.

### Supported Resource List

```bash
recourse resources
```

## Development

```bash
npm install
npm run build
npm test
npm run test:all
```

Regenerate docs after changing resource handlers:

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

The safety posture is conservative: when evidence is incomplete, Recourse returns higher-risk assessments (`escalate` or `block`) rather than understating risk.

## License

MIT
