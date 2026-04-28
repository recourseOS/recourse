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

export const securityGroupHandler: ResourceHandler = {
  resourceTypes: [
    'aws_security_group',
    'aws_security_group_rule',
    'aws_vpc_security_group_ingress_rule',
    'aws_vpc_security_group_egress_rule',
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
        note: 'Security group configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Security group rule update is reversible',
      };
    } else if (change.type === 'aws_security_group') {
      result = classifySecurityGroup(change, state, ctx);
    } else {
      // Individual rules
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'Individual security group rule',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Security group rule can be re-added',
      };
    }

    ctx.limitation('Cannot verify security group references in other accounts');
    ctx.limitation('Cannot check for dynamic security group rules added outside Terraform');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_security_group') {
      const sgId = resource.values.id as string;
      const sgName = resource.values.name as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const securityGroups = other.values.security_groups as string[] | undefined;
        const vpcSecurityGroupIds = other.values.vpc_security_group_ids as string[] | undefined;

        if (
          securityGroups?.includes(sgId) ||
          securityGroups?.includes(sgName) ||
          vpcSecurityGroupIds?.includes(sgId)
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'security_groups',
          });
        }
      }
    }

    return deps;
  },
};

function classifySecurityGroup(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const sgId = values.id as string;
  const sgName = values.name as string;
  const vpcId = values.vpc_id as string;

  ctx.check('security_group_id', sgId, {
    passed: true,
    note: `Security Group: ${sgName || sgId || 'unknown'}`,
  });

  ctx.check('vpc_id', vpcId, {
    passed: true,
    note: `In VPC: ${vpcId || 'unknown'}`,
  });

  // Count dependent resources
  let dependentCount = 0;
  if (state && sgId) {
    dependentCount = state.resources.filter(r => {
      const securityGroups = r.values.security_groups as string[] | undefined;
      const vpcSecurityGroupIds = r.values.vpc_security_group_ids as string[] | undefined;
      return securityGroups?.includes(sgId) ||
             vpcSecurityGroupIds?.includes(sgId);
    }).length;
  }

  ctx.check('dependent_resources', dependentCount, {
    passed: dependentCount === 0,
    note: dependentCount > 0
      ? `${dependentCount} resources reference this security group`
      : 'No dependent resources found',
  });

  // Check ingress/egress rules
  const ingressRules = values.ingress as Array<Record<string, unknown>> | undefined;
  const egressRules = values.egress as Array<Record<string, unknown>> | undefined;
  const ruleCount = (ingressRules?.length || 0) + (egressRules?.length || 0);

  ctx.check('rule_count', ruleCount, {
    passed: true,
    note: `${ingressRules?.length || 0} ingress, ${egressRules?.length || 0} egress rules`,
  });

  if (dependentCount > 0) {
    ctx.addCounterfactual({
      condition: 'security group ID were updated in all dependents first',
      resultingTier: 'reversible',
      explanation: 'Pre-migrating dependents to a replacement security group prevents connectivity loss',
    });

    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: `Security group referenced by ${dependentCount} resources; they will lose connectivity`,
    };
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'Security group can be recreated with same rules',
  };
}
