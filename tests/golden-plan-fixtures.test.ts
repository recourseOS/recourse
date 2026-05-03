import { describe, expect, it } from 'vitest';
import { evaluateTerraformPlanConsequences } from '../src/evaluator/terraform.js';
import { parsePlanFile } from '../src/parsers/plan.js';
import {
  RecoverabilityTier,
  type TerraformPlan,
} from '../src/resources/types.js';
import type { ConsequenceReport } from '../src/core/index.js';
import { goldenPlanFixturePath, goldenPlanScenarios } from './helpers/golden-plan-scenarios.js';

describe('golden Terraform plan fixtures', () => {
  it.each(goldenPlanScenarios)('$name', async scenario => {
    const plan = await parsePlanFile(goldenPlanFixturePath(scenario.fixture));
    const report = evaluateTerraformPlanConsequences(plan, null, {
      useClassifier: scenario.useClassifier ?? true,
      adapterContext: {
        actorId: 'agent/golden-fixture',
        environment: 'test',
      },
    });

    expect(plan.resourceChanges).toHaveLength(Object.keys(scenario.expectedByAddress).length);
    expect(report.riskAssessment).toBe(scenario.expectedDecision);
    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedWorstTier);
    expect(report.summary.totalMutations).toBe(Object.keys(scenario.expectedByAddress).length);

    expect(tiersByAddress(report)).toEqual(scenario.expectedByAddress);
  });

  it('parses all golden fixtures as Terraform plans with resource changes', async () => {
    const plans = await Promise.all(goldenPlanScenarios.map(scenario =>
      parsePlanFile(goldenPlanFixturePath(scenario.fixture))
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

function isTerraformPlan(plan: TerraformPlan): boolean {
  return !!plan.formatVersion && !!plan.terraformVersion && Array.isArray(plan.resourceChanges);
}
