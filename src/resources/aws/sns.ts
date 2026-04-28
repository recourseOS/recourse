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

export const snsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_sns_topic',
    'aws_sns_topic_subscription',
    'aws_sns_topic_policy',
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
        note: 'SNS configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'SNS configuration update is reversible',
      };
    } else if (change.type === 'aws_sns_topic') {
      result = classifySnsTopic(change, state, ctx);
    } else if (change.type === 'aws_sns_topic_subscription') {
      result = classifySnsSubscription(change, ctx);
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'SNS policy resource',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'SNS resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify pending subscription confirmations');
    ctx.limitation('Cannot check for external publishers using this topic');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_sns_topic') {
      const topicArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (other.values.topic_arn === topicArn) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'topic_arn',
          });
        }
      }
    }

    return deps;
  },
};

function classifySnsTopic(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const topicName = values.name as string;
  const topicArn = values.arn as string;
  const fifoTopic = values.fifo_topic as boolean;

  ctx.check('topic_name', topicName, {
    passed: true,
    note: `Topic: ${topicName || 'unknown'}${fifoTopic ? ' (FIFO)' : ''}`,
  });

  ctx.check('topic_arn', topicArn, {
    passed: false,
    note: `ARN will change: ${topicArn || 'unknown'}`,
  });

  // Count subscriptions
  let subscriptionCount = 0;
  if (state && topicArn) {
    subscriptionCount = state.resources.filter(
      r => r.type === 'aws_sns_topic_subscription' &&
           r.values.topic_arn === topicArn
    ).length;
  }

  ctx.check('subscription_count', subscriptionCount, {
    passed: subscriptionCount === 0,
    note: subscriptionCount > 0
      ? `${subscriptionCount} subscriptions will be deleted`
      : 'No subscriptions found in Terraform state',
  });

  if (subscriptionCount > 0) {
    ctx.addCounterfactual({
      condition: 'subscriptions were migrated to new topic first',
      resultingTier: 'recoverable-with-effort',
      explanation: 'Pre-creating subscriptions on replacement topic prevents message loss',
    });
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: subscriptionCount > 0
      ? `Topic deletion removes ${subscriptionCount} subscriptions; all must be recreated`
      : 'Topic can be recreated; ARN will change',
  };
}

function classifySnsSubscription(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const protocol = values.protocol as string;
  const endpoint = values.endpoint as string;
  const confirmationWasAuthenticated = values.confirmation_was_authenticated as boolean;

  ctx.check('protocol', protocol, {
    passed: true,
    note: `Protocol: ${protocol || 'unknown'}`,
  });

  ctx.check('endpoint', endpoint, {
    passed: true,
    note: `Endpoint: ${endpoint || 'unknown'}`,
  });

  // Some protocols require re-confirmation
  const requiresConfirmation = ['http', 'https', 'email', 'email-json'].includes(protocol);

  ctx.check('requires_confirmation', requiresConfirmation, {
    passed: !requiresConfirmation,
    note: requiresConfirmation
      ? 'Protocol requires endpoint confirmation after recreation'
      : 'Protocol does not require confirmation',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: requiresConfirmation
      ? 'Subscription can be recreated; may require re-confirmation'
      : 'Subscription can be recreated',
  };
}
