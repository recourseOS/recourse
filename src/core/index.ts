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

// Cross-action analysis
export type {
  CrossActionRelationship,
  CrossActionRisk,
  RelationshipConfidence,
  RelationshipDetectionMethod,
  RelationshipType,
} from '../analyzer/cross-action.js';

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

// Failure mode handling
export type {
  FailureMode,
  EvidenceFailureCheck,
} from './failure-mode.js';

export {
  DEFAULT_FAILURE_MODE,
  PRO_DEFAULT_FAILURE_MODE,
  checkEvidenceFailures,
  applyFailureMode,
} from './failure-mode.js';

// Performance timing
export type {
  EvaluationTiming,
  SLATarget,
} from './timing.js';

export {
  SLA_TARGETS,
  EvaluationTimer,
  formatTiming,
} from './timing.js';
