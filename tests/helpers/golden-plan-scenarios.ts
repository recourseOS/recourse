import { join } from 'path';
import type { ConsequenceDecision } from '../../src/core/index.js';
import { RecoverabilityTier } from '../../src/resources/types.js';

export interface GoldenPlanScenario {
  name: string;
  fixture: string;
  expectedDecision: ConsequenceDecision;
  expectedWorstTier: RecoverabilityTier;
  expectedByAddress: Record<string, RecoverabilityTier>;
  useClassifier?: boolean;
}

export const goldenPlanScenarios: GoldenPlanScenario[] = [
  {
    name: 'AWS destructive plan keeps rules authoritative',
    fixture: 'aws-golden.json',
    expectedDecision: 'block',
    expectedWorstTier: RecoverabilityTier.UNRECOVERABLE,
    expectedByAddress: {
      'aws_db_instance.unprotected': RecoverabilityTier.UNRECOVERABLE,
      'aws_db_instance.protected': RecoverabilityTier.REVERSIBLE,
      'aws_s3_object.versioned': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      'aws_secretsmanager_secret.recovery_window': RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      'aws_secretsmanager_secret_version.current': RecoverabilityTier.UNRECOVERABLE,
    },
  },
  {
    name: 'GCP destructive plan uses first-class provider rules',
    fixture: 'gcp-golden.json',
    expectedDecision: 'block',
    expectedWorstTier: RecoverabilityTier.UNRECOVERABLE,
    expectedByAddress: {
      'google_sql_database_instance.unprotected': RecoverabilityTier.UNRECOVERABLE,
      'google_storage_bucket.versioned': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      'google_project_iam_binding.viewer': RecoverabilityTier.REVERSIBLE,
      'google_secret_manager_secret.prod_db': RecoverabilityTier.UNRECOVERABLE,
      'google_secret_manager_secret_iam_binding.reader': RecoverabilityTier.REVERSIBLE,
    },
  },
  {
    name: 'Azure destructive plan uses first-class provider rules',
    fixture: 'azure-golden.json',
    expectedDecision: 'block',
    expectedWorstTier: RecoverabilityTier.UNRECOVERABLE,
    expectedByAddress: {
      'azurerm_mssql_database.unprotected': RecoverabilityTier.UNRECOVERABLE,
      'azurerm_storage_account.retained': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      'azurerm_role_assignment.reader': RecoverabilityTier.REVERSIBLE,
      'azurerm_key_vault_secret.retained': RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      'azurerm_key_vault_access_policy.app': RecoverabilityTier.REVERSIBLE,
    },
  },
  {
    name: 'Unknown provider plan uses semantic classifier and abstains on weak evidence',
    fixture: 'unknown-semantic-golden.json',
    expectedDecision: 'escalate',
    expectedWorstTier: RecoverabilityTier.NEEDS_REVIEW,
    expectedByAddress: {
      'acme_storage_bucket.versioned': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      'acme_sql_database.protected': RecoverabilityTier.REVERSIBLE,
      'acme_custom_resource.unknown': RecoverabilityTier.NEEDS_REVIEW,
    },
    useClassifier: true,
  },
];

export function goldenPlanFixturePath(fixture: string): string {
  return join(process.cwd(), 'tests', 'fixtures', 'plans', fixture);
}
