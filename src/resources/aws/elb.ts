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

export const elbHandler: ResourceHandler = {
  resourceTypes: [
    'aws_lb',
    'aws_alb',
    'aws_elb',
    'aws_lb_listener',
    'aws_lb_listener_rule',
    'aws_lb_target_group',
    'aws_lb_target_group_attachment',
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
        note: 'Load balancer configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Load balancer configuration update is reversible',
      };
    } else if (change.type === 'aws_lb' || change.type === 'aws_alb' || change.type === 'aws_elb') {
      result = classifyLoadBalancer(change, ctx);
    } else if (change.type === 'aws_lb_target_group') {
      result = classifyTargetGroup(change, state, ctx);
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'Load balancer configuration resource',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Load balancer resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify Route53 alias records pointing to this load balancer');
    ctx.limitation('Cannot check for external DNS references');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_lb' || resource.type === 'aws_alb') {
      const lbArn = resource.values.arn as string;
      const dnsName = resource.values.dns_name as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (other.values.load_balancer_arn === lbArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'load_balancer_arn',
          });
        }

        // Check for DNS references
        if (dnsName) {
          const values = JSON.stringify(other.values);
          if (values.includes(dnsName)) {
            deps.push({
              address: other.address,
              dependencyType: 'implicit',
              referenceAttribute: 'dns_name',
            });
          }
        }
      }
    }

    if (resource.type === 'aws_lb_target_group') {
      const tgArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (other.values.target_group_arn === tgArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'target_group_arn',
          });
        }
      }
    }

    return deps;
  },
};

function classifyLoadBalancer(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const lbName = values.name as string;
  const dnsName = values.dns_name as string;
  const lbType = values.load_balancer_type as string;
  const internal = values.internal as boolean;

  ctx.check('lb_name', lbName, {
    passed: true,
    note: `Load Balancer: ${lbName || 'unknown'}`,
  });

  ctx.check('lb_type', lbType, {
    passed: true,
    note: `Type: ${lbType || 'application'} (${internal ? 'internal' : 'internet-facing'})`,
  });

  ctx.check('dns_name', dnsName, {
    passed: false,
    note: `DNS name will change: ${dnsName || 'unknown'}`,
  });

  ctx.addCounterfactual({
    condition: 'Route53 alias were used instead of direct DNS reference',
    resultingTier: 'recoverable-with-effort',
    explanation: 'Route53 alias can be updated to point to new load balancer',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: `Load balancer can be recreated; DNS name ${dnsName || ''} will change`,
  };
}

function classifyTargetGroup(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const tgName = values.name as string;
  const tgArn = values.arn as string;
  const targetType = values.target_type as string;

  ctx.check('target_group_name', tgName, {
    passed: true,
    note: `Target Group: ${tgName || 'unknown'}`,
  });

  ctx.check('target_type', targetType, {
    passed: true,
    note: `Target type: ${targetType || 'instance'}`,
  });

  // Count registered targets
  let targetCount = 0;
  if (state && tgArn) {
    targetCount = state.resources.filter(r =>
      r.type === 'aws_lb_target_group_attachment' &&
      r.values.target_group_arn === tgArn
    ).length;
  }

  ctx.check('registered_targets', targetCount, {
    passed: targetCount === 0,
    note: targetCount > 0
      ? `${targetCount} targets must be re-registered`
      : 'No targets registered in Terraform state',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: targetCount > 0
      ? `Target group can be recreated; ${targetCount} targets must be re-registered`
      : 'Target group can be recreated; targets must be re-registered',
  };
}
