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

export const azureCoreHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_dns_a_record',
    'azurerm_dns_cname_record',
    'azurerm_private_dns_a_record',
    'azurerm_managed_disk',
    'azurerm_snapshot',
    'azurerm_kubernetes_cluster',
    'azurerm_kubernetes_cluster_node_pool',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'disk.snapshots',
        level: 'required',
        description: 'Existing snapshots of this managed disk',
        blocksSafeVerdict: true,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'disk.incremental_snapshots',
        level: 'recommended',
        description: 'Incremental snapshots for point-in-time recovery',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'aks.workloads',
        level: 'recommended',
        description: 'Running workloads on this AKS cluster or node pool',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 300,
      },
      {
        key: 'aks.persistent_volumes',
        level: 'recommended',
        description: 'Persistent volumes attached to this cluster',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Azure configuration update is reversible');

    if (change.type.includes('dns_')) {
      return reversible('DNS record is config-only and can be reapplied');
    }
    if (change.type === 'azurerm_snapshot') {
      return unrecoverable('Snapshot deletion is permanent; this may remove a recovery point');
    }
    if (change.type === 'azurerm_managed_disk') {
      return unrecoverable('Managed disk deletion can permanently destroy disk data without snapshot evidence');
    }
    if (change.type === 'azurerm_kubernetes_cluster_node_pool') {
      return recoverableWithEffort('AKS node pool can be recreated; running workloads may be disrupted');
    }
    if (change.type === 'azurerm_kubernetes_cluster') {
      return recoverableWithEffort('AKS cluster can be recreated, but control-plane state and workloads require coordinated restore');
    }

    return recoverableWithEffort('Azure resource can likely be recreated with effort');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.name) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'id',
      }));
  },
};

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

function unrecoverable(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning,
  };
}
