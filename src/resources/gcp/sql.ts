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

export const gcpSqlHandler: ResourceHandler = {
  resourceTypes: [
    'google_sql_database_instance',
    'google_sql_database',
    'google_sql_user',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'cloudsql.deletion_protection',
        level: 'required',
        description: 'Whether deletion protection is enabled on the instance',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cloudsql.automated_backups',
        level: 'required',
        description: 'Whether automated backups are enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cloudsql.point_in_time_recovery',
        level: 'required',
        description: 'Whether point-in-time recovery (PITR) is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'cloudsql.replicas',
        level: 'recommended',
        description: 'Read replicas that depend on this instance',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Cloud SQL configuration update is reversible');

    if (change.type === 'google_sql_database' || change.type === 'google_sql_user') {
      return recoverableWithEffort('Cloud SQL child resource can be recreated if the instance remains available');
    }

    const values = change.before ?? {};
    if (values.deletion_protection === true) {
      return {
        tier: RecoverabilityTier.REVERSIBLE,
        label: 'blocked',
        reasoning: 'APPLY WILL FAIL: deletion_protection=true; disable protection first to delete',
      };
    }

    const backupsEnabled = nestedBool(values, ['settings', 'backup_configuration', 'enabled']) === true;
    const pitrEnabled = nestedBool(values, ['settings', 'backup_configuration', 'point_in_time_recovery_enabled']) === true;
    if (backupsEnabled || pitrEnabled) {
      return {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: pitrEnabled
          ? 'Cloud SQL PITR is enabled; restore is possible from backups'
          : 'Cloud SQL automated backups are enabled; restore is possible from backup',
      };
    }

    return {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'Cloud SQL instance deletion without deletion protection or backup evidence can permanently destroy data',
    };
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const instanceName = resource.values.name as string;
    if (!instanceName) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(instanceName))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'instance',
      }));
  },
};

function nestedBool(values: Record<string, unknown>, path: string[]): boolean | undefined {
  let current: unknown = values;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'boolean' ? current : undefined;
}

function reversible(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning,
  };
}

function recoverableWithEffort(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning,
  };
}
