# Live AWS Tests

The normal test suite is deterministic and does not call AWS. Live AWS checks are opt-in and read-only.

## What They Verify

`tests/aws-live.test.ts` signs a direct STS `GetCallerIdentity` request using the same built-in AWS SigV4 client used by Recourse evidence readers. It verifies that the test environment can authenticate to the configured AWS account without adding the AWS SDK or AWS CLI as a dependency.

No resources are created, updated, or deleted.

When `AWS_LIVE_S3_BUCKET` is set, the live suite also collects read-only S3 evidence for that bucket:

- versioning status
- object lock configuration
- replication configuration
- lifecycle configuration
- empty/non-empty status

When `AWS_LIVE_RDS_INSTANCE` is set, the live suite collects read-only RDS evidence for that DB instance:

- deletion protection
- backup retention
- latest restorable time
- Multi-AZ and replica signals
- snapshot inventory

When `AWS_LIVE_DYNAMODB_TABLE` is set, the live suite collects read-only DynamoDB evidence for that table:

- deletion protection
- point-in-time recovery status
- on-demand backup inventory
- approximate item count
- replica regions

When `AWS_LIVE_IAM_ROLE` is set, the live suite collects read-only IAM role evidence:

- role metadata
- attached managed policy count
- inline policy count
- instance profile count
- permissions boundary

When `AWS_LIVE_KMS_KEY_ID` is set, the live suite collects read-only KMS key evidence:

- key state
- key manager
- deletion date
- rotation status
- multi-region setting
- tag count

Do not paste AWS secrets into issues, PRs, docs, or agent prompts. Keep credentials in environment variables or `~/.aws/credentials`.

## Running

```bash
npm run test:aws-live
```

Set `AWS_PROFILE` to use a non-default shared credentials profile:

```bash
AWS_PROFILE=recourse-dev npm run test:aws-live
```

The test accepts either:

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
- optional `AWS_SESSION_TOKEN`
- static credentials in `~/.aws/credentials`

If `RUN_AWS_LIVE_TESTS=1` is not set, the live test file is skipped by Vitest.

To include the optional S3 evidence check:

```bash
AWS_LIVE_S3_BUCKET=my-readonly-test-bucket npm run test:aws-live
```

To include the optional RDS evidence check:

```bash
AWS_LIVE_RDS_INSTANCE=my-db npm run test:aws-live
```

To include the optional DynamoDB evidence check:

```bash
AWS_LIVE_DYNAMODB_TABLE=my-table npm run test:aws-live
```

To include the optional IAM role evidence check:

```bash
AWS_LIVE_IAM_ROLE=my-role npm run test:aws-live
```

To include the optional KMS key evidence check:

```bash
AWS_LIVE_KMS_KEY_ID=1234abcd-12ab-34cd-56ef-1234567890ab npm run test:aws-live
```

## Collecting S3 Evidence

Use the CLI to collect read-only S3 evidence:

```bash
recourse evidence aws-s3 my-bucket --region us-east-1
```

Use the CLI to collect read-only RDS evidence:

```bash
recourse evidence aws-rds my-db --region us-east-1
```

Use the CLI to collect read-only DynamoDB evidence:

```bash
recourse evidence aws-dynamodb my-table --region us-east-1
```

Use the CLI to collect read-only IAM role evidence:

```bash
recourse evidence aws-iam-role my-role
```

Use the CLI to collect read-only KMS key evidence:

```bash
recourse evidence aws-kms-key 1234abcd-12ab-34cd-56ef-1234567890ab --region us-east-1
```

Feed that evidence into shell or MCP evaluation:

```bash
recourse evaluate shell 'aws s3 rm s3://my-bucket --recursive' \
  --aws-s3-evidence s3-evidence.json \
  --fail-on block
```

```bash
recourse evaluate shell 'aws rds delete-db-instance --db-instance-identifier my-db --skip-final-snapshot' \
  --aws-rds-evidence rds-evidence.json \
  --fail-on block
```

```bash
recourse evaluate shell 'aws dynamodb delete-table --table-name my-table' \
  --aws-dynamodb-evidence dynamodb-evidence.json \
  --fail-on block
```

```bash
recourse evaluate shell 'aws iam delete-role --role-name my-role' \
  --aws-iam-evidence iam-evidence.json \
  --fail-on block
```

```bash
recourse evaluate shell 'aws kms schedule-key-deletion --key-id 1234abcd --pending-window-in-days 30' \
  --aws-kms-evidence kms-evidence.json \
  --fail-on block
```
