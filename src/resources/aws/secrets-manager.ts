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

export const secretsManagerHandler: ResourceHandler = {
  resourceTypes: [
    'aws_secretsmanager_secret',
    'aws_secretsmanager_secret_version',
    'aws_secretsmanager_secret_policy',
    'aws_secretsmanager_secret_rotation',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'secretsmanager.recovery_window_days',
        level: 'required',
        description: 'Recovery window in days before permanent deletion (0 = immediate)',
        blocksSafeVerdict: true,
        defaultAssumption: 0,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'secretsmanager.force_delete',
        level: 'required',
        description: 'Whether force_delete_without_recovery is enabled',
        blocksSafeVerdict: true,
        defaultAssumption: true,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'secretsmanager.replica_regions',
        level: 'recommended',
        description: 'Regions where secret is replicated',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'secretsmanager.rotation_enabled',
        level: 'optional',
        description: 'Whether automatic rotation is configured',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('Secrets Manager configuration update is reversible');

    if (change.type === 'aws_secretsmanager_secret') {
      return classifySecret(change);
    }

    if (change.type === 'aws_secretsmanager_secret_version') {
      return unrecoverable('Secret version deletion can permanently remove credential material; payload values should not be treated as recoverable from Terraform state');
    }

    if (change.type === 'aws_secretsmanager_secret_policy') {
      return reversible('Secret resource policy is config-only and can be reapplied');
    }

    if (change.type === 'aws_secretsmanager_secret_rotation') {
      return reversible('Secret rotation configuration can be recreated without deleting secret material');
    }

    return recoverableWithEffort('Secrets Manager resource can be recreated with effort');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const secretId = (resource.values.id ?? resource.values.arn ?? resource.values.name) as string;
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

function classifySecret(change: ResourceChange): RecoverabilityResult {
  const values = change.before ?? {};
  const recoveryWindow = numberValue(values.recovery_window_in_days);
  const forceDelete = values.force_delete_without_recovery === true;

  if (forceDelete || recoveryWindow === 0) {
    return unrecoverable('Secret deletion is configured without a recovery window; secret material cannot be recovered after deletion');
  }

  const days = recoveryWindow ?? 30;
  return recoverableWithEffort(`Secret deletion is recoverable during the ${days}-day recovery window if deletion is cancelled before purge`);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
