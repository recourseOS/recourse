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

export const neptuneHandler: ResourceHandler = {
  resourceTypes: [
    'aws_neptune_cluster',
    'aws_neptune_cluster_instance',
    'aws_neptune_cluster_snapshot',
    'aws_neptune_cluster_parameter_group',
    'aws_neptune_parameter_group',
    'aws_neptune_subnet_group',
    'aws_neptune_event_subscription',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'neptune.deletion_protection',
        level: 'required',
        description: 'Whether deletion protection is enabled on the cluster',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'neptune.backup_retention_period',
        level: 'required',
        description: 'Automated backup retention period in days',
        blocksSafeVerdict: true,
        defaultAssumption: 1,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'neptune.skip_final_snapshot',
        level: 'required',
        description: 'Whether final snapshot will be skipped on deletion',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'neptune.cluster_instances',
        level: 'recommended',
        description: 'Active instances in this Neptune cluster',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 300,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Neptune configuration update is reversible');

    if (change.type === 'aws_neptune_cluster') {
      return classifyClusterDelete(change);
    }

    if (change.type === 'aws_neptune_cluster_instance') {
      return recoverableWithEffort('Neptune cluster instance can be recreated if the cluster and data remain available');
    }

    if (change.type === 'aws_neptune_cluster_snapshot') {
      return unrecoverable('Neptune cluster snapshot deletion is permanent; this may remove a recovery point');
    }

    return reversible('Neptune supporting configuration can be recreated from Terraform');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.cluster_identifier ?? resource.values.arn) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'neptune_cluster_id',
      }));
  },
};

function classifyClusterDelete(change: ResourceChange): RecoverabilityResult {
  const values = change.before ?? {};

  if (values.deletion_protection === true) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: 'blocked',
      reasoning: 'APPLY WILL FAIL: deletion_protection=true; disable protection first to delete',
    };
  }

  const skipFinalSnapshot = values.skip_final_snapshot === true;
  const finalSnapshotIdentifier = stringValue(values.final_snapshot_identifier);
  const backupRetentionPeriod = numberValue(values.backup_retention_period);

  if (finalSnapshotIdentifier) {
    return recoverableFromBackup(`Final Neptune snapshot will be created: ${finalSnapshotIdentifier}`);
  }

  if (backupRetentionPeriod !== null && backupRetentionPeriod > 0) {
    return recoverableFromBackup(`Neptune automated backups retained for ${backupRetentionPeriod} days`);
  }

  if (skipFinalSnapshot) {
    return unrecoverable('Neptune cluster deletion skips final snapshot and has no backup retention evidence; graph data will be lost');
  }

  return recoverableFromBackup('Final Neptune snapshot will be created by default');
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function recoverableWithEffort(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
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

function unrecoverable(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning,
  };
}
