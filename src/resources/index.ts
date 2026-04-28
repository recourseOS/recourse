import type { ResourceHandler, ResourceChange, TerraformState, RecoverabilityResult, StateResource, ResourceDependency } from './types.js';
import { RecoverabilityTier, RecoverabilityLabels } from './types.js';
import { ClassificationContext, type ClassificationTrace } from '../analyzer/trace.js';

// Import all AWS resource handlers
import { s3Handler } from './aws/s3.js';
import { rdsHandler } from './aws/rds.js';
import { ec2Handler } from './aws/ec2.js';
import { iamHandler } from './aws/iam.js';
import { lambdaHandler } from './aws/lambda.js';
import { vpcHandler } from './aws/vpc.js';
import { securityGroupHandler } from './aws/security-groups.js';
import { ebsHandler } from './aws/ebs.js';
import { elbHandler } from './aws/elb.js';
import { route53Handler } from './aws/route53.js';
import { dynamodbHandler } from './aws/dynamodb.js';
import { snsHandler } from './aws/sns.js';
import { sqsHandler } from './aws/sqs.js';
import { cloudwatchHandler } from './aws/cloudwatch.js';
import { kmsHandler } from './aws/kms.js';

// Registry of all handlers
const handlers: ResourceHandler[] = [
  s3Handler,
  rdsHandler,
  ec2Handler,
  iamHandler,
  lambdaHandler,
  vpcHandler,
  securityGroupHandler,
  ebsHandler,
  elbHandler,
  route53Handler,
  dynamodbHandler,
  snsHandler,
  sqsHandler,
  cloudwatchHandler,
  kmsHandler,
];

// Build a map from resource type to handler for O(1) lookup
const handlerMap = new Map<string, ResourceHandler>();
for (const handler of handlers) {
  for (const type of handler.resourceTypes) {
    handlerMap.set(type, handler);
  }
}

// Default handler for unknown resource types
const defaultHandler: ResourceHandler = {
  resourceTypes: [],

  getRecoverability(
    change: ResourceChange,
    _state: TerraformState | null
  ): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');

    if (!isDelete) {
      return {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Resource update is generally reversible',
      };
    }

    // Unknown resource type - be conservative
    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: `Unknown resource type: ${change.type}; assuming recoverable with effort`,
    };
  },

  getDependencies(
    _resource: StateResource,
    _allResources: StateResource[]
  ): ResourceDependency[] {
    return [];
  },
};

export function getHandler(resourceType: string): ResourceHandler {
  return handlerMap.get(resourceType) || defaultHandler;
}

export function getRecoverability(
  change: ResourceChange,
  state: TerraformState | null
): RecoverabilityResult {
  const handler = getHandler(change.type);
  return handler.getRecoverability(change, state);
}

export function getDependencies(
  resource: StateResource,
  allResources: StateResource[]
): ResourceDependency[] {
  const handler = getHandler(resource.type);
  return handler.getDependencies(resource, allResources);
}

export function getSupportedResourceTypes(): string[] {
  return Array.from(handlerMap.keys()).sort();
}

export function isResourceTypeSupported(type: string): boolean {
  return handlerMap.has(type);
}

export function getRecoverabilityTraced(
  change: ResourceChange,
  state: TerraformState | null
): ClassificationTrace {
  const handler = getHandler(change.type);
  const ctx = new ClassificationContext(
    change.address,
    change.type,
    change.actions.includes('delete')
      ? (change.actions.includes('create') ? 'replace' : 'delete')
      : change.actions.includes('create')
      ? 'create'
      : 'update'
  );

  // If handler supports tracing, use it
  if (handler.getRecoverabilityTraced) {
    return handler.getRecoverabilityTraced(change, state, ctx);
  }

  // Fallback: wrap the basic result in a minimal trace
  const result = handler.getRecoverability(change, state);

  ctx.check('resource_type', change.type, {
    passed: true,
    note: isResourceTypeSupported(change.type)
      ? 'Resource type recognized'
      : 'Resource type not specifically handled; using defaults',
  });

  ctx.limitation('This resource type does not yet have detailed tracing; showing basic classification only');

  return ctx.build(result);
}

export function hasDetailedTracing(resourceType: string): boolean {
  const handler = handlerMap.get(resourceType);
  return !!handler?.getRecoverabilityTraced;
}

// Re-export types
export * from './types.js';
export type { ClassificationTrace } from '../analyzer/trace.js';
