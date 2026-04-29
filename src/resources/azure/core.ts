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
