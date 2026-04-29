import { describe, expect, it } from 'vitest';
import { evaluateMcpToolCallConsequences } from '../src/evaluator/mcp.js';
import { evaluateShellCommandConsequences } from '../src/evaluator/shell.js';
import { evidenceScenarios, loadAwsEvidence } from './helpers/evidence-scenarios.js';

describe('evidence scenario matrix', () => {
  it.each(evidenceScenarios)('$name', scenario => {
    const awsEvidence = loadAwsEvidence(scenario.evidenceKind, scenario.fixture);
    const report = scenario.source === 'shell'
      ? evaluateShellCommandConsequences(scenario.input as string, { awsEvidence })
      : evaluateMcpToolCallConsequences(scenario.input as never, { awsEvidence });

    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedTier);
    expect(report.decision).toBe(scenario.expectedDecision);

    const evidenceKeys = report.mutations.flatMap(mutation =>
      mutation.evidence.map(item => item.key)
    );
    for (const key of scenario.expectedEvidenceKeys) {
      expect(evidenceKeys).toContain(key);
    }
  });
});
