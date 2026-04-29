import { mcpToolCallToMutation, type McpToolCall } from '../adapters/mcp.js';
import type { AdapterContext } from '../adapters/types.js';
import { conservativeUnknownClassifier } from '../classifier/unknown-resource.js';
import type {
  AnalyzedMutation,
  ConsequenceReport,
  MutationAction,
  MutationIntent,
} from '../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../resources/types.js';
import {
  evaluateRecoverability,
  type LocalPolicy,
} from '../policy/local.js';
import {
  analyzeDynamoDbTableDeletionEvidence,
  analyzeIamRoleDeletionEvidence,
  analyzeKmsKeyDeletionEvidence,
  analyzeRdsInstanceDeletionEvidence,
  analyzeS3BucketDeletionEvidence,
  type DynamoDbTableEvidence,
  type IamRoleEvidence,
  type KmsKeyEvidence,
  type RdsInstanceEvidence,
  type S3BucketEvidence,
} from '../state/aws/index.js';

export interface McpConsequenceOptions {
  adapterContext?: AdapterContext;
  policy?: LocalPolicy;
  awsEvidence?: {
    s3Buckets?: Record<string, S3BucketEvidence>;
    rdsInstances?: Record<string, RdsInstanceEvidence>;
    dynamoDbTables?: Record<string, DynamoDbTableEvidence>;
    iamRoles?: Record<string, IamRoleEvidence>;
    kmsKeys?: Record<string, KmsKeyEvidence>;
  };
}

const MUTATING_ACTIONS: MutationAction[] = [
  'create',
  'update',
  'delete',
  'replace',
  'execute',
  'grant',
  'revoke',
];

export function evaluateMcpToolCallConsequences(
  call: McpToolCall,
  options: McpConsequenceOptions = {}
): ConsequenceReport {
  const intent = mcpToolCallToMutation(call, options.adapterContext);
  const s3Analysis = getS3Analysis(intent, options.awsEvidence?.s3Buckets);
  const rdsAnalysis = getRdsAnalysis(intent, options.awsEvidence?.rdsInstances);
  const dynamoDbAnalysis = getDynamoDbAnalysis(intent, options.awsEvidence?.dynamoDbTables);
  const iamAnalysis = getIamAnalysis(intent, options.awsEvidence?.iamRoles);
  const kmsAnalysis = getKmsAnalysis(intent, options.awsEvidence?.kmsKeys);
  const stateAnalysis = s3Analysis ?? rdsAnalysis ?? dynamoDbAnalysis ?? iamAnalysis ?? kmsAnalysis;
  const recoverability = stateAnalysis?.recoverability ?? classifyMcpIntent(intent);
  const policyEvaluation = evaluateRecoverability(recoverability, options.policy);

  const mutation: AnalyzedMutation = {
    intent,
    recoverability,
    evidence: [
      {
        key: 'mcp.tool',
        value: call.tool,
        present: true,
        description: 'MCP tool proposed for execution',
      },
      {
        key: 'mcp.arguments',
        value: call.arguments ?? {},
        present: Boolean(call.arguments),
        description: 'Structured MCP tool arguments',
      },
      ...(stateAnalysis?.evidence ?? []),
    ],
    missingEvidence: stateAnalysis?.missingEvidence ?? (recoverability.tier === RecoverabilityTier.NEEDS_REVIEW
      ? [
          {
            key: 'tool-semantics',
            description: 'No deterministic adapter has verified this tool call semantics, dependencies, or rollback path',
            effect: 'requires-review',
          },
        ]
      : []),
    dependencyImpact: [],
  };

  return {
    mutations: [mutation],
    summary: {
      totalMutations: 1,
      worstRecoverability: recoverability,
      needsReview: recoverability.tier === RecoverabilityTier.NEEDS_REVIEW,
      hasUnrecoverable: recoverability.tier === RecoverabilityTier.UNRECOVERABLE,
      dependencyImpactCount: 0,
    },
    decision: policyEvaluation.decision,
    decisionReason: policyEvaluation.reason,
  };
}

function getRdsAnalysis(
  intent: MutationIntent,
  rdsInstances: Record<string, RdsInstanceEvidence> | undefined
) {
  if (!rdsInstances || intent.action !== 'delete') {
    return null;
  }

  const isAwsRds = intent.target.service === 'aws-rds'
    || intent.target.service === 'aws'
    || intent.target.provider === 'aws';
  if (!isAwsRds) return null;

  const evidence = rdsInstances[intent.target.id];
  return evidence ? analyzeRdsInstanceDeletionEvidence(evidence) : null;
}

function getDynamoDbAnalysis(
  intent: MutationIntent,
  dynamoDbTables: Record<string, DynamoDbTableEvidence> | undefined
) {
  if (!dynamoDbTables || intent.action !== 'delete') {
    return null;
  }

  const isAwsDynamoDb = intent.target.service === 'aws-dynamodb'
    || intent.target.service === 'aws'
    || intent.target.provider === 'aws';
  if (!isAwsDynamoDb) return null;

  const evidence = dynamoDbTables[intent.target.id];
  return evidence ? analyzeDynamoDbTableDeletionEvidence(evidence) : null;
}

function getIamAnalysis(
  intent: MutationIntent,
  iamRoles: Record<string, IamRoleEvidence> | undefined
) {
  if (!iamRoles || intent.action !== 'delete') {
    return null;
  }

  const isAwsIam = intent.target.service === 'aws-iam'
    || intent.target.service === 'aws'
    || intent.target.provider === 'aws';
  if (!isAwsIam) return null;

  const evidence = iamRoles[intent.target.id];
  return evidence ? analyzeIamRoleDeletionEvidence(evidence) : null;
}

function getKmsAnalysis(
  intent: MutationIntent,
  kmsKeys: Record<string, KmsKeyEvidence> | undefined
) {
  if (!kmsKeys || intent.action !== 'delete') {
    return null;
  }

  const isAwsKms = intent.target.service === 'aws-kms'
    || intent.target.service === 'aws'
    || intent.target.provider === 'aws';
  if (!isAwsKms) return null;

  const evidence = kmsKeys[intent.target.id];
  return evidence ? analyzeKmsKeyDeletionEvidence(evidence) : null;
}

function getS3Analysis(
  intent: MutationIntent,
  s3Buckets: Record<string, S3BucketEvidence> | undefined
) {
  if (!s3Buckets || intent.action !== 'delete') {
    return null;
  }

  const isAwsS3 = intent.target.service === 'aws-s3'
    || intent.target.service === 'aws'
    || intent.target.provider === 'aws';
  if (!isAwsS3) return null;

  const evidence = s3Buckets[intent.target.id];
  return evidence ? analyzeS3BucketDeletionEvidence(evidence) : null;
}

function classifyMcpIntent(intent: MutationIntent): RecoverabilityResult {
  if (!MUTATING_ACTIONS.includes(intent.action)) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'MCP tool call does not match a known mutating action pattern',
      source: 'rules',
      confidence: 0.6,
    };
  }

  if (intent.action === 'execute' && intent.target.type === 'tool_call') {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'MCP tool call has no recognized mutating verb',
      source: 'rules',
      confidence: 0.6,
    };
  }

  return conservativeUnknownClassifier.classify({
    intent,
    evidence: [
      {
        key: 'recognized-mcp-mutation',
        value: intent.action,
        present: true,
        description: 'Tool name matched a mutating action pattern',
      },
    ],
    missingEvidence: [
      {
        key: 'tool-semantics',
        description: 'No deterministic MCP adapter exists for this tool',
        effect: 'requires-review',
      },
    ],
  });
}
