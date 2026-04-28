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

export const cloudwatchHandler: ResourceHandler = {
  resourceTypes: [
    'aws_cloudwatch_log_group',
    'aws_cloudwatch_log_stream',
    'aws_cloudwatch_metric_alarm',
    'aws_cloudwatch_dashboard',
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
        note: 'CloudWatch configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'CloudWatch configuration update is reversible',
      };
    } else if (change.type === 'aws_cloudwatch_log_group') {
      result = classifyLogGroup(change, ctx);
    } else if (change.type === 'aws_cloudwatch_log_stream') {
      result = classifyLogStream(change, ctx);
    } else if (change.type === 'aws_cloudwatch_metric_alarm') {
      result = classifyMetricAlarm(change, ctx);
    } else if (change.type === 'aws_cloudwatch_dashboard') {
      ctx.check('resource_type', 'aws_cloudwatch_dashboard', {
        passed: true,
        note: 'Dashboard can be recreated from configuration',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Dashboard can be recreated from configuration',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'CloudWatch resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify CloudWatch Logs export tasks');
    ctx.limitation('Cannot check for S3 log export configurations');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_cloudwatch_log_group') {
      const logGroupName = resource.values.name as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        // Lambda functions commonly reference log groups
        if (
          other.type === 'aws_lambda_function' &&
          logGroupName?.includes(other.values.function_name as string)
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'log_group',
          });
        }
      }
    }

    return deps;
  },
};

function classifyLogGroup(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const logGroupName = values.name as string;
  const retentionDays = values.retention_in_days as number;
  const kmsKeyId = values.kms_key_id as string;

  ctx.check('log_group_name', logGroupName, {
    passed: false,
    note: `Log Group: ${logGroupName || 'unknown'}`,
  });

  ctx.check('retention_in_days', retentionDays, {
    passed: true,
    note: retentionDays
      ? `Retention: ${retentionDays} days`
      : 'Retention: Never expire',
  });

  if (kmsKeyId) {
    ctx.check('kms_key_id', kmsKeyId, {
      passed: true,
      note: 'Logs are encrypted with KMS',
    });
  }

  ctx.addCounterfactual({
    condition: 'logs were exported to S3 first',
    resultingTier: 'recoverable-from-backup',
    explanation: 'S3 export preserves logs independently of CloudWatch',
  });

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: retentionDays
      ? `Log group deletion destroys all logs (retention was ${retentionDays} days)`
      : 'Log group deletion destroys all logs permanently',
  };
}

function classifyLogStream(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const streamName = values.name as string;
  const logGroupName = values.log_group_name as string;

  ctx.check('stream_name', streamName, {
    passed: false,
    note: `Stream: ${streamName || 'unknown'}`,
  });

  ctx.check('log_group_name', logGroupName, {
    passed: true,
    note: `In log group: ${logGroupName || 'unknown'}`,
  });

  ctx.addCounterfactual({
    condition: 'stream logs were exported first',
    resultingTier: 'recoverable-from-backup',
    explanation: 'Exported logs can be preserved in S3',
  });

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Log stream deletion destroys all logs in the stream',
  };
}

function classifyMetricAlarm(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const alarmName = values.alarm_name as string;
  const metricName = values.metric_name as string;
  const namespace = values.namespace as string;
  const alarmActions = values.alarm_actions as string[];

  ctx.check('alarm_name', alarmName, {
    passed: true,
    note: `Alarm: ${alarmName || 'unknown'}`,
  });

  ctx.check('metric', metricName, {
    passed: true,
    note: `Metric: ${namespace || 'unknown'}/${metricName || 'unknown'}`,
  });

  if (alarmActions && alarmActions.length > 0) {
    ctx.check('alarm_actions', alarmActions.length, {
      passed: true,
      note: `${alarmActions.length} alarm action(s) configured`,
    });
  }

  ctx.check('monitoring_gap', null, {
    passed: false,
    note: 'Monitoring gap during alarm deletion and recreation',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'Alarm can be recreated; monitoring gap during recreation',
  };
}
