# RecourseOS for VS Code

Inline consequence evaluation for Terraform and Kubernetes files.

## Features

### Inline Diagnostics

Real-time analysis of your infrastructure code with inline warnings:

- **Terraform**: Detects risky configurations like `skip_final_snapshot`, `force_destroy`, disabled deletion protection
- **Kubernetes**: Highlights PVC deletions, StatefulSet changes, risky reclaim policies

### Quick Fixes

One-click fixes for common issues:

- Set `skip_final_snapshot = false`
- Enable `deletion_protection`
- Disable `force_destroy`

### Commands

- **RecourseOS: Analyze Current File** - Run analysis on the active file
- **RecourseOS: Evaluate Terraform Plan** - Generate and evaluate a Terraform plan
- **RecourseOS: Evaluate Kubernetes Manifest** - Check Kubernetes manifest for risks

### Hover Information

Hover over resource types to see recoverability information and best practices.

## Installation

### From Marketplace

Search for "RecourseOS" in the VS Code Extensions marketplace.

### Manual Install

```bash
cd integrations/vscode-recourse
npm install
npm run compile
npm run package
code --install-extension vscode-recourse-0.1.0.vsix
```

## Configuration

```json
{
  "recourse.enableDiagnostics": true,
  "recourse.severity.block": "Error",
  "recourse.severity.escalate": "Warning",
  "recourse.severity.warn": "Information"
}
```

## Detected Patterns

### Terraform

| Pattern | Risk | Message |
|---------|------|---------|
| `skip_final_snapshot = true` | BLOCK | Will cause data loss on deletion |
| `force_destroy = true` | BLOCK | Will delete non-empty bucket |
| `deletion_protection = false` | ESCALATE | Allows accidental deletion |
| `backup_retention_period = 0` | ESCALATE | No backup retention configured |
| `versioning { enabled = false }` | WARN | No object recovery possible |
| `point_in_time_recovery { enabled = false }` | ESCALATE | No point-in-time recovery |

### Kubernetes

| Pattern | Risk | Message |
|---------|------|---------|
| `kind: PersistentVolumeClaim` | INFO | PVC deletion will cause data loss |
| `reclaimPolicy: Delete` | ESCALATE | PV destroyed on PVC deletion |
| `kind: StatefulSet` | INFO | Changes may affect persistent data |

## Screenshots

### Inline Diagnostics

```terraform
resource "aws_db_instance" "prod" {
  # ⚠️ [RecourseOS] skip_final_snapshot=true will cause data loss on deletion
  skip_final_snapshot = true

  # ⚠️ [RecourseOS] deletion_protection=false allows accidental deletion
  deletion_protection = false
}
```

### Evaluation Panel

When you run "Evaluate Terraform Plan", a panel shows:

- Risk assessment (BLOCK/ESCALATE/ALLOW)
- Total changes
- Per-resource recoverability
- Detailed reasoning

## Requirements

- VS Code 1.80.0+
- Node.js 18+ (for CLI evaluation)
- Terraform CLI (for plan evaluation)
- kubectl (for manifest evaluation)

## License

MIT
