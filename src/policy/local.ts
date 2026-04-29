import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type BlastRadiusReport,
  type RecoverabilityResult,
} from '../resources/types.js';
import type { ConsequenceDecision } from '../core/index.js';

export interface LocalPolicy {
  blockOn?: RecoverabilityTier;
  escalateOn?: RecoverabilityTier;
  warnOn?: RecoverabilityTier;
  requireReviewOnNeedsReview?: boolean;
}

export interface PolicyEvaluation {
  decision: ConsequenceDecision;
  reason: string;
  matchedTier: RecoverabilityTier;
}

export const defaultLocalPolicy: Required<LocalPolicy> = {
  blockOn: RecoverabilityTier.UNRECOVERABLE,
  escalateOn: RecoverabilityTier.NEEDS_REVIEW,
  warnOn: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
  requireReviewOnNeedsReview: true,
};

export function evaluateRecoverability(
  recoverability: RecoverabilityResult,
  policy: LocalPolicy = {}
): PolicyEvaluation {
  const effective = { ...defaultLocalPolicy, ...policy };

  if (
    effective.requireReviewOnNeedsReview &&
    recoverability.tier === RecoverabilityTier.NEEDS_REVIEW
  ) {
    return {
      decision: 'escalate',
      reason: 'Recoverability needs human review',
      matchedTier: recoverability.tier,
    };
  }

  if (recoverability.tier >= effective.blockOn) {
    return {
      decision: 'block',
      reason: `Recoverability is ${recoverability.label}; policy blocks ${RecoverabilityLabels[effective.blockOn]} or worse`,
      matchedTier: recoverability.tier,
    };
  }

  if (recoverability.tier >= effective.escalateOn) {
    return {
      decision: 'escalate',
      reason: `Recoverability is ${recoverability.label}; policy requires escalation`,
      matchedTier: recoverability.tier,
    };
  }

  if (recoverability.tier >= effective.warnOn) {
    return {
      decision: 'warn',
      reason: `Recoverability is ${recoverability.label}; policy requires warning`,
      matchedTier: recoverability.tier,
    };
  }

  return {
    decision: 'allow',
    reason: `Recoverability is ${recoverability.label}; policy allows this mutation`,
    matchedTier: recoverability.tier,
  };
}

export function evaluateBlastRadiusReport(
  report: BlastRadiusReport,
  policy: LocalPolicy = {}
): PolicyEvaluation {
  if (report.changes.length === 0) {
    return {
      decision: 'allow',
      reason: 'No changes detected',
      matchedTier: RecoverabilityTier.REVERSIBLE,
    };
  }

  const worst = report.changes.reduce((current, change) =>
    change.recoverability.tier > current.tier ? change.recoverability : current
  , report.changes[0].recoverability);

  return evaluateRecoverability(worst, policy);
}
