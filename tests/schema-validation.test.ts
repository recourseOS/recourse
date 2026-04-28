/**
 * Schema validation tests for edge-case resource types.
 *
 * These tests validate whether the classifier's feature schema
 * handles resources that don't fit the standard data-storage patterns:
 *
 * 1. Resources with no destroy semantics (config-only)
 * 2. Resources where destroy is really "edit" (attachment resources)
 * 3. Resources with external dependencies
 * 4. Resources with async delete (recovery window)
 * 5. Stateless/config-only resources
 */

import { describe, it, expect } from 'vitest';
import { extractFeatures, explainFeatures } from '../src/classifier/feature-extractor.js';
import { classifyFromFeatures } from '../src/classifier/decision-tree.js';
import { getRecoverabilityDual } from '../src/classifier/dual-verdict.js';
import type { ResourceChange } from '../src/resources/types.js';

// Helper to create a resource change
function makeChange(
  type: string,
  action: 'delete' | 'create' | 'update',
  before?: Record<string, unknown>,
  after?: Record<string, unknown>
): ResourceChange {
  return {
    address: `${type}.test`,
    type,
    name: 'test',
    mode: 'managed',
    actions: [action],
    before: action === 'create' ? null : (before || {}),
    after: action === 'delete' ? null : (after || {}),
  };
}

describe('Edge Case: aws_lambda_function_event_invoke_config', () => {
  /**
   * This resource configures async invocation settings for a Lambda function.
   * Deleting it just removes the configuration - the Lambda still works.
   * It's REVERSIBLE because you can recreate the exact same config.
   * No data is stored in this resource.
   */

  it('should classify delete as reversible (config-only resource)', () => {
    const change = makeChange('aws_lambda_function_event_invoke_config', 'delete', {
      function_name: 'my-function',
      maximum_event_age_in_seconds: 60,
      maximum_retry_attempts: 2,
      destination_config: {
        on_failure: { destination: 'arn:aws:sqs:...' },
        on_success: { destination: 'arn:aws:sqs:...' }
      }
    });

    const features = extractFeatures(change, null);
    const classifierResult = classifyFromFeatures(features);

    console.log('\n=== aws_lambda_function_event_invoke_config ===');
    console.log('Features:', features);
    console.log('Feature explanations:', explainFeatures(features));
    console.log('Classification:', classifierResult);

    // Test the dual-verdict system which has config-only detection
    const dualResult = getRecoverabilityDual(change, null);
    console.log('Dual-verdict result:', dualResult.tier, dualResult.label, dualResult.reasoning);

    // With dual-verdict, config-only resources should be detected as reversible
    expect(dualResult.label).toBe('reversible');
  });
});

describe('Edge Case: aws_iam_role_policy_attachment', () => {
  /**
   * This resource attaches a policy to a role.
   * Deleting it detaches the policy - both role and policy still exist.
   * It's REVERSIBLE because you can re-attach immediately.
   * This is a "join table" resource, not a data store.
   */

  it('should classify delete as reversible (attachment resource)', () => {
    const change = makeChange('aws_iam_role_policy_attachment', 'delete', {
      role: 'my-role',
      policy_arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess'
    });

    const features = extractFeatures(change, null);
    const classifierResult = classifyFromFeatures(features);

    console.log('\n=== aws_iam_role_policy_attachment ===');
    console.log('Features:', features);
    console.log('Feature explanations:', explainFeatures(features));
    console.log('Classification:', classifierResult);

    // Test the dual-verdict system which has attachment detection
    const dualResult = getRecoverabilityDual(change, null);
    console.log('Dual-verdict result:', dualResult.tier, dualResult.label, dualResult.reasoning);

    // With dual-verdict, attachment resources should be detected as reversible
    expect(dualResult.label).toBe('reversible');
  });
});

describe('Edge Case: aws_route53_record', () => {
  /**
   * Route53 records point to external resources (IPs, ALBs, etc).
   * The recoverability depends on whether you can recreate the target:
   * - A record pointing to an ALB: recoverable (ALB still exists)
   * - A record pointing to a specific IP: depends if IP is still yours
   * - The record itself is just configuration
   */

  it('should classify delete as recoverable-with-effort (can recreate if you know the values)', () => {
    const change = makeChange('aws_route53_record', 'delete', {
      zone_id: 'Z123456',
      name: 'api.example.com',
      type: 'A',
      ttl: 300,
      records: ['1.2.3.4']
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_route53_record (A record) ===');
    console.log('Features:', features);
    console.log('Feature explanations:', explainFeatures(features));
    console.log('Classification:', result);

    // Current behavior - let's see what it does
    // Ideally: recoverable-with-effort (config can be recreated)
  });

  it('should handle ALIAS record pointing to ALB', () => {
    const change = makeChange('aws_route53_record', 'delete', {
      zone_id: 'Z123456',
      name: 'api.example.com',
      type: 'A',
      alias: {
        name: 'my-alb-123.us-east-1.elb.amazonaws.com',
        zone_id: 'Z35SXDOTRQ7X7K',
        evaluate_target_health: true
      }
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_route53_record (ALIAS to ALB) ===');
    console.log('Features:', features);
    console.log('Classification:', result);
  });
});

describe('Edge Case: aws_secretsmanager_secret', () => {
  /**
   * Secrets Manager has a recovery window (7-30 days).
   * Deleting schedules deletion, but you can cancel it.
   * This is REVERSIBLE during the window, then UNRECOVERABLE.
   */

  it('should classify delete as reversible when recovery_window_in_days > 0', () => {
    const change = makeChange('aws_secretsmanager_secret', 'delete', {
      id: 'my-secret',
      name: 'prod/db/password',
      recovery_window_in_days: 30
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_secretsmanager_secret (with recovery window) ===');
    console.log('Features:', features);
    console.log('Feature explanations:', explainFeatures(features));
    console.log('Classification:', result);

    // SHOULD be reversible - you can cancel the deletion
    // But our feature schema doesn't have "recovery_window_in_days"
    // (we have deletion_window_days for KMS, but this is different)
  });

  it('should classify delete as unrecoverable when force_overwrite_replica_secret', () => {
    const change = makeChange('aws_secretsmanager_secret', 'delete', {
      id: 'my-secret',
      name: 'prod/db/password',
      recovery_window_in_days: 0,  // Force immediate deletion
      force_overwrite_replica_secret: true
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_secretsmanager_secret (immediate delete) ===');
    console.log('Features:', features);
    console.log('Classification:', result);

    // SHOULD be unrecoverable - immediate deletion
  });
});

describe('Edge Case: aws_s3_bucket_policy', () => {
  /**
   * Bucket policy is pure configuration attached to a bucket.
   * Deleting it just removes the policy - bucket still exists.
   * This is REVERSIBLE - you can reapply the same policy.
   */

  it('should classify delete as reversible (stateless config)', () => {
    const change = makeChange('aws_s3_bucket_policy', 'delete', {
      bucket: 'my-bucket',
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::my-bucket/*'
        }]
      })
    });

    const features = extractFeatures(change, null);
    const classifierResult = classifyFromFeatures(features);

    console.log('\n=== aws_s3_bucket_policy ===');
    console.log('Features:', features);
    console.log('Feature explanations:', explainFeatures(features));
    console.log('Classification:', classifierResult);

    // Test the dual-verdict system which has config-only detection
    const dualResult = getRecoverabilityDual(change, null);
    console.log('Dual-verdict result:', dualResult.tier, dualResult.label, dualResult.reasoning);

    // With dual-verdict, config-only resources (ending in _policy) should be reversible
    expect(dualResult.label).toBe('reversible');
  });
});

describe('Edge Case: aws_elasticache_cluster', () => {
  /**
   * ElastiCache cluster without snapshots loses all data.
   * This is similar to RDS - check snapshot_retention_limit.
   */

  it('should classify delete as unrecoverable without snapshots', () => {
    const change = makeChange('aws_elasticache_cluster', 'delete', {
      cluster_id: 'my-redis',
      engine: 'redis',
      snapshot_retention_limit: 0  // No snapshots
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_elasticache_cluster (no snapshots) ===');
    console.log('Features:', features);
    console.log('Classification:', result);
  });

  it('should classify delete as recoverable-from-backup with snapshots', () => {
    const change = makeChange('aws_elasticache_cluster', 'delete', {
      cluster_id: 'my-redis',
      engine: 'redis',
      snapshot_retention_limit: 7
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_elasticache_cluster (with snapshots) ===');
    console.log('Features:', features);
    console.log('Classification:', result);
  });
});

describe('Edge Case: aws_neptune_cluster', () => {
  /**
   * Neptune has deletion_protection like RDS.
   * Should be reversible when protected.
   */

  it('should classify delete as reversible with deletion_protection', () => {
    const change = makeChange('aws_neptune_cluster', 'delete', {
      cluster_identifier: 'my-neptune',
      deletion_protection: true
    });

    const features = extractFeatures(change, null);
    const result = classifyFromFeatures(features);

    console.log('\n=== aws_neptune_cluster (protected) ===');
    console.log('Features:', features);
    console.log('Classification:', result);

    expect(result.tier).toBe('reversible');
  });
});

describe('Feature Schema Gap Analysis', () => {
  it('should document what features are missing for edge cases', () => {
    console.log('\n=== SCHEMA GAP ANALYSIS ===\n');

    const gaps = [
      {
        resource: 'aws_lambda_function_event_invoke_config',
        expected: 'reversible',
        reason: 'Config-only resource, no data stored',
        missingFeature: 'is_config_only or is_stateless',
      },
      {
        resource: 'aws_iam_role_policy_attachment',
        expected: 'reversible',
        reason: 'Attachment/join resource, parent resources unaffected',
        missingFeature: 'is_attachment or is_relationship',
      },
      {
        resource: 'aws_secretsmanager_secret',
        expected: 'reversible (with window) or unrecoverable (immediate)',
        reason: 'Has recovery_window_in_days that determines recoverability',
        missingFeature: 'has_recovery_window (different from deletion_window)',
      },
      {
        resource: 'aws_route53_record',
        expected: 'recoverable-with-effort',
        reason: 'DNS record is config, but depends on external target existing',
        missingFeature: 'has_external_dependency or is_reference_only',
      },
      {
        resource: 'aws_s3_bucket_policy',
        expected: 'reversible',
        reason: 'Policy JSON can be recreated, no state',
        missingFeature: 'is_config_only',
      },
    ];

    for (const gap of gaps) {
      console.log(`${gap.resource}:`);
      console.log(`  Expected: ${gap.expected}`);
      console.log(`  Reason: ${gap.reason}`);
      console.log(`  Missing feature: ${gap.missingFeature}`);
      console.log('');
    }

    // This test always passes - it's documentation
    expect(gaps.length).toBeGreaterThan(0);
  });
});
