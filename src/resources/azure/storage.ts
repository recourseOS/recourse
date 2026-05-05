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

export const azureStorageHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_storage_account',
    'azurerm_storage_container',
    'azurerm_storage_blob',
    'azurerm_storage_share',
    'azurerm_storage_queue',
    'azurerm_storage_table',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'azure_storage.versioning_enabled',
        level: 'required',
        description: 'Whether blob versioning is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_storage.soft_delete_enabled',
        level: 'required',
        description: 'Whether blob soft delete is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_storage.container_soft_delete',
        level: 'required',
        description: 'Whether container soft delete is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'azure_storage.immutability_policy',
        level: 'recommended',
        description: 'Immutability policy preventing deletion',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Azure Storage configuration update is reversible');

    if (change.type === 'azurerm_storage_account') {
      const values = change.before ?? {};
      const blobVersioning = nestedBool(values, ['blob_properties', 'versioning_enabled']) === true;
      const deleteRetention = nestedBool(values, ['blob_properties', 'delete_retention_policy', 'enabled']) === true;
      const containerRetention = nestedBool(values, ['blob_properties', 'container_delete_retention_policy', 'enabled']) === true;

      if (blobVersioning || deleteRetention || containerRetention) {
        return {
          tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
          label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
          reasoning: 'Azure Storage soft delete/versioning is enabled; data may be recoverable within retention windows',
        };
      }

      return unrecoverable('Azure Storage account deletion without soft delete/versioning evidence can permanently destroy data');
    }

    if (change.type === 'azurerm_storage_blob') {
      return unrecoverable('Azure blob deletion is permanent without storage account soft delete/versioning evidence');
    }

    return recoverableWithEffort('Azure Storage child resource can be recreated, but contained data may need restore');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const name = resource.values.name as string;
    if (!name) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(name))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'storage_account_name',
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

function unrecoverable(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning,
  };
}
