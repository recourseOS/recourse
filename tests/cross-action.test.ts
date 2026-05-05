import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ResourceChange, RecoverabilityResult, TerraformAction } from '../src/resources/types.js';
import { RecoverabilityTier } from '../src/resources/types.js';
import {
  buildCrossActionContext,
  detectCrossActionRisks,
  meetsConfidenceThreshold,
  type CrossActionContext,
} from '../src/analyzer/cross-action.js';
import {
  crossActionPatterns,
  backupAndProtectedDeleted,
  replicaAndPrimaryDeleted,
  protectionDisabledThenDeleted,
} from '../src/analyzer/cross-action-patterns.js';

const fixturesDir = join(__dirname, 'fixtures/plans/cross-action');

interface RawPlanFixture {
  resource_changes: Array<{
    address: string;
    type: string;
    name: string;
    provider_name: string;
    change: {
      actions: string[];
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      after_unknown: Record<string, unknown>;
    };
  }>;
}

function loadFixture(name: string): ResourceChange[] {
  const raw = readFileSync(join(fixturesDir, name), 'utf8');
  const plan = JSON.parse(raw) as RawPlanFixture;

  return plan.resource_changes.map(rc => ({
    address: rc.address,
    type: rc.type,
    name: rc.name,
    providerName: rc.provider_name,
    actions: rc.change.actions as TerraformAction[],
    before: rc.change.before,
    after: rc.change.after,
    afterUnknown: rc.change.after_unknown,
  }));
}

function buildTestContext(changes: ResourceChange[]): CrossActionContext {
  // Build a simple verdicts map (not used by current patterns, but required)
  const verdicts = new Map<string, RecoverabilityResult>();
  for (const change of changes) {
    verdicts.set(change.address, {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: 'recoverable-with-effort',
      reasoning: 'Test verdict',
    });
  }

  return buildCrossActionContext(changes, null, verdicts, null);
}

// -----------------------------------------------------------------------------
// Confidence Threshold Tests
// -----------------------------------------------------------------------------

describe('meetsConfidenceThreshold', () => {
  it('definite meets all thresholds', () => {
    expect(meetsConfidenceThreshold('definite', 'definite')).toBe(true);
    expect(meetsConfidenceThreshold('definite', 'probable')).toBe(true);
    expect(meetsConfidenceThreshold('definite', 'possible')).toBe(true);
  });

  it('probable meets probable and possible thresholds', () => {
    expect(meetsConfidenceThreshold('probable', 'definite')).toBe(false);
    expect(meetsConfidenceThreshold('probable', 'probable')).toBe(true);
    expect(meetsConfidenceThreshold('probable', 'possible')).toBe(true);
  });

  it('possible only meets possible threshold', () => {
    expect(meetsConfidenceThreshold('possible', 'definite')).toBe(false);
    expect(meetsConfidenceThreshold('possible', 'probable')).toBe(false);
    expect(meetsConfidenceThreshold('possible', 'possible')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Pattern 1: Backup and Protected Resource Both Deleted
// -----------------------------------------------------------------------------

describe('pattern: backup_and_protected_both_deleted', () => {
  it('detects dangerous: snapshot + instance both deleted', () => {
    const changes = loadFixture('backup-and-protected-dangerous.json');
    const context = buildTestContext(changes);
    const matches = backupAndProtectedDeleted.detect(context);

    expect(matches.length).toBe(1);
    expect(matches[0].relationship.type).toBe('backup');
    expect(matches[0].relationship.confidence).toBe('definite');
    expect(matches[0].affectedResources).toContain('aws_db_instance.production');
    expect(matches[0].affectedResources).toContain('aws_db_snapshot.production_final');
  });

  it('ignores benign: snapshot deleted but instance only updated', () => {
    const changes = loadFixture('backup-and-protected-benign.json');
    const context = buildTestContext(changes);
    const matches = backupAndProtectedDeleted.detect(context);

    expect(matches.length).toBe(0);
  });

  it('detects edge case: snapshot + instance deleted, but final snapshot will be created', () => {
    const changes = loadFixture('backup-and-protected-edge-final-snapshot.json');
    const context = buildTestContext(changes);
    const matches = backupAndProtectedDeleted.detect(context);

    // Pattern should still match - the relationship exists
    // The context should include skip_final_snapshot=false for downstream handling
    expect(matches.length).toBe(1);
    expect(matches[0].relationship.type).toBe('backup');
  });

  it('has correct pattern metadata', () => {
    expect(backupAndProtectedDeleted.id).toBe('backup_and_protected_both_deleted');
    expect(backupAndProtectedDeleted.minimumConfidence).toBe('probable');
    expect(backupAndProtectedDeleted.upgradeTier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });
});

// -----------------------------------------------------------------------------
// Pattern 2: Replica and Primary Both Deleted
// -----------------------------------------------------------------------------

describe('pattern: replica_and_primary_both_deleted', () => {
  it('detects dangerous: replica + primary both deleted', () => {
    const changes = loadFixture('replica-and-primary-dangerous.json');
    const context = buildTestContext(changes);
    const matches = replicaAndPrimaryDeleted.detect(context);

    expect(matches.length).toBe(1);
    expect(matches[0].relationship.type).toBe('replica');
    expect(matches[0].relationship.confidence).toBe('definite');
    expect(matches[0].affectedResources).toContain('aws_db_instance.primary');
    expect(matches[0].affectedResources).toContain('aws_db_instance.replica');
  });

  it('ignores benign: only replica deleted', () => {
    const changes = loadFixture('replica-and-primary-benign.json');
    const context = buildTestContext(changes);
    const matches = replicaAndPrimaryDeleted.detect(context);

    expect(matches.length).toBe(0);
  });

  it('has correct pattern metadata', () => {
    expect(replicaAndPrimaryDeleted.id).toBe('replica_and_primary_both_deleted');
    expect(replicaAndPrimaryDeleted.minimumConfidence).toBe('probable');
    expect(replicaAndPrimaryDeleted.upgradeTier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });
});

// -----------------------------------------------------------------------------
// Pattern 3: Protection Disabled Then Resource Deleted
// -----------------------------------------------------------------------------

describe('pattern: protection_disabled_then_deleted', () => {
  it('detects dangerous: protection disabled and resource deleted', () => {
    const changes = loadFixture('protection-disabled-then-deleted-dangerous.json');
    const context = buildTestContext(changes);
    const matches = protectionDisabledThenDeleted.detect(context);

    expect(matches.length).toBe(1);
    expect(matches[0].relationship.type).toBe('protection');
    expect(matches[0].relationship.confidence).toBe('definite');
    expect(matches[0].affectedResources).toContain('aws_db_instance.production');
  });

  it('ignores benign: protection disabled but not deleted', () => {
    const changes = loadFixture('protection-disabled-then-deleted-benign.json');
    const context = buildTestContext(changes);
    const matches = protectionDisabledThenDeleted.detect(context);

    expect(matches.length).toBe(0);
  });

  it('ignores edge case: deleted but protection was already disabled', () => {
    const changes = loadFixture('protection-disabled-then-deleted-edge-already-disabled.json');
    const context = buildTestContext(changes);
    const matches = protectionDisabledThenDeleted.detect(context);

    // Pattern should NOT match - protection wasn't changed in this plan
    expect(matches.length).toBe(0);
  });

  it('has correct pattern metadata', () => {
    expect(protectionDisabledThenDeleted.id).toBe('protection_disabled_then_deleted');
    expect(protectionDisabledThenDeleted.minimumConfidence).toBe('definite');
    expect(protectionDisabledThenDeleted.upgradeTier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });
});

// -----------------------------------------------------------------------------
// Integration: detectCrossActionRisks
// -----------------------------------------------------------------------------

describe('detectCrossActionRisks integration', () => {
  it('runs all patterns and returns aggregated risks', () => {
    const changes = loadFixture('backup-and-protected-dangerous.json');
    const context = buildTestContext(changes);
    const risks = detectCrossActionRisks(context, crossActionPatterns);

    expect(risks.length).toBe(1);
    expect(risks[0].pattern).toBe('backup_and_protected_both_deleted');
    expect(risks[0].upgradedTier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(risks[0].explanation).toContain('production_final');
    expect(risks[0].scopeWarning).toBeDefined();
  });

  it('returns empty array when no patterns match', () => {
    const changes = loadFixture('backup-and-protected-benign.json');
    const context = buildTestContext(changes);
    const risks = detectCrossActionRisks(context, crossActionPatterns);

    expect(risks.length).toBe(0);
  });

  it('includes relationship details in output', () => {
    const changes = loadFixture('replica-and-primary-dangerous.json');
    const context = buildTestContext(changes);
    const risks = detectCrossActionRisks(context, crossActionPatterns);

    expect(risks.length).toBe(1);
    expect(risks[0].relationship.type).toBe('replica');
    expect(risks[0].relationship.detectionMethod).toBe('explicit_reference');
    expect(risks[0].relationship.confidence).toBe('definite');
  });
});

// -----------------------------------------------------------------------------
// Pattern Registry
// -----------------------------------------------------------------------------

describe('crossActionPatterns registry', () => {
  it('contains all three initial patterns', () => {
    expect(crossActionPatterns.length).toBe(3);
    expect(crossActionPatterns.map(p => p.id)).toEqual([
      'backup_and_protected_both_deleted',
      'replica_and_primary_both_deleted',
      'protection_disabled_then_deleted',
    ]);
  });

  it('all patterns have required fields', () => {
    for (const pattern of crossActionPatterns) {
      expect(pattern.id).toBeDefined();
      expect(pattern.name).toBeDefined();
      expect(pattern.detect).toBeDefined();
      expect(pattern.upgradeTier).toBeDefined();
      expect(pattern.minimumConfidence).toBeDefined();
      expect(pattern.explanationTemplate).toBeDefined();
    }
  });
});
