export type {
  ActorKind,
  AgentInterpretation,
  DependencyImpact,
  EvidenceItem,
  EvidenceSubmission,
  MissingEvidence,
  MutationAction,
  MutationActor,
  MutationIntent,
  MutationSource,
  MutationTarget,
  VerificationApiCall,
  VerificationCommand,
  VerificationPriority,
  VerificationSuggestion,
  VerificationType,
  VerificationUncertainty,
  VerificationVerdictImpact,
} from './mutation.js';

export type {
  AnalyzedMutation,
  ConsequenceDecision,
  ConsequenceReport,
  ConsequenceSummary,
  EvidenceRequirementStatus,
  RequiredEvidence,
  VerificationProtocolVersion,
  VerificationStatus,
  VerificationStatusInfo,
} from './consequence.js';

// Unknown-state schema
export type {
  EvidenceConflict,
  EvidenceFreshness,
  EvidenceFreshnessLevel,
  EvidenceRequirement,
  EvidenceRequirementLevel,
  EvidenceSource,
  EvidenceSufficiency,
  ResourceEvidenceRequirements,
  StateAssessment,
  StateCompleteness,
  StateCompletenessLevel,
  StateRecommendation,  // Deprecated - use EvidenceSufficiency
  TrackedEvidence,
} from './state-schema.js';

export {
  assessCompleteness,
  assessFreshness,
  assessState,
  assessmentToMissingEvidence,
  buildRequiredEvidence,
  confidenceModifier,
} from './state-schema.js';

export {
  DEFAULT_UNKNOWN_REQUIREMENTS,
  getEvidenceRequirements,
  getRegisteredResourceTypes,
  hasEvidenceRequirements,
} from './evidence-requirements.js';
