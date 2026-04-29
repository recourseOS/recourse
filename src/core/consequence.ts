import type { RecoverabilityResult } from '../resources/types.js';
import type { DependencyImpact, EvidenceItem, MissingEvidence, MutationIntent } from './mutation.js';

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

export interface ConsequenceReport {
  mutations: AnalyzedMutation[];
  summary: ConsequenceSummary;
  decision: ConsequenceDecision;
  decisionReason: string;
}
