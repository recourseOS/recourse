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

export const gcpCoreHandler: ResourceHandler = {
  resourceTypes: [
    'google_dns_record_set',
    'google_compute_disk',
    'google_compute_snapshot',
    'google_kms_crypto_key',
    'google_kms_key_ring',
    'google_kms_crypto_key_iam_binding',
    'google_kms_crypto_key_iam_member',
    'google_container_cluster',
    'google_container_node_pool',
  ],

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('GCP configuration update is reversible');

    if (change.type === 'google_dns_record_set') {
      return reversible('DNS record is config-only and can be reapplied');
    }
    if (change.type === 'google_compute_snapshot') {
      return unrecoverable('Snapshot deletion is permanent; this may remove a recovery point');
    }
    if (change.type === 'google_compute_disk') {
      return unrecoverable('Persistent disk deletion can permanently destroy disk data without snapshot evidence');
    }
    if (change.type === 'google_kms_crypto_key' || change.type === 'google_kms_key_ring') {
      return recoverableWithEffort('Cloud KMS key material is not immediately destroyed by Terraform resource removal, but dependents need review');
    }
    if (change.type.includes('_iam_')) {
      return reversible('Cloud KMS IAM binding is config-only and can be reapplied');
    }
    if (change.type === 'google_container_node_pool') {
      return recoverableWithEffort('GKE node pool can be recreated; running workloads may be disrupted');
    }
    if (change.type === 'google_container_cluster') {
      return recoverableWithEffort('GKE cluster can be recreated, but control-plane state and workloads require coordinated restore');
    }

    return recoverableWithEffort('GCP resource can likely be recreated with effort');
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
