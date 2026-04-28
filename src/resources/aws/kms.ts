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

export const kmsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_kms_key',
    'aws_kms_alias',
    'aws_kms_grant',
  ],

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

    if (!isDelete) {
      ctx.check('update_type', 'configuration', {
        passed: true,
        note: 'KMS configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'KMS configuration update is reversible',
      };
    } else if (change.type === 'aws_kms_key') {
      result = classifyKmsKey(change, state, ctx);
    } else if (change.type === 'aws_kms_alias') {
      ctx.check('resource_type', 'aws_kms_alias', {
        passed: true,
        note: 'Key alias can be recreated',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Key alias can be recreated',
      };
    } else if (change.type === 'aws_kms_grant') {
      ctx.check('resource_type', 'aws_kms_grant', {
        passed: true,
        note: 'Key grant can be recreated',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Key grant can be recreated',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'KMS resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify all resources encrypted with this key');
    ctx.limitation('Cannot check for cross-account key sharing');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_kms_key') {
      const keyId = resource.values.key_id as string || resource.values.id as string;
      const keyArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (keyId && values.includes(keyId)) ||
          (keyArn && values.includes(keyArn))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'kms_key_id',
          });
        }
      }
    }

    return deps;
  },
};

function classifyKmsKey(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const keyId = values.key_id as string || values.id as string;
  const keyArn = values.arn as string;
  const description = values.description as string;
  const deletionWindow = values.deletion_window_in_days as number || 30;
  const enabled = values.is_enabled as boolean;

  ctx.check('key_id', keyId, {
    passed: false,
    note: `Key: ${keyId || 'unknown'}`,
  });

  if (description) {
    ctx.check('description', description, {
      passed: true,
      note: `Description: ${description}`,
    });
  }

  ctx.check('deletion_window_in_days', deletionWindow, {
    passed: deletionWindow >= 7,
    note: `Deletion window: ${deletionWindow} days`,
    counterfactual: deletionWindow < 7 ? {
      condition: 'deletion_window_in_days >= 7',
      resultingTier: 'recoverable-with-effort',
      explanation: 'Longer deletion window allows cancellation before key is destroyed',
    } : undefined,
  });

  // Count dependent resources
  let dependentCount = 0;
  if (state && keyId) {
    dependentCount = state.resources.filter(r => {
      const vals = JSON.stringify(r.values);
      return vals.includes(keyId) || (keyArn && vals.includes(keyArn));
    }).length - 1; // Subtract self
    if (dependentCount < 0) dependentCount = 0;
  }

  ctx.check('dependent_resources', dependentCount, {
    passed: dependentCount === 0,
    note: dependentCount > 0
      ? `${dependentCount} resources use this key for encryption`
      : 'No dependent resources found in Terraform state',
  });

  if (deletionWindow >= 7) {
    ctx.check('cancellation_note', null, {
      passed: true,
      note: `Key will be pending deletion for ${deletionWindow} days; can cancel during this period`,
    });

    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: `Key scheduled for deletion in ${deletionWindow} days; can be cancelled. ${dependentCount > 0 ? `${dependentCount} resources use this key.` : ''}`,
    };
  }

  ctx.addCounterfactual({
    condition: 'deletion_window_in_days were increased',
    resultingTier: 'recoverable-with-effort',
    explanation: 'Standard 7-30 day deletion window allows recovery',
  });

  if (dependentCount > 0) {
    return {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: `Key deletion will make data encrypted with it unrecoverable; ${dependentCount} resources affected`,
    };
  }

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'KMS key deletion makes all data encrypted with it permanently inaccessible',
  };
}
