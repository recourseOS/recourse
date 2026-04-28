import { describe, it, expect } from 'vitest';
import { parsePlanJson } from '../src/parsers/plan.js';
import { parseStateJson } from '../src/parsers/state.js';
import { analyzeBlastRadius } from '../src/analyzer/blast-radius.js';
import { RecoverabilityTier } from '../src/resources/types.js';

describe('analyzeBlastRadius', () => {
  it('identifies unrecoverable S3 bucket deletion without versioning', () => {
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [
        {
          address: 'aws_s3_bucket.test',
          type: 'aws_s3_bucket',
          name: 'test',
          provider_name: 'registry.terraform.io/hashicorp/aws',
          change: {
            actions: ['delete'],
            before: { bucket: 'test-bucket', versioning: [{ enabled: false }] },
            after: null,
            after_unknown: {},
          },
        },
      ],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(report.summary.hasUnrecoverable).toBe(true);
  });

  it('identifies recoverable RDS deletion with final snapshot', () => {
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [
        {
          address: 'aws_db_instance.test',
          type: 'aws_db_instance',
          name: 'test',
          provider_name: 'registry.terraform.io/hashicorp/aws',
          change: {
            actions: ['delete'],
            before: {
              identifier: 'test-db',
              skip_final_snapshot: false,
              final_snapshot_identifier: 'test-db-final',
              deletion_protection: false,
            },
            after: null,
            after_unknown: {},
          },
        },
      ],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('identifies reversible update', () => {
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [
        {
          address: 'aws_instance.test',
          type: 'aws_instance',
          name: 'test',
          provider_name: 'registry.terraform.io/hashicorp/aws',
          change: {
            actions: ['update'],
            before: { ami: 'ami-123', instance_type: 't3.micro' },
            after: { ami: 'ami-123', instance_type: 't3.micro', tags: { Name: 'test' } },
            after_unknown: {},
          },
        },
      ],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('handles empty plan', () => {
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes).toHaveLength(0);
    expect(report.summary.totalChanges).toBe(0);
    expect(report.summary.hasUnrecoverable).toBe(false);
  });

  it('S3 bucket deletion is unrecoverable even with versioning', () => {
    // Versioning does NOT help with bucket deletion - only with object deletion
    // within an existing bucket. To delete a bucket, you must first delete all
    // objects AND all versions, then the bucket itself is gone.
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [
        {
          address: 'aws_s3_bucket.versioned',
          type: 'aws_s3_bucket',
          name: 'versioned',
          provider_name: 'registry.terraform.io/hashicorp/aws',
          change: {
            actions: ['delete'],
            before: { bucket: 'versioned-bucket', versioning: [{ enabled: true }] },
            after: null,
            after_unknown: {},
          },
        },
      ],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(report.changes[0].recoverability.reasoning).toContain('versioning does not survive bucket deletion');
  });

  it('detects deletion protection on RDS', () => {
    const planJson = JSON.stringify({
      format_version: '1.2',
      terraform_version: '1.6.0',
      resource_changes: [
        {
          address: 'aws_db_instance.protected',
          type: 'aws_db_instance',
          name: 'protected',
          provider_name: 'registry.terraform.io/hashicorp/aws',
          change: {
            actions: ['delete'],
            before: {
              identifier: 'protected-db',
              deletion_protection: true,
            },
            after: null,
            after_unknown: {},
          },
        },
      ],
    });

    const plan = parsePlanJson(planJson);
    const report = analyzeBlastRadius(plan, null);

    expect(report.changes[0].recoverability.tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(report.changes[0].recoverability.label).toBe('blocked');
    expect(report.changes[0].recoverability.reasoning).toContain('APPLY WILL FAIL');
  });
});
