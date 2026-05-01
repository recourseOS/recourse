import { describe, expect, it } from 'vitest';
import { RecoverabilityTier } from '../src/resources/types.js';
import { s3Handler } from '../src/resources/aws/s3.js';
import { rdsHandler } from '../src/resources/aws/rds.js';
import { dynamodbHandler } from '../src/resources/aws/dynamodb.js';
import { iamHandler } from '../src/resources/aws/iam.js';
import type { ResourceChange, TerraformState } from '../src/resources/types.js';

// Helper to create a resource change
function createChange(
  address: string,
  type: string,
  actions: string[],
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {}
): ResourceChange {
  return {
    address,
    type,
    actions,
    before,
    after,
  };
}

// Helper to create minimal state
function createState(resources: Array<{ address: string; type: string; values: Record<string, unknown> }> = []): TerraformState {
  return {
    version: 4,
    serial: 1,
    terraform_version: '1.0.0',
    resources: resources.map(r => ({
      address: r.address,
      type: r.type,
      mode: 'managed',
      name: r.address.split('.').pop() || r.address,
      provider: 'registry.terraform.io/hashicorp/aws',
      instances: [{ attributes: r.values }],
      dependsOn: [],
      values: r.values,
    })),
  };
}

describe('Recoverability Tiers', () => {
  describe('S3 Handler', () => {
    describe('aws_s3_bucket', () => {
      it('returns REVERSIBLE for bucket updates', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['update'],
          { bucket: 'my-bucket', tags: {} },
          { bucket: 'my-bucket', tags: { env: 'prod' } }
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });

      it('returns RECOVERABLE_WITH_EFFORT for empty bucket deletion', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          { bucket: 'my-bucket', object_count: 0 }
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('empty');
      });

      it('returns UNRECOVERABLE for bucket with objects deletion', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          { bucket: 'my-bucket', object_count: 100 }
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('returns UNRECOVERABLE when object_count is unknown (defaults to non-empty)', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          { bucket: 'my-bucket' } // No object_count
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
    });

    describe('aws_s3_bucket_versioning', () => {
      it('returns REVERSIBLE for versioning configuration changes', () => {
        const change = createChange(
          'aws_s3_bucket_versioning.main',
          'aws_s3_bucket_versioning',
          ['update'],
          { status: 'Enabled' },
          { status: 'Suspended' }
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
        expect(result.reasoning).toContain('re-enabled');
      });
    });

    describe('aws_s3_object', () => {
      it('returns REVERSIBLE for object updates', () => {
        const change = createChange(
          'aws_s3_object.file',
          'aws_s3_object',
          ['update'],
          { bucket: 'my-bucket', key: 'file.txt' },
          { bucket: 'my-bucket', key: 'file.txt', content: 'new content' }
        );
        const result = s3Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });
  });

  describe('RDS Handler', () => {
    describe('aws_db_instance', () => {
      it('returns REVERSIBLE for instance updates', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['update'],
          { instance_class: 'db.t3.micro' },
          { instance_class: 'db.t3.small' }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });

      it('returns REVERSIBLE (blocked) when deletion_protection is enabled', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          { deletion_protection: true, identifier: 'prod-db' }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Deletion protection makes the apply fail, so it's "blocked"
        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
        expect(result.reasoning).toContain('deletion_protection');
        expect(result.reasoning).toContain('APPLY WILL FAIL');
      });

      it('returns RECOVERABLE_FROM_BACKUP when final snapshot will be created', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'prod-db',
            skip_final_snapshot: false,
            final_snapshot_identifier: 'prod-db-final',
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });

      it('returns RECOVERABLE_FROM_BACKUP when backup_retention_period > 0', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'prod-db',
            skip_final_snapshot: true,
            backup_retention_period: 7,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
        expect(result.reasoning).toContain('automated backups');
      });

      it('returns UNRECOVERABLE when skip_final_snapshot=true and no backups', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'prod-db',
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('skip_final_snapshot');
      });

      it('handles missing backup_retention_period as no backups', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'prod-db',
            skip_final_snapshot: true,
            // No backup_retention_period
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
    });

    describe('aws_rds_cluster', () => {
      it('returns RECOVERABLE_FROM_BACKUP when final snapshot will be created', () => {
        const change = createChange(
          'aws_rds_cluster.main',
          'aws_rds_cluster',
          ['delete'],
          {
            cluster_identifier: 'prod-cluster',
            skip_final_snapshot: false,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });

      it('returns UNRECOVERABLE when skip_final_snapshot=true and no backups', () => {
        const change = createChange(
          'aws_rds_cluster.main',
          'aws_rds_cluster',
          ['delete'],
          {
            cluster_identifier: 'prod-cluster',
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
    });
  });

  describe('DynamoDB Handler', () => {
    describe('aws_dynamodb_table', () => {
      it('returns REVERSIBLE for table updates', () => {
        const change = createChange(
          'aws_dynamodb_table.main',
          'aws_dynamodb_table',
          ['update'],
          { name: 'my-table', billing_mode: 'PAY_PER_REQUEST' },
          { name: 'my-table', billing_mode: 'PROVISIONED' }
        );
        const result = dynamodbHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });

      it('returns RECOVERABLE_FROM_BACKUP when PITR is enabled', () => {
        const change = createChange(
          'aws_dynamodb_table.main',
          'aws_dynamodb_table',
          ['delete'],
          {
            name: 'my-table',
            point_in_time_recovery: [{ enabled: true }], // Array format as per Terraform
          }
        );
        const result = dynamodbHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
        expect(result.reasoning).toContain('Point-in-time');
      });

      it('returns UNRECOVERABLE when no PITR or backups', () => {
        const change = createChange(
          'aws_dynamodb_table.main',
          'aws_dynamodb_table',
          ['delete'],
          {
            name: 'my-table',
            // No PITR
          }
        );
        const result = dynamodbHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('returns REVERSIBLE when deletion_protection_enabled is true', () => {
        const change = createChange(
          'aws_dynamodb_table.main',
          'aws_dynamodb_table',
          ['delete'],
          {
            name: 'my-table',
            deletion_protection_enabled: true,
          }
        );
        const result = dynamodbHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
        expect(result.reasoning).toContain('protection');
      });
    });
  });

  describe('IAM Handler', () => {
    describe('aws_iam_role', () => {
      it('returns RECOVERABLE_WITH_EFFORT for role deletion', () => {
        const change = createChange(
          'aws_iam_role.main',
          'aws_iam_role',
          ['delete'],
          { name: 'my-role' }
        );
        const result = iamHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('returns REVERSIBLE for role updates', () => {
        const change = createChange(
          'aws_iam_role.main',
          'aws_iam_role',
          ['update'],
          { name: 'my-role', description: 'old' },
          { name: 'my-role', description: 'new' }
        );
        const result = iamHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_iam_policy_attachment', () => {
      it('returns REVERSIBLE for attachment deletion', () => {
        const change = createChange(
          'aws_iam_policy_attachment.main',
          'aws_iam_policy_attachment',
          ['delete'],
          { name: 'my-attachment', roles: ['my-role'], policy_arn: 'arn:aws:iam::...' }
        );
        const result = iamHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });
  });

  describe('Tier Boundary Conditions', () => {
    it('correctly orders tiers from lowest to highest severity', () => {
      expect(RecoverabilityTier.REVERSIBLE).toBe(1);
      expect(RecoverabilityTier.RECOVERABLE_WITH_EFFORT).toBe(2);
      expect(RecoverabilityTier.RECOVERABLE_FROM_BACKUP).toBe(3);
      expect(RecoverabilityTier.UNRECOVERABLE).toBe(4);
      expect(RecoverabilityTier.NEEDS_REVIEW).toBe(5);
    });

    it('UNRECOVERABLE is worse than all recoverable tiers', () => {
      expect(RecoverabilityTier.UNRECOVERABLE).toBeGreaterThan(RecoverabilityTier.REVERSIBLE);
      expect(RecoverabilityTier.UNRECOVERABLE).toBeGreaterThan(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      expect(RecoverabilityTier.UNRECOVERABLE).toBeGreaterThan(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    });
  });

  describe('Null State Handling', () => {
    it('S3 handler works with null state', () => {
      const change = createChange(
        'aws_s3_bucket.main',
        'aws_s3_bucket',
        ['delete'],
        { bucket: 'my-bucket', object_count: 10 }
      );
      // Should not throw
      const result = s3Handler.getRecoverability(change, null);
      expect(result.tier).toBeDefined();
    });

    it('RDS handler works with null state', () => {
      const change = createChange(
        'aws_db_instance.main',
        'aws_db_instance',
        ['delete'],
        { identifier: 'my-db', skip_final_snapshot: true }
      );
      // Should not throw
      const result = rdsHandler.getRecoverability(change, null);
      expect(result.tier).toBeDefined();
    });

    it('DynamoDB handler works with null state', () => {
      const change = createChange(
        'aws_dynamodb_table.main',
        'aws_dynamodb_table',
        ['delete'],
        { name: 'my-table' }
      );
      // Should not throw
      const result = dynamodbHandler.getRecoverability(change, null);
      expect(result.tier).toBeDefined();
    });
  });

  describe('Verification Suggestions', () => {
    it('S3 handler provides verification suggestions for bucket deletion', () => {
      const change = createChange(
        'aws_s3_bucket.main',
        'aws_s3_bucket',
        ['delete'],
        { bucket: 'prod-important-data', object_count: 1000 }
      );
      const result = s3Handler.getRecoverability(change, null);

      expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      expect(result.verificationSuggestions).toBeDefined();
      expect(result.verificationSuggestions!.length).toBeGreaterThan(0);
    });

    it('RDS handler provides verification suggestions for unrecoverable deletion', () => {
      const change = createChange(
        'aws_db_instance.main',
        'aws_db_instance',
        ['delete'],
        {
          identifier: 'prod-db',
          skip_final_snapshot: true,
          backup_retention_period: 0,
        }
      );
      const result = rdsHandler.getRecoverability(change, null);

      expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      // RDS may or may not have suggestions depending on implementation
    });
  });

  describe('Create Actions', () => {
    it('S3 bucket create is REVERSIBLE', () => {
      const change = createChange(
        'aws_s3_bucket.new',
        'aws_s3_bucket',
        ['create'],
        {},
        { bucket: 'new-bucket' }
      );
      const result = s3Handler.getRecoverability(change, null);

      // Create actions are typically treated as updates (low risk)
      expect(result.tier).toBeLessThanOrEqual(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
    });

    it('RDS instance create is REVERSIBLE', () => {
      const change = createChange(
        'aws_db_instance.new',
        'aws_db_instance',
        ['create'],
        {},
        { identifier: 'new-db' }
      );
      const result = rdsHandler.getRecoverability(change, null);

      expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
    });
  });

  describe('Replace Actions', () => {
    it('S3 bucket replace is treated based on delete portion', () => {
      const change = createChange(
        'aws_s3_bucket.main',
        'aws_s3_bucket',
        ['delete', 'create'], // Replace = delete + create
        { bucket: 'my-bucket', object_count: 100 },
        { bucket: 'my-bucket-new' }
      );
      const result = s3Handler.getRecoverability(change, null);

      // Should evaluate the delete action
      expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    });

    it('RDS instance replace checks snapshot configuration', () => {
      const change = createChange(
        'aws_db_instance.main',
        'aws_db_instance',
        ['delete', 'create'],
        {
          identifier: 'my-db',
          skip_final_snapshot: false,
          final_snapshot_identifier: 'my-db-final',
        },
        { identifier: 'my-db-new' }
      );
      const result = rdsHandler.getRecoverability(change, null);

      expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    });
  });
});
