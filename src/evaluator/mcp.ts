import { mcpToolCallToMutation, type McpToolCall } from '../adapters/mcp.js';
import type { AdapterContext } from '../adapters/types.js';
import { conservativeUnknownClassifier } from '../classifier/unknown-resource.js';
import type {
  AnalyzedMutation,
  ConsequenceReport,
  MutationAction,
  MutationIntent,
  RequiredEvidence,
  EvidenceItem,
} from '../core/index.js';
import {
  buildRequiredEvidence,
  getEvidenceRequirements,
  DEFAULT_UNKNOWN_REQUIREMENTS,
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

  // Build required evidence for the consequence report
  const requiredEvidence = buildRequiredEvidenceForIntent(intent, mutation.evidence);

  return {
    mutations: [mutation],
    summary: {
      totalMutations: 1,
      worstRecoverability: recoverability,
      needsReview: recoverability.tier === RecoverabilityTier.NEEDS_REVIEW,
      hasUnrecoverable: recoverability.tier === RecoverabilityTier.UNRECOVERABLE,
      dependencyImpactCount: 0,
    },
    riskAssessment: policyEvaluation.decision,
    assessmentReason: policyEvaluation.reason,
    requiredEvidence,
  };
}

function getRdsAnalysis(
  intent: MutationIntent,
  rdsInstances: Record<string, RdsInstanceEvidence> | undefined
) {
  if (!rdsInstances || intent.action !== 'delete') {
    return null;
  }

  const service = intent.target.service?.toLowerCase() ?? '';
  const isAwsRds = service === 'aws-rds'
    || service === 'aws'
    || service.includes('rds')
    || service.includes('db')
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

  const service = intent.target.service?.toLowerCase() ?? '';
  const isAwsS3 = service === 'aws-s3'
    || service === 'aws'
    || service.includes('s3')
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

/**
 * Map MCP service/target to Terraform resource type for evidence requirements.
 */
function inferResourceType(intent: MutationIntent): string | null {
  const service = intent.target.service?.toLowerCase() ?? '';
  const type = intent.target.type?.toLowerCase() ?? '';

  // AWS S3
  if (service.includes('s3') || type.includes('bucket')) {
    return 'aws_s3_bucket';
  }
  // AWS RDS
  if (service.includes('rds') || type.includes('db_instance') || type.includes('database')) {
    return 'aws_db_instance';
  }
  // AWS DynamoDB
  if (service.includes('dynamodb') || type.includes('dynamodb')) {
    return 'aws_dynamodb_table';
  }
  // AWS IAM Role
  if ((service.includes('iam') && type.includes('role')) || type === 'role') {
    return 'aws_iam_role';
  }
  // AWS IAM User
  if (service.includes('iam') && type.includes('user')) {
    return 'aws_iam_user';
  }
  // AWS KMS
  if (service.includes('kms') || type.includes('key')) {
    return 'aws_kms_key';
  }
  // AWS VPC (must check before generic EC2)
  if (service.includes('vpc') || type.includes('vpc')) {
    return 'aws_vpc';
  }
  // AWS Elastic IP (must check before generic EC2)
  // Matches: aws_ec2_release_address, eip tools, etc.
  if (service.includes('eip') || type.includes('elastic_ip') || service.includes('release_address') || type.includes('address')) {
    return 'aws_eip';
  }
  // AWS EBS Volume (must check before generic EC2)
  if (type.includes('volume') || service.includes('volume')) {
    return 'aws_ebs_volume';
  }
  // AWS Subnet (must check before generic EC2)
  if (service.includes('subnet') || type.includes('subnet')) {
    return 'aws_subnet';
  }
  // AWS NAT Gateway (must check before generic EC2)
  if (service.includes('nat_gateway') || service.includes('nat-gateway') || type.includes('nat_gateway')) {
    return 'aws_nat_gateway';
  }
  // AWS EC2 Instance
  if (service.includes('ec2') || service.includes('terminate') || type.includes('instance')) {
    return 'aws_instance';
  }
  // AWS Lambda
  if (service.includes('lambda') || type.includes('function')) {
    return 'aws_lambda_function';
  }
  // AWS Secrets Manager
  if (service.includes('secret') || service.includes('secretsmanager')) {
    return 'aws_secretsmanager_secret';
  }
  // AWS Route53
  if (service.includes('route53') || service.includes('dns') || type.includes('zone') || type.includes('hosted')) {
    return 'aws_route53_zone';
  }
  // AWS ECS Service
  if (service.includes('ecs') || type.includes('ecs_service') || type.includes('service')) {
    return 'aws_ecs_service';
  }
  // AWS EKS Cluster
  if (service.includes('eks') || type.includes('eks_cluster') || type.includes('cluster')) {
    return 'aws_eks_cluster';
  }

  return null;
}

/**
 * Build RequiredEvidence for a mutation intent.
 */
function buildRequiredEvidenceForIntent(
  intent: MutationIntent,
  evidence: EvidenceItem[]
): RequiredEvidence {
  const resourceType = inferResourceType(intent);
  const action = intent.action === 'delete' ? 'delete'
    : intent.action === 'create' ? 'create'
    : 'update';

  if (!resourceType) {
    // Unknown resource type - use default requirements
    return buildRequiredEvidence(
      intent.target.type ?? 'unknown',
      action,
      evidence,
      DEFAULT_UNKNOWN_REQUIREMENTS
    );
  }

  const requirements = getEvidenceRequirements(resourceType, action);
  if (!requirements) {
    // Known resource type but no requirements defined for this action
    return {
      resourceType,
      action,
      requirementsDefined: false,
      requirements: [],
      summary: { total: 0, satisfied: 0, missingRequired: 0, missingBlocking: 0 },
      sufficient: true,
      sufficiency: 'sufficient',
    };
  }

  return buildRequiredEvidence(resourceType, action, evidence, requirements);
}
