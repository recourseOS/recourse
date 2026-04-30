/**
 * Verification Templates
 *
 * Templates that generate verification suggestions for each category.
 * BitNet classifies the resource, templates generate the commands.
 */

import type { VerificationSuggestion } from '../core/mutation.js';
import type { VerificationCategory, IdentifierPattern } from './categories.js';
import { IDENTIFIER_PATTERNS } from './categories.js';

/**
 * Resource context extracted from Terraform plan
 */
export interface ResourceContext {
  resourceType: string;
  address: string;
  attributes: Record<string, unknown>;
  region?: string;
  accountId?: string;
}

/**
 * Extract identifier from resource attributes
 */
function extractIdentifier(
  attributes: Record<string, unknown>,
  pattern: IdentifierPattern
): string | undefined {
  for (const attr of pattern.identifierAttributes) {
    const value = attributes[attr];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract ARN from resource attributes or construct it
 */
function extractOrConstructArn(
  attributes: Record<string, unknown>,
  pattern: IdentifierPattern,
  context: ResourceContext
): string | undefined {
  // Try to find existing ARN
  for (const attr of pattern.arnAttributes) {
    const value = attributes[attr];
    if (typeof value === 'string' && value.startsWith('arn:')) {
      return value;
    }
  }

  // Try to construct ARN
  if (pattern.arnPattern) {
    const identifier = extractIdentifier(attributes, pattern);
    if (identifier) {
      const region = context.region || extractRegion(attributes) || '*';
      const account = context.accountId || '*';
      const { service, resourceType } = pattern.arnPattern;

      if (resourceType) {
        return `arn:aws:${service}:${region}:${account}:${resourceType}/${identifier}`;
      } else {
        // For S3-style ARNs without resource type
        return `arn:aws:${service}:::${identifier}`;
      }
    }
  }

  return undefined;
}

/**
 * Extract region from availability zone or other attributes
 */
function extractRegion(attributes: Record<string, unknown>): string | undefined {
  const az = attributes.availability_zone as string;
  if (az && az.length > 0) {
    // us-east-1a -> us-east-1
    return az.slice(0, -1);
  }

  const region = attributes.region as string;
  if (region) return region;

  return undefined;
}

/**
 * Template generators for each category
 */
type TemplateGenerator = (context: ResourceContext) => VerificationSuggestion[];

const TEMPLATES: Record<VerificationCategory, TemplateGenerator> = {
  'database-with-snapshots': (context) => {
    const pattern = IDENTIFIER_PATTERNS['database-with-snapshots'];
    const identifier = extractIdentifier(context.attributes, pattern);
    const arn = extractOrConstructArn(context.attributes, pattern, context);
    const suggestions: VerificationSuggestion[] = [];

    if (identifier) {
      // Check for manual snapshots
      suggestions.push({
        evidence_key: 'manual_snapshots_exist',
        description: 'Check for manual database snapshots',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'rds', 'describe-db-snapshots',
            '--db-instance-identifier', identifier,
            '--snapshot-type', 'manual',
            '--query', 'DBSnapshots[*].{Id:DBSnapshotIdentifier,Status:Status}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['rds:DescribeDBSnapshots'],
        },
        expected_signal: 'Non-empty array with Status=available indicates manual snapshot exists',
        failure_signal: 'Empty array indicates no manual snapshots',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });

      // Check for automated backups
      suggestions.push({
        evidence_key: 'automated_backups_exist',
        description: 'Check for automated database backups',
        uncertainty: 'medium',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'rds', 'describe-db-instance-automated-backups',
            '--db-instance-identifier', identifier,
            '--query', 'DBInstanceAutomatedBackups[*].{Id:DBInstanceIdentifier,Status:Status}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['rds:DescribeDBInstanceAutomatedBackups'],
        },
        expected_signal: 'Non-empty array indicates automated backups exist',
        failure_signal: 'Empty array indicates no automated backups',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    if (arn) {
      // Check AWS Backup
      suggestions.push({
        evidence_key: 'aws_backup_recovery_points',
        description: 'Check for recovery points in AWS Backup',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'backup', 'list-recovery-points-by-resource',
            '--resource-arn', arn,
            '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['backup:ListRecoveryPointsByResource'],
        },
        expected_signal: 'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
        failure_signal: 'Empty array indicates no AWS Backup recovery points',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'nosql-database': (context) => {
    const pattern = IDENTIFIER_PATTERNS['nosql-database'];
    const tableName = extractIdentifier(context.attributes, pattern);
    const arn = extractOrConstructArn(context.attributes, pattern, context);
    const suggestions: VerificationSuggestion[] = [];

    if (tableName) {
      // Check point-in-time recovery
      suggestions.push({
        evidence_key: 'point_in_time_recovery',
        description: 'Check for point-in-time recovery configuration',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'dynamodb', 'describe-continuous-backups',
            '--table-name', tableName,
            '--query', 'ContinuousBackupsDescription.PointInTimeRecoveryDescription',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['dynamodb:DescribeContinuousBackups'],
        },
        expected_signal: 'PointInTimeRecoveryStatus=ENABLED indicates recovery is possible',
        failure_signal: 'PointInTimeRecoveryStatus=DISABLED indicates no point-in-time recovery',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });

      // Check for on-demand backups
      suggestions.push({
        evidence_key: 'on_demand_backups',
        description: 'Check for on-demand backups',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'dynamodb', 'list-backups',
            '--table-name', tableName,
            '--query', 'BackupSummaries[*].{Arn:BackupArn,Status:BackupStatus}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['dynamodb:ListBackups'],
        },
        expected_signal: 'Non-empty array with BackupStatus=AVAILABLE indicates backups exist',
        failure_signal: 'Empty array indicates no on-demand backups',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    if (arn) {
      // Check AWS Backup
      suggestions.push({
        evidence_key: 'aws_backup_recovery_points',
        description: 'Check for recovery points in AWS Backup',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'backup', 'list-recovery-points-by-resource',
            '--resource-arn', arn,
            '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['backup:ListRecoveryPointsByResource'],
        },
        expected_signal: 'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
        failure_signal: 'Empty array indicates no AWS Backup recovery points',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'block-storage': (context) => {
    const pattern = IDENTIFIER_PATTERNS['block-storage'];
    const volumeId = extractIdentifier(context.attributes, pattern);
    const arn = extractOrConstructArn(context.attributes, pattern, context);
    const suggestions: VerificationSuggestion[] = [];

    if (volumeId) {
      // Check for snapshots
      suggestions.push({
        evidence_key: 'external_snapshots_exist',
        description: 'Check for EBS snapshots outside Terraform state',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'ec2', 'describe-snapshots',
            '--filters', `Name=volume-id,Values=${volumeId}`,
            '--query', 'Snapshots[*].{SnapshotId:SnapshotId,State:State,VolumeId:VolumeId}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['ec2:DescribeSnapshots'],
        },
        expected_signal: 'Non-empty array indicates snapshots exist for this volume',
        failure_signal: 'Empty array indicates no snapshots',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    if (arn) {
      // Check AWS Backup
      suggestions.push({
        evidence_key: 'aws_backup_recovery_points',
        description: 'Check for recovery points in AWS Backup vault',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'backup', 'list-recovery-points-by-resource',
            '--resource-arn', arn,
            '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['backup:ListRecoveryPointsByResource'],
        },
        expected_signal: 'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
        failure_signal: 'Empty array indicates no AWS Backup recovery points',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'file-storage': (context) => {
    const pattern = IDENTIFIER_PATTERNS['file-storage'];
    const arn = extractOrConstructArn(context.attributes, pattern, context);
    const suggestions: VerificationSuggestion[] = [];

    if (arn) {
      // Check AWS Backup
      suggestions.push({
        evidence_key: 'aws_backup_recovery_points',
        description: 'Check for recovery points in AWS Backup',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'backup', 'list-recovery-points-by-resource',
            '--resource-arn', arn,
            '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['backup:ListRecoveryPointsByResource'],
        },
        expected_signal: 'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
        failure_signal: 'Empty array indicates no AWS Backup recovery points',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'object-storage': (context) => {
    const pattern = IDENTIFIER_PATTERNS['object-storage'];
    const bucketName = extractIdentifier(context.attributes, pattern);
    const suggestions: VerificationSuggestion[] = [];

    if (bucketName) {
      // Check versioning
      suggestions.push({
        evidence_key: 'versioning_enabled',
        description: 'Check bucket versioning status',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 's3api', 'get-bucket-versioning',
            '--bucket', bucketName,
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['s3:GetBucketVersioning'],
        },
        expected_signal: 'Status=Enabled indicates versioning is active',
        failure_signal: 'Empty response or Status=Suspended indicates no versioning',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });

      // Check cross-region replication
      suggestions.push({
        evidence_key: 'cross_region_replication',
        description: 'Check for cross-region replication configuration',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 's3api', 'get-bucket-replication',
            '--bucket', bucketName,
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['s3:GetReplicationConfiguration'],
        },
        expected_signal: 'ReplicationConfiguration with rules indicates data is replicated',
        failure_signal: 'ReplicationConfigurationNotFoundError indicates no replication',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'cache-cluster': (context) => {
    const pattern = IDENTIFIER_PATTERNS['cache-cluster'];
    const clusterId = extractIdentifier(context.attributes, pattern);
    const suggestions: VerificationSuggestion[] = [];

    if (clusterId) {
      // Check for snapshots
      suggestions.push({
        evidence_key: 'cache_snapshots_exist',
        description: 'Check for ElastiCache snapshots',
        uncertainty: 'high',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'elasticache', 'describe-snapshots',
            '--cache-cluster-id', clusterId,
            '--query', 'Snapshots[*].{Name:SnapshotName,Status:SnapshotStatus}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['elasticache:DescribeSnapshots'],
        },
        expected_signal: 'Non-empty array indicates snapshots exist',
        failure_signal: 'Empty array indicates no snapshots',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
          decision_change: { from: 'block', to: 'warn' },
        },
        priority: 'critical',
      });
    }

    return suggestions;
  },

  'search-cluster': (context) => {
    const pattern = IDENTIFIER_PATTERNS['search-cluster'];
    const domainName = extractIdentifier(context.attributes, pattern);
    const suggestions: VerificationSuggestion[] = [];

    if (domainName) {
      // Check for snapshots
      suggestions.push({
        evidence_key: 'search_snapshots_exist',
        description: 'Check for OpenSearch/Elasticsearch snapshots',
        uncertainty: 'medium',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'opensearch', 'describe-domain',
            '--domain-name', domainName,
            '--query', 'DomainStatus.SnapshotOptions',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['es:DescribeDomain'],
        },
        expected_signal: 'AutomatedSnapshotStartHour present indicates automatic snapshots configured',
        failure_signal: 'No snapshot configuration',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-from-backup',
        },
        priority: 'recommended',
      });
    }

    return suggestions;
  },

  'streaming-data': (context) => {
    const pattern = IDENTIFIER_PATTERNS['streaming-data'];
    const streamName = extractIdentifier(context.attributes, pattern);
    const suggestions: VerificationSuggestion[] = [];

    if (streamName && context.resourceType.includes('kinesis')) {
      // Check retention period
      suggestions.push({
        evidence_key: 'stream_retention',
        description: 'Check Kinesis stream retention period',
        uncertainty: 'medium',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'kinesis', 'describe-stream',
            '--stream-name', streamName,
            '--query', 'StreamDescription.RetentionPeriodHours',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['kinesis:DescribeStream'],
        },
        expected_signal: 'RetentionPeriodHours > 24 indicates extended retention',
        failure_signal: 'Default 24-hour retention',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-with-effort',
        },
        priority: 'informational',
      });
    }

    return suggestions;
  },

  'message-queue': (context) => {
    // Most message queues don't have backup mechanisms
    // Return empty suggestions
    return [];
  },

  'container-registry': (context) => {
    const pattern = IDENTIFIER_PATTERNS['container-registry'];
    const repoName = extractIdentifier(context.attributes, pattern);
    const suggestions: VerificationSuggestion[] = [];

    if (repoName) {
      // Check for images
      suggestions.push({
        evidence_key: 'ecr_images_exist',
        description: 'Check for images in ECR repository',
        uncertainty: 'medium',
        verification: {
          type: 'aws_cli',
          argv: [
            'aws', 'ecr', 'describe-images',
            '--repository-name', repoName,
            '--query', 'imageDetails[*].{Tag:imageTags[0],Digest:imageDigest}',
            '--output', 'json',
          ],
          timeout_seconds: 30,
          requires_permissions: ['ecr:DescribeImages'],
        },
        expected_signal: 'Non-empty array indicates images exist that would be lost',
        failure_signal: 'Empty repository',
        verdict_impact: {
          current_tier: 'unrecoverable',
          potential_tier: 'recoverable-with-effort',
        },
        priority: 'informational',
      });
    }

    return suggestions;
  },

  'secrets-and-keys': (context) => {
    const suggestions: VerificationSuggestion[] = [];

    // Check KMS key deletion window
    if (context.resourceType === 'aws_kms_key') {
      const keyId = context.attributes.key_id as string || context.attributes.id as string;
      if (keyId) {
        suggestions.push({
          evidence_key: 'kms_deletion_window',
          description: 'Check KMS key deletion window',
          uncertainty: 'medium',
          verification: {
            type: 'aws_cli',
            argv: [
              'aws', 'kms', 'describe-key',
              '--key-id', keyId,
              '--query', 'KeyMetadata.{State:KeyState,DeletionDate:DeletionDate}',
              '--output', 'json',
            ],
            timeout_seconds: 30,
            requires_permissions: ['kms:DescribeKey'],
          },
          expected_signal: 'DeletionDate in future indicates key can be recovered',
          failure_signal: 'Key already deleted or no deletion window',
          verdict_impact: {
            current_tier: 'unrecoverable',
            potential_tier: 'recoverable-with-effort',
          },
          priority: 'critical',
        });
      }
    }

    // Check Secrets Manager recovery window
    if (context.resourceType === 'aws_secretsmanager_secret') {
      const secretId = context.attributes.id as string || context.attributes.name as string;
      if (secretId) {
        suggestions.push({
          evidence_key: 'secret_recovery_window',
          description: 'Check Secrets Manager recovery window',
          uncertainty: 'medium',
          verification: {
            type: 'aws_cli',
            argv: [
              'aws', 'secretsmanager', 'describe-secret',
              '--secret-id', secretId,
              '--query', '{DeletedDate:DeletedDate,RecoveryWindowInDays:RecoveryWindowInDays}',
              '--output', 'json',
            ],
            timeout_seconds: 30,
            requires_permissions: ['secretsmanager:DescribeSecret'],
          },
          expected_signal: 'RecoveryWindowInDays > 0 indicates secret can be recovered',
          failure_signal: 'No recovery window configured',
          verdict_impact: {
            current_tier: 'unrecoverable',
            potential_tier: 'recoverable-with-effort',
          },
          priority: 'critical',
        });
      }
    }

    return suggestions;
  },

  'stateful-compute': (context) => {
    const suggestions: VerificationSuggestion[] = [];

    // For EC2 instances, check for AMIs
    if (context.resourceType === 'aws_instance') {
      const instanceId = context.attributes.id as string;
      if (instanceId) {
        suggestions.push({
          evidence_key: 'instance_ami_exists',
          description: 'Check for AMIs created from this instance',
          uncertainty: 'high',
          verification: {
            type: 'aws_cli',
            argv: [
              'aws', 'ec2', 'describe-images',
              '--filters', `Name=block-device-mapping.snapshot-id,Values=*`,
              '--owners', 'self',
              '--query', 'Images[*].{ImageId:ImageId,Name:Name}',
              '--output', 'json',
            ],
            timeout_seconds: 30,
            requires_permissions: ['ec2:DescribeImages'],
          },
          expected_signal: 'AMI exists that could restore this instance',
          failure_signal: 'No AMIs found',
          verdict_impact: {
            current_tier: 'unrecoverable',
            potential_tier: 'recoverable-from-backup',
          },
          priority: 'recommended',
        });
      }
    }

    return suggestions;
  },

  'no-verification-needed': () => {
    // No verification needed for these resources
    return [];
  },
};

/**
 * Generate verification suggestions for a resource
 */
export function generateVerificationSuggestions(
  category: VerificationCategory,
  context: ResourceContext
): VerificationSuggestion[] {
  const template = TEMPLATES[category];
  if (!template) {
    return [];
  }

  return template(context);
}
