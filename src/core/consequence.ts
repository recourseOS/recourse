import type { RecoverabilityResult } from '../resources/types.js';
import type { DependencyImpact, EvidenceItem, MissingEvidence, MutationIntent, VerificationSuggestion } from './mutation.js';
import type { EvidenceRequirementLevel, EvidenceSufficiency } from './state-schema.js';

export type ConsequenceDecision = 'allow' | 'warn' | 'block' | 'escalate';

// ─────────────────────────────────────────────────────────────────────────────
// Required Evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Individual evidence requirement status.
 */
export interface EvidenceRequirementStatus {
  /** Evidence key (e.g., 's3.versioning', 'rds.deletion_protection') */
  key: string;
  /** Human-readable description */
  description: string;
  /** Requirement level */
  level: EvidenceRequirementLevel;
  /** Whether this evidence is present */
  present: boolean;
  /** Current value if present */
  value?: unknown;
  /** If true, absence of this evidence blocks confident classification */
  blocksConfidentVerdict: boolean;
}

/**
 * Top-level required_evidence field on ConsequenceReport.
 *
 * Tells agents and humans exactly what evidence is needed for confident
 * classification and whether current evidence is sufficient.
 */
export interface RequiredEvidence {
  /** Resource type these requirements apply to (e.g., 'aws_s3_bucket') */
  resourceType: string;
  /** Action being evaluated (e.g., 'delete') */
  action: string;
  /** Whether requirements are defined for this resource/action combination */
  requirementsDefined: boolean;
  /** Individual requirement statuses */
  requirements: EvidenceRequirementStatus[];
  /** Summary counts */
  summary: {
    /** Total requirements checked */
    total: number;
    /** Requirements satisfied */
    satisfied: number;
    /** Required evidence that is missing */
    missingRequired: number;
    /** Blocking evidence that is missing (subset of missingRequired) */
    missingBlocking: number;
  };
  /** Whether current evidence is sufficient for confident classification */
  sufficient: boolean;
  /** Evidence sufficiency assessment - a fact about evidence state, not a directive */
  sufficiency: EvidenceSufficiency;
}

export interface AnalyzedMutation {
  intent: MutationIntent;
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
  dependencyImpact: DependencyImpact[];
  /** Structured evidence requirements for this mutation */
  requiredEvidence?: RequiredEvidence;
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
  /** Engine's risk assessment - a summary signal, not a directive */
  riskAssessment: ConsequenceDecision;
  /** Reasoning behind the risk assessment */
  assessmentReason: string;

  // Verification Protocol v1
  verificationProtocolVersion?: VerificationProtocolVersion;
  verificationSuggestions?: VerificationSuggestion[];
  verificationStatus?: VerificationStatusInfo;

  // Required Evidence (Unknown-State Schema)
  /** Evidence requirements and current state for confident classification */
  requiredEvidence?: RequiredEvidence;
}
