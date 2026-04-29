# Agent Interface

RecourseOS is an AI-ready consequence oracle for agents before they act. Agents submit a proposed mutation and receive a structured `ConsequenceReport` that tells them whether to proceed, warn, block, or ask a human for review.

## Agent Contract

Agents should call Recourse before destructive or privileged actions, especially infrastructure, cloud, shell, MCP, or deployment operations.

Decision meanings:

| Decision | Agent behavior |
| --- | --- |
| `allow` | Continue. The mutation is expected to be reversible. |
| `warn` | Continue only after surfacing recovery requirements to the user. |
| `block` | Do not execute unless the user changes the plan or policy. |
| `escalate` | Ask a human for review; evidence is insufficient for safe automation. |

## Proposed MCP Tools

The MCP server should expose small, explicit tools over the existing evaluator.

### `recourse_evaluate_terraform`

Evaluates Terraform plan JSON.

Input:

```json
{
  "plan": {},
  "state": {},
  "classifier": true,
  "actor": "agent/deploy",
  "environment": "production"
}
```

### `recourse_evaluate_shell`

Evaluates a shell command before execution.

Input:

```json
{
  "command": "aws s3 rb s3://prod-audit-logs --force",
  "actor": "agent/sre",
  "environment": "production",
  "evidence": {}
}
```

### `recourse_evaluate_mcp_call`

Evaluates another MCP tool call before the agent invokes it.

Input:

```json
{
  "server": "aws",
  "tool": "s3.delete_bucket",
  "arguments": {
    "bucket": "prod-audit-logs"
  },
  "actor": "agent/infra"
}
```

### `recourse_explain_verdict`

Returns structured reasoning for one target in a prior report or plan. Agents should use this when explaining a block, warning, or escalation to a user.

### `recourse_supported_resources`

Returns deterministic resource coverage so agents can decide when a verdict came from a known rule versus the unknown-resource classifier.

## Output Schema

All evaluator tools return a `ConsequenceReport`.

```json
{
  "schemaVersion": "recourse.consequence.v1",
  "decision": "block",
  "decisionReason": "Recoverability is unrecoverable",
  "summary": {
    "totalMutations": 1,
    "needsReview": false,
    "hasUnrecoverable": true,
    "dependencyImpactCount": 0,
    "worstRecoverability": {
      "tier": 4,
      "label": "unrecoverable",
      "reasoning": "skip_final_snapshot=true, no backup retention"
    }
  },
  "mutations": []
}
```

The implementation currently returns the report shape without an explicit `schemaVersion`; MCP output should add `schemaVersion: "recourse.consequence.v1"` at the top level and keep backward-compatible field names.

## Agent Instructions

Agents consuming Recourse should follow these rules:

- Never execute a mutation when `decision` is `block`.
- Never silently continue when `decision` is `escalate`.
- For `warn`, include the recovery requirement in the user-facing response.
- Prefer structured fields over parsing `reasoning` strings.
- Treat `recoverability.source: "rules"` as authoritative for known resources.
- Treat classifier verdicts as useful but lower confidence than rules.
- Preserve `missingEvidence` when asking a human for review.

Example response:

```text
I checked this with RecourseOS. It blocks the deletion because the RDS instance has skip_final_snapshot=true and backup_retention_period=0, so the database would be unrecoverable. I will not apply this plan unless you enable a final snapshot, backups, or explicitly override policy.
```

## Error Behavior

MCP tools should fail closed:

- Invalid input: return an MCP error with validation details.
- Unsupported source: return `decision: "escalate"` when the action can be parsed but not classified.
- Internal error: return an MCP error; do not return `allow`.
- Missing evidence: return `needs-review` or `escalate`, not `allow`.

## BitNet Placement

BitNet should replace the unknown-resource semantic scorer, not deterministic handlers. Known rules remain first because they encode provider-specific recovery behavior. BitNet becomes active after the public fixture corpus is broad enough to measure false-safe risk across unknown AWS, GCP, Azure, and long-tail provider resources.
