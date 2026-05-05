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

export const gcpSecretsHandler: ResourceHandler = {
  resourceTypes: [
    'google_secret_manager_secret',
    'google_secret_manager_secret_version',
    'google_secret_manager_secret_iam_binding',
    'google_secret_manager_secret_iam_member',
    'google_secret_manager_secret_iam_policy',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'secret.version_count',
        level: 'required',
        description: 'Number of secret versions that will be destroyed',
        blocksSafeVerdict: true,
        defaultAssumption: 0,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'secret.replication',
        level: 'recommended',
        description: 'Secret replication configuration',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'secret.external_backup',
        level: 'recommended',
        description: 'Whether secret value is backed up externally',
        blocksSafeVerdict: false,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('GCP Secret Manager configuration update is reversible');

    if (change.type.includes('_iam_')) {
      return reversible('Secret Manager IAM binding/member/policy is config-only and can be reapplied');
    }

    if (change.type === 'google_secret_manager_secret_version') {
      return unrecoverable('Secret version destruction permanently removes the payload; secret data cannot be recovered after destroy');
    }

    if (change.type === 'google_secret_manager_secret') {
      return unrecoverable('Secret deletion destroys associated versions and credential material unless an out-of-band backup exists');
    }

    return recoverableWithEffort('Secret Manager resource can be recreated, but payload recovery needs separate evidence');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const secretId = (resource.values.id ?? resource.values.secret_id ?? resource.values.name) as string;
    if (!secretId) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(secretId))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'secret_id',
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
