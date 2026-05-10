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
  // Enhanced metrics for consequence reasoning
  objectCount?: number;
  totalSizeBytes?: number;
  lastModified?: string;
  sampleSize?: number; // How many objects we sampled (for large buckets)
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
    requestOptional(client, bucket, region, 'list-type=2&max-keys=1000'), // Get up to 1000 objects for metrics
  ]);

  // Parse object metrics from list response
  const { objectCount, totalSizeBytes, lastModified, hasMore } = parseObjectMetrics(objectList.body);

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
      ? objectCount === 0
      : undefined,
    objectCount: hasMore ? undefined : objectCount, // Only report exact count if we got all objects
    totalSizeBytes: hasMore ? undefined : totalSizeBytes,
    lastModified,
    sampleSize: hasMore ? objectCount : undefined, // Report sample size if we didn't get all
    missingEvidence: [
      isUnavailable(versioning.statusCode) ? 's3.versioning' : '',
      isUnavailable(objectLock.statusCode) ? 's3.object_lock' : '',
      isUnavailable(replication.statusCode) ? 's3.replication' : '',
      isUnavailable(lifecycle.statusCode) ? 's3.lifecycle' : '',
      isUnavailable(objectList.statusCode) ? 's3.object_listing' : '',
    ].filter(Boolean),
  };
}

function parseObjectMetrics(body: string): {
  objectCount: number;
  totalSizeBytes: number;
  lastModified: string | undefined;
  hasMore: boolean;
} {
  const contents = body.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  let totalSizeBytes = 0;
  let lastModified: string | undefined;

  for (const content of contents) {
    const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);
    if (sizeMatch) {
      totalSizeBytes += parseInt(sizeMatch[1], 10);
    }

    const dateMatch = content.match(/<LastModified>([^<]+)<\/LastModified>/);
    if (dateMatch) {
      if (!lastModified || dateMatch[1] > lastModified) {
        lastModified = dateMatch[1];
      }
    }
  }

  const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(body);

  return {
    objectCount: contents.length,
    totalSizeBytes,
    lastModified,
    hasMore: isTruncated,
  };
}

/**
 * Format bytes to human-readable string (e.g., "47.2 GB")
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format time ago (e.g., "2 hours ago", "3 days ago")
 */
function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  return `on ${date.toISOString().split('T')[0]}`;
}

/**
 * Build a metrics summary string for reasoning
 */
function buildMetricsSummary(evidence: S3BucketEvidence): string {
  const parts: string[] = [];

  if (evidence.objectCount !== undefined) {
    parts.push(`${evidence.objectCount.toLocaleString()} object${evidence.objectCount !== 1 ? 's' : ''}`);
  } else if (evidence.sampleSize !== undefined) {
    parts.push(`${evidence.sampleSize.toLocaleString()}+ objects`);
  }

  if (evidence.totalSizeBytes !== undefined && evidence.totalSizeBytes > 0) {
    parts.push(formatBytes(evidence.totalSizeBytes));
  }

  if (evidence.lastModified) {
    parts.push(`last modified ${formatTimeAgo(evidence.lastModified)}`);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function analyzeS3BucketDeletionEvidence(
  evidence: S3BucketEvidence
): S3EvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);
  const metrics = buildMetricsSummary(evidence);

  if (evidence.objectLockEnabled) {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: `S3 bucket '${evidence.bucket}'${metrics} has object lock enabled; destructive deletion is constrained by retention controls`,
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
        reasoning: `S3 bucket '${evidence.bucket}' is empty; bucket deletion can be recreated but metadata may require manual restoration`,
        source: 'rules',
        confidence: 0.8,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (evidence.versioning === 'Enabled' || evidence.hasReplication) {
    const protections: string[] = [];
    if (evidence.versioning === 'Enabled') protections.push('versioning enabled');
    if (evidence.hasReplication) protections.push('replication configured');
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: `S3 bucket '${evidence.bucket}'${metrics} has ${protections.join(' and ')}; objects may be recoverable`,
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
        reasoning: `S3 bucket '${evidence.bucket}' deletion cannot be classified safely without complete live-state evidence`,
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
      reasoning: `S3 bucket '${evidence.bucket}'${metrics} has no versioning, object lock, or replication; deletion is UNRECOVERABLE`,
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

  const items: EvidenceItem[] = [
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

  // Add concrete metrics if available
  if (evidence.objectCount !== undefined) {
    items.push({
      key: 's3.object_count',
      value: evidence.objectCount,
      present: true,
      description: 'Number of objects in the bucket',
    });
  }

  if (evidence.totalSizeBytes !== undefined) {
    items.push({
      key: 's3.total_size_bytes',
      value: evidence.totalSizeBytes,
      present: true,
      description: 'Total size of objects in the bucket (bytes)',
    });
  }

  if (evidence.lastModified !== undefined) {
    items.push({
      key: 's3.last_modified',
      value: evidence.lastModified,
      present: true,
      description: 'Most recent object modification timestamp',
    });
  }

  if (evidence.sampleSize !== undefined) {
    items.push({
      key: 's3.sample_size',
      value: evidence.sampleSize,
      present: true,
      description: 'Number of objects sampled (bucket has more than this)',
    });
  }

  return items;
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
