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

export const iamHandler: ResourceHandler = {
  resourceTypes: [
    'aws_iam_role',
    'aws_iam_policy',
    'aws_iam_user',
    'aws_iam_group',
    'aws_iam_role_policy',
    'aws_iam_role_policy_attachment',
    'aws_iam_user_policy',
    'aws_iam_user_policy_attachment',
    'aws_iam_instance_profile',
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
        note: 'IAM configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'IAM resource update is reversible',
      };
    } else if (change.type === 'aws_iam_role') {
      result = classifyIamRole(change, state, ctx);
    } else if (change.type === 'aws_iam_policy') {
      result = classifyIamPolicy(change, state, ctx);
    } else if (change.type === 'aws_iam_user') {
      result = classifyIamUser(change, ctx);
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'IAM attachment or profile resource',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'IAM resource can be recreated from configuration',
      };
    }

    ctx.limitation('Cannot verify cross-account trust relationships');
    ctx.limitation('Cannot check for externally-managed IAM bindings');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_iam_role') {
      const roleArn = resource.values.arn as string;
      const roleName = resource.values.name as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        // Check for role references
        if (other.values.role === roleName || other.values.role === roleArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'role',
          });
        }

        if (other.values.execution_role_arn === roleArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'execution_role_arn',
          });
        }

        if (other.values.task_role_arn === roleArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'task_role_arn',
          });
        }
      }
    }

    if (resource.type === 'aws_iam_policy') {
      const policyArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (
          other.type === 'aws_iam_role_policy_attachment' ||
          other.type === 'aws_iam_user_policy_attachment'
        ) {
          if (other.values.policy_arn === policyArn) {
            deps.push({
              address: other.address,
              dependencyType: 'implicit',
              referenceAttribute: 'policy_arn',
            });
          }
        }
      }
    }

    return deps;
  },
};

function classifyIamRole(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const roleName = values.name as string;
  const roleArn = values.arn as string;

  ctx.check('role_name', roleName, {
    passed: true,
    note: `Role: ${roleName || 'unknown'}`,
  });

  // Check for dependent resources
  let dependentCount = 0;
  if (state && roleArn) {
    dependentCount = state.resources.filter(r => {
      return r.values.role === roleName ||
             r.values.role === roleArn ||
             r.values.execution_role_arn === roleArn ||
             r.values.task_role_arn === roleArn;
    }).length;
  }

  ctx.check('dependent_resources', dependentCount, {
    passed: dependentCount === 0,
    note: dependentCount > 0
      ? `${dependentCount} resources reference this role and will fail`
      : 'No dependent resources found',
  });

  if (dependentCount > 0) {
    ctx.addCounterfactual({
      condition: 'role had no dependents',
      resultingTier: 'recoverable-with-effort',
      explanation: 'Role without dependents can be safely recreated',
    });
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: dependentCount > 0
      ? `Role can be recreated, but ${dependentCount} dependent services will fail until restored`
      : 'Role can be recreated from configuration',
  };
}

function classifyIamPolicy(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const policyName = values.name as string;
  const policyArn = values.arn as string;

  ctx.check('policy_name', policyName, {
    passed: true,
    note: `Policy: ${policyName || 'unknown'}`,
  });

  // Check for attachments
  let attachmentCount = 0;
  if (state && policyArn) {
    attachmentCount = state.resources.filter(r =>
      (r.type === 'aws_iam_role_policy_attachment' ||
       r.type === 'aws_iam_user_policy_attachment') &&
      r.values.policy_arn === policyArn
    ).length;
  }

  ctx.check('attachments', attachmentCount, {
    passed: attachmentCount === 0,
    note: attachmentCount > 0
      ? `Policy has ${attachmentCount} attachments that must be re-established`
      : 'No attachments found',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: attachmentCount > 0
      ? `Policy can be recreated, but ${attachmentCount} attachments must be re-established`
      : 'Policy can be recreated from configuration',
  };
}

function classifyIamUser(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const userName = values.name as string;

  ctx.check('user_name', userName, {
    passed: true,
    note: `User: ${userName || 'unknown'}`,
  });

  ctx.check('access_keys', null, {
    passed: false,
    note: 'Access keys will need to be regenerated; applications using old keys will break',
  });

  ctx.addCounterfactual({
    condition: 'access keys were rotated to new user first',
    resultingTier: 'recoverable-with-effort',
    explanation: 'Pre-rotating keys to a replacement user prevents application outage',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'User can be recreated, but access keys will need to be regenerated',
  };
}
