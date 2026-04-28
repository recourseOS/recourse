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

export const lambdaHandler: ResourceHandler = {
  resourceTypes: [
    'aws_lambda_function',
    'aws_lambda_alias',
    'aws_lambda_event_source_mapping',
    'aws_lambda_permission',
    'aws_lambda_layer_version',
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
        note: 'Lambda configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Lambda configuration update is reversible',
      };
    } else if (change.type === 'aws_lambda_function') {
      result = classifyLambdaFunction(change, ctx);
    } else if (change.type === 'aws_lambda_layer_version') {
      ctx.check('resource_type', 'aws_lambda_layer_version', {
        passed: true,
        note: 'Layer version can be republished from source',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Layer version can be republished',
      };
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'Lambda configuration resource',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Lambda resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify source code availability in S3 or container registry');
    ctx.limitation('Cannot check for function-specific environment secrets');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_lambda_function') {
      const functionName = resource.values.function_name as string;
      const functionArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (functionName && values.includes(functionName)) ||
          (functionArn && values.includes(functionArn))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'function_name',
          });
        }
      }
    }

    return deps;
  },
};

function classifyLambdaFunction(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const functionName = values.function_name as string;
  const packageType = values.package_type as string;
  const s3Bucket = values.s3_bucket as string;
  const imageUri = values.image_uri as string;

  ctx.check('function_name', functionName, {
    passed: true,
    note: `Function: ${functionName || 'unknown'}`,
  });

  ctx.check('package_type', packageType, {
    passed: true,
    note: packageType === 'Image' ? 'Container image deployment' : 'Zip deployment',
  });

  if (packageType === 'Image') {
    ctx.check('image_uri', imageUri, {
      passed: !!imageUri,
      note: imageUri
        ? `Image: ${imageUri}`
        : 'Container image URI not found',
    });
    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: 'Function uses container image; can be redeployed from registry',
    };
  }

  if (s3Bucket) {
    ctx.check('s3_bucket', s3Bucket, {
      passed: true,
      note: `Code stored in S3: ${s3Bucket}`,
    });
    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: 'Function code stored in S3; can be redeployed',
    };
  }

  ctx.check('deployment_source', 'inline/local', {
    passed: true,
    note: 'Code deployed from local source or inline',
  });

  ctx.addCounterfactual({
    condition: 'code were stored in S3 with versioning',
    resultingTier: 'recoverable-from-backup',
    explanation: 'S3 versioning would preserve all function code versions',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'Function can be redeployed from source',
  };
}
