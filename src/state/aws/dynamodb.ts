import type { EvidenceItem, MissingEvidence } from '../../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../../resources/types.js';
import type { AwsSignedClient } from './client.js';

export interface DynamoDbTableEvidence {
  tableName: string;
  region?: string;
  exists?: boolean;
  tableStatus?: string;
  itemCount?: number;
  deletionProtectionEnabled?: boolean;
  pointInTimeRecoveryStatus?: string;
  backupCount?: number;
  latestBackupTime?: string;
  replicaRegions?: string[];
  missingEvidence?: string[];
}

export interface DynamoDbEvidenceAnalysis {
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
}

export async function readDynamoDbTableEvidence(
  client: AwsSignedClient,
  tableName: string,
  region = 'us-east-1'
): Promise<DynamoDbTableEvidence> {
  const [tableResponse, backupsResponse, continuousBackupsResponse] = await Promise.all([
    requestDynamoDb(client, region, 'DynamoDB_20120810.DescribeTable', { TableName: tableName }),
    requestDynamoDb(client, region, 'DynamoDB_20120810.ListBackups', { TableName: tableName }),
    requestDynamoDb(client, region, 'DynamoDB_20120810.DescribeContinuousBackups', { TableName: tableName }),
  ]);

  const table = parseJsonObject(tableResponse.body)?.Table as Record<string, unknown> | undefined;
  const backups = parseJsonObject(backupsResponse.body)?.BackupSummaries;
  const continuousBackups = parseJsonObject(continuousBackupsResponse.body)
    ?.ContinuousBackupsDescription as Record<string, unknown> | undefined;
  const backupSummaries = Array.isArray(backups) ? backups as Record<string, unknown>[] : [];

  return {
    tableName,
    region,
    exists: tableResponse.statusCode === 200 && Boolean(table),
    tableStatus: stringValue(table?.TableStatus),
    itemCount: numberValue(table?.ItemCount),
    deletionProtectionEnabled: booleanValue(table?.DeletionProtectionEnabled),
    pointInTimeRecoveryStatus: stringValue(
      (continuousBackups?.PointInTimeRecoveryDescription as Record<string, unknown> | undefined)
        ?.PointInTimeRecoveryStatus
    ),
    backupCount: backupsResponse.statusCode === 200 ? backupSummaries.length : undefined,
    latestBackupTime: latestBackupTime(backupSummaries),
    replicaRegions: replicaRegions(table?.Replicas),
    missingEvidence: [
      isUnavailable(tableResponse.statusCode) ? 'dynamodb.table' : '',
      isUnavailable(backupsResponse.statusCode) ? 'dynamodb.backups' : '',
      isUnavailable(continuousBackupsResponse.statusCode) ? 'dynamodb.continuous_backups' : '',
    ].filter(Boolean),
  };
}

export function analyzeDynamoDbTableDeletionEvidence(
  evidence: DynamoDbTableEvidence
): DynamoDbEvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);

  if (evidence.deletionProtectionEnabled === true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'DynamoDB deletion protection is enabled; delete attempts should be blocked by AWS until protection is disabled',
        source: 'rules',
        confidence: 0.95,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (
    evidence.pointInTimeRecoveryStatus === 'ENABLED'
    || (evidence.backupCount ?? 0) > 0
  ) {
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'DynamoDB point-in-time recovery or backups are available for this table',
        source: 'rules',
        confidence: 0.9,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (missingEvidence.length > 0 || evidence.exists !== true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'DynamoDB deletion cannot be classified safely without complete table and backup evidence',
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
      reasoning: 'DynamoDB table has no deletion protection, point-in-time recovery, or backup evidence',
      source: 'rules',
      confidence: 0.9,
    },
    evidence: evidenceItems,
    missingEvidence,
  };
}

function requestDynamoDb(
  client: AwsSignedClient,
  region: string,
  target: string,
  body: Record<string, unknown>
) {
  return client.request({
    method: 'POST',
    service: 'dynamodb',
    region,
    host: `dynamodb.${region}.amazonaws.com`,
    path: '/',
    headers: {
      'content-type': 'application/x-amz-json-1.0',
      'x-amz-target': target,
    },
    body: JSON.stringify(body),
  }).catch(error => ({
    statusCode: 0,
    body: String(error instanceof Error ? error.message : error),
    headers: {},
  }));
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function latestBackupTime(backups: Record<string, unknown>[]): string | undefined {
  return backups
    .map(backup => stringValue(backup.BackupCreationDateTime))
    .filter((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function replicaRegions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(replica => stringValue((replica as Record<string, unknown>).RegionName))
    .filter((region): region is string => Boolean(region));
}

function isUnavailable(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 403 || statusCode >= 500;
}

function toEvidenceItems(evidence: DynamoDbTableEvidence): EvidenceItem[] {
  return [
    {
      key: 'dynamodb.table',
      value: evidence.tableName,
      present: true,
      description: 'DynamoDB table targeted by the mutation',
    },
    {
      key: 'dynamodb.deletion_protection',
      value: evidence.deletionProtectionEnabled,
      present: evidence.deletionProtectionEnabled === true,
      description: 'DynamoDB deletion protection setting',
    },
    {
      key: 'dynamodb.pitr',
      value: evidence.pointInTimeRecoveryStatus,
      present: evidence.pointInTimeRecoveryStatus === 'ENABLED',
      description: 'DynamoDB point-in-time recovery status',
    },
    {
      key: 'dynamodb.backup_count',
      value: evidence.backupCount,
      present: (evidence.backupCount ?? 0) > 0,
      description: 'DynamoDB on-demand backups for the table',
    },
    {
      key: 'dynamodb.item_count',
      value: evidence.itemCount,
      present: (evidence.itemCount ?? 0) > 0,
      description: 'Approximate DynamoDB item count',
    },
    {
      key: 'dynamodb.replica_regions',
      value: evidence.replicaRegions,
      present: (evidence.replicaRegions?.length ?? 0) > 0,
      description: 'DynamoDB global table replica regions',
    },
  ];
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live DynamoDB state`,
    effect: 'requires-review',
  }));
}
