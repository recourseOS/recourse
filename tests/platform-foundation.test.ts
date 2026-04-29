import { describe, expect, it } from 'vitest';
import { shellCommandToMutation } from '../src/adapters/shell.js';
import { mcpToolCallToMutation } from '../src/adapters/mcp.js';
import { terraformChangeToMutation } from '../src/adapters/terraform.js';
import { conservativeUnknownClassifier } from '../src/classifier/unknown-resource.js';
import { evaluateMcpToolCallConsequences } from '../src/evaluator/mcp.js';
import { evaluateShellCommandConsequences } from '../src/evaluator/shell.js';
import { evaluateTerraformPlanConsequences } from '../src/evaluator/terraform.js';
import { evaluateRecoverability } from '../src/policy/local.js';
import {
  analyzeDynamoDbTableDeletionEvidence,
  analyzeIamRoleDeletionEvidence,
  analyzeKmsKeyDeletionEvidence,
  analyzeRdsInstanceDeletionEvidence,
  analyzeS3BucketDeletionEvidence,
  AwsSignedClient,
  readIamRoleEvidence,
  readKmsKeyEvidence,
  readDynamoDbTableEvidence,
  readRdsInstanceEvidence,
  readS3BucketEvidence,
} from '../src/state/aws/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type ResourceChange,
  type TerraformPlan,
} from '../src/resources/types.js';

describe('platform foundation', () => {
  it('normalizes Terraform resource changes into mutation intents', () => {
    const change: ResourceChange = {
      address: 'aws_db_instance.main',
      type: 'aws_db_instance',
      name: 'main',
      providerName: 'registry.terraform.io/hashicorp/aws',
      actions: ['delete'],
      before: {
        identifier: 'prod-db',
        skip_final_snapshot: true,
      },
      after: null,
      afterUnknown: {},
    };

    const intent = terraformChangeToMutation(change, {
      actorId: 'ci/build-123',
      environment: 'production',
      owner: 'platform',
    });

    expect(intent.source).toBe('terraform');
    expect(intent.action).toBe('delete');
    expect(intent.target.id).toBe('aws_db_instance.main');
    expect(intent.target.provider).toBe('registry.terraform.io/hashicorp/aws');
    expect(intent.target.environment).toBe('production');
    expect(intent.actor?.id).toBe('ci/build-123');
    expect(intent.raw).toBe(change);
  });

  it('normalizes high-risk shell commands into mutation intents', () => {
    const rmIntent = shellCommandToMutation('rm -rf ./data', {
      actorId: 'human/alice',
      environment: 'local',
    });

    expect(rmIntent.source).toBe('shell');
    expect(rmIntent.action).toBe('delete');
    expect(rmIntent.target.type).toBe('filesystem_path');
    expect(rmIntent.target.id).toBe('./data');

    const kubectlIntent = shellCommandToMutation('kubectl delete pvc postgres-data -n production');
    expect(kubectlIntent.action).toBe('delete');
    expect(kubectlIntent.target.service).toBe('kubernetes');
    expect(kubectlIntent.target.id).toBe('pvc/postgres-data');
  });

  it('normalizes MCP tool calls into mutation intents', () => {
    const intent = mcpToolCallToMutation({
      server: 'aws',
      tool: 's3.delete_bucket',
      arguments: {
        bucket: 'prod-audit-logs',
      },
    }, {
      actorId: 'agent/coder',
      environment: 'production',
    });

    expect(intent.source).toBe('mcp');
    expect(intent.action).toBe('delete');
    expect(intent.actor?.kind).toBe('agent');
    expect(intent.target.provider).toBe('aws');
    expect(intent.target.id).toBe('prod-audit-logs');
  });

  it('defaults unknown destructive semantics to needs-review', () => {
    const result = conservativeUnknownClassifier.classify({
      intent: {
        source: 'mcp',
        action: 'delete',
        target: {
          type: 'vendor_unknown_bucket',
          id: 'prod-audit-logs',
        },
      },
    });

    expect(result.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.label).toBe('needs-review');
    expect(result.abstain).toBe(true);
    expect(result.missingEvidence).toContain('resource-semantics');
  });

  it('maps recoverability tiers to local policy decisions', () => {
    expect(evaluateRecoverability({
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Config-only update',
    }).decision).toBe('allow');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'Snapshot required',
    }).decision).toBe('warn');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'Data will be lost',
    }).decision).toBe('block');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.NEEDS_REVIEW,
      label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
      reasoning: 'Unknown semantics',
    }).decision).toBe('escalate');
  });

  it('evaluates a Terraform plan as a generic consequence report', () => {
    const plan: TerraformPlan = {
      formatVersion: '1.2',
      terraformVersion: '1.6.0',
      resourceChanges: [
        {
          address: 'aws_db_instance.main',
          type: 'aws_db_instance',
          name: 'main',
          providerName: 'registry.terraform.io/hashicorp/aws',
          actions: ['delete'],
          before: {
            identifier: 'prod-db',
            deletion_protection: false,
            skip_final_snapshot: true,
            backup_retention_period: 0,
          },
          after: null,
          afterUnknown: {},
        },
      ],
    };

    const report = evaluateTerraformPlanConsequences(plan, null, {
      adapterContext: {
        actorId: 'agent/deploy-bot',
        environment: 'production',
      },
    });

    expect(report.decision).toBe('block');
    expect(report.summary.totalMutations).toBe(1);
    expect(report.summary.hasUnrecoverable).toBe(true);
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(report.mutations[0].intent.source).toBe('terraform');
    expect(report.mutations[0].intent.actor?.id).toBe('agent/deploy-bot');
    expect(report.mutations[0].evidence[0].key).toBe('recoverability.reasoning');
  });

  it('evaluates high-risk shell commands as needs-review', () => {
    const report = evaluateShellCommandConsequences('aws s3 rm s3://prod-audit-logs --recursive', {
      adapterContext: {
        actorId: 'agent/ops-bot',
        environment: 'production',
      },
    });

    expect(report.decision).toBe('escalate');
    expect(report.summary.needsReview).toBe(true);
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(report.mutations[0].intent.target.service).toBe('aws-s3');
    expect(report.mutations[0].missingEvidence[0].key).toBe('live-state');
  });

  it('uses S3 live-state evidence for shell bucket deletions', () => {
    const report = evaluateShellCommandConsequences('aws s3 rm s3://prod-audit-logs --recursive', {
      awsEvidence: {
        s3Buckets: {
          'prod-audit-logs': {
            bucket: 'prod-audit-logs',
            versioning: 'Enabled',
            isEmpty: false,
          },
        },
      },
    });

    expect(report.decision).toBe('warn');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(report.mutations[0].evidence.some(item => item.key === 's3.versioning')).toBe(true);
    expect(report.mutations[0].missingEvidence).toEqual([]);
  });

  it('uses RDS live-state evidence for shell DB instance deletions', () => {
    const report = evaluateShellCommandConsequences(
      'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot',
      {
        awsEvidence: {
          rdsInstances: {
            'prod-db': {
              dbInstanceIdentifier: 'prod-db',
              exists: true,
              deletionProtection: false,
              backupRetentionPeriod: 7,
              latestRestorableTime: '2026-04-29T12:00:00.000Z',
              snapshotCount: 2,
            },
          },
        },
      }
    );

    expect(report.decision).toBe('warn');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(report.mutations[0].intent.target.service).toBe('aws-rds');
    expect(report.mutations[0].evidence.some(item => item.key === 'rds.backup_retention_period')).toBe(true);
  });

  it('uses DynamoDB live-state evidence for shell table deletions', () => {
    const report = evaluateShellCommandConsequences(
      'aws dynamodb delete-table --table-name prod-events',
      {
        awsEvidence: {
          dynamoDbTables: {
            'prod-events': {
              tableName: 'prod-events',
              exists: true,
              deletionProtectionEnabled: false,
              pointInTimeRecoveryStatus: 'ENABLED',
              backupCount: 0,
            },
          },
        },
      }
    );

    expect(report.decision).toBe('warn');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(report.mutations[0].intent.target.service).toBe('aws-dynamodb');
    expect(report.mutations[0].evidence.some(item => item.key === 'dynamodb.pitr')).toBe(true);
  });

  it('uses IAM live-state evidence for shell role deletions', () => {
    const report = evaluateShellCommandConsequences(
      'aws iam delete-role --role-name prod-runner',
      {
        awsEvidence: {
          iamRoles: {
            'prod-runner': {
              roleName: 'prod-runner',
              exists: true,
              attachedPolicyCount: 2,
              inlinePolicyCount: 1,
              instanceProfileCount: 0,
            },
          },
        },
      }
    );

    expect(report.decision).toBe('allow');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
    expect(report.mutations[0].intent.target.service).toBe('aws-iam');
    expect(report.mutations[0].evidence.some(item => item.key === 'iam.attached_policy_count')).toBe(true);
  });

  it('uses KMS live-state evidence for shell key deletion scheduling', () => {
    const report = evaluateShellCommandConsequences(
      'aws kms schedule-key-deletion --key-id 1234abcd --pending-window-in-days 30',
      {
        awsEvidence: {
          kmsKeys: {
            '1234abcd': {
              keyId: '1234abcd',
              exists: true,
              keyState: 'Enabled',
              keyManager: 'CUSTOMER',
              keyUsage: 'ENCRYPT_DECRYPT',
            },
          },
        },
      }
    );

    expect(report.decision).toBe('escalate');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(report.mutations[0].intent.target.service).toBe('aws-kms');
    expect(report.mutations[0].evidence.some(item => item.key === 'kms.key_state')).toBe(true);
  });

  it('allows shell commands with no recognized high-risk mutation pattern', () => {
    const report = evaluateShellCommandConsequences('ls -la');

    expect(report.decision).toBe('allow');
    expect(report.summary.needsReview).toBe(false);
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('evaluates mutating MCP tool calls as needs-review', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 's3.delete_bucket',
      arguments: {
        bucket: 'prod-audit-logs',
      },
    }, {
      adapterContext: {
        actorId: 'agent/coder',
        environment: 'production',
      },
    });

    expect(report.decision).toBe('escalate');
    expect(report.summary.needsReview).toBe(true);
    expect(report.mutations[0].intent.source).toBe('mcp');
    expect(report.mutations[0].intent.target.id).toBe('prod-audit-logs');
    expect(report.mutations[0].missingEvidence[0].key).toBe('tool-semantics');
  });

  it('uses S3 live-state evidence for MCP bucket deletions', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 's3.delete_bucket',
      arguments: {
        bucket: 'prod-audit-logs',
      },
    }, {
      awsEvidence: {
        s3Buckets: {
          'prod-audit-logs': {
            bucket: 'prod-audit-logs',
            objectLockEnabled: true,
            isEmpty: false,
          },
        },
      },
    });

    expect(report.decision).toBe('allow');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(report.mutations[0].intent.target.type).toBe('s3_bucket');
    expect(report.mutations[0].evidence.some(item => item.key === 's3.object_lock')).toBe(true);
  });

  it('uses RDS live-state evidence for MCP DB instance deletions', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 'rds.delete_db_instance',
      arguments: {
        dbInstanceIdentifier: 'prod-db',
      },
    }, {
      awsEvidence: {
        rdsInstances: {
          'prod-db': {
            dbInstanceIdentifier: 'prod-db',
            exists: true,
            deletionProtection: true,
            backupRetentionPeriod: 0,
            snapshotCount: 0,
          },
        },
      },
    });

    expect(report.decision).toBe('allow');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(report.mutations[0].intent.target.type).toBe('rds_db_instance');
    expect(report.mutations[0].evidence.some(item => item.key === 'rds.deletion_protection')).toBe(true);
  });

  it('uses DynamoDB live-state evidence for MCP table deletions', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 'dynamodb.delete_table',
      arguments: {
        tableName: 'prod-events',
      },
    }, {
      awsEvidence: {
        dynamoDbTables: {
          'prod-events': {
            tableName: 'prod-events',
            exists: true,
            deletionProtectionEnabled: true,
            pointInTimeRecoveryStatus: 'DISABLED',
            backupCount: 0,
          },
        },
      },
    });

    expect(report.decision).toBe('allow');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(report.mutations[0].intent.target.type).toBe('dynamodb_table');
    expect(report.mutations[0].evidence.some(item => item.key === 'dynamodb.deletion_protection')).toBe(true);
  });

  it('uses IAM live-state evidence for MCP role deletions', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 'iam.delete_role',
      arguments: {
        roleName: 'prod-runner',
      },
    }, {
      awsEvidence: {
        iamRoles: {
          'prod-runner': {
            roleName: 'prod-runner',
            exists: true,
            attachedPolicyCount: 0,
            inlinePolicyCount: 0,
            instanceProfileCount: 1,
          },
        },
      },
    });

    expect(report.decision).toBe('allow');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
    expect(report.mutations[0].intent.target.type).toBe('iam_role');
    expect(report.mutations[0].evidence.some(item => item.key === 'iam.instance_profile_count')).toBe(true);
  });

  it('uses KMS live-state evidence for MCP key deletion scheduling', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 'kms.schedule_key_deletion',
      arguments: {
        keyId: '1234abcd',
      },
    }, {
      awsEvidence: {
        kmsKeys: {
          '1234abcd': {
            keyId: '1234abcd',
            exists: true,
            keyState: 'PendingDeletion',
            keyManager: 'CUSTOMER',
            deletionDate: '2026-05-29T12:00:00.000Z',
          },
        },
      },
    });

    expect(report.decision).toBe('escalate');
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(report.mutations[0].intent.target.type).toBe('kms_key');
    expect(report.mutations[0].evidence.some(item => item.key === 'kms.deletion_date')).toBe(true);
  });

  it('allows read-like MCP tool calls without a mutating verb', () => {
    const report = evaluateMcpToolCallConsequences({
      server: 'aws',
      tool: 's3.list_buckets',
      arguments: {},
    });

    expect(report.decision).toBe('allow');
    expect(report.summary.needsReview).toBe(false);
    expect(report.summary.worstRecoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies S3 evidence conservatively when objects are unprotected', () => {
    const result = analyzeS3BucketDeletionEvidence({
      bucket: 'prod-audit-logs',
      versioning: 'Off',
      objectLockEnabled: false,
      hasReplication: false,
      isEmpty: false,
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(result.missingEvidence).toEqual([]);
  });

  it('requires review when S3 evidence is incomplete', () => {
    const result = analyzeS3BucketDeletionEvidence({
      bucket: 'prod-audit-logs',
      versioning: 'Unknown',
      missingEvidence: ['s3.versioning', 's3.object_listing'],
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.missingEvidence.map(item => item.key)).toEqual([
      's3.versioning',
      's3.object_listing',
    ]);
  });

  it('classifies RDS evidence as unrecoverable without protection or backups', () => {
    const result = analyzeRdsInstanceDeletionEvidence({
      dbInstanceIdentifier: 'prod-db',
      exists: true,
      deletionProtection: false,
      backupRetentionPeriod: 0,
      snapshotCount: 0,
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(result.missingEvidence).toEqual([]);
  });

  it('requires review when RDS evidence is incomplete', () => {
    const result = analyzeRdsInstanceDeletionEvidence({
      dbInstanceIdentifier: 'prod-db',
      missingEvidence: ['rds.instance', 'rds.snapshots'],
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.missingEvidence.map(item => item.key)).toEqual([
      'rds.instance',
      'rds.snapshots',
    ]);
  });

  it('classifies DynamoDB evidence as unrecoverable without protection, PITR, or backups', () => {
    const result = analyzeDynamoDbTableDeletionEvidence({
      tableName: 'prod-events',
      exists: true,
      deletionProtectionEnabled: false,
      pointInTimeRecoveryStatus: 'DISABLED',
      backupCount: 0,
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(result.missingEvidence).toEqual([]);
  });

  it('requires review when DynamoDB evidence is incomplete', () => {
    const result = analyzeDynamoDbTableDeletionEvidence({
      tableName: 'prod-events',
      missingEvidence: ['dynamodb.table', 'dynamodb.continuous_backups'],
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.missingEvidence.map(item => item.key)).toEqual([
      'dynamodb.table',
      'dynamodb.continuous_backups',
    ]);
  });

  it('requires review when IAM role evidence is incomplete', () => {
    const result = analyzeIamRoleDeletionEvidence({
      roleName: 'prod-runner',
      missingEvidence: ['iam.role', 'iam.attached_policies'],
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.missingEvidence.map(item => item.key)).toEqual([
      'iam.role',
      'iam.attached_policies',
    ]);
  });

  it('keeps KMS customer key deletion in needs-review even with complete metadata', () => {
    const result = analyzeKmsKeyDeletionEvidence({
      keyId: '1234abcd',
      exists: true,
      keyState: 'Enabled',
      keyManager: 'CUSTOMER',
      rotationEnabled: true,
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.missingEvidence).toEqual([]);
  });

  it('classifies AWS-managed KMS keys as reversible for customer deletion requests', () => {
    const result = analyzeKmsKeyDeletionEvidence({
      keyId: 'alias/aws/s3',
      exists: true,
      keyState: 'Enabled',
      keyManager: 'AWS',
    });

    expect(result.recoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('reads S3 bucket evidence with absent optional configs treated as known absence', async () => {
    const client = new AwsSignedClient({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }, async request => {
      if (request.query === 'versioning=') {
        return {
          statusCode: 200,
          body: '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />',
          headers: {},
        };
      }

      if (request.query === 'list-type=2&max-keys=1') {
        return {
          statusCode: 200,
          body: '<ListBucketResult />',
          headers: {},
        };
      }

      return {
        statusCode: 404,
        body: '<Error><Code>NoSuchConfiguration</Code></Error>',
        headers: {},
      };
    });

    const evidence = await readS3BucketEvidence(client, 'prod-audit-logs');

    expect(evidence.versioning).toBe('Off');
    expect(evidence.objectLockEnabled).toBe(false);
    expect(evidence.hasReplication).toBe(false);
    expect(evidence.hasLifecycleRules).toBe(false);
    expect(evidence.isEmpty).toBe(true);
    expect(evidence.missingEvidence).toEqual([]);
  });

  it('reads RDS instance evidence from signed query responses', async () => {
    const client = new AwsSignedClient({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }, async request => {
      if (request.query.includes('Action=DescribeDBInstances')) {
        return {
          statusCode: 200,
          body: [
            '<DescribeDBInstancesResponse><DescribeDBInstancesResult><DBInstances><DBInstance>',
            '<DBInstanceIdentifier>prod-db</DBInstanceIdentifier>',
            '<Engine>postgres</Engine>',
            '<DeletionProtection>false</DeletionProtection>',
            '<BackupRetentionPeriod>7</BackupRetentionPeriod>',
            '<LatestRestorableTime>2026-04-29T12:00:00.000Z</LatestRestorableTime>',
            '<MultiAZ>true</MultiAZ>',
            '<ReadReplicaDBInstanceIdentifiers><ReadReplicaDBInstanceIdentifier>prod-db-ro</ReadReplicaDBInstanceIdentifier></ReadReplicaDBInstanceIdentifiers>',
            '</DBInstance></DBInstances></DescribeDBInstancesResult></DescribeDBInstancesResponse>',
          ].join(''),
          headers: {},
        };
      }

      return {
        statusCode: 200,
        body: [
          '<DescribeDBSnapshotsResponse><DescribeDBSnapshotsResult><DBSnapshots>',
          '<DBSnapshot><DBSnapshotIdentifier>prod-db-snap-1</DBSnapshotIdentifier><SnapshotCreateTime>2026-04-28T12:00:00.000Z</SnapshotCreateTime></DBSnapshot>',
          '</DBSnapshots></DescribeDBSnapshotsResult></DescribeDBSnapshotsResponse>',
        ].join(''),
        headers: {},
      };
    });

    const evidence = await readRdsInstanceEvidence(client, 'prod-db');

    expect(evidence.exists).toBe(true);
    expect(evidence.engine).toBe('postgres');
    expect(evidence.backupRetentionPeriod).toBe(7);
    expect(evidence.snapshotCount).toBe(1);
    expect(evidence.readReplicas).toEqual(['prod-db-ro']);
    expect(evidence.missingEvidence).toEqual([]);
  });

  it('reads DynamoDB table evidence from signed JSON responses', async () => {
    const client = new AwsSignedClient({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }, async request => {
      if (request.headers['x-amz-target'] === 'DynamoDB_20120810.DescribeTable') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            Table: {
              TableName: 'prod-events',
              TableStatus: 'ACTIVE',
              ItemCount: 42,
              DeletionProtectionEnabled: false,
              Replicas: [{ RegionName: 'us-west-2' }],
            },
          }),
          headers: {},
        };
      }

      if (request.headers['x-amz-target'] === 'DynamoDB_20120810.DescribeContinuousBackups') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ContinuousBackupsDescription: {
              PointInTimeRecoveryDescription: {
                PointInTimeRecoveryStatus: 'ENABLED',
              },
            },
          }),
          headers: {},
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          BackupSummaries: [
            {
              BackupName: 'prod-events-backup',
              BackupCreationDateTime: '2026-04-29T12:00:00.000Z',
            },
          ],
        }),
        headers: {},
      };
    });

    const evidence = await readDynamoDbTableEvidence(client, 'prod-events');

    expect(evidence.exists).toBe(true);
    expect(evidence.itemCount).toBe(42);
    expect(evidence.pointInTimeRecoveryStatus).toBe('ENABLED');
    expect(evidence.backupCount).toBe(1);
    expect(evidence.replicaRegions).toEqual(['us-west-2']);
    expect(evidence.missingEvidence).toEqual([]);
  });

  it('reads IAM role evidence from signed query responses', async () => {
    const client = new AwsSignedClient({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }, async request => {
      if (request.query.includes('Action=GetRole')) {
        return {
          statusCode: 200,
          body: '<GetRoleResponse><GetRoleResult><Role><RoleName>prod-runner</RoleName><Arn>arn:aws:iam::123456789012:role/prod-runner</Arn><Path>/</Path></Role></GetRoleResult></GetRoleResponse>',
          headers: {},
        };
      }

      if (request.query.includes('Action=ListAttachedRolePolicies')) {
        return {
          statusCode: 200,
          body: '<ListAttachedRolePoliciesResponse><ListAttachedRolePoliciesResult><AttachedPolicies><member><PolicyArn>arn:aws:iam::aws:policy/ReadOnlyAccess</PolicyArn></member></AttachedPolicies></ListAttachedRolePoliciesResult></ListAttachedRolePoliciesResponse>',
          headers: {},
        };
      }

      if (request.query.includes('Action=ListRolePolicies')) {
        return {
          statusCode: 200,
          body: '<ListRolePoliciesResponse><ListRolePoliciesResult><PolicyNames><member>inline</member></PolicyNames></ListRolePoliciesResult></ListRolePoliciesResponse>',
          headers: {},
        };
      }

      return {
        statusCode: 200,
        body: '<ListInstanceProfilesForRoleResponse><ListInstanceProfilesForRoleResult><InstanceProfiles /></ListInstanceProfilesForRoleResult></ListInstanceProfilesForRoleResponse>',
        headers: {},
      };
    });

    const evidence = await readIamRoleEvidence(client, 'prod-runner');

    expect(evidence.exists).toBe(true);
    expect(evidence.attachedPolicyCount).toBe(1);
    expect(evidence.inlinePolicyCount).toBe(1);
    expect(evidence.instanceProfileCount).toBe(0);
    expect(evidence.missingEvidence).toEqual([]);
  });

  it('reads KMS key evidence from signed JSON responses', async () => {
    const client = new AwsSignedClient({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }, async request => {
      if (request.headers['x-amz-target'] === 'TrentService.DescribeKey') {
        return {
          statusCode: 200,
          body: JSON.stringify({
            KeyMetadata: {
              KeyId: '1234abcd',
              Arn: 'arn:aws:kms:us-east-1:123456789012:key/1234abcd',
              KeyState: 'Enabled',
              KeyManager: 'CUSTOMER',
              KeyUsage: 'ENCRYPT_DECRYPT',
              Origin: 'AWS_KMS',
              MultiRegion: true,
            },
          }),
          headers: {},
        };
      }

      if (request.headers['x-amz-target'] === 'TrentService.GetKeyRotationStatus') {
        return {
          statusCode: 200,
          body: JSON.stringify({ KeyRotationEnabled: true }),
          headers: {},
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ Tags: [{ TagKey: 'env', TagValue: 'prod' }] }),
        headers: {},
      };
    });

    const evidence = await readKmsKeyEvidence(client, '1234abcd');

    expect(evidence.exists).toBe(true);
    expect(evidence.keyState).toBe('Enabled');
    expect(evidence.keyManager).toBe('CUSTOMER');
    expect(evidence.rotationEnabled).toBe(true);
    expect(evidence.tagCount).toBe(1);
    expect(evidence.missingEvidence).toEqual([]);
  });
});
