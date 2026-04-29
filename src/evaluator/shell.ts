import { shellCommandToMutation, type ShellCommandInput } from '../adapters/shell.js';
import type { AdapterContext } from '../adapters/types.js';
import { conservativeUnknownClassifier } from '../classifier/unknown-resource.js';
import type {
  AnalyzedMutation,
  ConsequenceReport,
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

export interface ShellConsequenceOptions {
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

export function evaluateShellCommandConsequences(
  input: ShellCommandInput | string,
  options: ShellConsequenceOptions = {}
): ConsequenceReport {
  const command = typeof input === 'string' ? input : input.command;
  const intent = shellCommandToMutation(command, {
    ...options.adapterContext,
    metadata: {
      ...options.adapterContext?.metadata,
      cwd: typeof input === 'string' ? undefined : input.cwd,
    },
  });

  const s3Analysis = getS3Analysis(intent, options.awsEvidence?.s3Buckets);
  const rdsAnalysis = getRdsAnalysis(intent, options.awsEvidence?.rdsInstances);
  const dynamoDbAnalysis = getDynamoDbAnalysis(intent, options.awsEvidence?.dynamoDbTables);
  const iamAnalysis = getIamAnalysis(intent, options.awsEvidence?.iamRoles);
  const kmsAnalysis = getKmsAnalysis(intent, options.awsEvidence?.kmsKeys);
  const stateAnalysis = s3Analysis ?? rdsAnalysis ?? dynamoDbAnalysis ?? iamAnalysis ?? kmsAnalysis;
  const recoverability = stateAnalysis?.recoverability ?? classifyShellIntent(intent);
  const policyEvaluation = evaluateRecoverability(recoverability, options.policy);

  const mutation: AnalyzedMutation = {
    intent,
    recoverability,
    evidence: [
      {
        key: 'shell.command',
        value: command,
        present: true,
        description: 'Shell command proposed for execution',
      },
      {
        key: 'shell.pattern',
        value: intent.target.type,
        present: intent.target.type !== 'shell_command',
        description: 'Known high-risk shell command pattern',
      },
      ...(stateAnalysis?.evidence ?? []),
    ],
    missingEvidence: stateAnalysis?.missingEvidence ?? (recoverability.tier === RecoverabilityTier.NEEDS_REVIEW
      ? [
          {
            key: 'live-state',
            description: 'No live state reader has verified target contents, dependencies, backups, or rollback path',
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
  if (!rdsInstances || intent.target.service !== 'aws-rds' || intent.action !== 'delete') {
    return null;
  }

  const evidence = rdsInstances[intent.target.id];
  return evidence ? analyzeRdsInstanceDeletionEvidence(evidence) : null;
}

function getDynamoDbAnalysis(
  intent: MutationIntent,
  dynamoDbTables: Record<string, DynamoDbTableEvidence> | undefined
) {
  if (!dynamoDbTables || intent.target.service !== 'aws-dynamodb' || intent.action !== 'delete') {
    return null;
  }

  const evidence = dynamoDbTables[intent.target.id];
  return evidence ? analyzeDynamoDbTableDeletionEvidence(evidence) : null;
}

function getIamAnalysis(
  intent: MutationIntent,
  iamRoles: Record<string, IamRoleEvidence> | undefined
) {
  if (!iamRoles || intent.target.service !== 'aws-iam' || intent.action !== 'delete') {
    return null;
  }

  const evidence = iamRoles[intent.target.id];
  return evidence ? analyzeIamRoleDeletionEvidence(evidence) : null;
}

function getKmsAnalysis(
  intent: MutationIntent,
  kmsKeys: Record<string, KmsKeyEvidence> | undefined
) {
  if (!kmsKeys || intent.target.service !== 'aws-kms' || intent.action !== 'delete') {
    return null;
  }

  const evidence = kmsKeys[intent.target.id];
  return evidence ? analyzeKmsKeyDeletionEvidence(evidence) : null;
}

function getS3Analysis(
  intent: MutationIntent,
  s3Buckets: Record<string, S3BucketEvidence> | undefined
) {
  if (!s3Buckets || intent.target.service !== 'aws-s3' || intent.action !== 'delete') {
    return null;
  }

  const bucket = bucketNameFromS3Target(intent.target.id);
  const evidence = s3Buckets[bucket];
  return evidence ? analyzeS3BucketDeletionEvidence(evidence) : null;
}

function bucketNameFromS3Target(targetId: string): string {
  const withoutScheme = targetId.replace(/^s3:\/\//, '');
  return withoutScheme.split('/')[0] || targetId;
}

function classifyShellIntent(intent: MutationIntent): RecoverabilityResult {
  if (intent.target.type === 'shell_command') {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'No high-risk mutation pattern recognized in shell command',
      source: 'rules',
      confidence: 0.6,
    };
  }

  return conservativeUnknownClassifier.classify({
    intent,
    evidence: [
      {
        key: 'recognized-shell-pattern',
        value: intent.target.type,
        present: true,
        description: 'Command matched a high-risk mutation pattern',
      },
    ],
    missingEvidence: [
      {
        key: 'live-state',
        description: 'No domain state reader has evaluated this command target yet',
        effect: 'requires-review',
      },
    ],
  });
}
