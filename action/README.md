# RecourseOS GitHub Action

Evaluate Terraform plan consequences before apply. Automatically blocks dangerous changes and surfaces recovery options.

## Usage

```yaml
name: Terraform Plan Check

on:
  pull_request:
    paths:
      - '**.tf'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: terraform init

      - name: Terraform Plan
        run: |
          terraform plan -out=plan.out
          terraform show -json plan.out > plan.json

      - name: RecourseOS Check
        uses: recourseOS/recourse/action@main
        with:
          plan-json: plan.json
          fail-on: block  # block, escalate, warn, or none
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `plan-json` | Yes | - | Path to Terraform plan JSON file |
| `state-json` | No | - | Path to Terraform state JSON (improves accuracy) |
| `fail-on` | No | `block` | Fail on this risk level or higher |
| `format` | No | `human` | Output format (`human` or `json`) |

### `fail-on` Options

| Value | Fails on |
|-------|----------|
| `block` | Only unrecoverable actions |
| `escalate` | Unrecoverable + needs human review |
| `warn` | Anything requiring attention |
| `none` | Never fail (report only) |

## Outputs

| Output | Description |
|--------|-------------|
| `risk-assessment` | Overall risk: `allow`, `warn`, `escalate`, `block` |
| `worst-tier` | Worst recoverability tier found |
| `report` | Full consequence report (JSON) |

## Examples

### Block Only Unrecoverable

```yaml
- uses: recourseOS/recourse/action@main
  with:
    plan-json: plan.json
    fail-on: block
```

### Include State for Better Analysis

```yaml
- name: Export State
  run: terraform show -json > state.json

- uses: recourseOS/recourse/action@main
  with:
    plan-json: plan.json
    state-json: state.json
```

### Use Output in Subsequent Steps

```yaml
- name: RecourseOS Check
  id: recourse
  uses: recourseOS/recourse/action@main
  with:
    plan-json: plan.json
    fail-on: none  # Don't fail, just report

- name: Comment on PR
  if: steps.recourse.outputs.risk-assessment != 'allow'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `## RecourseOS Report\n\nRisk: **${{ steps.recourse.outputs.risk-assessment }}**\nTier: ${{ steps.recourse.outputs.worst-tier }}`
      })
```

### Matrix with Multiple Environments

```yaml
jobs:
  check:
    strategy:
      matrix:
        env: [staging, production]
    steps:
      - uses: recourseOS/recourse/action@main
        with:
          plan-json: ${{ matrix.env }}/plan.json
          fail-on: ${{ matrix.env == 'production' && 'escalate' || 'block' }}
```

## What Gets Checked

RecourseOS evaluates:

- **175+ AWS/GCP/Azure resource types**
- **Deletion protection** status
- **Backup configurations** (snapshots, PITR, versioning)
- **Dependency cascades** (what else breaks?)
- **Recovery paths** (how to undo?)

## License

MIT
