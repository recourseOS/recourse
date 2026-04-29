import { describe, expect, it } from 'vitest';
import { getRecoverability, getSupportedResourceTypes } from '../src/resources/index.js';
import {
  RecoverabilityTier,
  type ResourceChange,
  type TerraformState,
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
    expect(getRecoverability(change('aws_secretsmanager_secret', {
      name: 'prod/db/password',
      recovery_window_in_days: 0,
      force_delete_without_recovery: true,
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('aws_secretsmanager_secret_version', {
      secret_id: 'prod/db/password',
      secret_string: 'redacted',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('google_secret_manager_secret', {
      secret_id: 'prod-db-password',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('google_secret_manager_secret_version', {
      secret: 'prod-db-password',
      secret_data: 'redacted',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('google_service_account_key', {
      service_account_id: 'svc@example.iam.gserviceaccount.com',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('azuread_service_principal_password', {
      service_principal_id: 'spn-123',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('classifies secrets with explicit recovery windows as recoverable with effort', () => {
    expect(getRecoverability(change('aws_secretsmanager_secret', {
      name: 'prod/db/password',
      recovery_window_in_days: 30,
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
    expect(getRecoverability(change('azurerm_key_vault_secret', {
      name: 'prod-db-password',
      recovery_level: 'Recoverable+Purgeable',
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
  });

  it('escalates Azure Key Vault secret deletion without recovery evidence', () => {
    const result = getRecoverability(change('azurerm_key_vault_secret', {
      name: 'prod-db-password',
      key_vault_id: '/subscriptions/000/resourceGroups/prod/providers/Microsoft.KeyVault/vaults/prod-kv',
    }), null);

    expect(result.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
  });

  it('classifies secret IAM and policy attachments as reversible', () => {
    expect(getRecoverability(change('aws_secretsmanager_secret_policy', {
      secret_arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db/password',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('google_secret_manager_secret_iam_binding', {
      secret_id: 'prod-db-password',
      role: 'roles/secretmanager.secretAccessor',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('azurerm_key_vault_access_policy', {
      key_vault_id: '/subscriptions/000/resourceGroups/prod/providers/Microsoft.KeyVault/vaults/prod-kv',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies ElastiCache Redis deletes by snapshot evidence', () => {
    expect(getRecoverability(change('aws_elasticache_cluster', {
      cluster_id: 'prod-cache',
      engine: 'redis',
      snapshot_retention_limit: 0,
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('aws_elasticache_replication_group', {
      replication_group_id: 'prod-cache-rg',
      engine: 'redis',
      snapshot_retention_limit: 7,
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(getRecoverability(change('aws_elasticache_cluster', {
      cluster_id: 'prod-cache',
      engine: 'redis',
      final_snapshot_identifier: 'prod-cache-final',
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies Memcached cache deletion as recoverable with effort', () => {
    expect(getRecoverability(change('aws_elasticache_cluster', {
      cluster_id: 'prod-memcached',
      engine: 'memcached',
      snapshot_retention_limit: 0,
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
  });

  it('classifies ElastiCache snapshots as unrecoverable and config resources as reversible', () => {
    expect(getRecoverability(change('aws_elasticache_snapshot', {
      name: 'prod-cache-snapshot',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('aws_elasticache_parameter_group', {
      name: 'prod-cache-params',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('aws_elasticache_user_group_association', {
      user_group_id: 'prod-cache-users',
      user_id: 'app',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies Neptune clusters by deletion protection and backup evidence', () => {
    expect(getRecoverability(change('aws_neptune_cluster', {
      cluster_identifier: 'prod-graph',
      deletion_protection: true,
      skip_final_snapshot: true,
      backup_retention_period: 0,
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('aws_neptune_cluster', {
      cluster_identifier: 'prod-graph',
      deletion_protection: false,
      skip_final_snapshot: true,
      backup_retention_period: 0,
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('aws_neptune_cluster', {
      cluster_identifier: 'prod-graph',
      deletion_protection: false,
      skip_final_snapshot: true,
      backup_retention_period: 7,
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies Neptune snapshots as unrecoverable and config resources as reversible', () => {
    expect(getRecoverability(change('aws_neptune_cluster_snapshot', {
      db_cluster_snapshot_identifier: 'prod-graph-snapshot',
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('aws_neptune_cluster_parameter_group', {
      name: 'prod-graph-params',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies EFS file system deletion by backup policy evidence', () => {
    const state: TerraformState = {
      formatVersion: '1.0',
      terraformVersion: '1.6.0',
      resources: [
        {
          address: 'aws_efs_backup_policy.prod',
          type: 'aws_efs_backup_policy',
          name: 'prod',
          providerName: 'registry.terraform.io/hashicorp/aws',
          values: {
            file_system_id: 'fs-123',
            backup_policy: [{ status: 'ENABLED' }],
          },
          dependsOn: [],
        },
      ],
    };

    expect(getRecoverability(change('aws_efs_file_system', {
      id: 'fs-123',
      encrypted: true,
    }), state).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(getRecoverability(change('aws_efs_file_system', {
      id: 'fs-456',
      encrypted: true,
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
  });

  it('classifies EFS supporting resources conservatively', () => {
    expect(getRecoverability(change('aws_efs_mount_target', {
      file_system_id: 'fs-123',
      subnet_id: 'subnet-123',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('aws_efs_replication_configuration', {
      source_file_system_id: 'fs-123',
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_WITH_EFFORT);
  });

  it('classifies BigQuery datasets and tables by destructive flags and time travel evidence', () => {
    expect(getRecoverability(change('google_bigquery_dataset', {
      dataset_id: 'prod_analytics',
      delete_contents_on_destroy: true,
    }), null).tier).toBe(RecoverabilityTier.UNRECOVERABLE);
    expect(getRecoverability(change('google_bigquery_dataset', {
      dataset_id: 'prod_analytics',
      max_time_travel_hours: 168,
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(getRecoverability(change('google_bigquery_table', {
      dataset_id: 'prod_analytics',
      table_id: 'events',
      deletion_protection: true,
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('google_bigquery_table', {
      dataset_id: 'prod_analytics',
      table_id: 'events',
    }), null).tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
  });

  it('classifies BigQuery IAM and routines as reversible', () => {
    expect(getRecoverability(change('google_bigquery_dataset_iam_binding', {
      dataset_id: 'prod_analytics',
      role: 'roles/bigquery.dataViewer',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
    expect(getRecoverability(change('google_bigquery_routine', {
      dataset_id: 'prod_analytics',
      routine_id: 'normalize_event',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('classifies Cosmos DB deletes by backup policy evidence', () => {
    expect(getRecoverability(change('azurerm_cosmosdb_account', {
      name: 'prod-cosmos',
      backup: [{ type: 'Continuous' }],
    }), null).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
    expect(getRecoverability(change('azurerm_cosmosdb_account', {
      name: 'prod-cosmos',
    }), null).tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(getRecoverability(change('azurerm_cosmosdb_sql_container', {
      name: 'events',
      account_name: 'prod-cosmos',
    }), {
      formatVersion: '1.0',
      terraformVersion: '1.6.0',
      resources: [
        {
          address: 'azurerm_cosmosdb_account.prod',
          type: 'azurerm_cosmosdb_account',
          name: 'prod',
          providerName: 'registry.terraform.io/hashicorp/azurerm',
          values: {
            name: 'prod-cosmos',
            backup: [{ type: 'Periodic', retention_in_hours: 8 }],
          },
          dependsOn: [],
        },
      ],
    }).tier).toBe(RecoverabilityTier.RECOVERABLE_FROM_BACKUP);
  });

  it('classifies Cosmos DB SQL role resources as reversible', () => {
    expect(getRecoverability(change('azurerm_cosmosdb_sql_role_assignment', {
      account_name: 'prod-cosmos',
      role_definition_id: 'reader',
    }), null).tier).toBe(RecoverabilityTier.REVERSIBLE);
  });

  it('registers first-class GCP and Azure resource handlers', () => {
    const types = getSupportedResourceTypes();
    expect(types).toContain('aws_efs_file_system');
    expect(types).toContain('aws_efs_backup_policy');
    expect(types).toContain('aws_elasticache_cluster');
    expect(types).toContain('aws_elasticache_replication_group');
    expect(types).toContain('aws_neptune_cluster');
    expect(types).toContain('aws_neptune_cluster_snapshot');
    expect(types).toContain('aws_secretsmanager_secret');
    expect(types).toContain('aws_secretsmanager_secret_version');
    expect(types).toContain('google_storage_bucket');
    expect(types).toContain('google_sql_database_instance');
    expect(types).toContain('google_secret_manager_secret');
    expect(types).toContain('google_secret_manager_secret_version');
    expect(types).toContain('google_bigquery_dataset');
    expect(types).toContain('google_bigquery_table');
    expect(types).toContain('azurerm_storage_account');
    expect(types).toContain('azurerm_mssql_database');
    expect(types).toContain('azurerm_key_vault_secret');
    expect(types).toContain('azurerm_cosmosdb_account');
    expect(types).toContain('azurerm_cosmosdb_sql_container');
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
  if (type.startsWith('aws_')) return 'registry.terraform.io/hashicorp/aws';
  if (type.startsWith('google_')) return 'registry.terraform.io/hashicorp/google';
  if (type.startsWith('azurerm_')) return 'registry.terraform.io/hashicorp/azurerm';
  if (type.startsWith('azuread_')) return 'registry.terraform.io/hashicorp/azuread';
  return 'registry.terraform.io/hashicorp/unknown';
}
