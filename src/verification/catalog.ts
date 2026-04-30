/**
 * Verification Catalog
 *
 * Read-only verification commands for resolving evidence gaps.
 * All commands must be safe by construction - no mutations allowed.
 */

import type {
  VerificationSuggestion,
  VerificationCommand,
  VerificationPriority,
  VerificationUncertainty,
  VerificationVerdictImpact,
} from '../core/mutation.js';

// Helper to build verification suggestions with consistent structure
function suggestion(
  evidence_key: string,
  description: string,
  uncertainty: VerificationUncertainty,
  verification: VerificationCommand,
  expected_signal: string,
  failure_signal: string,
  verdict_impact: VerificationVerdictImpact
): VerificationSuggestion {
  // Derive priority from verdict_impact
  let priority: VerificationPriority = 'informational';
  if (verdict_impact.decision_change) {
    priority = 'critical';
  } else if (verdict_impact.current_tier !== verdict_impact.potential_tier) {
    priority = 'recommended';
  }

  return {
    evidence_key,
    description,
    uncertainty,
    verification,
    expected_signal,
    failure_signal,
    verdict_impact,
    priority,
  };
}

// EBS Verification Suggestions

export function ebsExternalSnapshots(volumeId: string): VerificationSuggestion {
  return suggestion(
    'external_snapshots_exist',
    'Check for EBS snapshots outside Terraform state',
    'high',
    {
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
    'Non-empty array indicates snapshots exist for this volume',
    'Empty array indicates no snapshots',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function ebsAwsBackupRecoveryPoints(volumeArn: string): VerificationSuggestion {
  return suggestion(
    'aws_backup_recovery_points',
    'Check for recovery points in AWS Backup vault',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'backup', 'list-recovery-points-by-resource',
        '--resource-arn', volumeArn,
        '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['backup:ListRecoveryPointsByResource'],
    },
    'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
    'Empty array indicates no AWS Backup recovery points',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function ebsCrossRegionSnapshots(volumeId: string, currentRegion: string): VerificationSuggestion {
  return suggestion(
    'cross_region_snapshot_copies',
    'Check for cross-region snapshot copies that survive regional failure',
    'medium',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'ec2', 'describe-snapshots',
        '--filters', `Name=volume-id,Values=${volumeId}`,
        '--query', 'Snapshots[*].{SnapshotId:SnapshotId,State:State}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['ec2:DescribeSnapshots'],
    },
    `Snapshots in regions other than ${currentRegion} indicate cross-region replication`,
    `All snapshots in ${currentRegion} only - no cross-region copies`,
    {
      current_tier: 'recoverable-from-backup',
      potential_tier: 'recoverable-from-backup',
      // No decision change, just confidence upgrade
    }
  );
}

// RDS Verification Suggestions

export function rdsManualSnapshots(dbInstanceIdentifier: string): VerificationSuggestion {
  return suggestion(
    'manual_snapshots_exist',
    'Check for manual RDS snapshots',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'rds', 'describe-db-snapshots',
        '--db-instance-identifier', dbInstanceIdentifier,
        '--snapshot-type', 'manual',
        '--query', 'DBSnapshots[*].{Id:DBSnapshotIdentifier,Status:Status}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['rds:DescribeDBSnapshots'],
    },
    'Non-empty array with Status=available indicates manual snapshot exists',
    'Empty array indicates no manual snapshots',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function rdsAwsBackupRecoveryPoints(dbInstanceArn: string): VerificationSuggestion {
  return suggestion(
    'aws_backup_recovery_points',
    'Check for recovery points in AWS Backup',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'backup', 'list-recovery-points-by-resource',
        '--resource-arn', dbInstanceArn,
        '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['backup:ListRecoveryPointsByResource'],
    },
    'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
    'Empty array or no COMPLETED recovery points',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function rdsAutomatedBackups(dbInstanceIdentifier: string): VerificationSuggestion {
  return suggestion(
    'automated_backups_exist',
    'Check for automated RDS backups',
    'medium',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'rds', 'describe-db-instance-automated-backups',
        '--db-instance-identifier', dbInstanceIdentifier,
        '--query', 'DBInstanceAutomatedBackups[*].{Id:DBInstanceIdentifier,Status:Status,RestoreWindow:RestoreWindow}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['rds:DescribeDBInstanceAutomatedBackups'],
    },
    'Non-empty array with valid RestoreWindow indicates point-in-time recovery available',
    'Empty array indicates no automated backups',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

// S3 Verification Suggestions

export function s3CrossRegionReplication(bucketName: string): VerificationSuggestion {
  return suggestion(
    'cross_region_replication',
    'Check for cross-region replication configuration',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 's3api', 'get-bucket-replication',
        '--bucket', bucketName,
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['s3:GetReplicationConfiguration'],
    },
    'ReplicationConfiguration with rules indicates data is replicated elsewhere',
    'ReplicationConfigurationNotFoundError indicates no replication',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function s3VersioningStatus(bucketName: string): VerificationSuggestion {
  return suggestion(
    'versioning_enabled',
    'Check bucket versioning status',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 's3api', 'get-bucket-versioning',
        '--bucket', bucketName,
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['s3:GetBucketVersioning'],
    },
    'Status=Enabled indicates versioning is active and objects can be recovered',
    'Empty response or Status=Suspended indicates no versioning protection',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

// DynamoDB Verification Suggestions

export function dynamoDbPointInTimeRecovery(tableName: string): VerificationSuggestion {
  return suggestion(
    'point_in_time_recovery',
    'Check for point-in-time recovery configuration',
    'high',
    {
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
    'PointInTimeRecoveryStatus=ENABLED indicates recovery is possible',
    'PointInTimeRecoveryStatus=DISABLED indicates no point-in-time recovery',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}

export function dynamoDbAwsBackupRecoveryPoints(tableArn: string): VerificationSuggestion {
  return suggestion(
    'aws_backup_recovery_points',
    'Check for recovery points in AWS Backup',
    'high',
    {
      type: 'aws_cli',
      argv: [
        'aws', 'backup', 'list-recovery-points-by-resource',
        '--resource-arn', tableArn,
        '--query', 'RecoveryPoints[*].{Arn:RecoveryPointArn,Status:Status,Vault:BackupVaultName}',
        '--output', 'json',
      ],
      timeout_seconds: 30,
      requires_permissions: ['backup:ListRecoveryPointsByResource'],
    },
    'Non-empty array with Status=COMPLETED indicates AWS Backup protection',
    'Empty array indicates no AWS Backup recovery points',
    {
      current_tier: 'unrecoverable',
      potential_tier: 'recoverable-from-backup',
      decision_change: { from: 'block', to: 'warn' },
    }
  );
}
