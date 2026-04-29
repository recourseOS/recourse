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

export const gcpIamHandler: ResourceHandler = {
  resourceTypes: [
    'google_project_iam_binding',
    'google_project_iam_member',
    'google_project_iam_policy',
    'google_service_account',
    'google_service_account_iam_binding',
    'google_service_account_iam_member',
    'google_service_account_key',
  ],

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('GCP IAM configuration update is reversible');

    if (change.type === 'google_service_account_key') {
      return {
        tier: RecoverabilityTier.UNRECOVERABLE,
        label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
        reasoning: 'Service account key deletion is permanent; private key material cannot be recovered',
      };
    }

    if (change.type === 'google_service_account') {
      return {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Service account can be recreated, but identity email and bindings may require coordinated repair',
      };
    }

    return reversible('GCP IAM binding/member/policy is config-only and can be reapplied');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const email = resource.values.email as string;
    if (!email) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(email))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'service_account',
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
