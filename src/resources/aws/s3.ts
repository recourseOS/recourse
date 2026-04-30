import {
  RecoverabilityTier,
  RecoverabilityLabels,
  type ResourceHandler,
  type ResourceChange,
  type TerraformState,
  type RecoverabilityResult,
  type StateResource,
  type ResourceDependency,
  type ClassificationTrace,
} from '../types.js';
import { ClassificationContext } from '../../analyzer/trace.js';
import type { VerificationSuggestion } from '../../core/mutation.js';
import { s3CrossRegionReplication, s3VersioningStatus } from '../../verification/index.js';

export const s3Handler: ResourceHandler = {
  resourceTypes: ['aws_s3_bucket', 'aws_s3_bucket_versioning', 'aws_s3_object'],

  getRecoverability(
    change: ResourceChange,
    state: TerraformState | null
  ): RecoverabilityResult {
    const ctx = new ClassificationContext(change.address, change.type,
      change.actions.includes('delete') ? 'delete' : 'update');
    const trace = this.getRecoverabilityTraced!(change, state, ctx);
    return trace.result;
  },

  getRecoverabilityTraced(
    change: ResourceChange,
    state: TerraformState | null,
    ctx: ClassificationContext
  ): ClassificationTrace {
    const isDelete = change.actions.includes('delete');

    ctx.check('action', change.actions, {
      passed: true,
      note: isDelete ? 'Resource will be deleted' : 'Resource will be modified',
    });

    let result: RecoverabilityResult;

    if (change.type === 'aws_s3_bucket') {
      result = classifyS3Bucket(change, state, isDelete, ctx);
    } else if (change.type === 'aws_s3_object') {
      result = classifyS3Object(change, state, isDelete, ctx);
    } else if (change.type === 'aws_s3_bucket_versioning') {
      ctx.check('resource_type', 'aws_s3_bucket_versioning', {
        passed: true,
        note: 'Versioning configuration change',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Versioning configuration can be re-enabled',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Unknown S3 resource type',
      };
    }

    ctx.limitation('Cannot determine actual object count in bucket');
    ctx.limitation('Cannot verify S3 replication configurations');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_s3_bucket') {
      const bucketName = resource.values.bucket as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);
        if (values.includes(bucketName)) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'bucket',
          });
        }
      }
    }

    return deps;
  },
};

function classifyS3Bucket(
  change: ResourceChange,
  state: TerraformState | null,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    ctx.check('update_type', 'configuration', {
      passed: true,
      note: 'Bucket configuration update, no data at risk',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Bucket update can be reverted',
    };
  }

  const bucketValues = change.before || {};
  const bucketName = bucketValues.bucket as string;

  ctx.check('bucket_name', bucketName, {
    passed: true,
    note: `Bucket: ${bucketName}`,
  });

  // Check if bucket is empty
  const objectCount = bucketValues.object_count as number | undefined;
  ctx.check('object_count', objectCount, {
    passed: objectCount === 0,
    note: objectCount === 0
      ? 'Bucket is empty'
      : objectCount !== undefined
      ? `Bucket contains ${objectCount} objects`
      : 'Object count unknown (bucket likely not empty)',
  });

  if (objectCount === 0) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: 'Bucket is empty; can be recreated',
    };
  }

  // Explain why versioning doesn't help with bucket deletion
  ctx.check('versioning_note', null, {
    passed: false,
    note: 'Versioning does NOT protect bucket deletion; bucket must be emptied first (including all versions)',
  });

  ctx.addCounterfactual({
    condition: 'bucket were empty',
    resultingTier: 'recoverable-with-effort',
    explanation: 'Empty buckets can be recreated with same configuration',
  });

  // Generate verification suggestions
  const suggestions: VerificationSuggestion[] = [];
  if (bucketName) {
    suggestions.push(s3CrossRegionReplication(bucketName));
  }

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Bucket deletion is permanent; versioning does not survive bucket deletion',
    verificationSuggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

function classifyS3Object(
  change: ResourceChange,
  state: TerraformState | null,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    ctx.check('update_type', 'object_update', {
      passed: true,
      note: 'Object update, previous version may be preserved if versioning enabled',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Object update can be reverted',
    };
  }

  const objectValues = change.before || {};
  const bucketName = objectValues.bucket as string;
  const key = objectValues.key as string;

  ctx.check('object_key', key, {
    passed: true,
    note: `Object: ${key}`,
  });

  ctx.check('bucket', bucketName, {
    passed: true,
    note: `In bucket: ${bucketName}`,
  });

  // Check if parent bucket has versioning
  let isVersioned = false;
  if (state && bucketName) {
    const versioningResource = state.resources.find(
      r => r.type === 'aws_s3_bucket_versioning' &&
           (r.values.bucket === bucketName ||
            (r.values.bucket as string)?.includes(bucketName))
    );

    if (versioningResource) {
      const versioningConfig = versioningResource.values.versioning_configuration as
        { status?: string }[] | undefined;
      isVersioned = versioningConfig?.[0]?.status === 'Enabled';
    }
  }

  ctx.check('bucket_versioning', isVersioned, {
    passed: isVersioned,
    note: isVersioned
      ? 'Bucket has versioning enabled; previous versions preserved'
      : 'Bucket does not have versioning enabled',
    counterfactual: !isVersioned ? {
      condition: 'bucket had versioning enabled',
      resultingTier: 'recoverable-from-backup',
      explanation: 'Object deletion in versioned bucket creates delete marker; previous versions remain',
    } : undefined,
  });

  if (isVersioned) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'Object is in versioned bucket; previous versions preserved',
    };
  }

  // Generate verification suggestions - check versioning status live
  const suggestions: VerificationSuggestion[] = [];
  if (bucketName) {
    suggestions.push(s3VersioningStatus(bucketName));
    suggestions.push(s3CrossRegionReplication(bucketName));
  }

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Object deletion without versioning is permanent',
    verificationSuggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}
