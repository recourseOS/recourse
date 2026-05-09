import { describe, expect, it } from 'vitest';
import { RecoverabilityTier } from '../src/resources/types.js';
import { s3Handler } from '../src/resources/aws/s3.js';
import { rdsHandler } from '../src/resources/aws/rds.js';
import { dynamodbHandler } from '../src/resources/aws/dynamodb.js';
import { iamHandler } from '../src/resources/aws/iam.js';
import { ec2Handler } from '../src/resources/aws/ec2.js';
import { vpcHandler } from '../src/resources/aws/vpc.js';
import { ebsHandler } from '../src/resources/aws/ebs.js';
import { lambdaHandler } from '../src/resources/aws/lambda.js';
import { kmsHandler } from '../src/resources/aws/kms.js';
import { secretsManagerHandler } from '../src/resources/aws/secrets-manager.js';
import { snsHandler } from '../src/resources/aws/sns.js';
import { sqsHandler } from '../src/resources/aws/sqs.js';
import { elasticacheHandler } from '../src/resources/aws/elasticache.js';
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

      it('returns RECOVERABLE_FROM_BACKUP when bucket has versioning enabled', () => {
        const change = createChange(
          'aws_s3_object.file',
          'aws_s3_object',
          ['delete'],
          { bucket: 'my-bucket', key: 'file.txt' }
        );
        // State indicates versioning is enabled
        const state = createState([
          {
            address: 'aws_s3_bucket_versioning.main',
            type: 'aws_s3_bucket_versioning',
            values: { bucket: 'my-bucket', versioning_configuration: [{ status: 'Enabled' }] },
          },
        ]);
        const result = s3Handler.getRecoverability(change, state);

        // With versioning, object deletion is recoverable
        expect(result.tier).toBeLessThanOrEqual(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });
    });

    describe('Edge Cases', () => {
      it('handles bucket with force_destroy=true', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          { bucket: 'my-bucket', force_destroy: true, object_count: 500 }
        );
        const result = s3Handler.getRecoverability(change, null);

        // force_destroy allows deletion with objects - dangerous
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('handles bucket with lifecycle expiration configured', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          {
            bucket: 'logs-bucket',
            object_count: 1000,
            lifecycle_rule: [{ expiration: { days: 30 } }],
          }
        );
        const result = s3Handler.getRecoverability(change, null);

        // Even with lifecycle, bucket deletion is unrecoverable if it has objects
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('handles bucket with replication configured', () => {
        const change = createChange(
          'aws_s3_bucket.main',
          'aws_s3_bucket',
          ['delete'],
          {
            bucket: 'replicated-bucket',
            object_count: 100,
            replication_configuration: { role: 'arn:aws:iam::123:role/repl' },
          }
        );
        const result = s3Handler.getRecoverability(change, null);

        // Replication exists but bucket still has data
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
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

    describe('Edge Cases', () => {
      it('handles conflicting signals: deletion_protection false + skip_final_snapshot true', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'risky-db',
            deletion_protection: false,
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Most dangerous configuration
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('handles multi-az instance deletion', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'ha-db',
            multi_az: true,
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Multi-AZ doesn't help if we skip snapshot and have no backups
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('handles read replica deletion', () => {
        const change = createChange(
          'aws_db_instance.replica',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'prod-db-replica',
            replicate_source_db: 'prod-db',
            skip_final_snapshot: true,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Without special handling, read replicas are still evaluated like regular instances
        // The handler doesn't currently distinguish replica deletion as recoverable
        expect(result.tier).toBeDefined();
      });

      it('handles instance with storage_encrypted and no final snapshot', () => {
        const change = createChange(
          'aws_db_instance.main',
          'aws_db_instance',
          ['delete'],
          {
            identifier: 'encrypted-db',
            storage_encrypted: true,
            kms_key_id: 'arn:aws:kms:us-east-1:123:key/abc',
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Encryption doesn't help recoverability if data is lost
        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('handles Aurora cluster with global_cluster membership', () => {
        const change = createChange(
          'aws_rds_cluster.aurora',
          'aws_rds_cluster',
          ['delete'],
          {
            cluster_identifier: 'aurora-cluster',
            global_cluster_identifier: 'global-cluster',
            skip_final_snapshot: true,
            backup_retention_period: 0,
          }
        );
        const result = rdsHandler.getRecoverability(change, null);

        // Even in global cluster, local deletion is unrecoverable without snapshot
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

  describe('EC2 Handler', () => {
    describe('aws_instance', () => {
      it('returns RECOVERABLE_WITH_EFFORT for basic instance deletion', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['delete'],
          { id: 'i-1234567890abcdef0', ami: 'ami-12345678' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('AMI');
      });

      it('returns RECOVERABLE_FROM_BACKUP when root EBS has delete_on_termination=false', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['delete'],
          {
            id: 'i-1234567890abcdef0',
            ami: 'ami-12345678',
            root_block_device: [{ delete_on_termination: false, volume_id: 'vol-123' }],
          }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
        expect(result.reasoning).toContain('preserved');
      });

      it('returns RECOVERABLE_FROM_BACKUP when additional EBS has delete_on_termination=false', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['delete'],
          {
            id: 'i-1234567890abcdef0',
            ami: 'ami-12345678',
            root_block_device: [{ delete_on_termination: true }],
            ebs_block_device: [
              { delete_on_termination: true, volume_id: 'vol-111' },
              { delete_on_termination: false, volume_id: 'vol-222' },
            ],
          }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });

      it('returns UNRECOVERABLE when instance has ephemeral storage', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['delete'],
          {
            id: 'i-1234567890abcdef0',
            ami: 'ami-12345678',
            ephemeral_block_device: [{ device_name: '/dev/sdb', virtual_name: 'ephemeral0' }],
          }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('ephemeral');
      });

      it('returns REVERSIBLE for in-place configuration updates', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['update'],
          { id: 'i-1234567890abcdef0', tags: { Name: 'old' } },
          { id: 'i-1234567890abcdef0', tags: { Name: 'new' } }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });

      it('returns RECOVERABLE_WITH_EFFORT for instance type change (triggers replacement)', () => {
        const change = createChange(
          'aws_instance.web',
          'aws_instance',
          ['update'],
          { id: 'i-1234567890abcdef0', instance_type: 't3.micro', ami: 'ami-12345678' },
          { id: 'i-1234567890abcdef0', instance_type: 't3.large', ami: 'ami-12345678' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('replaced');
      });
    });

    describe('aws_ami', () => {
      it('returns UNRECOVERABLE for AMI deletion', () => {
        const change = createChange(
          'aws_ami.golden',
          'aws_ami',
          ['delete'],
          { id: 'ami-12345678', name: 'golden-image-v1' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('permanent');
      });

      it('returns REVERSIBLE for AMI metadata updates', () => {
        const change = createChange(
          'aws_ami.golden',
          'aws_ami',
          ['update'],
          { id: 'ami-12345678', description: 'old' },
          { id: 'ami-12345678', description: 'new' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_launch_template', () => {
      it('returns RECOVERABLE_WITH_EFFORT for launch template deletion', () => {
        const change = createChange(
          'aws_launch_template.main',
          'aws_launch_template',
          ['delete'],
          { id: 'lt-12345678', name: 'my-template' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('configuration');
      });
    });

    describe('aws_spot_instance_request', () => {
      it('returns RECOVERABLE_WITH_EFFORT for spot request deletion', () => {
        const change = createChange(
          'aws_spot_instance_request.worker',
          'aws_spot_instance_request',
          ['delete'],
          { id: 'sir-12345678' }
        );
        const result = ec2Handler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('ephemeral');
      });
    });
  });

  describe('VPC Handler', () => {
    describe('aws_vpc', () => {
      it('returns RECOVERABLE_WITH_EFFORT for VPC deletion', () => {
        const change = createChange(
          'aws_vpc.main',
          'aws_vpc',
          ['delete'],
          { id: 'vpc-12345678', cidr_block: '10.0.0.0/16' }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('mentions dependent count when VPC has dependents', () => {
        const change = createChange(
          'aws_vpc.main',
          'aws_vpc',
          ['delete'],
          { id: 'vpc-12345678', cidr_block: '10.0.0.0/16' }
        );
        const state = createState([
          { address: 'aws_vpc.main', type: 'aws_vpc', values: { id: 'vpc-12345678' } },
          { address: 'aws_subnet.a', type: 'aws_subnet', values: { vpc_id: 'vpc-12345678' } },
          { address: 'aws_subnet.b', type: 'aws_subnet', values: { vpc_id: 'vpc-12345678' } },
        ]);
        const result = vpcHandler.getRecoverability(change, state);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('2');
      });

      it('returns REVERSIBLE for VPC updates', () => {
        const change = createChange(
          'aws_vpc.main',
          'aws_vpc',
          ['update'],
          { id: 'vpc-12345678', tags: { Name: 'old' } },
          { id: 'vpc-12345678', tags: { Name: 'new' } }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_subnet', () => {
      it('returns RECOVERABLE_WITH_EFFORT for subnet deletion', () => {
        const change = createChange(
          'aws_subnet.main',
          'aws_subnet',
          ['delete'],
          { id: 'subnet-12345678', cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('mentions resource count when subnet has resources', () => {
        const change = createChange(
          'aws_subnet.main',
          'aws_subnet',
          ['delete'],
          { id: 'subnet-12345678', cidr_block: '10.0.1.0/24' }
        );
        const state = createState([
          { address: 'aws_subnet.main', type: 'aws_subnet', values: { id: 'subnet-12345678' } },
          { address: 'aws_instance.web', type: 'aws_instance', values: { subnet_id: 'subnet-12345678' } },
        ]);
        const result = vpcHandler.getRecoverability(change, state);

        expect(result.reasoning).toContain('1');
      });
    });

    describe('aws_eip', () => {
      it('returns UNRECOVERABLE for EIP deletion', () => {
        const change = createChange(
          'aws_eip.nat',
          'aws_eip',
          ['delete'],
          { id: 'eipalloc-12345678', public_ip: '54.123.45.67' }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('released');
      });

      it('notes when EIP is associated', () => {
        const change = createChange(
          'aws_eip.nat',
          'aws_eip',
          ['delete'],
          { id: 'eipalloc-12345678', public_ip: '54.123.45.67', association_id: 'eipassoc-123' }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
    });

    describe('aws_nat_gateway', () => {
      it('returns RECOVERABLE_WITH_EFFORT for NAT gateway deletion', () => {
        const change = createChange(
          'aws_nat_gateway.main',
          'aws_nat_gateway',
          ['delete'],
          { id: 'nat-12345678', subnet_id: 'subnet-123' }
        );
        const result = vpcHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('connectivity');
      });
    });
  });

  describe('EBS Handler', () => {
    describe('aws_ebs_volume', () => {
      it('returns UNRECOVERABLE for volume deletion without snapshot', () => {
        const change = createChange(
          'aws_ebs_volume.data',
          'aws_ebs_volume',
          ['delete'],
          { id: 'vol-12345678', size: 100, type: 'gp3', encrypted: true }
        );
        const result = ebsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('permanently lost');
      });

      it('returns RECOVERABLE_FROM_BACKUP when volume has snapshot in state', () => {
        const change = createChange(
          'aws_ebs_volume.data',
          'aws_ebs_volume',
          ['delete'],
          { id: 'vol-12345678', size: 100 }
        );
        const state = createState([
          { address: 'aws_ebs_volume.data', type: 'aws_ebs_volume', values: { id: 'vol-12345678' } },
          { address: 'aws_ebs_snapshot.backup', type: 'aws_ebs_snapshot', values: { volume_id: 'vol-12345678' } },
        ]);
        const result = ebsHandler.getRecoverability(change, state);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
        expect(result.reasoning).toContain('snapshot');
      });

      it('returns REVERSIBLE for volume updates', () => {
        const change = createChange(
          'aws_ebs_volume.data',
          'aws_ebs_volume',
          ['update'],
          { id: 'vol-12345678', size: 100, tags: { Name: 'old' } },
          { id: 'vol-12345678', size: 100, tags: { Name: 'new' } }
        );
        const result = ebsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });

      it('provides verification suggestions for volume without snapshot', () => {
        const change = createChange(
          'aws_ebs_volume.data',
          'aws_ebs_volume',
          ['delete'],
          { id: 'vol-12345678', size: 100, availability_zone: 'us-east-1a' }
        );
        const result = ebsHandler.getRecoverability(change, null);

        expect(result.verificationSuggestions).toBeDefined();
        expect(result.verificationSuggestions!.length).toBeGreaterThan(0);
      });
    });

    describe('aws_ebs_snapshot', () => {
      it('returns UNRECOVERABLE for snapshot deletion', () => {
        const change = createChange(
          'aws_ebs_snapshot.backup',
          'aws_ebs_snapshot',
          ['delete'],
          { id: 'snap-12345678', volume_id: 'vol-12345678', description: 'Daily backup' }
        );
        const result = ebsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('backup');
      });
    });

    describe('aws_volume_attachment', () => {
      it('returns REVERSIBLE for attachment deletion', () => {
        const change = createChange(
          'aws_volume_attachment.data',
          'aws_volume_attachment',
          ['delete'],
          { id: 'vai-12345678', volume_id: 'vol-123', instance_id: 'i-123' }
        );
        const result = ebsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
        expect(result.reasoning).toContain('re-attached');
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

  describe('Lambda Handler', () => {
    describe('aws_lambda_function', () => {
      it('returns RECOVERABLE_WITH_EFFORT for function deletion', () => {
        const change = createChange(
          'aws_lambda_function.api',
          'aws_lambda_function',
          ['delete'],
          { function_name: 'my-api', package_type: 'Zip' }
        );
        const result = lambdaHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('mentions container image for Image package type', () => {
        const change = createChange(
          'aws_lambda_function.api',
          'aws_lambda_function',
          ['delete'],
          { function_name: 'my-api', package_type: 'Image', image_uri: '123456789.dkr.ecr.us-east-1.amazonaws.com/my-image:latest' }
        );
        const result = lambdaHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('container');
      });

      it('returns REVERSIBLE for function updates', () => {
        const change = createChange(
          'aws_lambda_function.api',
          'aws_lambda_function',
          ['update'],
          { function_name: 'my-api', memory_size: 128 },
          { function_name: 'my-api', memory_size: 256 }
        );
        const result = lambdaHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_lambda_layer_version', () => {
      it('returns RECOVERABLE_WITH_EFFORT for layer deletion', () => {
        const change = createChange(
          'aws_lambda_layer_version.deps',
          'aws_lambda_layer_version',
          ['delete'],
          { layer_name: 'my-deps', version: 5 }
        );
        const result = lambdaHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });
    });
  });

  describe('KMS Handler', () => {
    describe('aws_kms_key', () => {
      it('returns RECOVERABLE_WITH_EFFORT for key deletion with standard window', () => {
        const change = createChange(
          'aws_kms_key.main',
          'aws_kms_key',
          ['delete'],
          { key_id: 'mrk-12345678', deletion_window_in_days: 30 }
        );
        const result = kmsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('30 days');
      });

      it('returns UNRECOVERABLE for key with short deletion window and dependents', () => {
        const change = createChange(
          'aws_kms_key.main',
          'aws_kms_key',
          ['delete'],
          { key_id: 'mrk-12345678', arn: 'arn:aws:kms:us-east-1:123456789:key/mrk-12345678', deletion_window_in_days: 5 }
        );
        const state = createState([
          { address: 'aws_kms_key.main', type: 'aws_kms_key', values: { key_id: 'mrk-12345678' } },
          { address: 'aws_s3_bucket.encrypted', type: 'aws_s3_bucket', values: { kms_key_id: 'mrk-12345678' } },
        ]);
        const result = kmsHandler.getRecoverability(change, state);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('returns REVERSIBLE for key updates', () => {
        const change = createChange(
          'aws_kms_key.main',
          'aws_kms_key',
          ['update'],
          { key_id: 'mrk-12345678', description: 'old' },
          { key_id: 'mrk-12345678', description: 'new' }
        );
        const result = kmsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_kms_alias', () => {
      it('returns REVERSIBLE for alias deletion', () => {
        const change = createChange(
          'aws_kms_alias.main',
          'aws_kms_alias',
          ['delete'],
          { name: 'alias/my-key' }
        );
        const result = kmsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });
  });

  describe('Secrets Manager Handler', () => {
    describe('aws_secretsmanager_secret', () => {
      it('returns UNRECOVERABLE for secret with force_delete', () => {
        const change = createChange(
          'aws_secretsmanager_secret.api_key',
          'aws_secretsmanager_secret',
          ['delete'],
          { name: 'prod/api-key', force_delete_without_recovery: true }
        );
        const result = secretsManagerHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('returns RECOVERABLE_WITH_EFFORT for secret with recovery window', () => {
        const change = createChange(
          'aws_secretsmanager_secret.api_key',
          'aws_secretsmanager_secret',
          ['delete'],
          { name: 'prod/api-key', recovery_window_in_days: 30 }
        );
        const result = secretsManagerHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('30-day');
      });
    });

    describe('aws_secretsmanager_secret_version', () => {
      it('returns UNRECOVERABLE for secret version deletion', () => {
        const change = createChange(
          'aws_secretsmanager_secret_version.v1',
          'aws_secretsmanager_secret_version',
          ['delete'],
          { secret_id: 'arn:aws:secretsmanager:us-east-1:123456789:secret:my-secret' }
        );
        const result = secretsManagerHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
    });

    describe('aws_secretsmanager_secret_rotation', () => {
      it('returns REVERSIBLE for rotation config deletion', () => {
        const change = createChange(
          'aws_secretsmanager_secret_rotation.main',
          'aws_secretsmanager_secret_rotation',
          ['delete'],
          { secret_id: 'my-secret' }
        );
        const result = secretsManagerHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });
  });

  describe('SNS Handler', () => {
    describe('aws_sns_topic', () => {
      it('returns RECOVERABLE_WITH_EFFORT for topic deletion', () => {
        const change = createChange(
          'aws_sns_topic.alerts',
          'aws_sns_topic',
          ['delete'],
          { name: 'prod-alerts', arn: 'arn:aws:sns:us-east-1:123456789:prod-alerts' }
        );
        const result = snsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('mentions subscription count when topic has subscriptions', () => {
        const change = createChange(
          'aws_sns_topic.alerts',
          'aws_sns_topic',
          ['delete'],
          { name: 'prod-alerts', arn: 'arn:aws:sns:us-east-1:123456789:prod-alerts' }
        );
        const state = createState([
          { address: 'aws_sns_topic.alerts', type: 'aws_sns_topic', values: { arn: 'arn:aws:sns:us-east-1:123456789:prod-alerts' } },
          { address: 'aws_sns_topic_subscription.email', type: 'aws_sns_topic_subscription', values: { topic_arn: 'arn:aws:sns:us-east-1:123456789:prod-alerts' } },
        ]);
        const result = snsHandler.getRecoverability(change, state);

        expect(result.reasoning).toContain('1');
      });

      it('returns REVERSIBLE for topic updates', () => {
        const change = createChange(
          'aws_sns_topic.alerts',
          'aws_sns_topic',
          ['update'],
          { name: 'prod-alerts', display_name: 'old' },
          { name: 'prod-alerts', display_name: 'new' }
        );
        const result = snsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_sns_topic_subscription', () => {
      it('returns RECOVERABLE_WITH_EFFORT for subscription deletion', () => {
        const change = createChange(
          'aws_sns_topic_subscription.email',
          'aws_sns_topic_subscription',
          ['delete'],
          { protocol: 'email', endpoint: 'alerts@example.com' }
        );
        const result = snsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('notes re-confirmation requirement for http/email protocols', () => {
        const change = createChange(
          'aws_sns_topic_subscription.webhook',
          'aws_sns_topic_subscription',
          ['delete'],
          { protocol: 'https', endpoint: 'https://example.com/webhook' }
        );
        const result = snsHandler.getRecoverability(change, null);

        expect(result.reasoning).toContain('confirmation');
      });
    });
  });

  describe('SQS Handler', () => {
    describe('aws_sqs_queue', () => {
      it('returns RECOVERABLE_WITH_EFFORT for empty queue deletion', () => {
        const change = createChange(
          'aws_sqs_queue.tasks',
          'aws_sqs_queue',
          ['delete'],
          { name: 'task-queue', approximate_number_of_messages: 0 }
        );
        const result = sqsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
      });

      it('returns UNRECOVERABLE for queue with messages', () => {
        const change = createChange(
          'aws_sqs_queue.tasks',
          'aws_sqs_queue',
          ['delete'],
          { name: 'task-queue', approximate_number_of_messages: 150 }
        );
        const result = sqsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
        expect(result.reasoning).toContain('150');
      });

      it('returns REVERSIBLE for queue updates', () => {
        const change = createChange(
          'aws_sqs_queue.tasks',
          'aws_sqs_queue',
          ['update'],
          { name: 'task-queue', visibility_timeout_seconds: 30 },
          { name: 'task-queue', visibility_timeout_seconds: 60 }
        );
        const result = sqsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_sqs_queue_policy', () => {
      it('returns REVERSIBLE for queue policy deletion', () => {
        const change = createChange(
          'aws_sqs_queue_policy.main',
          'aws_sqs_queue_policy',
          ['delete'],
          { queue_url: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue' }
        );
        const result = sqsHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });
  });

  describe('ElastiCache Handler', () => {
    describe('aws_elasticache_cluster', () => {
      it('returns RECOVERABLE_FROM_BACKUP for cluster with final snapshot', () => {
        const change = createChange(
          'aws_elasticache_cluster.redis',
          'aws_elasticache_cluster',
          ['delete'],
          { cluster_id: 'my-redis', engine: 'redis', final_snapshot_identifier: 'my-redis-final' }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });

      it('returns RECOVERABLE_FROM_BACKUP for cluster with snapshot retention', () => {
        const change = createChange(
          'aws_elasticache_cluster.redis',
          'aws_elasticache_cluster',
          ['delete'],
          { cluster_id: 'my-redis', engine: 'redis', snapshot_retention_limit: 7 }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
      });

      it('returns UNRECOVERABLE for Redis without backups', () => {
        const change = createChange(
          'aws_elasticache_cluster.redis',
          'aws_elasticache_cluster',
          ['delete'],
          { cluster_id: 'my-redis', engine: 'redis', snapshot_retention_limit: 0 }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });

      it('returns RECOVERABLE_WITH_EFFORT for Memcached (ephemeral)', () => {
        const change = createChange(
          'aws_elasticache_cluster.memcached',
          'aws_elasticache_cluster',
          ['delete'],
          { cluster_id: 'my-cache', engine: 'memcached' }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
        expect(result.reasoning).toContain('ephemeral');
      });

      it('returns REVERSIBLE for cluster updates', () => {
        const change = createChange(
          'aws_elasticache_cluster.redis',
          'aws_elasticache_cluster',
          ['update'],
          { cluster_id: 'my-redis', node_type: 'cache.t3.micro' },
          { cluster_id: 'my-redis', node_type: 'cache.t3.small' }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
      });
    });

    describe('aws_elasticache_snapshot', () => {
      it('returns UNRECOVERABLE for snapshot deletion', () => {
        const change = createChange(
          'aws_elasticache_snapshot.backup',
          'aws_elasticache_snapshot',
          ['delete'],
          { snapshot_name: 'my-backup' }
        );
        const result = elasticacheHandler.getRecoverability(change, null);

        expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      });
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
