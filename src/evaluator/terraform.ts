import { analyzeBlastRadius } from '../analyzer/blast-radius.js';
import { terraformChangeToMutation } from '../adapters/terraform.js';
import type { AdapterContext } from '../adapters/types.js';
import type {
  AnalyzedMutation,
  ConsequenceReport,
} from '../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
  type TerraformPlan,
  type TerraformState,
} from '../resources/types.js';
import {
  evaluateBlastRadiusReport,
  type LocalPolicy,
} from '../policy/local.js';

export interface TerraformConsequenceOptions {
  useClassifier?: boolean;
  adapterContext?: AdapterContext;
  policy?: LocalPolicy;
}

export function evaluateTerraformPlanConsequences(
  plan: TerraformPlan,
  state: TerraformState | null,
  options: TerraformConsequenceOptions = {}
): ConsequenceReport {
  const blastRadiusReport = analyzeBlastRadius(plan, state, {
    useClassifier: options.useClassifier,
  });

  const policyEvaluation = evaluateBlastRadiusReport(
    blastRadiusReport,
    options.policy
  );

  const mutations: AnalyzedMutation[] = blastRadiusReport.changes.map(change => ({
    intent: terraformChangeToMutation(change.resource, options.adapterContext),
    recoverability: change.recoverability,
    evidence: [
      {
        key: 'recoverability.reasoning',
        value: change.recoverability.reasoning,
        present: true,
        description: 'Reason produced by the recoverability classifier',
      },
    ],
    missingEvidence: change.recoverability.tier === RecoverabilityTier.NEEDS_REVIEW
      ? [
          {
            key: 'resource-semantics',
            description: 'Recourse does not have enough evidence to classify this mutation safely',
            effect: 'requires-review',
          },
        ]
      : [],
    dependencyImpact: change.cascadeImpact.map(impact => ({
      targetId: impact.affectedResource,
      reason: impact.reason,
      transitive: true,
    })),
  }));

  const worstRecoverability = getWorstRecoverability(
    blastRadiusReport.changes.map(change => change.recoverability)
  );

  return {
    mutations,
    summary: {
      totalMutations: mutations.length,
      worstRecoverability,
      needsReview: worstRecoverability.tier === RecoverabilityTier.NEEDS_REVIEW,
      hasUnrecoverable: blastRadiusReport.summary.hasUnrecoverable,
      dependencyImpactCount: blastRadiusReport.summary.cascadeImpactCount,
    },
    decision: policyEvaluation.decision,
    decisionReason: policyEvaluation.reason,
  };
}

function getWorstRecoverability(results: RecoverabilityResult[]): RecoverabilityResult {
  if (results.length === 0) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'No mutations detected',
    };
  }

  return results.reduce((worst, current) =>
    current.tier > worst.tier ? current : worst
  );
}
