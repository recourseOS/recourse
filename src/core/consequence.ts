import type { RecoverabilityResult } from '../resources/types.js';
import type { DependencyImpact, EvidenceItem, MissingEvidence, MutationIntent, VerificationSuggestion } from './mutation.js';

export type ConsequenceDecision = 'allow' | 'warn' | 'block' | 'escalate';

export interface AnalyzedMutation {
  intent: MutationIntent;
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
  dependencyImpact: DependencyImpact[];
}

export interface ConsequenceSummary {
  totalMutations: number;
  worstRecoverability: RecoverabilityResult;
  needsReview: boolean;
  hasUnrecoverable: boolean;
  dependencyImpactCount: number;
}

export type VerificationProtocolVersion = 'v1';

export type VerificationStatus =
  | 'suggestions_available'      // Suggestions generated successfully
  | 'not_required'               // Resource doesn't need verification
  | 'low_confidence'             // Classification confidence below threshold
  | 'no_suggestions_available'   // High-risk but no templates
  | 'not_evaluated';             // Verification not evaluated (e.g., non-delete action)

export interface VerificationStatusInfo {
  status: VerificationStatus;
  reason: string;
  classificationAudit?: {
    category: string;
    confidence: number;
    source: string;
    riskLevel: string;
  };
}

export interface ConsequenceReport {
  mutations: AnalyzedMutation[];
  summary: ConsequenceSummary;
  decision: ConsequenceDecision;
  decisionReason: string;

  // Verification Protocol v1
  verificationProtocolVersion?: VerificationProtocolVersion;
  verificationSuggestions?: VerificationSuggestion[];
  verificationStatus?: VerificationStatusInfo;
}
