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

export const azureSqlHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_mssql_database',
    'azurerm_sql_database',
    'azurerm_postgresql_flexible_server',
    'azurerm_mysql_flexible_server',
    'azurerm_mariadb_server',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'azure_sql.backup_retention_days',
        level: 'required',
        description: 'Short-term backup retention period in days',
        blocksSafeVerdict: true,
        defaultAssumption: 7,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_sql.long_term_retention',
        level: 'recommended',
        description: 'Long-term backup retention policy configuration',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_sql.geo_backup_enabled',
        level: 'recommended',
        description: 'Whether geo-redundant backups are enabled',
        blocksSafeVerdict: false,
        defaultAssumption: true,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_sql.replicas',
        level: 'recommended',
        description: 'Read replicas or geo-replicas for this database',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Azure database configuration update is reversible');

    const values = change.before ?? {};
    const backupRetentionDays =
      numberValue(values.short_term_retention_days)
      ?? nestedNumber(values, ['short_term_retention_policy', 'retention_days'])
      ?? numberValue(values.backup_retention_days);

    if (backupRetentionDays && backupRetentionDays > 0) {
      return {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: `Azure database backups are retained for ${backupRetentionDays} days`,
      };
    }

    return {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'Azure database deletion without backup retention evidence can permanently destroy data',
    };
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const name = resource.values.name as string;
    if (!name) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(name))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'database',
      }));
  },
};

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function nestedNumber(values: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = values;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return numberValue(current);
}

function reversible(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning,
  };
}
