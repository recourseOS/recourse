/**
 * Failure mode configuration for RecourseOS evaluations.
 *
 * Determines how RecourseOS behaves when state lookups fail
 * (network errors, API timeouts, permission denied, etc.)
 */

/**
 * Failure mode options:
 * - 'closed': Block the action when evidence cannot be gathered (safest)
 * - 'review': Escalate to human review when evidence unavailable (default)
 * - 'open': Allow the action despite missing evidence (dangerous!)
 */
export type FailureMode = 'closed' | 'review' | 'open';

/**
 * Result of checking for evidence failures in a consequence report.
 */
export interface EvidenceFailureCheck {
  /** Whether any evidence gathering failed */
  hasFailures: boolean;
  /** List of resources with missing evidence */
  failedResources: string[];
  /** Reasons for failures */
  failureReasons: string[];
}

/**
 * Default failure modes by deployment context.
 * - OSS/self-hosted: 'review' (escalate to human)
 * - Pro/managed: 'closed' (fail-safe)
 * - Explicit override: user's choice
 */
export const DEFAULT_FAILURE_MODE: FailureMode = 'review';
export const PRO_DEFAULT_FAILURE_MODE: FailureMode = 'closed';

/**
 * Check if a consequence report has evidence failures that should
 * trigger failure mode handling.
 */
export function checkEvidenceFailures(
  mutations: Array<{
    missingEvidence?: Array<{ key: string; description?: string }>;
    intent?: { target?: { id?: string } };
  }>
): EvidenceFailureCheck {
  const failedResources: string[] = [];
  const failureReasons: string[] = [];

  for (const mutation of mutations) {
    if (mutation.missingEvidence && mutation.missingEvidence.length > 0) {
      const resourceId = mutation.intent?.target?.id || 'unknown';
      failedResources.push(resourceId);

      for (const missing of mutation.missingEvidence) {
        failureReasons.push(
          missing.description || `Missing evidence: ${missing.key}`
        );
      }
    }
  }

  return {
    hasFailures: failedResources.length > 0,
    failedResources: Array.from(new Set(failedResources)),
    failureReasons: Array.from(new Set(failureReasons)),
  };
}

/**
 * Apply failure mode to a consequence decision.
 *
 * @param currentDecision - The decision from normal policy evaluation
 * @param failureCheck - Result of evidence failure check
 * @param failureMode - The configured failure mode
 * @returns The potentially modified decision and reason
 */
export function applyFailureMode(
  currentDecision: 'allow' | 'warn' | 'escalate' | 'block',
  currentReason: string,
  failureCheck: EvidenceFailureCheck,
  failureMode: FailureMode
): { decision: 'allow' | 'warn' | 'escalate' | 'block'; reason: string } {
  // No failures, return original decision
  if (!failureCheck.hasFailures) {
    return { decision: currentDecision, reason: currentReason };
  }

  const failureContext = `Evidence unavailable for: ${failureCheck.failedResources.join(', ')}`;

  switch (failureMode) {
    case 'closed':
      // Fail-closed: always block when evidence is missing
      return {
        decision: 'block',
        reason: `[FAIL-CLOSED] ${failureContext}. Action blocked due to inability to verify safety.`,
      };

    case 'review':
      // Fail-review: escalate to human (current default behavior)
      // Only upgrade if current decision is less severe than escalate
      if (currentDecision === 'allow' || currentDecision === 'warn') {
        return {
          decision: 'escalate',
          reason: `[FAIL-REVIEW] ${failureContext}. Human review required.`,
        };
      }
      return { decision: currentDecision, reason: currentReason };

    case 'open':
      // Fail-open: allow despite missing evidence (dangerous!)
      // Log a warning but don't change the decision
      return {
        decision: currentDecision,
        reason: `[FAIL-OPEN WARNING] ${failureContext}. Proceeding without complete evidence.`,
      };

    default:
      // Unknown mode, fail safe
      return {
        decision: 'escalate',
        reason: `Unknown failure mode. ${failureContext}`,
      };
  }
}
