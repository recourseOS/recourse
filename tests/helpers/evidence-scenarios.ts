import { readFileSync } from 'fs';
import { join } from 'path';
import type { ConsequenceDecision } from '../../src/core/index.js';
import { RecoverabilityTier } from '../../src/resources/types.js';
import type {
  DynamoDbTableEvidence,
  IamRoleEvidence,
  KmsKeyEvidence,
  RdsInstanceEvidence,
  S3BucketEvidence,
} from '../../src/state/aws/index.js';

export type EvidenceKind = 's3' | 'rds' | 'dynamodb' | 'iam' | 'kms';
export type ScenarioSource = 'shell' | 'mcp';

export interface EvidenceFixture<T> {
  evidence: T;
}

export interface EvidenceScenario {
  name: string;
  source: ScenarioSource;
  input: string | {
    server: string;
    tool: string;
    arguments: Record<string, unknown>;
  };
  evidenceKind: EvidenceKind;
  fixture: string;
  expectedTier: RecoverabilityTier;
  expectedDecision: ConsequenceDecision;
  expectedEvidenceKeys: string[];
}

export const evidenceScenarios: EvidenceScenario[] = [
  {
    name: 'S3 recursive delete with versioning warns',
    source: 'shell',
    input: 'aws s3 rm s3://prod-audit-logs --recursive',
    evidenceKind: 's3',
    fixture: 's3-versioned.json',
    expectedTier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    expectedDecision: 'warn',
    expectedEvidenceKeys: ['s3.bucket', 's3.versioning'],
  },
  {
    name: 'S3 recursive delete without protection blocks',
    source: 'shell',
    input: 'aws s3 rm s3://prod-audit-logs --recursive',
    evidenceKind: 's3',
    fixture: 's3-unprotected.json',
    expectedTier: RecoverabilityTier.UNRECOVERABLE,
    expectedDecision: 'block',
    expectedEvidenceKeys: ['s3.bucket', 's3.empty'],
  },
  {
    name: 'S3 incomplete evidence escalates',
    source: 'shell',
    input: 'aws s3 rm s3://prod-audit-logs --recursive',
    evidenceKind: 's3',
    fixture: 's3-incomplete.json',
    expectedTier: RecoverabilityTier.NEEDS_REVIEW,
    expectedDecision: 'escalate',
    expectedEvidenceKeys: ['s3.bucket'],
  },
  {
    name: 'RDS delete with deletion protection allows',
    source: 'shell',
    input: 'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot',
    evidenceKind: 'rds',
    fixture: 'rds-protected.json',
    expectedTier: RecoverabilityTier.REVERSIBLE,
    expectedDecision: 'allow',
    expectedEvidenceKeys: ['rds.instance', 'rds.deletion_protection'],
  },
  {
    name: 'RDS delete with backups warns',
    source: 'shell',
    input: 'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot',
    evidenceKind: 'rds',
    fixture: 'rds-with-backups.json',
    expectedTier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    expectedDecision: 'warn',
    expectedEvidenceKeys: ['rds.backup_retention_period', 'rds.snapshot_count'],
  },
  {
    name: 'RDS delete without backups blocks',
    source: 'shell',
    input: 'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot',
    evidenceKind: 'rds',
    fixture: 'rds-unprotected.json',
    expectedTier: RecoverabilityTier.UNRECOVERABLE,
    expectedDecision: 'block',
    expectedEvidenceKeys: ['rds.instance', 'rds.snapshot_count'],
  },
  {
    name: 'DynamoDB delete with PITR warns',
    source: 'shell',
    input: 'aws dynamodb delete-table --table-name prod-events',
    evidenceKind: 'dynamodb',
    fixture: 'dynamodb-pitr.json',
    expectedTier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    expectedDecision: 'warn',
    expectedEvidenceKeys: ['dynamodb.table', 'dynamodb.pitr'],
  },
  {
    name: 'DynamoDB delete without PITR or backups blocks',
    source: 'shell',
    input: 'aws dynamodb delete-table --table-name prod-events',
    evidenceKind: 'dynamodb',
    fixture: 'dynamodb-unprotected.json',
    expectedTier: RecoverabilityTier.UNRECOVERABLE,
    expectedDecision: 'block',
    expectedEvidenceKeys: ['dynamodb.table', 'dynamodb.backup_count'],
  },
  {
    name: 'IAM role delete with policies remains recoverable with effort',
    source: 'shell',
    input: 'aws iam delete-role --role-name prod-runner',
    evidenceKind: 'iam',
    fixture: 'iam-role-attached.json',
    expectedTier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    expectedDecision: 'allow',
    expectedEvidenceKeys: ['iam.role', 'iam.attached_policy_count'],
  },
  {
    name: 'IAM role delete with incomplete evidence escalates',
    source: 'shell',
    input: 'aws iam delete-role --role-name prod-runner',
    evidenceKind: 'iam',
    fixture: 'iam-role-incomplete.json',
    expectedTier: RecoverabilityTier.NEEDS_REVIEW,
    expectedDecision: 'escalate',
    expectedEvidenceKeys: ['iam.role'],
  },
  {
    name: 'KMS customer key deletion escalates',
    source: 'shell',
    input: 'aws kms schedule-key-deletion --key-id 1234abcd --pending-window-in-days 30',
    evidenceKind: 'kms',
    fixture: 'kms-customer-key.json',
    expectedTier: RecoverabilityTier.NEEDS_REVIEW,
    expectedDecision: 'escalate',
    expectedEvidenceKeys: ['kms.key', 'kms.key_manager'],
  },
  {
    name: 'KMS AWS-managed key deletion request allows',
    source: 'mcp',
    input: {
      server: 'aws',
      tool: 'kms.schedule_key_deletion',
      arguments: {
        keyId: 'alias/aws/s3',
      },
    },
    evidenceKind: 'kms',
    fixture: 'kms-aws-managed-key.json',
    expectedTier: RecoverabilityTier.REVERSIBLE,
    expectedDecision: 'allow',
    expectedEvidenceKeys: ['kms.key', 'kms.key_manager'],
  },
];

export function loadAwsEvidence(kind: EvidenceKind, fixture: string) {
  switch (kind) {
    case 's3': {
      const evidence = loadEvidenceFixture<S3BucketEvidence>(fixture);
      return { s3Buckets: { [evidence.bucket]: evidence } };
    }
    case 'rds': {
      const evidence = loadEvidenceFixture<RdsInstanceEvidence>(fixture);
      return { rdsInstances: { [evidence.dbInstanceIdentifier]: evidence } };
    }
    case 'dynamodb': {
      const evidence = loadEvidenceFixture<DynamoDbTableEvidence>(fixture);
      return { dynamoDbTables: { [evidence.tableName]: evidence } };
    }
    case 'iam': {
      const evidence = loadEvidenceFixture<IamRoleEvidence>(fixture);
      return { iamRoles: { [evidence.roleName]: evidence } };
    }
    case 'kms': {
      const evidence = loadEvidenceFixture<KmsKeyEvidence>(fixture);
      return { kmsKeys: { [evidence.keyId]: evidence } };
    }
  }
}

export function evidenceFixturePath(fixture: string): string {
  return join(process.cwd(), 'tests', 'fixtures', 'evidence', 'aws', fixture);
}

function loadEvidenceFixture<T>(fixture: string): T {
  const parsed = JSON.parse(readFileSync(evidenceFixturePath(fixture), 'utf8')) as EvidenceFixture<T>;
  return parsed.evidence;
}
