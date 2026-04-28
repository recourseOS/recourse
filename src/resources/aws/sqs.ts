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

export const sqsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_sqs_queue',
    'aws_sqs_queue_policy',
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
        note: 'SQS configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'SQS configuration update is reversible',
      };
    } else if (change.type === 'aws_sqs_queue') {
      result = classifySqsQueue(change, ctx);
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'SQS policy resource',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'SQS resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify actual message count in queue at apply time');
    ctx.limitation('Cannot check for external services publishing to this queue');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_sqs_queue') {
      const queueArn = resource.values.arn as string;
      const queueUrl = resource.values.url as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (queueArn && values.includes(queueArn)) ||
          (queueUrl && values.includes(queueUrl))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'queue_arn',
          });
        }
      }
    }

    return deps;
  },
};

function classifySqsQueue(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const queueName = values.name as string;
  const fifoQueue = values.fifo_queue as boolean;
  const messageCount = values.approximate_number_of_messages as number;
  const dlqArn = values.redrive_policy as string;

  ctx.check('queue_name', queueName, {
    passed: true,
    note: `Queue: ${queueName || 'unknown'}${fifoQueue ? ' (FIFO)' : ''}`,
  });

  ctx.check('message_count', messageCount, {
    passed: !messageCount || messageCount === 0,
    note: messageCount && messageCount > 0
      ? `Queue contains ~${messageCount} messages that will be lost`
      : 'Queue appears empty or message count unknown',
    counterfactual: messageCount && messageCount > 0 ? {
      condition: 'messages were drained first',
      resultingTier: 'recoverable-with-effort',
      explanation: 'Draining messages before deletion prevents data loss',
    } : undefined,
  });

  if (dlqArn) {
    ctx.check('dead_letter_queue', dlqArn, {
      passed: true,
      note: 'Queue has DLQ configured',
    });
  }

  ctx.check('queue_url', null, {
    passed: false,
    note: 'Queue URL will change; consumers must be updated',
  });

  if (messageCount && messageCount > 0) {
    return {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: `Queue contains ~${messageCount} messages that will be lost`,
    };
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'Queue can be recreated; URL will change',
  };
}
