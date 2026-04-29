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

  if (evidence.deletionProtection === true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'RDS deletion protection is enabled; delete attempts should be blocked by AWS until protection is disabled',
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
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'RDS backups, point-in-time restore, or snapshots are available for this instance',
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
        reasoning: 'RDS deletion cannot be classified safely without complete instance and snapshot evidence',
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
      reasoning: 'RDS instance has no deletion protection, backup retention, latest restorable time, or snapshots',
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

function toEvidenceItems(evidence: RdsInstanceEvidence): EvidenceItem[] {
  return [
    {
      key: 'rds.instance',
      value: evidence.dbInstanceIdentifier,
      present: true,
      description: 'RDS instance targeted by the mutation',
    },
    {
      key: 'rds.deletion_protection',
      value: evidence.deletionProtection,
      present: evidence.deletionProtection === true,
      description: 'RDS deletion protection setting',
    },
    {
      key: 'rds.backup_retention_period',
      value: evidence.backupRetentionPeriod,
      present: (evidence.backupRetentionPeriod ?? 0) > 0,
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
      present: (evidence.snapshotCount ?? 0) > 0,
      description: 'RDS snapshots associated with the DB instance',
    },
    {
      key: 'rds.multi_az',
      value: evidence.multiAz,
      present: evidence.multiAz === true,
      description: 'RDS Multi-AZ deployment setting',
    },
    {
      key: 'rds.read_replicas',
      value: evidence.readReplicas,
      present: (evidence.readReplicas?.length ?? 0) > 0,
      description: 'RDS read replicas attached to the DB instance',
    },
  ];
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live RDS state`,
    effect: 'requires-review',
  }));
}
