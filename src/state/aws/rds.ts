import type { EvidenceItem, MissingEvidence } from '../../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../../resources/types.js';
import type { AwsSignedClient } from './client.js';

export interface RdsInstanceEvidence {
  dbInstanceIdentifier: string;
  region?: string;
  exists?: boolean;
  engine?: string;
  deletionProtection?: boolean;
  backupRetentionPeriod?: number;
  latestRestorableTime?: string;
  multiAz?: boolean;
  readReplicaSource?: string;
  readReplicas?: string[];
  snapshotCount?: number;
  latestSnapshotTime?: string;
  missingEvidence?: string[];
}

export interface RdsEvidenceAnalysis {
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
}

export async function readRdsInstanceEvidence(
  client: AwsSignedClient,
  dbInstanceIdentifier: string,
  region = 'us-east-1'
): Promise<RdsInstanceEvidence> {
  const [instanceResponse, snapshotResponse] = await Promise.all([
    requestRds(client, region, {
      Action: 'DescribeDBInstances',
      DBInstanceIdentifier: dbInstanceIdentifier,
      Version: '2014-10-31',
    }),
    requestRds(client, region, {
      Action: 'DescribeDBSnapshots',
      DBInstanceIdentifier: dbInstanceIdentifier,
      Version: '2014-10-31',
    }),
  ]);

  const instanceXml = instanceResponse.body;
  const snapshotXml = snapshotResponse.body;
  const snapshotTimes = xmlValues(snapshotXml, 'SnapshotCreateTime');

  return {
    dbInstanceIdentifier,
    region,
    exists: instanceResponse.statusCode === 200 && instanceXml.includes('<DBInstance>'),
    engine: xmlValue(instanceXml, 'Engine'),
    deletionProtection: xmlBoolean(instanceXml, 'DeletionProtection'),
    backupRetentionPeriod: xmlNumber(instanceXml, 'BackupRetentionPeriod'),
    latestRestorableTime: xmlValue(instanceXml, 'LatestRestorableTime'),
    multiAz: xmlBoolean(instanceXml, 'MultiAZ'),
    readReplicaSource: xmlValue(instanceXml, 'ReadReplicaSourceDBInstanceIdentifier'),
    readReplicas: xmlValues(instanceXml, 'ReadReplicaDBInstanceIdentifier'),
    snapshotCount: snapshotResponse.statusCode === 200
      ? xmlValues(snapshotXml, 'DBSnapshotIdentifier').length
      : undefined,
    latestSnapshotTime: latestIsoTime(snapshotTimes),
    missingEvidence: [
      isUnavailable(instanceResponse.statusCode) ? 'rds.instance' : '',
      isUnavailable(snapshotResponse.statusCode) ? 'rds.snapshots' : '',
    ].filter(Boolean),
  };
}

export function analyzeRdsInstanceDeletionEvidence(
  evidence: RdsInstanceEvidence
): RdsEvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);
  const protections = buildProtectionSummary(evidence);

  if (evidence.deletionProtection === true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: `RDS instance '${evidence.dbInstanceIdentifier}'${protections} has deletion protection enabled; delete attempts will be blocked by AWS`,
        source: 'rules',
        confidence: 0.95,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (
    (evidence.backupRetentionPeriod ?? 0) > 0
    || Boolean(evidence.latestRestorableTime)
    || (evidence.snapshotCount ?? 0) > 0
  ) {
    // Build specific recovery info
    const recoveryOptions: string[] = [];
    if ((evidence.snapshotCount ?? 0) > 0) {
      const snapInfo = `${evidence.snapshotCount} snapshot${evidence.snapshotCount !== 1 ? 's' : ''}`;
      if (evidence.latestSnapshotTime) {
        recoveryOptions.push(`${snapInfo} (latest: ${formatTimeAgo(evidence.latestSnapshotTime)})`);
      } else {
        recoveryOptions.push(snapInfo);
      }
    }
    if (evidence.latestRestorableTime) {
      recoveryOptions.push(`PITR available`);
    }
    if ((evidence.backupRetentionPeriod ?? 0) > 0) {
      recoveryOptions.push(`${evidence.backupRetentionPeriod}-day automated backups`);
    }

    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: `RDS instance '${evidence.dbInstanceIdentifier}'${evidence.engine ? ` (${evidence.engine})` : ''} is recoverable: ${recoveryOptions.join(', ')}`,
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
        reasoning: `RDS instance '${evidence.dbInstanceIdentifier}' deletion cannot be classified safely without complete instance and snapshot evidence`,
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
      reasoning: `RDS instance '${evidence.dbInstanceIdentifier}'${evidence.engine ? ` (${evidence.engine})` : ''} has no deletion protection, no automated backups, no PITR, and no snapshots; deletion is UNRECOVERABLE`,
      source: 'rules',
      confidence: 0.9,
    },
    evidence: evidenceItems,
    missingEvidence,
  };
}

function requestRds(
  client: AwsSignedClient,
  region: string,
  params: Record<string, string>
) {
  return client.request({
    method: 'GET',
    service: 'rds',
    region,
    host: `rds.${region}.amazonaws.com`,
    path: '/',
    query: canonicalQuery(params),
  }).catch(error => ({
    statusCode: 0,
    body: String(error instanceof Error ? error.message : error),
    headers: {},
  }));
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1];
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g'))]
    .map(match => match[1]);
}

function xmlBoolean(xml: string, tag: string): boolean | undefined {
  const value = xmlValue(xml, tag);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function xmlNumber(xml: string, tag: string): number | undefined {
  const value = xmlValue(xml, tag);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function latestIsoTime(values: string[]): string | undefined {
  return values
    .filter(value => !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function isUnavailable(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 403 || statusCode >= 500;
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
 * Build a protection summary string for reasoning
 */
function buildProtectionSummary(evidence: RdsInstanceEvidence): string {
  const parts: string[] = [];

  if (evidence.engine) {
    parts.push(evidence.engine);
  }

  if ((evidence.backupRetentionPeriod ?? 0) > 0) {
    parts.push(`${evidence.backupRetentionPeriod}-day backup retention`);
  }

  if ((evidence.snapshotCount ?? 0) > 0) {
    const snapInfo = `${evidence.snapshotCount} snapshot${evidence.snapshotCount !== 1 ? 's' : ''}`;
    if (evidence.latestSnapshotTime) {
      parts.push(`${snapInfo}, latest ${formatTimeAgo(evidence.latestSnapshotTime)}`);
    } else {
      parts.push(snapInfo);
    }
  }

  if (evidence.latestRestorableTime) {
    parts.push(`PITR available to ${formatTimeAgo(evidence.latestRestorableTime)}`);
  }

  if (evidence.multiAz) {
    parts.push('Multi-AZ');
  }

  if ((evidence.readReplicas?.length ?? 0) > 0) {
    parts.push(`${evidence.readReplicas!.length} read replica${evidence.readReplicas!.length !== 1 ? 's' : ''}`);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function toEvidenceItems(evidence: RdsInstanceEvidence): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      key: 'rds.instance',
      value: evidence.dbInstanceIdentifier,
      present: true,
      description: 'RDS instance targeted by the mutation',
    },
    {
      key: 'rds.engine',
      value: evidence.engine,
      present: Boolean(evidence.engine),
      description: 'RDS database engine type',
    },
    {
      key: 'rds.deletion_protection',
      value: evidence.deletionProtection,
      present: evidence.deletionProtection !== undefined,
      description: 'RDS deletion protection setting',
    },
    {
      key: 'rds.backup_retention_period',
      value: evidence.backupRetentionPeriod,
      present: evidence.backupRetentionPeriod !== undefined,
      description: 'RDS automated backup retention period in days',
    },
    {
      key: 'rds.latest_restorable_time',
      value: evidence.latestRestorableTime,
      present: Boolean(evidence.latestRestorableTime),
      description: 'RDS point-in-time restore availability',
    },
    {
      key: 'rds.snapshot_count',
      value: evidence.snapshotCount,
      present: evidence.snapshotCount !== undefined,
      description: 'Number of manual snapshots for this DB instance',
    },
    {
      key: 'rds.latest_snapshot_time',
      value: evidence.latestSnapshotTime,
      present: Boolean(evidence.latestSnapshotTime),
      description: 'Most recent snapshot creation timestamp',
    },
    {
      key: 'rds.multi_az',
      value: evidence.multiAz,
      present: evidence.multiAz !== undefined,
      description: 'RDS Multi-AZ deployment setting',
    },
    {
      key: 'rds.read_replicas',
      value: evidence.readReplicas,
      present: (evidence.readReplicas?.length ?? 0) > 0,
      description: 'RDS read replicas attached to the DB instance',
    },
  ];

  return items;
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live RDS state`,
    effect: 'requires-review',
  }));
}
