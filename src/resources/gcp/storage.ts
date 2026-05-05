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

export const gcpStorageHandler: ResourceHandler = {
  resourceTypes: [
    'google_storage_bucket',
    'google_storage_bucket_object',
    'google_storage_bucket_iam_binding',
    'google_storage_bucket_iam_member',
    'google_storage_bucket_iam_policy',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'gcs.versioning_enabled',
        level: 'required',
        description: 'Whether object versioning is enabled on the bucket',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'gcs.force_destroy',
        level: 'required',
        description: 'Whether force_destroy is set (deletes all objects)',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'gcs.lifecycle_rules',
        level: 'recommended',
        description: 'Lifecycle rules that may affect object retention',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'gcs.retention_policy',
        level: 'recommended',
        description: 'Bucket retention policy preventing deletion',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('GCS configuration update is reversible');

    if (change.type.includes('_iam_')) {
      return reversible('GCS IAM binding is config-only and can be reapplied');
    }

    if (change.type === 'google_storage_bucket_object') {
      const values = change.before ?? {};
      return values.detect_md5hash || values.source
        ? recoverableWithEffort('GCS object can be recreated from configured source content')
        : unrecoverable('GCS object deletion is permanent without object versioning or source content evidence');
    }

    const values = change.before ?? {};
    const versioningEnabled = nestedBool(values, ['versioning', 'enabled']) === true;
    const forceDestroy = values.force_destroy === true;

    if (versioningEnabled) {
      return {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'GCS bucket versioning is enabled; object generations may be recoverable',
      };
    }

    if (forceDestroy) {
      return unrecoverable('force_destroy=true can delete bucket contents; no versioning evidence found');
    }

    return recoverableWithEffort('GCS bucket deletion without force_destroy may fail if non-empty; empty bucket can be recreated');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const bucketName = resource.values.name as string;
    if (!bucketName) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(bucketName))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'bucket',
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
