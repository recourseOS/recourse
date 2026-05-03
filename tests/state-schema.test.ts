/**
 * Tests for Unknown-State Schema
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  assessCompleteness,
  assessFreshness,
  assessState,
  assessmentToMissingEvidence,
  confidenceModifier,
  getEvidenceRequirements,
  getRegisteredResourceTypes,
  hasEvidenceRequirements,
  DEFAULT_UNKNOWN_REQUIREMENTS,
  type EvidenceRequirement,
  type TrackedEvidence,
  type StateCompleteness,
  type EvidenceFreshness,
} from '../src/core/index.js';

describe('State Completeness Assessment', () => {
  const requirements: EvidenceRequirement[] = [
    {
      key: 'required_1',
      level: 'required',
      description: 'First required field',
      blocksSafeVerdict: true,
    },
    {
      key: 'required_2',
      level: 'required',
      description: 'Second required field',
      blocksSafeVerdict: false,
    },
    {
      key: 'recommended_1',
      level: 'recommended',
      description: 'First recommended field',
      blocksSafeVerdict: false,
    },
    {
      key: 'optional_1',
      level: 'optional',
      description: 'First optional field',
      blocksSafeVerdict: false,
    },
  ];

  it('returns complete when all required and recommended present', () => {
    const evidence = [
      { key: 'required_1', value: 'yes', present: true, description: '' },
      { key: 'required_2', value: 'yes', present: true, description: '' },
      { key: 'recommended_1', value: 'yes', present: true, description: '' },
    ];

    const result = assessCompleteness(evidence, requirements);

    expect(result.level).toBe('complete');
    expect(result.percentage).toBe(100);
    expect(result.missingKeys).toHaveLength(0);
    expect(result.optionalMissingKeys).toContain('optional_1');
  });

  it('returns partial when required present but recommended missing', () => {
    const evidence = [
      { key: 'required_1', value: 'yes', present: true, description: '' },
      { key: 'required_2', value: 'yes', present: true, description: '' },
    ];

    const result = assessCompleteness(evidence, requirements);

    expect(result.level).toBe('partial');
    expect(result.percentage).toBe(67); // 2/3 of required+recommended
    expect(result.missingKeys).toContain('recommended_1');
  });

  it('returns minimal when some required missing', () => {
    const evidence = [
      { key: 'required_1', value: 'yes', present: true, description: '' },
    ];

    const result = assessCompleteness(evidence, requirements);

    expect(result.level).toBe('minimal');
    expect(result.missingKeys).toContain('required_2');
    expect(result.missingKeys).toContain('recommended_1');
  });

  it('returns none when no evidence present', () => {
    const evidence: TrackedEvidence[] = [];

    const result = assessCompleteness(evidence, requirements);

    expect(result.level).toBe('none');
    expect(result.percentage).toBe(0);
    expect(result.presentKeys).toHaveLength(0);
  });

  it('ignores evidence with present=false', () => {
    const evidence = [
      { key: 'required_1', value: null, present: false, description: '' },
      { key: 'required_2', value: 'yes', present: true, description: '' },
    ];

    const result = assessCompleteness(evidence, requirements);

    expect(result.level).toBe('minimal');
    expect(result.presentKeys).toContain('required_2');
    expect(result.presentKeys).not.toContain('required_1');
  });
});

describe('Evidence Freshness Assessment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns fresh for evidence within half of max age', () => {
    const gatheredAt = new Date('2025-05-01T11:45:00Z').toISOString(); // 15 min ago
    const maxAge = 3600; // 1 hour

    const result = assessFreshness(gatheredAt, maxAge);

    expect(result.level).toBe('fresh');
    expect(result.ageSeconds).toBe(900);
  });

  it('returns aging for evidence between half and full max age', () => {
    const gatheredAt = new Date('2025-05-01T11:15:00Z').toISOString(); // 45 min ago
    const maxAge = 3600; // 1 hour

    const result = assessFreshness(gatheredAt, maxAge);

    expect(result.level).toBe('aging');
    expect(result.ageSeconds).toBe(2700);
  });

  it('returns stale for evidence older than max age', () => {
    const gatheredAt = new Date('2025-05-01T10:00:00Z').toISOString(); // 2 hours ago
    const maxAge = 3600; // 1 hour

    const result = assessFreshness(gatheredAt, maxAge);

    expect(result.level).toBe('stale');
    expect(result.ageSeconds).toBe(7200);
  });

  it('returns unknown when no timestamp provided', () => {
    const result = assessFreshness(undefined, 3600);

    expect(result.level).toBe('unknown');
    expect(result.ageSeconds).toBeUndefined();
  });
});

describe('Full State Assessment', () => {
  const requirements: EvidenceRequirement[] = [
    {
      key: 's3.versioning',
      level: 'required',
      description: 'S3 versioning status',
      blocksSafeVerdict: false,
    },
    {
      key: 's3.empty',
      level: 'required',
      description: 'Whether bucket is empty',
      blocksSafeVerdict: true,
    },
    {
      key: 's3.replication',
      level: 'recommended',
      description: 'Replication config',
      blocksSafeVerdict: false,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns proceed recommendation when all evidence is complete and fresh', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.empty',
        value: false,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.replication',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
    ];

    const result = assessState(evidence, requirements, 3600);

    expect(result.sufficiency).toBe('sufficient');
    expect(result.completeness.level).toBe('complete');
    expect(result.freshness.level).toBe('fresh');
    expect(result.sufficientForClassification).toBe(true);
    expect(result.qualityScore).toBeGreaterThan(0.9);
  });

  it('returns blocking_gaps when blocking evidence is missing', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      // s3.empty is missing - and it blocks safe verdict
    ];

    const result = assessState(evidence, requirements, 3600);

    expect(result.sufficiency).toBe('blocking_gaps');
    expect(result.sufficientForClassification).toBe(false);
  });

  it('returns require_verification for stale evidence', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(), // 4 hours ago
      },
      {
        key: 's3.empty',
        value: false,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(),
      },
      {
        key: 's3.replication',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(),
      },
    ];

    const result = assessState(evidence, requirements, 3600);

    expect(result.sufficiency).toBe('insufficient');
    expect(result.freshness.level).toBe('stale');
    expect(result.sufficientForClassification).toBe(false);
  });

  it('detects evidence conflicts from different sources', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'terraform_state',
        gatheredAt: new Date('2025-05-01T11:50:00Z').toISOString(),
      },
      {
        key: 's3.versioning',
        value: 'Suspended',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.empty',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.replication',
        value: false,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
    ];

    const result = assessState(evidence, requirements, 3600);

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts![0].key).toBe('s3.versioning');
    expect(result.conflicts![0].resolution).toBe('use_most_conservative');
    expect(result.qualityScore).toBeLessThan(0.9); // Penalized for conflicts
  });

  it('returns gather_more for partial evidence', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.empty',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      // s3.replication (recommended) is missing
    ];

    const result = assessState(evidence, requirements, 3600);

    expect(result.sufficiency).toBe('partial');
    expect(result.completeness.level).toBe('partial');
  });
});

describe('Assessment to MissingEvidence Conversion', () => {
  const requirements: EvidenceRequirement[] = [
    {
      key: 's3.empty',
      level: 'required',
      description: 'Whether bucket is empty',
      blocksSafeVerdict: true,
    },
    {
      key: 's3.versioning',
      level: 'required',
      description: 'Versioning status',
      blocksSafeVerdict: false,
    },
    {
      key: 's3.replication',
      level: 'recommended',
      description: 'Replication config',
      blocksSafeVerdict: false,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts missing required blocking evidence to blocks-safe-verdict', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const missing = assessmentToMissingEvidence(assessment, requirements);

    const emptyMissing = missing.find(m => m.key === 's3.empty');
    expect(emptyMissing).toBeDefined();
    expect(emptyMissing!.effect).toBe('blocks-safe-verdict');
  });

  it('converts missing required non-blocking evidence to requires-review', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.empty',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const missing = assessmentToMissingEvidence(assessment, requirements);

    const versioningMissing = missing.find(m => m.key === 's3.versioning');
    expect(versioningMissing).toBeDefined();
    expect(versioningMissing!.effect).toBe('requires-review');
  });

  it('converts missing recommended evidence to lowers-confidence', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.empty',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString(),
      },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const missing = assessmentToMissingEvidence(assessment, requirements);

    const replicationMissing = missing.find(m => m.key === 's3.replication');
    expect(replicationMissing).toBeDefined();
    expect(replicationMissing!.effect).toBe('lowers-confidence');
  });

  it('adds freshness warning for stale evidence', () => {
    const evidence: TrackedEvidence[] = [
      {
        key: 's3.empty',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(), // 4 hours ago
      },
      {
        key: 's3.versioning',
        value: 'Enabled',
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(),
      },
      {
        key: 's3.replication',
        value: true,
        present: true,
        description: '',
        source: 'live_api',
        gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString(),
      },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const missing = assessmentToMissingEvidence(assessment, requirements);

    const freshnessMissing = missing.find(m => m.key === 'evidence_freshness');
    expect(freshnessMissing).toBeDefined();
    expect(freshnessMissing!.effect).toBe('requires-review');
  });
});

describe('Confidence Modifier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const requirements: EvidenceRequirement[] = [
    { key: 'a', level: 'required', description: '', blocksSafeVerdict: false },
    { key: 'b', level: 'recommended', description: '', blocksSafeVerdict: false },
  ];

  it('returns 1.0 for complete fresh evidence', () => {
    const evidence: TrackedEvidence[] = [
      { key: 'a', value: 1, present: true, description: '', source: 'live_api', gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString() },
      { key: 'b', value: 2, present: true, description: '', source: 'live_api', gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString() },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const modifier = confidenceModifier(assessment);

    expect(modifier).toBe(1.0);
  });

  it('reduces modifier for partial completeness', () => {
    const evidence: TrackedEvidence[] = [
      { key: 'a', value: 1, present: true, description: '', source: 'live_api', gatheredAt: new Date('2025-05-01T11:55:00Z').toISOString() },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const modifier = confidenceModifier(assessment);

    expect(modifier).toBeLessThan(1.0);
    expect(modifier).toBeGreaterThan(0.5);
  });

  it('reduces modifier for stale evidence', () => {
    const evidence: TrackedEvidence[] = [
      { key: 'a', value: 1, present: true, description: '', source: 'live_api', gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString() },
      { key: 'b', value: 2, present: true, description: '', source: 'live_api', gatheredAt: new Date('2025-05-01T08:00:00Z').toISOString() },
    ];

    const assessment = assessState(evidence, requirements, 3600);
    const modifier = confidenceModifier(assessment);

    expect(modifier).toBeLessThanOrEqual(0.5);
  });

  it('returns very low modifier for no evidence', () => {
    const evidence: TrackedEvidence[] = [];

    const assessment = assessState(evidence, requirements, 3600);
    const modifier = confidenceModifier(assessment);

    expect(modifier).toBeLessThanOrEqual(0.2);
  });
});

describe('Evidence Requirements Registry', () => {
  it('returns requirements for aws_s3_bucket delete', () => {
    const requirements = getEvidenceRequirements('aws_s3_bucket', 'delete');

    expect(requirements).toBeDefined();
    expect(requirements!.length).toBeGreaterThan(0);
    expect(requirements!.some(r => r.key === 's3.versioning')).toBe(true);
    expect(requirements!.some(r => r.key === 's3.empty')).toBe(true);
  });

  it('returns requirements for aws_db_instance delete', () => {
    const requirements = getEvidenceRequirements('aws_db_instance', 'delete');

    expect(requirements).toBeDefined();
    expect(requirements!.some(r => r.key === 'rds.deletion_protection')).toBe(true);
    expect(requirements!.some(r => r.key === 'rds.skip_final_snapshot')).toBe(true);
  });

  it('returns undefined for unknown resource type', () => {
    const requirements = getEvidenceRequirements('unknown_resource', 'delete');

    expect(requirements).toBeUndefined();
  });

  it('lists all registered resource types', () => {
    const types = getRegisteredResourceTypes();

    expect(types).toContain('aws_s3_bucket');
    expect(types).toContain('aws_db_instance');
    expect(types).toContain('aws_dynamodb_table');
    expect(types).toContain('aws_iam_role');
    expect(types).toContain('aws_kms_key');
    expect(types).toContain('aws_instance');
  });

  it('correctly checks for registered requirements', () => {
    expect(hasEvidenceRequirements('aws_s3_bucket')).toBe(true);
    expect(hasEvidenceRequirements('unknown_type')).toBe(false);
  });

  it('provides default requirements for unknown resources', () => {
    expect(DEFAULT_UNKNOWN_REQUIREMENTS.length).toBeGreaterThan(0);
    expect(DEFAULT_UNKNOWN_REQUIREMENTS.some(r => r.blocksSafeVerdict)).toBe(true);
  });
});

describe('S3 Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_s3_bucket', 'delete')!;

  it('requires versioning check', () => {
    const versioning = requirements.find(r => r.key === 's3.versioning');
    expect(versioning).toBeDefined();
    expect(versioning!.level).toBe('required');
  });

  it('blocks safe verdict without empty check', () => {
    const empty = requirements.find(r => r.key === 's3.empty');
    expect(empty).toBeDefined();
    expect(empty!.blocksSafeVerdict).toBe(true);
  });

  it('recommends replication check', () => {
    const replication = requirements.find(r => r.key === 's3.replication');
    expect(replication).toBeDefined();
    expect(replication!.level).toBe('recommended');
  });

  it('has conservative defaults', () => {
    const empty = requirements.find(r => r.key === 's3.empty');
    expect(empty!.defaultAssumption).toBe(false); // Assume not empty
  });
});

describe('RDS Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_db_instance', 'delete')!;

  it('requires deletion protection check', () => {
    const protection = requirements.find(r => r.key === 'rds.deletion_protection');
    expect(protection).toBeDefined();
    expect(protection!.level).toBe('required');
  });

  it('blocks safe verdict without skip_final_snapshot check', () => {
    const skipSnapshot = requirements.find(r => r.key === 'rds.skip_final_snapshot');
    expect(skipSnapshot).toBeDefined();
    expect(skipSnapshot!.blocksSafeVerdict).toBe(true);
    expect(skipSnapshot!.defaultAssumption).toBe(true); // Assume skip (conservative)
  });

  it('recommends manual snapshot check', () => {
    const snapshots = requirements.find(r => r.key === 'rds.manual_snapshots');
    expect(snapshots).toBeDefined();
    expect(snapshots!.level).toBe('recommended');
  });

  it('blocks safe verdict for all critical RDS evidence', () => {
    // Per design review: deletion_protection, automated_backups, and skip_final_snapshot
    // should all block safe verdicts
    const deletionProtection = requirements.find(r => r.key === 'rds.deletion_protection');
    const automatedBackups = requirements.find(r => r.key === 'rds.automated_backups');
    const skipSnapshot = requirements.find(r => r.key === 'rds.skip_final_snapshot');

    expect(deletionProtection!.blocksSafeVerdict).toBe(true);
    expect(automatedBackups!.blocksSafeVerdict).toBe(true);
    expect(skipSnapshot!.blocksSafeVerdict).toBe(true);
  });
});

describe('VPC Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_vpc', 'delete')!;

  it('has requirements defined', () => {
    expect(requirements).toBeDefined();
    expect(requirements.length).toBeGreaterThan(0);
  });

  it('blocks safe verdict without dependent count', () => {
    const dependentCount = requirements.find(r => r.key === 'vpc.dependent_count');
    expect(dependentCount).toBeDefined();
    expect(dependentCount!.blocksSafeVerdict).toBe(true);
  });

  it('recommends peering connections check', () => {
    const peering = requirements.find(r => r.key === 'vpc.peering_connections');
    expect(peering).toBeDefined();
    expect(peering!.level).toBe('recommended');
  });
});

describe('EIP Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_eip', 'delete')!;

  it('has requirements defined', () => {
    expect(requirements).toBeDefined();
    expect(requirements.length).toBeGreaterThan(0);
  });

  it('blocks safe verdict without public IP', () => {
    const publicIp = requirements.find(r => r.key === 'eip.public_ip');
    expect(publicIp).toBeDefined();
    expect(publicIp!.blocksSafeVerdict).toBe(true);
  });

  it('blocks safe verdict without association check', () => {
    const association = requirements.find(r => r.key === 'eip.association_id');
    expect(association).toBeDefined();
    expect(association!.blocksSafeVerdict).toBe(true);
  });
});

describe('Route53 Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_route53_zone', 'delete')!;

  it('has requirements defined', () => {
    expect(requirements).toBeDefined();
    expect(requirements.length).toBeGreaterThan(0);
  });

  it('blocks safe verdict without record count', () => {
    const recordCount = requirements.find(r => r.key === 'route53.record_count');
    expect(recordCount).toBeDefined();
    expect(recordCount!.blocksSafeVerdict).toBe(true);
  });

  it('blocks safe verdict without is_private check', () => {
    const isPrivate = requirements.find(r => r.key === 'route53.is_private');
    expect(isPrivate).toBeDefined();
    expect(isPrivate!.blocksSafeVerdict).toBe(true);
    expect(isPrivate!.defaultAssumption).toBe(false); // Assume public (conservative)
  });

  it('recommends associated VPCs check', () => {
    const vpcs = requirements.find(r => r.key === 'route53.associated_vpcs');
    expect(vpcs).toBeDefined();
    expect(vpcs!.level).toBe('recommended');
  });
});

describe('Secrets Manager Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_secretsmanager_secret', 'delete')!;

  it('has requirements defined', () => {
    expect(requirements).toBeDefined();
    expect(requirements.length).toBeGreaterThan(0);
  });

  it('blocks safe verdict without recovery window check', () => {
    const recoveryWindow = requirements.find(r => r.key === 'secretsmanager.recovery_window_days');
    expect(recoveryWindow).toBeDefined();
    expect(recoveryWindow!.blocksSafeVerdict).toBe(true);
    expect(recoveryWindow!.defaultAssumption).toBe(0); // Assume immediate deletion
  });

  it('blocks safe verdict without force_delete check', () => {
    const forceDelete = requirements.find(r => r.key === 'secretsmanager.force_delete');
    expect(forceDelete).toBeDefined();
    expect(forceDelete!.blocksSafeVerdict).toBe(true);
    expect(forceDelete!.defaultAssumption).toBe(true); // Assume force delete
  });

  it('recommends replica regions check', () => {
    const replicas = requirements.find(r => r.key === 'secretsmanager.replica_regions');
    expect(replicas).toBeDefined();
    expect(replicas!.level).toBe('recommended');
  });
});

describe('buildRequiredEvidence', () => {
  it('builds correct RequiredEvidence for S3 with partial evidence', async () => {
    const { buildRequiredEvidence } = await import('../src/core/index.js');
    const evidence = [
      { key: 's3.versioning', value: 'Enabled', present: true, description: '' },
      { key: 's3.object_lock', value: false, present: true, description: '' },
      { key: 's3.replication', value: true, present: true, description: '' },
      // s3.empty is missing
    ];
    const requirements = getEvidenceRequirements('aws_s3_bucket', 'delete')!;

    const result = buildRequiredEvidence('aws_s3_bucket', 'delete', evidence, requirements);

    expect(result.resourceType).toBe('aws_s3_bucket');
    expect(result.action).toBe('delete');
    expect(result.requirementsDefined).toBe(true);
    expect(result.sufficient).toBe(false); // s3.empty blocks
    expect(result.sufficiency).toBe('blocking_gaps');
    expect(result.summary.missingBlocking).toBe(1);
  });

  it('builds RequiredEvidence with sufficient=true when all blocking evidence present', async () => {
    const { buildRequiredEvidence } = await import('../src/core/index.js');
    const evidence = [
      { key: 's3.versioning', value: 'Enabled', present: true, description: '' },
      { key: 's3.empty', value: false, present: true, description: '' },
      { key: 's3.object_lock', value: false, present: true, description: '' },
      { key: 's3.replication', value: true, present: true, description: '' },
      { key: 's3.lifecycle', value: false, present: true, description: '' },
    ];
    const requirements = getEvidenceRequirements('aws_s3_bucket', 'delete')!;

    const result = buildRequiredEvidence('aws_s3_bucket', 'delete', evidence, requirements);

    expect(result.sufficient).toBe(true);
    expect(result.sufficiency).toBe('sufficient');
    expect(result.summary.satisfied).toBe(5);
    expect(result.summary.missingBlocking).toBe(0);
  });
});
