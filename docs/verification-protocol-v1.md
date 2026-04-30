# Verification Protocol v1

RecourseOS can return verification suggestions when evidence is incomplete. This document defines the protocol for agents to gather missing evidence and submit it for re-evaluation.

## Design Principles

1. **Recourse evaluates, agents gather.** The engine knows what evidence matters; the agent has the credentials and API access to fetch it. Neither holds the other's responsibilities.

2. **Read-only by construction.** Every verification command is a read operation. The catalog is enumerated and audited. Mutations are never suggested.

3. **Structured arguments, not strings.** Commands use `argv` arrays or typed API calls. No string interpolation. No injection vectors.

4. **Partial verification is valid.** Agents can submit some evidence without completing all suggestions. The engine incorporates what it receives.

5. **Advisory, not blocking.** Verification is recommended but not required. Agents can escalate without verifying if they lack credentials or capacity.

## Scope

This specification covers:

- **Verification suggestions for read-only evidence gathering.** Mutation operations are out of scope and will never be suggested.
- **The data shape of suggestions and evidence submissions.** The transport layer (MCP tools, REST API, future protocols) is specified separately.
- **Multi-cloud verification.** Suggestions may span AWS, GCP, and Azure in a single report.

This specification does not cover:

- **Credential management.** The agent has its own credentials. Recourse does not provide, manage, or proxy credentials.
- **Cross-account orchestration.** If verification requires assuming a role in another AWS account, the agent handles that context. Recourse suggests the command; the agent decides how to authenticate.
- **Output parsing.** The `expected_signal` and `failure_signal` fields are human-readable hints. Structured parsing (regex, JMESPath) may be added in a future version.
- **Verification execution.** Recourse suggests; agents execute. The engine never runs commands itself.

## Schema

### VerificationSuggestion

Returned in the consequence report when evidence is incomplete.

```typescript
export type VerificationType =
  | 'aws_cli'
  | 'gcloud_cli'
  | 'az_cli'
  | 'kubectl'
  | 'terraform_state'
  | 'aws_api'
  | 'gcp_api'
  | 'azure_api';

export interface VerificationCommand {
  type: VerificationType;

  // For CLI-based verification (aws_cli, gcloud_cli, az_cli, kubectl)
  argv?: string[];

  // For API-based verification (aws_api, gcp_api, azure_api)
  api_call?: {
    service: string;
    operation: string;
    parameters: Record<string, unknown>;
  };

  // Execution hints
  timeout_seconds?: number;           // Default: 30

  // Required permissions (IAM-style notation)
  // AWS: 'ec2:DescribeSnapshots'
  // GCP: 'compute.snapshots.list'
  // Azure: 'Microsoft.Compute/snapshots/read'
  requires_permissions?: string[];
}

export interface VerificationSuggestion {
  // What evidence is missing
  evidence_key: string;
  description: string;                // For agents: what we're looking for

  // Current knowledge state
  // - 'low': Evidence already present, no verification needed
  // - 'medium': Some indirect evidence, verification would increase confidence
  // - 'high': No evidence, verification required for confident verdict
  uncertainty: 'high' | 'medium' | 'low';

  // How to resolve it
  verification: VerificationCommand;

  // How to interpret results
  expected_signal: string;            // What indicates evidence is present
  failure_signal: string;             // What indicates evidence is absent

  // What changes if verified
  verdict_impact: {
    current_tier: string;
    potential_tier: string;
    decision_change?: {
      from: ConsequenceDecision;
      to: ConsequenceDecision;
    };
  };

  // Derived from verdict_impact for agent convenience:
  // - 'critical': Would change decision (e.g., block -> allow)
  // - 'recommended': Would change tier (e.g., unrecoverable -> recoverable)
  // - 'informational': Would only improve confidence
  priority: 'critical' | 'recommended' | 'informational';
}
```

### EvidenceSubmission

Submitted by the agent after running verification commands.

```typescript
export interface EvidenceSubmission {
  // Reference to the suggestion this responds to
  evidence_key: string;

  // What was executed
  command_executed: VerificationCommand;

  // Raw results
  exit_code?: number;
  raw_output?: string;

  // Structured results (if parseable)
  parsed_evidence?: Record<string, unknown>;

  // Agent's interpretation
  agent_interpretation:
    | 'matches_expected'    // Output matches expected_signal
    | 'matches_failure'     // Output matches failure_signal
    | 'ambiguous'           // Output doesn't clearly match either
    | 'error';              // Command failed to execute

  // Free text for context
  agent_notes?: string;
}
```

### ConsequenceReport additions

```typescript
export interface ConsequenceReport {
  // ... existing fields ...

  // Protocol version for verification suggestions
  verification_protocol_version?: 'v1';

  // Suggestions for gathering missing evidence
  verification_suggestions?: VerificationSuggestion[];
}
```

## MCP Tool Surface

### Initial evaluation (existing tools)

`recourse_evaluate_terraform`, `recourse_evaluate_shell`, `recourse_evaluate_mcp_call`

Returns consequence report with optional `verification_suggestions` array.

### Re-evaluation with evidence (new tool)

`recourse_evaluate_with_evidence`

```typescript
{
  name: 'recourse_evaluate_with_evidence',
  description:
    'Re-evaluates a previous consequence report with additional evidence gathered by the agent. ' +
    'Use this after running verification commands suggested by a prior evaluation. ' +
    'Returns an updated verdict incorporating the new evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      original_report_id: {
        type: 'string',
        description: 'ID from the original evaluation to refine'
      },
      original_input: {
        type: 'object',
        description: 'The original evaluation input (plan, command, or tool call)'
      },
      evidence: {
        type: 'array',
        items: { /* EvidenceSubmission schema */ },
        description: 'Evidence gathered from verification commands'
      }
    },
    required: ['original_input', 'evidence']
  }
}
```

## Verification Catalog

### EBS Volume Delete

When deleting an `aws_ebs_volume` without snapshots in Terraform state:

```typescript
{
  evidence_key: 'external_snapshots_exist',
  description: 'Check for EBS snapshots outside Terraform state',
  uncertainty: 'high',
  verification: {
    type: 'aws_cli',
    argv: ['aws', 'ec2', 'describe-snapshots',
           '--filters', 'Name=volume-id,Values=${volume_id}',
           '--query', 'Snapshots[*].{Id:SnapshotId,State:State}',
           '--output', 'json'],
    timeout_seconds: 30,
    requires_permissions: ['ec2:DescribeSnapshots']
  },
  expected_signal: 'Non-empty array indicates snapshots exist',
  failure_signal: 'Empty array indicates no snapshots',
  verdict_impact: {
    current_tier: 'unrecoverable',
    potential_tier: 'recoverable-from-backup',
    decision_change: { from: 'block', to: 'warn' }
  },
  priority: 'critical'
}
```

When snapshots exist but topology is unknown:

```typescript
{
  evidence_key: 'cross_region_snapshot_copies',
  description: 'Check for cross-region snapshot copies',
  uncertainty: 'medium',
  verification: {
    type: 'aws_api',
    api_call: {
      service: 'ec2',
      operation: 'describe-snapshots',
      parameters: {
        Filters: [{ Name: 'volume-id', Values: ['${volume_id}'] }]
      }
    },
    requires_permissions: ['ec2:DescribeSnapshots']
  },
  expected_signal: 'Snapshots in multiple regions indicate cross-region replication',
  failure_signal: 'All snapshots in same region as volume',
  verdict_impact: {
    current_tier: 'recoverable-from-backup',
    potential_tier: 'recoverable-from-backup'
    // No decision change, just confidence upgrade
  },
  priority: 'informational'
}
```

### RDS Instance Delete

When deleting `aws_db_instance` with skip_final_snapshot=true:

```typescript
{
  evidence_key: 'aws_backup_recovery_points',
  description: 'Check for recovery points in AWS Backup',
  uncertainty: 'high',
  verification: {
    type: 'aws_cli',
    argv: ['aws', 'backup', 'list-recovery-points-by-resource',
           '--resource-arn', '${db_instance_arn}',
           '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status}',
           '--output', 'json'],
    timeout_seconds: 30,
    requires_permissions: ['backup:ListRecoveryPointsByResource']
  },
  expected_signal: 'Non-empty array with Status=COMPLETED indicates backup exists',
  failure_signal: 'Empty array or no COMPLETED recovery points',
  verdict_impact: {
    current_tier: 'unrecoverable',
    potential_tier: 'recoverable-from-backup',
    decision_change: { from: 'block', to: 'warn' }
  },
  priority: 'critical'
}
```

```typescript
{
  evidence_key: 'manual_snapshots_exist',
  description: 'Check for manual RDS snapshots',
  uncertainty: 'high',
  verification: {
    type: 'aws_cli',
    argv: ['aws', 'rds', 'describe-db-snapshots',
           '--db-instance-identifier', '${db_instance_identifier}',
           '--snapshot-type', 'manual',
           '--query', 'DBSnapshots[*].{Id:DBSnapshotIdentifier,Status:Status}',
           '--output', 'json'],
    timeout_seconds: 30,
    requires_permissions: ['rds:DescribeDBSnapshots']
  },
  expected_signal: 'Non-empty array with Status=available indicates manual snapshot exists',
  failure_signal: 'Empty array indicates no manual snapshots',
  verdict_impact: {
    current_tier: 'unrecoverable',
    potential_tier: 'recoverable-from-backup',
    decision_change: { from: 'block', to: 'warn' }
  },
  priority: 'critical'
}
```

### S3 Bucket Delete

When deleting `aws_s3_bucket` without versioning:

```typescript
{
  evidence_key: 'cross_region_replication',
  description: 'Check for cross-region replication configuration',
  uncertainty: 'high',
  verification: {
    type: 'aws_cli',
    argv: ['aws', 's3api', 'get-bucket-replication',
           '--bucket', '${bucket_name}',
           '--output', 'json'],
    timeout_seconds: 30,
    requires_permissions: ['s3:GetReplicationConfiguration']
  },
  expected_signal: 'ReplicationConfiguration with rules indicates data is replicated elsewhere',
  failure_signal: 'ReplicationConfigurationNotFoundError indicates no replication',
  verdict_impact: {
    current_tier: 'unrecoverable',
    potential_tier: 'recoverable-from-backup',
    decision_change: { from: 'block', to: 'warn' }
  },
  priority: 'critical'
}
```

## Worked Example: The PocketOS Case

This example demonstrates the backup topology problem: a volume has snapshots, but are they co-located (same region, deleted with the volume) or external (different region, survive the deletion)?

### Context

An agent is about to run `terraform apply` on a plan that deletes an EBS volume. The Terraform state shows a snapshot exists, but Recourse cannot determine from the plan alone whether the snapshot is:
- In the same region as the volume (co-located, may not survive)
- In a different region (external, will survive)
- Managed by AWS Backup (external, will survive)

This is the backup topology vs. backup existence distinction. The verification protocol resolves it.

### 1. Initial Evaluation

Agent calls `recourse_evaluate_terraform`:

```json
{
  "tool": "recourse_evaluate_terraform",
  "arguments": {
    "plan": {
      "resource_changes": [{
        "address": "aws_ebs_volume.user_data",
        "type": "aws_ebs_volume",
        "change": {
          "actions": ["delete"],
          "before": {
            "id": "vol-0abc123def456",
            "availability_zone": "us-east-1a",
            "size": 100,
            "tags": { "Name": "user-data-prod" }
          }
        }
      }]
    },
    "actor": "claude-code-agent"
  }
}
```

### 2. Initial Response (Escalate with Verification Suggestion)

Recourse sees a snapshot in Terraform state but cannot verify its topology:

```json
{
  "schemaVersion": "recourse.consequence.v1",
  "verification_protocol_version": "v1",
  "decision": "escalate",
  "decisionReason": "Backup exists but topology unknown - cannot confirm recoverability",
  "mutations": [{
    "intent": {
      "source": "terraform",
      "action": "delete",
      "target": {
        "provider": "aws",
        "service": "ec2",
        "type": "aws_ebs_volume",
        "id": "aws_ebs_volume.user_data",
        "region": "us-east-1"
      }
    },
    "recoverability": {
      "tier": 3,
      "label": "recoverable-from-backup",
      "reasoning": "Snapshot exists in Terraform state, but co-location unknown"
    },
    "missingEvidence": [{
      "key": "snapshot_topology",
      "description": "Cannot determine if snapshot is co-located with volume or in external region/account",
      "effect": "lowers-confidence"
    }]
  }],
  "verification_suggestions": [{
    "evidence_key": "snapshot_regions",
    "description": "Check snapshot locations to determine if backups survive volume deletion",
    "uncertainty": "high",
    "verification": {
      "type": "aws_cli",
      "argv": [
        "aws", "ec2", "describe-snapshots",
        "--filters", "Name=volume-id,Values=vol-0abc123def456",
        "--query", "Snapshots[*].{SnapshotId:SnapshotId,VolumeId:VolumeId,State:State,Region:OwnerId}",
        "--output", "json"
      ],
      "timeout_seconds": 30,
      "requires_permissions": ["ec2:DescribeSnapshots"]
    },
    "expected_signal": "Snapshots in regions other than us-east-1 indicate external backups that survive",
    "failure_signal": "All snapshots in us-east-1 only - backups may be co-located",
    "verdict_impact": {
      "current_tier": "recoverable-from-backup",
      "potential_tier": "recoverable-from-backup",
      "decision_change": { "from": "escalate", "to": "warn" }
    },
    "priority": "critical"
  }, {
    "evidence_key": "aws_backup_recovery_points",
    "description": "Check for recovery points in AWS Backup vault",
    "uncertainty": "high",
    "verification": {
      "type": "aws_cli",
      "argv": [
        "aws", "backup", "list-recovery-points-by-resource",
        "--resource-arn", "arn:aws:ec2:us-east-1:123456789012:volume/vol-0abc123def456",
        "--query", "RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}",
        "--output", "json"
      ],
      "timeout_seconds": 30,
      "requires_permissions": ["backup:ListRecoveryPointsByResource"]
    },
    "expected_signal": "Recovery points in AWS Backup vault indicate external backup that survives",
    "failure_signal": "Empty array indicates no AWS Backup protection",
    "verdict_impact": {
      "current_tier": "recoverable-from-backup",
      "potential_tier": "recoverable-from-backup",
      "decision_change": { "from": "escalate", "to": "warn" }
    },
    "priority": "critical"
  }]
}
```

### 3. Agent Runs Verification

The agent runs both suggested commands. First, check snapshot regions:

```bash
aws ec2 describe-snapshots \
  --filters "Name=volume-id,Values=vol-0abc123def456" \
  --query "Snapshots[*].{SnapshotId:SnapshotId,VolumeId:VolumeId,State:State}" \
  --output json
```

Output:
```json
[
  {"SnapshotId": "snap-0111222333", "VolumeId": "vol-0abc123def456", "State": "completed"}
]
```

Then check AWS Backup:

```bash
aws backup list-recovery-points-by-resource \
  --resource-arn "arn:aws:ec2:us-east-1:123456789012:volume/vol-0abc123def456" \
  --query "RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}" \
  --output json
```

Output:
```json
[
  {
    "Arn": "arn:aws:backup:us-west-2:123456789012:recovery-point:abc-123",
    "Status": "COMPLETED",
    "Vault": "prod-cross-region-vault"
  }
]
```

### 4. Agent Submits Evidence

Agent calls `recourse_evaluate_with_evidence` with both results:

```json
{
  "tool": "recourse_evaluate_with_evidence",
  "arguments": {
    "original_input": { "plan": "..." },
    "evidence": [
      {
        "evidence_key": "snapshot_regions",
        "command_executed": {
          "type": "aws_cli",
          "argv": ["aws", "ec2", "describe-snapshots", "..."]
        },
        "exit_code": 0,
        "raw_output": "[{\"SnapshotId\": \"snap-0111222333\", ...}]",
        "parsed_evidence": {
          "snapshots": [{ "id": "snap-0111222333", "region": "us-east-1" }]
        },
        "agent_interpretation": "matches_failure",
        "agent_notes": "Snapshot exists but only in same region as volume (us-east-1)"
      },
      {
        "evidence_key": "aws_backup_recovery_points",
        "command_executed": {
          "type": "aws_cli",
          "argv": ["aws", "backup", "list-recovery-points-by-resource", "..."]
        },
        "exit_code": 0,
        "raw_output": "[{\"Arn\": \"...us-west-2...\", \"Status\": \"COMPLETED\", \"Vault\": \"prod-cross-region-vault\"}]",
        "parsed_evidence": {
          "recovery_points": [{
            "arn": "arn:aws:backup:us-west-2:123456789012:recovery-point:abc-123",
            "region": "us-west-2",
            "vault": "prod-cross-region-vault",
            "status": "COMPLETED"
          }]
        },
        "agent_interpretation": "matches_expected",
        "agent_notes": "Found AWS Backup recovery point in us-west-2 (different region from volume)"
      }
    ]
  }
}
```

### 5. Re-evaluation Response

Recourse incorporates the evidence and returns a confident verdict:

```json
{
  "schemaVersion": "recourse.consequence.v1",
  "verification_protocol_version": "v1",
  "decision": "warn",
  "decisionReason": "Volume deletion is recoverable - cross-region backup verified in AWS Backup",
  "mutations": [{
    "intent": {
      "source": "terraform",
      "action": "delete",
      "target": {
        "provider": "aws",
        "service": "ec2",
        "type": "aws_ebs_volume",
        "id": "aws_ebs_volume.user_data",
        "region": "us-east-1"
      }
    },
    "recoverability": {
      "tier": 3,
      "label": "recoverable-from-backup",
      "reasoning": "AWS Backup recovery point verified in us-west-2 (prod-cross-region-vault); data survives volume deletion"
    },
    "evidence": [
      {
        "key": "snapshot_regions",
        "value": { "snapshots": [{ "id": "snap-0111222333", "region": "us-east-1" }] },
        "present": true,
        "description": "EBS snapshot exists but co-located in us-east-1"
      },
      {
        "key": "aws_backup_recovery_points",
        "value": {
          "recovery_points": [{
            "arn": "arn:aws:backup:us-west-2:123456789012:recovery-point:abc-123",
            "region": "us-west-2",
            "vault": "prod-cross-region-vault"
          }]
        },
        "present": true,
        "description": "AWS Backup recovery point in different region - survives deletion"
      }
    ]
  }],
  "verification_suggestions": [],
  "summary": {
    "totalMutations": 1,
    "hasUnrecoverable": false,
    "needsReview": false,
    "dependencyImpactCount": 0
  }
}
```

### What This Demonstrates

1. **Initial verdict was uncertain.** Recourse saw a backup but couldn't verify topology.
2. **Verification resolved the ambiguity.** The agent gathered evidence Recourse couldn't access.
3. **Re-evaluation produced confident verdict.** With topology confirmed, Recourse returned `warn` instead of `escalate`.
4. **The co-located snapshot wasn't enough.** The EBS snapshot in us-east-1 wouldn't survive if the region had an outage. The AWS Backup recovery point in us-west-2 is the real safety net.
5. **Partial verification works.** If only one command had succeeded, Recourse would incorporate that evidence and note the other as still missing.

## Agent Guidelines

1. **Attempt verification before escalating.** If you receive verification suggestions with `priority: critical`, run them before escalating to humans. This produces better verdicts with less human involvement.

2. **Skip verification gracefully.** If you lack credentials or the command fails, submit evidence with `agent_interpretation: error`. The engine will use your escalation with the original verdict.

3. **Trust the engine's interpretation.** Submit `raw_output` and let the engine validate. Your `agent_interpretation` is a hint, not authoritative.

4. **Respect timeouts.** Use `timeout_seconds` from the suggestion. Don't hang indefinitely on slow API calls.

5. **Check permissions first.** If `requires_permissions` lists permissions you don't have, skip that verification and note it in `agent_notes`.

## Changelog

- **v1** (2024-XX-XX): Initial protocol
