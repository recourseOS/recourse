# recourse-go

Independent Go implementation of the RecourseOS consequence evaluator.

This is a second verifier implementation that evaluates Terraform plans for recoverability, producing identical verdicts to the TypeScript reference implementation. The existence of two independent implementations surfaces spec ambiguities and establishes protocol credibility.

## Installation

```bash
go install github.com/recourseOS/recourse-go/cmd/recourse@latest
```

Or build from source:

```bash
go build -o recourse ./cmd/recourse
```

## Usage

### Evaluate a Terraform plan

```bash
# Human-readable output
recourse plan plan.json

# JSON output
recourse plan plan.json --format json

# Production policy (stricter)
recourse plan plan.json --env production
```

### List supported resources

```bash
recourse resources
```

## Exit Codes

| Code | Verdict | Meaning |
|------|---------|---------|
| 0 | allow/warn | Safe to proceed |
| 1 | escalate | Requires human review |
| 2 | block | Contains unrecoverable changes |

## Supported Resources (42)

### S3
- `aws_s3_bucket` - Checks versioning, force_destroy
- `aws_s3_bucket_versioning`
- `aws_s3_bucket_lifecycle_configuration`
- `aws_s3_bucket_replication_configuration`
- `aws_s3_object`

### RDS
- `aws_db_instance` - Checks skip_final_snapshot, deletion_protection, backup_retention
- `aws_rds_cluster` - Checks skip_final_snapshot, deletion_protection
- `aws_db_snapshot`
- `aws_db_cluster_snapshot`
- `aws_db_parameter_group`
- `aws_db_subnet_group`
- `aws_rds_cluster_parameter_group`

### DynamoDB
- `aws_dynamodb_table` - Checks point_in_time_recovery
- `aws_dynamodb_global_table`
- `aws_dynamodb_table_item`

### EC2
- `aws_instance`
- `aws_ebs_volume`
- `aws_ebs_snapshot`
- `aws_ami`
- `aws_launch_template`
- `aws_security_group`
- `aws_security_group_rule`
- `aws_eip`
- `aws_key_pair`

### IAM
- `aws_iam_user`
- `aws_iam_role`
- `aws_iam_policy`
- `aws_iam_role_policy`
- `aws_iam_user_policy`
- `aws_iam_role_policy_attachment`
- `aws_iam_user_policy_attachment`
- `aws_iam_instance_profile`
- `aws_iam_access_key`

### Lambda
- `aws_lambda_function`
- `aws_lambda_layer_version`
- `aws_lambda_permission`
- `aws_lambda_event_source_mapping`

### SQS
- `aws_sqs_queue`
- `aws_sqs_queue_policy`

### SNS
- `aws_sns_topic`
- `aws_sns_topic_subscription`
- `aws_sns_topic_policy`

## Recoverability Tiers

| Tier | Description |
|------|-------------|
| reversible | Can undo with another API call |
| recoverable-with-effort | Can recreate but requires work |
| recoverable-from-backup | Needs snapshot/backup to restore |
| unrecoverable | Data permanently lost |
| needs-review | Evidence insufficient |

## Architecture

```
cmd/recourse/           CLI entry point
pkg/
  types/                Core types (tiers, assessments, plans)
  parser/               Terraform plan JSON parsing
  resources/            Resource-specific handlers
  evaluator/            Plan evaluation orchestration
  policy/               Verdict determination
```

## Protocol Compliance

This implementation follows the RecourseOS evaluation protocol:

1. Parse Terraform plan JSON
2. For each resource change, determine recoverability tier
3. Consider protective mechanisms (versioning, snapshots, deletion protection)
4. Produce risk assessment: allow, warn, escalate, or block
5. Output traced reasoning for each verdict

Both Go and TypeScript implementations should produce identical verdicts for the same input.
