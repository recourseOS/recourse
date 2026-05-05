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

export const elasticacheHandler: ResourceHandler = {
  resourceTypes: [
    'aws_elasticache_cluster',
    'aws_elasticache_replication_group',
    'aws_elasticache_global_replication_group',
    'aws_elasticache_serverless_cache',
    'aws_elasticache_snapshot',
    'aws_elasticache_parameter_group',
    'aws_elasticache_subnet_group',
    'aws_elasticache_user',
    'aws_elasticache_user_group',
    'aws_elasticache_user_group_association',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'elasticache.snapshot_retention_limit',
        level: 'required',
        description: 'Number of days automated snapshots are retained',
        blocksSafeVerdict: true,
        defaultAssumption: 0,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'elasticache.final_snapshot_identifier',
        level: 'required',
        description: 'Identifier for final snapshot on deletion',
        blocksSafeVerdict: true,
        defaultAssumption: null,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'elasticache.engine',
        level: 'recommended',
        description: 'Cache engine type (redis, valkey, memcached)',
        blocksSafeVerdict: false,
        defaultAssumption: 'redis',
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'elasticache.replication_group_members',
        level: 'recommended',
        description: 'Member nodes in this replication group',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 300,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('ElastiCache configuration update is reversible');

    if (change.type === 'aws_elasticache_snapshot') {
      return unrecoverable('ElastiCache snapshot deletion is permanent; this may remove the only recovery point');
    }

    if (isCacheResource(change.type)) {
      return classifyCacheDelete(change);
    }

    if (change.type === 'aws_elasticache_user_group_association') {
      return reversible('ElastiCache user-group association is a relationship resource and can be reapplied');
    }

    return reversible('ElastiCache supporting configuration can be recreated from Terraform');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.cluster_id ?? resource.values.replication_group_id) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'elasticache_id',
      }));
  },
};

function classifyCacheDelete(change: ResourceChange): RecoverabilityResult {
  const values = change.before ?? {};
  const engine = stringValue(values.engine).toLowerCase();
  const finalSnapshotIdentifier = stringValue(values.final_snapshot_identifier);
  const snapshotRetentionLimit = numberValue(values.snapshot_retention_limit);

  if (finalSnapshotIdentifier) {
    return recoverableFromBackup(`Final ElastiCache snapshot will be created: ${finalSnapshotIdentifier}`);
  }

  if (snapshotRetentionLimit !== null && snapshotRetentionLimit > 0) {
    return recoverableFromBackup(`ElastiCache automated snapshots retained for ${snapshotRetentionLimit} days`);
  }

  if (engine === 'memcached') {
    return recoverableWithEffort('Memcached cache nodes are ephemeral; service can be recreated but cache contents will be cold');
  }

  return unrecoverable('ElastiCache Redis/Valkey deletion without snapshot retention or final snapshot evidence can permanently lose cache data');
}

function isCacheResource(type: string): boolean {
  return type === 'aws_elasticache_cluster' ||
    type === 'aws_elasticache_replication_group' ||
    type === 'aws_elasticache_global_replication_group' ||
    type === 'aws_elasticache_serverless_cache';
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
