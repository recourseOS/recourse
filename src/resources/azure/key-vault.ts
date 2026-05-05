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

export const azureKeyVaultHandler: ResourceHandler = {
  resourceTypes: [
    'azurerm_key_vault',
    'azurerm_key_vault_key',
    'azurerm_key_vault_secret',
    'azurerm_key_vault_certificate',
    'azurerm_key_vault_access_policy',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'key_vault.soft_delete_enabled',
        level: 'required',
        description: 'Whether soft delete is enabled on the vault',
        blocksSafeVerdict: true,
        defaultAssumption: true,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'key_vault.purge_protection_enabled',
        level: 'required',
        description: 'Whether purge protection is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'key_vault.soft_delete_retention_days',
        level: 'recommended',
        description: 'Soft delete retention period in days (7-90)',
        blocksSafeVerdict: false,
        defaultAssumption: 90,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'key_vault.dependent_resources',
        level: 'recommended',
        description: 'Resources encrypted with keys from this vault',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Azure Key Vault configuration update is reversible');

    if (change.type === 'azurerm_key_vault_access_policy') {
      return reversible('Key Vault access policy is config-only and can be reapplied');
    }

    if (change.type === 'azurerm_key_vault_secret') {
      return classifyVaultChild(change, 'secret', 'secret value');
    }

    if (change.type === 'azurerm_key_vault_certificate') {
      return classifyVaultChild(change, 'certificate', 'private key material');
    }

    if (change.type === 'azurerm_key_vault_key') {
      return classifyVaultChild(change, 'key', 'encrypted data protected by this key');
    }

    if (change.type === 'azurerm_key_vault') {
      const values = change.before ?? {};
      const purgeProtection = values.purge_protection_enabled === true;
      const retentionDays = numberValue(values.soft_delete_retention_days);

      if (purgeProtection || retentionDays !== null) {
        const window = retentionDays ? ` for ${retentionDays} days` : '';
        return recoverableWithEffort(`Key Vault soft delete/purge protection evidence exists; vault may be recoverable${window}`);
      }

      return recoverableWithEffort('Key Vault can be recreated, but child secrets, keys, and certificates require separate recovery evidence');
    }

    return recoverableWithEffort('Azure Key Vault resource can be recreated with effort');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.versionless_id ?? resource.values.name) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'key_vault_id',
      }));
  },
};

function classifyVaultChild(
  change: ResourceChange,
  resourceKind: string,
  materialDescription: string
): RecoverabilityResult {
  const values = change.before ?? {};
  const recoveryLevel = stringValue(values.recovery_level).toLowerCase();
  const purgeProtection = values.purge_protection_enabled === true || recoveryLevel.includes('recoverable');
  const retentionDays = numberValue(values.soft_delete_retention_days);

  if (purgeProtection || retentionDays !== null) {
    const window = retentionDays ? ` within the ${retentionDays}-day retention window` : ' during the soft-delete retention window';
    return recoverableWithEffort(`Key Vault ${resourceKind} has recovery evidence; ${materialDescription} may be recoverable${window}`);
  }

  return {
    tier: RecoverabilityTier.NEEDS_REVIEW,
    label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
    reasoning: `Key Vault ${resourceKind} deletion lacks soft-delete or purge-protection evidence; ${materialDescription} may be permanently lost`,
  };
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
