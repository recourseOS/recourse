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

export const azureIamHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_role_assignment',
    'azurerm_role_definition',
    'azuread_application',
    'azuread_service_principal',
    'azuread_service_principal_password',
  ],

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Azure IAM configuration update is reversible');

    if (change.type === 'azuread_service_principal_password') {
      return {
        tier: RecoverabilityTier.UNRECOVERABLE,
        label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
        reasoning: 'Service principal credential deletion is permanent; secret material cannot be recovered',
      };
    }

    if (change.type === 'azuread_application' || change.type === 'azuread_service_principal') {
      return {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Azure AD identity can be recreated, but object IDs and integrations may require repair',
      };
    }

    return reversible('Azure role assignment/definition is config-only and can be reapplied');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const principalId = resource.values.principal_id as string || resource.values.object_id as string;
    if (!principalId) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(principalId))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'principal_id',
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
