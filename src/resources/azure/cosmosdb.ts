import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
  type ResourceChange,
  type ResourceDependency,
  type ResourceHandler,
  type StateResource,
  type TerraformState,
} from '../types.js';
import type { EvidenceRequirement } from '../../core/state-schema.js';

export const azureCosmosDbHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_cosmosdb_account',
    'azurerm_cosmosdb_sql_database',
    'azurerm_cosmosdb_sql_container',
    'azurerm_cosmosdb_mongo_database',
    'azurerm_cosmosdb_mongo_collection',
    'azurerm_cosmosdb_cassandra_keyspace',
    'azurerm_cosmosdb_cassandra_table',
    'azurerm_cosmosdb_gremlin_database',
    'azurerm_cosmosdb_gremlin_graph',
    'azurerm_cosmosdb_table',
    'azurerm_cosmosdb_sql_role_assignment',
    'azurerm_cosmosdb_sql_role_definition',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'cosmosdb.backup_type',
        level: 'required',
        description: 'Backup type (Continuous or Periodic)',
        blocksSafeVerdict: true,
        defaultAssumption: 'Periodic',
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cosmosdb.backup_retention_hours',
        level: 'required',
        description: 'Backup retention period in hours',
        blocksSafeVerdict: true,
        defaultAssumption: 8,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cosmosdb.continuous_backup_tier',
        level: 'recommended',
        description: 'Continuous backup tier (7 days or 30 days)',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cosmosdb.geo_replication',
        level: 'recommended',
        description: 'Geo-replication regions for this account',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Cosmos DB configuration update is reversible');

    if (change.type === 'azurerm_cosmosdb_sql_role_assignment' || change.type === 'azurerm_cosmosdb_sql_role_definition') {
      return reversible('Cosmos DB SQL role resource is config-only and can be reapplied');
    }

    const backup = backupEvidence(change.before ?? {}, state);
    if (backup) return backup;

    if (change.type === 'azurerm_cosmosdb_account') {
      return {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'Cosmos DB account deletion lacks backup policy evidence in the plan; recovery posture requires review',
      };
    }

    return {
      tier: RecoverabilityTier.NEEDS_REVIEW,
      label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
      reasoning: 'Cosmos DB data-plane resource deletion lacks parent account backup evidence in the plan; recovery posture requires review',
    };
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.account_name ?? resource.values.name) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'cosmosdb_account',
      }));
  },
};

function backupEvidence(values: Record<string, unknown>, state: TerraformState | null): RecoverabilityResult | null {
  const policy = backupPolicy(values) ?? accountBackupPolicyFromState(values, state);
  if (!policy) return null;

  const type = stringValue(policy.type).toLowerCase();
  const retentionHours = numberValue(policy.retention_in_hours);
  const retentionMinutes = numberValue(policy.retention_in_minutes);

  if (type === 'continuous') {
    return recoverableFromBackup('Cosmos DB continuous backup is enabled; point-in-time restore may be available');
  }

  if (type === 'periodic' || retentionHours || retentionMinutes) {
    const retention = retentionHours
      ? `${retentionHours} hours`
      : retentionMinutes
      ? `${retentionMinutes} minutes`
      : 'configured retention';
    return recoverableFromBackup(`Cosmos DB periodic backup is configured with ${retention}`);
  }

  return null;
}

function accountBackupPolicyFromState(values: Record<string, unknown>, state: TerraformState | null): Record<string, unknown> | null {
  if (!state) return null;
  const accountName = stringValue(values.account_name);
  if (!accountName) return null;

  const account = state.resources.find(resource =>
    resource.type === 'azurerm_cosmosdb_account' && resource.values.name === accountName
  );
  return account ? backupPolicy(account.values) : null;
}

function backupPolicy(values: Record<string, unknown>): Record<string, unknown> | null {
  const raw = values.backup ?? values.backup_policy;
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
    return raw[0] as Record<string, unknown>;
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function reversible(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning,
  };
}

function recoverableFromBackup(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
    reasoning,
  };
}
