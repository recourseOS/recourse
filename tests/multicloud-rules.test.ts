import { describe, expect, it } from 'vitest';
import { getRecoverability, getSupportedResourceTypes } from '../src/resources/index.js';
import {
  RecoverabilityTier,
  type ResourceChange,
} from '../src/resources/types.js';

describe('multi-cloud deterministic recoverability rules', () => {
  it('classifies versioned GCS bucket deletion as recoverable from backup', () => {
    const result = getRecoverability(change('google_storage_bucket', {
      name: 'prod-data',
      force_destroy: true,
      versioning: [{ enabled: true }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(result.source).not.toBe('classifier');
  });

  it('classifies force-destroy GCS bucket without versioning as unrecoverable', () => {
    const result = getRecoverability(change('google_storage_bucket', {
      name: 'prod-data',
      force_destroy: true,
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('classifies protected Cloud SQL deletion as blocked', () => {
    const result = getRecoverability(change('google_sql_database_instance', {
      name: 'prod-sql',
      deletion_protection: true,
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(result.label).toBe('blocked');
  });

  it('classifies Cloud SQL with PITR as recoverable from backup', () => {
    const result = getRecoverability(change('google_sql_database_instance', {
      name: 'prod-sql',
      deletion_protection: false,
      settings: [{
        backup_configuration: [{
          enabled: true,
          point_in_time_recovery_enabled: true,
        }],
      }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies GCP and Azure IAM bindings as reversible', () => {
    expect(getRecoverability(change('google_project_iam_binding', {
      role: 'roles/viewer',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('azurerm_role_assignment', {
      role_definition_name: 'Reader',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies Azure Storage soft delete/versioning as recoverable from backup', () => {
    const result = getRecoverability(change('azurerm_storage_account', {
      name: 'prodstorage',
      blob_properties: [{
        versioning_enabled: true,
        delete_retention_policy: [{ enabled: true, days: 14 }],
      }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies Azure Storage without retention as unrecoverable', () => {
    const result = getRecoverability(change('azurerm_storage_account', {
      name: 'prodstorage',
      blob_properties: [{
        versioning_enabled: false,
        delete_retention_policy: [{ enabled: false }],
      }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('classifies Azure database with backup retention as recoverable from backup', () => {
    const result = getRecoverability(change('azurerm_mssql_database', {
      name: 'prod-db',
      short_term_retention_policy: [{ retention_days: 7 }],
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies cloud provider secrets and credential material as unrecoverable', () => {
    expect(getRecoverability(change('google_service_account_key', {
      service_account_id: 'svc@example.iam.gserviceaccount.com',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('azuread_service_principal_password', {
      service_principal_id: 'spn-123',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('registers first-class GCP and Azure resource handlers', () => {
    const types = getSupportedResourceTypes();
    expect(types).toContain('google_storage_bucket');
    expect(types).toContain('google_sql_database_instance');
    expect(types).toContain('azurerm_storage_account');
    expect(types).toContain('azurerm_mssql_database');
  });
});

function change(type: string, before: Record<string, unknown>): ResourceChange {
  return {
    address: `${type}.example`,
    type,
    name: 'example',
    providerName: providerFor(type),
    actions: ['delete'],
    before,
    after: null,
    afterUnknown: {},
  };
}

function providerFor(type: string): string {
  if (type.startsWith('google_')) return 'registry.terraform.io/hashicorp/google';
  if (type.startsWith('azurerm_')) return 'registry.terraform.io/hashicorp/azurerm';
  if (type.startsWith('azuread_')) return 'registry.terraform.io/hashicorp/azuread';
  return 'registry.terraform.io/hashicorp/unknown';
}
