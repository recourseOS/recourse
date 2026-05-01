import { describe, expect, it } from 'vitest';
import { analyzeBlastRadius, getWorstTier, shouldBlock } from '../src/analyzer/blast-radius.js';
import { RecoverabilityTier } from '../src/resources/types.js';
import type { TerraformPlan, TerraformState, ResourceChange } from '../src/resources/types.js';

// Helper to create a minimal Terraform plan
function createPlan(resourceChanges: ResourceChange[], priorState?: TerraformState): TerraformPlan {
  return {
    format_version: '1.0',
    terraform_version: '1.0.0',
    resourceChanges,
    priorState,
  };
}

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

// Helper to create a state resource
function createStateResource(
  address: string,
  type: string,
  values: Record<string, unknown> = {},
  dependsOn: string[] = []
) {
  return {
    address,
    type,
    mode: 'managed' as const,
    name: address.split('.').pop() || address,
    provider: 'registry.terraform.io/hashicorp/aws',
    instances: [{ attributes: values }],
    dependsOn,
    values,
  };
}

// Helper to create a terraform state
function createState(resources: ReturnType<typeof createStateResource>[]): TerraformState {
  return {
    version: 4,
    serial: 1,
    terraform_version: '1.0.0',
    resources,
  };
}

describe('Cascade Impact Analysis', () => {
  describe('analyzeBlastRadius', () => {
    it('returns empty cascade impact for changes with no dependents', () => {
      const plan = createPlan([
        createChange('aws_s3_bucket.orphan', 'aws_s3_bucket', ['delete'], { bucket: 'orphan', object_count: 10 }),
      ]);
      const state = createState([
        createStateResource('aws_s3_bucket.orphan', 'aws_s3_bucket', { bucket: 'orphan' }),
      ]);

      const report = analyzeBlastRadius(plan, state);

      expect(report.changes).toHaveLength(1);
      expect(report.changes[0].cascadeImpact).toHaveLength(0);
    });

    it('identifies direct dependents via explicit depends_on', () => {
      const plan = createPlan([
        createChange('aws_vpc.main', 'aws_vpc', ['delete']),
      ]);
      const state = createState([
        createStateResource('aws_vpc.main', 'aws_vpc', { id: 'vpc-123' }),
        createStateResource('aws_subnet.public', 'aws_subnet', { vpc_id: 'vpc-123' }, ['aws_vpc.main']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      expect(report.changes).toHaveLength(1);
      expect(report.changes[0].cascadeImpact.length).toBeGreaterThanOrEqual(1);
      expect(report.changes[0].cascadeImpact.some(c => c.affectedResource === 'aws_subnet.public')).toBe(true);
    });

    it('identifies multi-level cascade chains', () => {
      const plan = createPlan([
        createChange('aws_vpc.main', 'aws_vpc', ['delete']),
      ]);
      // VPC → Subnet → Instance
      const state = createState([
        createStateResource('aws_vpc.main', 'aws_vpc', { id: 'vpc-123' }),
        createStateResource('aws_subnet.public', 'aws_subnet', { vpc_id: 'vpc-123' }, ['aws_vpc.main']),
        createStateResource('aws_instance.web', 'aws_instance', { subnet_id: 'subnet-123' }, ['aws_subnet.public']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      const cascadeAddresses = report.changes[0].cascadeImpact.map(c => c.affectedResource);
      expect(cascadeAddresses).toContain('aws_subnet.public');
      expect(cascadeAddresses).toContain('aws_instance.web');
    });

    it('handles diamond dependencies correctly', () => {
      // A → B, A → C, B → D, C → D (diamond pattern)
      const plan = createPlan([
        createChange('aws_vpc.a', 'aws_vpc', ['delete']),
      ]);
      const state = createState([
        createStateResource('aws_vpc.a', 'aws_vpc'),
        createStateResource('aws_subnet.b', 'aws_subnet', {}, ['aws_vpc.a']),
        createStateResource('aws_subnet.c', 'aws_subnet', {}, ['aws_vpc.a']),
        createStateResource('aws_instance.d', 'aws_instance', {}, ['aws_subnet.b', 'aws_subnet.c']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      const cascadeAddresses = report.changes[0].cascadeImpact.map(c => c.affectedResource);
      expect(cascadeAddresses).toContain('aws_subnet.b');
      expect(cascadeAddresses).toContain('aws_subnet.c');
      expect(cascadeAddresses).toContain('aws_instance.d');
    });

    it('deduplicates cascade impacts in summary', () => {
      // Two deletions both affecting the same resource
      const plan = createPlan([
        createChange('aws_security_group.a', 'aws_security_group', ['delete']),
        createChange('aws_security_group.b', 'aws_security_group', ['delete']),
      ]);
      const state = createState([
        createStateResource('aws_security_group.a', 'aws_security_group'),
        createStateResource('aws_security_group.b', 'aws_security_group'),
        createStateResource('aws_instance.shared', 'aws_instance', {}, ['aws_security_group.a', 'aws_security_group.b']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      // Each change should have the instance in its cascade
      expect(report.changes[0].cascadeImpact.some(c => c.affectedResource === 'aws_instance.shared')).toBe(true);
      expect(report.changes[1].cascadeImpact.some(c => c.affectedResource === 'aws_instance.shared')).toBe(true);

      // Summary should deduplicate
      expect(report.summary.cascadeImpactCount).toBe(1);
    });

    it('handles deletion with no state (null state)', () => {
      const plan = createPlan([
        createChange('aws_s3_bucket.main', 'aws_s3_bucket', ['delete'], { bucket: 'test' }),
      ]);

      // No state provided - should still work
      const report = analyzeBlastRadius(plan, null);

      expect(report.changes).toHaveLength(1);
      expect(report.changes[0].cascadeImpact).toHaveLength(0); // No graph available
    });

    it('uses prior state from plan when no separate state provided', () => {
      const priorState = createState([
        createStateResource('aws_s3_bucket.main', 'aws_s3_bucket', { bucket: 'test' }),
        createStateResource('aws_s3_bucket_policy.main', 'aws_s3_bucket_policy', {}, ['aws_s3_bucket.main']),
      ]);
      const plan = createPlan(
        [createChange('aws_s3_bucket.main', 'aws_s3_bucket', ['delete'], { bucket: 'test', object_count: 10 })],
        priorState
      );

      const report = analyzeBlastRadius(plan, null);

      // Should find dependent from prior state
      expect(report.changes[0].cascadeImpact.length).toBeGreaterThanOrEqual(1);
    });

    it('only computes cascade for delete actions', () => {
      const plan = createPlan([
        createChange('aws_vpc.main', 'aws_vpc', ['update'], { id: 'vpc-123' }, { id: 'vpc-123', tags: { env: 'prod' } }),
      ]);
      const state = createState([
        createStateResource('aws_vpc.main', 'aws_vpc', { id: 'vpc-123' }),
        createStateResource('aws_subnet.public', 'aws_subnet', { vpc_id: 'vpc-123' }, ['aws_vpc.main']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      // Update should not trigger cascade analysis
      expect(report.changes[0].cascadeImpact).toHaveLength(0);
    });
  });

  describe('Cascade with Mixed Tiers', () => {
    it('aggregates worst tier correctly', () => {
      const plan = createPlan([
        // REVERSIBLE - update
        createChange('aws_iam_role.main', 'aws_iam_role', ['update'], { name: 'role' }, { name: 'role', description: 'updated' }),
        // UNRECOVERABLE - S3 bucket deletion with objects
        createChange('aws_s3_bucket.data', 'aws_s3_bucket', ['delete'], { bucket: 'data', object_count: 1000 }),
      ]);

      const report = analyzeBlastRadius(plan, null);
      const worstTier = getWorstTier(report);

      expect(worstTier).toBe(RecoverabilityTier.UNRECOVERABLE);
    });

    it('correctly counts changes by tier', () => {
      const plan = createPlan([
        createChange('aws_iam_role.main', 'aws_iam_role', ['update']),
        createChange('aws_iam_role.other', 'aws_iam_role', ['update']),
        createChange('aws_s3_bucket.data', 'aws_s3_bucket', ['delete'], { bucket: 'data', object_count: 100 }),
      ]);

      const report = analyzeBlastRadius(plan, null);

      expect(report.summary.byTier[RecoverabilityTier.REVERSIBLE]).toBe(2);
      expect(report.summary.byTier[RecoverabilityTier.UNRECOVERABLE]).toBe(1);
    });
  });

  describe('shouldBlock', () => {
    it('returns true when worst tier meets threshold', () => {
      const plan = createPlan([
        createChange('aws_s3_bucket.main', 'aws_s3_bucket', ['delete'], { bucket: 'test', object_count: 10 }),
      ]);
      const report = analyzeBlastRadius(plan, null);

      expect(shouldBlock(report, RecoverabilityTier.UNRECOVERABLE)).toBe(true);
    });

    it('returns false when worst tier is below threshold', () => {
      const plan = createPlan([
        createChange('aws_iam_role.main', 'aws_iam_role', ['update']),
      ]);
      const report = analyzeBlastRadius(plan, null);

      expect(shouldBlock(report, RecoverabilityTier.UNRECOVERABLE)).toBe(false);
    });

    it('returns true when worst tier equals threshold', () => {
      const plan = createPlan([
        createChange('aws_db_instance.main', 'aws_db_instance', ['delete'], {
          identifier: 'db',
          skip_final_snapshot: false,
          final_snapshot_identifier: 'final',
        }),
      ]);
      const report = analyzeBlastRadius(plan, null);

      // This should be RECOVERABLE_FROM_BACKUP (tier 3)
      expect(shouldBlock(report, RecoverabilityTier.RECOVERABLE_FROM_BACKUP)).toBe(true);
    });
  });

  describe('getWorstTier', () => {
    it('returns REVERSIBLE for empty plan', () => {
      const plan = createPlan([]);
      const report = analyzeBlastRadius(plan, null);

      expect(getWorstTier(report)).toBe(RecoverabilityTier.REVERSIBLE);
    });

    it('returns highest tier among multiple changes', () => {
      const plan = createPlan([
        createChange('aws_iam_role.main', 'aws_iam_role', ['update']), // REVERSIBLE
        createChange('aws_instance.web', 'aws_instance', ['delete']), // RECOVERABLE_WITH_EFFORT
        createChange('aws_db_instance.main', 'aws_db_instance', ['delete'], {
          identifier: 'db',
          skip_final_snapshot: false,
        }), // RECOVERABLE_FROM_BACKUP
      ]);
      const report = analyzeBlastRadius(plan, null);

      expect(getWorstTier(report)).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    });
  });

  describe('Real-World Scenarios', () => {
    it('VPC deletion cascades to all network resources', () => {
      const plan = createPlan([
        createChange('aws_vpc.prod', 'aws_vpc', ['delete']),
      ]);
      const state = createState([
        createStateResource('aws_vpc.prod', 'aws_vpc', { id: 'vpc-prod' }),
        createStateResource('aws_subnet.public_a', 'aws_subnet', {}, ['aws_vpc.prod']),
        createStateResource('aws_subnet.public_b', 'aws_subnet', {}, ['aws_vpc.prod']),
        createStateResource('aws_subnet.private_a', 'aws_subnet', {}, ['aws_vpc.prod']),
        createStateResource('aws_internet_gateway.prod', 'aws_internet_gateway', {}, ['aws_vpc.prod']),
        createStateResource('aws_nat_gateway.prod', 'aws_nat_gateway', {}, ['aws_subnet.public_a']),
        createStateResource('aws_instance.web', 'aws_instance', {}, ['aws_subnet.public_a']),
        createStateResource('aws_db_instance.main', 'aws_db_instance', {}, ['aws_subnet.private_a']),
      ]);

      const report = analyzeBlastRadius(plan, state);
      const cascadeAddresses = report.changes[0].cascadeImpact.map(c => c.affectedResource);

      // All VPC children should be affected
      expect(cascadeAddresses).toContain('aws_subnet.public_a');
      expect(cascadeAddresses).toContain('aws_subnet.public_b');
      expect(cascadeAddresses).toContain('aws_subnet.private_a');
      expect(cascadeAddresses).toContain('aws_internet_gateway.prod');
      // Transitive dependents
      expect(cascadeAddresses).toContain('aws_nat_gateway.prod');
      expect(cascadeAddresses).toContain('aws_instance.web');
      expect(cascadeAddresses).toContain('aws_db_instance.main');
    });

    it('IAM role deletion affects attached resources', () => {
      const plan = createPlan([
        createChange('aws_iam_role.lambda_exec', 'aws_iam_role', ['delete'], { name: 'lambda-exec' }),
      ]);
      const state = createState([
        createStateResource('aws_iam_role.lambda_exec', 'aws_iam_role', { name: 'lambda-exec' }),
        createStateResource('aws_iam_role_policy_attachment.lambda_basic', 'aws_iam_role_policy_attachment', {}, ['aws_iam_role.lambda_exec']),
        createStateResource('aws_lambda_function.api', 'aws_lambda_function', { role: 'arn:aws:iam::123:role/lambda-exec' }, ['aws_iam_role.lambda_exec']),
      ]);

      const report = analyzeBlastRadius(plan, state);
      const cascadeAddresses = report.changes[0].cascadeImpact.map(c => c.affectedResource);

      expect(cascadeAddresses).toContain('aws_iam_role_policy_attachment.lambda_basic');
      expect(cascadeAddresses).toContain('aws_lambda_function.api');
    });

    it('S3 bucket deletion with lifecycle policy dependent', () => {
      const plan = createPlan([
        createChange('aws_s3_bucket.logs', 'aws_s3_bucket', ['delete'], { bucket: 'logs', object_count: 500 }),
      ]);
      const state = createState([
        createStateResource('aws_s3_bucket.logs', 'aws_s3_bucket', { bucket: 'logs' }),
        createStateResource('aws_s3_bucket_lifecycle_configuration.logs', 'aws_s3_bucket_lifecycle_configuration', {}, ['aws_s3_bucket.logs']),
        createStateResource('aws_s3_bucket_versioning.logs', 'aws_s3_bucket_versioning', {}, ['aws_s3_bucket.logs']),
      ]);

      const report = analyzeBlastRadius(plan, state);

      expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
      expect(report.changes[0].cascadeImpact.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edge Cases', () => {
    it('handles self-referential resource gracefully', () => {
      const plan = createPlan([
        createChange('aws_security_group.self', 'aws_security_group', ['delete']),
      ]);
      const state = createState([
        createStateResource('aws_security_group.self', 'aws_security_group', {}, ['aws_security_group.self']),
      ]);

      // Should not hang or crash
      const report = analyzeBlastRadius(plan, state);
      expect(report.changes).toHaveLength(1);
    });

    it('handles very deep dependency chains', () => {
      const resources = [];
      for (let i = 0; i < 20; i++) {
        const dependsOn = i > 0 ? [`aws_resource.level${i - 1}`] : [];
        resources.push(createStateResource(`aws_resource.level${i}`, 'aws_resource', {}, dependsOn));
      }

      const plan = createPlan([
        createChange('aws_resource.level0', 'aws_resource', ['delete']),
      ]);
      const state = createState(resources);

      const report = analyzeBlastRadius(plan, state);

      // Should find all 19 dependent resources
      expect(report.changes[0].cascadeImpact.length).toBe(19);
    });

    it('handles mixed create/delete/update plan', () => {
      const plan = createPlan([
        createChange('aws_s3_bucket.new', 'aws_s3_bucket', ['create'], {}, { bucket: 'new' }),
        createChange('aws_s3_bucket.update', 'aws_s3_bucket', ['update'], { bucket: 'update' }, { bucket: 'update', tags: {} }),
        createChange('aws_s3_bucket.delete', 'aws_s3_bucket', ['delete'], { bucket: 'delete', object_count: 10 }),
      ]);

      const report = analyzeBlastRadius(plan, null);

      expect(report.summary.totalChanges).toBe(3);
      // Only delete should have cascade analyzed (though cascade will be empty without state)
    });
  });

  describe('Summary Aggregation', () => {
    it('correctly sets hasUnrecoverable flag', () => {
      const planWithUnrecoverable = createPlan([
        createChange('aws_s3_bucket.main', 'aws_s3_bucket', ['delete'], { bucket: 'data', object_count: 100 }),
      ]);
      const reportWithUnrecoverable = analyzeBlastRadius(planWithUnrecoverable, null);

      expect(reportWithUnrecoverable.summary.hasUnrecoverable).toBe(true);

      const planWithoutUnrecoverable = createPlan([
        createChange('aws_iam_role.main', 'aws_iam_role', ['update']),
      ]);
      const reportWithoutUnrecoverable = analyzeBlastRadius(planWithoutUnrecoverable, null);

      expect(reportWithoutUnrecoverable.summary.hasUnrecoverable).toBe(false);
    });

    it('counts total changes correctly', () => {
      const plan = createPlan([
        createChange('aws_resource.a', 'aws_resource', ['update']),
        createChange('aws_resource.b', 'aws_resource', ['update']),
        createChange('aws_resource.c', 'aws_resource', ['delete']),
        createChange('aws_resource.d', 'aws_resource', ['create']),
        createChange('aws_resource.e', 'aws_resource', ['delete', 'create']),
      ]);

      const report = analyzeBlastRadius(plan, null);

      expect(report.summary.totalChanges).toBe(5);
    });
  });
});
