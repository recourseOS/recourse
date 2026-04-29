import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateTerraformPlanConsequences } from '../src/evaluator/terraform.js';
import { parsePlanFile } from '../src/parsers/plan.js';
import {
  RecoverabilityTier,
  type TerraformPlan,
} from '../src/resources/types.js';
import type { ConsequenceDecision, ConsequenceReport } from '../src/core/index.js';

interface GoldenPlanScenario {
  name: string;
  fixture: string;
  expectedDecision: ConsequenceDecision;
  expectedWorstTier: RecoverabilityTier;
  expectedByAddress: Record<string, RecoverabilityTier>;
  useClassifier?: boolean;
}

const scenarios: GoldenPlanScenario[] = [
  {
    name: 'AWS destructive plan keeps rules authoritative',
    fixture: 'aws-golden.json',
    expectedDecision: 'block',
    expectedWorstTier: RecoverabilityTier.UNRECOVERABLE,
    expectedByAddress: {
      'aws_db_instance.unprotected': RecoverabilityTier.UNRECOVERABLE,
      'aws_db_instance.protected': RecoverabilityTier.REVERSIBLE,
      'aws_s3_object.versioned': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
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

describe('golden Terraform plan fixtures', () => {
  it.each(scenarios)('$name', async scenario => {
    const plan = await parsePlanFile(fixturePath(scenario.fixture));
    const report = evaluateTerraformPlanConsequences(plan, null, {
      useClassifier: scenario.useClassifier ?? true,
      adapterContext: {
        actorId: 'agent/golden-fixture',
        environment: 'test',
      },
    });

    expect(plan.resourceChanges).toHaveLength(Object.keys(scenario.expectedByAddress).length);
    expect(report.decision).toBe(scenario.expectedDecision);
    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedWorstTier);
    expect(report.summary.totalMutations).toBe(Object.keys(scenario.expectedByAddress).length);

    expect(tiersByAddress(report)).toEqual(scenario.expectedByAddress);
  });

  it('parses all golden fixtures as Terraform plans with resource changes', async () => {
    const plans = await Promise.all(scenarios.map(scenario =>
      parsePlanFile(fixturePath(scenario.fixture))
    ));

    for (const plan of plans) {
      expect(plan.resourceChanges.length).toBeGreaterThan(0);
      expect(isTerraformPlan(plan)).toBe(true);
    }
  });
});

function tiersByAddress(report: ConsequenceReport): Record<string, RecoverabilityTier> {
  return Object.fromEntries(report.mutations.map(mutation => [
    mutation.intent.target.id,
    mutation.recoverability.tier,
  ]));
}

function fixturePath(fixture: string): string {
  return join(process.cwd(), 'tests', 'fixtures', 'plans', fixture);
}

function isTerraformPlan(plan: TerraformPlan): boolean {
  return !!plan.formatVersion && !!plan.terraformVersion && Array.isArray(plan.resourceChanges);
}
