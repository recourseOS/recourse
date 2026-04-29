import { describe, expect, it } from 'vitest';
import {
  buildSemanticResourceProfile,
  classifyUnknownResourceSemantically,
  extractFeatures,
  getRecoverabilityDual,
} from '../src/classifier/index.js';
import {
  RecoverabilityTier,
  type ResourceChange,
} from '../src/resources/types.js';

describe('semantic unknown-resource classifier', () => {
  it('transfers versioning semantics to unknown storage resources', () => {
    const result = getRecoverabilityDual(change('acme_storage_bucket', {
      force_destroy: true,
      versioning: [{ enabled: true }],
    }), null);

    expect(result.source).toBe('classifier');
    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(result.reasoning).toContain('versioning enabled');
  });

  it('treats forced unknown storage deletion without retention as unrecoverable', () => {
    const result = getRecoverabilityDual(change('acme_storage_bucket', {
      force_destroy: true,
      versioning: [{ enabled: false }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('transfers deletion protection semantics to unknown database resources', () => {
    const result = getRecoverabilityDual(change('example_sql_database_instance', {
      deletion_protection: true,
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('maps provider-specific backup retention attributes to backup recovery', () => {
    const result = getRecoverabilityDual(change('example_postgres_database', {
      short_term_retention_policy: [{ retention_days: 14 }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('recognizes recovery and deletion windows as equivalent safety evidence', () => {
    const recoveryWindow = getRecoverabilityDual(change('example_secret_value', {
      recovery_window_in_days: 7,
    }), null);
    const deletionWindow = getRecoverabilityDual(change('example_secret_value', {
      deletion_window_in_days: 7,
    }), null);

    expect(recoveryWindow.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
    expect(deletionWindow.tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
  });

  it('normalizes provider-specific storage soft-delete evidence', () => {
    const result = getRecoverabilityDual(change('example_storage_container', {
      delete_retention_policy: [{ enabled: true, days: 7 }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(result.reasoning).toContain('storage retention/backup evidence');
  });

  it('builds a BitNet-ready semantic profile before scoring unknown resources', () => {
    const resource = change('future_cloud_sql_database', {
      backup_policy: [{ enabled: true, retained_backups: 7 }],
      deletion_protection: false,
    });
    const features = extractFeatures(resource, null);
    const profile = buildSemanticResourceProfile(resource, features);
    const result = classifyUnknownResourceSemantically(resource, null, features);

    expect(profile.kind).toBe('database');
    expect(profile.hasBackup).toBe(true);
    expect(profile.hasDeletionProtection).toBe(false);
    expect(profile.evidence).toContain('backup, snapshot, retention, or PITR evidence');
    expect(result.model).toBe('semantic-unknown@bitnet-contract-v1');
    expect(result.tier).toBe('recoverable-from-backup');
  });

  it('abstains on unknown destructive resources without enough semantic evidence', () => {
    const result = getRecoverabilityDual(change('example_custom_resource', {
      name: 'prod',
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.reasoning).toContain('unknown resource semantics');
  });
});

function change(type: string, before: Record<string, unknown>): ResourceChange {
  return {
    address: `${type}.example`,
    type,
    name: 'example',
    providerName: 'registry.terraform.io/example/example',
    actions: ['delete'],
    before,
    after: null,
    afterUnknown: {},
  };
}
