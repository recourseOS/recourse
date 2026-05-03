import type { EvidenceItem, MissingEvidence, TrackedEvidence, StateAssessment } from '../../core/index.js';
import {
  assessState,
  getEvidenceRequirements,
} from '../../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../../resources/types.js';
import type { AwsSignedClient } from './client.js';

export interface S3BucketEvidence {
  bucket: string;
  region?: string;
  exists?: boolean;
  versioning?: 'Enabled' | 'Suspended' | 'Off' | 'Unknown';
  objectLockEnabled?: boolean;
  hasReplication?: boolean;
  hasLifecycleRules?: boolean;
  isEmpty?: boolean;
  tags?: Record<string, string>;
  missingEvidence?: string[];
}

export interface S3EvidenceAnalysis {
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
}

export async function readS3BucketEvidence(
  client: AwsSignedClient,
  bucket: string,
  region = 'us-east-1'
): Promise<S3BucketEvidence> {
  const [versioning, objectLock, replication, lifecycle, objectList] = await Promise.all([
    requestOptional(client, bucket, region, 'versioning='),
    requestOptional(client, bucket, region, 'object-lock='),
    requestOptional(client, bucket, region, 'replication='),
    requestOptional(client, bucket, region, 'lifecycle='),
    requestOptional(client, bucket, region, 'list-type=2&max-keys=1'),
  ]);

  return {
    bucket,
    region,
    exists: [versioning, objectLock, replication, lifecycle, objectList].some(
      response => response.statusCode !== 404
    ),
    versioning: parseVersioningStatus(versioning.body),
    objectLockEnabled: objectLock.statusCode === 200 && /<ObjectLockEnabled>Enabled<\/ObjectLockEnabled>/.test(objectLock.body),
    hasReplication: replication.statusCode === 200 && /<ReplicationConfiguration/.test(replication.body),
    hasLifecycleRules: lifecycle.statusCode === 200 && /<Rule>/.test(lifecycle.body),
    isEmpty: objectList.statusCode === 200
      ? !/<Contents>/.test(objectList.body)
      : undefined,
    missingEvidence: [
      isUnavailable(versioning.statusCode) ? 's3.versioning' : '',
      isUnavailable(objectLock.statusCode) ? 's3.object_lock' : '',
      isUnavailable(replication.statusCode) ? 's3.replication' : '',
      isUnavailable(lifecycle.statusCode) ? 's3.lifecycle' : '',
      isUnavailable(objectList.statusCode) ? 's3.object_listing' : '',
    ].filter(Boolean),
  };
}

export function analyzeS3BucketDeletionEvidence(
  evidence: S3BucketEvidence
): S3EvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);

  if (evidence.objectLockEnabled) {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'S3 object lock is enabled; destructive deletion is constrained by retention controls',
        source: 'rules',
        confidence: 0.95,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (evidence.isEmpty === true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'S3 bucket appears empty; bucket deletion can be recreated but metadata may require manual restoration',
        source: 'rules',
        confidence: 0.8,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (evidence.versioning === 'Enabled' || evidence.hasReplication) {
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'S3 bucket has versioning or replication evidence that may support object recovery',
        source: 'rules',
        confidence: 0.85,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (missingEvidence.length > 0 || evidence.isEmpty === undefined) {
    return {
      recoverability: {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'S3 bucket deletion cannot be classified safely without complete live-state evidence',
        source: 'rules',
        confidence: 0.45,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  return {
    recoverability: {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'S3 bucket contains objects and no versioning, object lock, or replication evidence was found',
      source: 'rules',
      confidence: 0.9,
    },
    evidence: evidenceItems,
    missingEvidence,
  };
}

function requestOptional(
  client: AwsSignedClient,
  bucket: string,
  region: string,
  query: string
) {
  return client.request({
    method: 'GET',
    service: 's3',
    region,
    host: `${bucket}.s3.${region}.amazonaws.com`,
    path: '/',
    query,
  }).catch(error => ({
    statusCode: 0,
    body: String(error instanceof Error ? error.message : error),
    headers: {},
  }));
}

function parseVersioningStatus(body: string): S3BucketEvidence['versioning'] {
  const match = body.match(/<Status>([^<]+)<\/Status>/);
  if (match?.[1] === 'Enabled') return 'Enabled';
  if (match?.[1] === 'Suspended') return 'Suspended';
  if (body.includes('<VersioningConfiguration')) return 'Off';
  return 'Unknown';
}

function isUnavailable(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 403 || statusCode >= 500;
}

function toEvidenceItems(evidence: S3BucketEvidence): EvidenceItem[] {
  // Note: 'present' means "we gathered this evidence" not "feature is enabled"
  // A value of 'Unknown' or undefined means evidence was not gathered
  const missingSet = new Set(evidence.missingEvidence ?? []);

  return [
    {
      key: 's3.bucket',
      value: evidence.bucket,
      present: true,
      description: 'S3 bucket targeted by the mutation',
    },
    {
      key: 's3.versioning',
      value: evidence.versioning,
      present: evidence.versioning !== 'Unknown' && !missingSet.has('s3.versioning'),
      description: 'S3 bucket versioning status',
    },
    {
      key: 's3.object_lock',
      value: evidence.objectLockEnabled,
      present: evidence.objectLockEnabled !== undefined && !missingSet.has('s3.object_lock'),
      description: 'S3 object lock retention controls',
    },
    {
      key: 's3.replication',
      value: evidence.hasReplication,
      present: evidence.hasReplication !== undefined && !missingSet.has('s3.replication'),
      description: 'S3 replication configuration',
    },
    {
      key: 's3.lifecycle',
      value: evidence.hasLifecycleRules,
      present: evidence.hasLifecycleRules !== undefined && !missingSet.has('s3.lifecycle'),
      description: 'S3 lifecycle configuration',
    },
    {
      key: 's3.empty',
      value: evidence.isEmpty,
      present: evidence.isEmpty !== undefined && !missingSet.has('s3.object_listing'),
      description: 'Whether live listing found objects in the bucket',
    },
  ];
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live S3 state`,
    effect: 'requires-review',
  }));
}

/**
 * Convert S3 evidence to tracked evidence with source and timestamp.
 */
export function toTrackedEvidence(
  evidence: S3BucketEvidence,
  gatheredAt?: string
): TrackedEvidence[] {
  const items = toEvidenceItems(evidence);
  return items.map(item => ({
    ...item,
    source: 'live_api' as const,
    gatheredAt,
  }));
}

/**
 * Assess the quality of S3 bucket evidence for deletion classification.
 * Returns a StateAssessment indicating whether classification is safe.
 */
export function assessS3BucketDeletionState(
  evidence: S3BucketEvidence,
  gatheredAt?: string
): StateAssessment {
  const requirements = getEvidenceRequirements('aws_s3_bucket', 'delete') ?? [];
  const tracked = toTrackedEvidence(evidence, gatheredAt);
  return assessState(tracked, requirements, 300); // 5 min max freshness for S3
}
