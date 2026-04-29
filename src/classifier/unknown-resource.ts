import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../resources/types.js';
import type { EvidenceItem, MissingEvidence, MutationIntent } from '../core/index.js';

export interface UnknownClassificationInput {
  intent: MutationIntent;
  evidence?: EvidenceItem[];
  missingEvidence?: MissingEvidence[];
}

export interface UnknownClassificationResult extends RecoverabilityResult {
  resourceKind?: string;
  evidence: string[];
  missingEvidence: string[];
  abstain: boolean;
}

export interface UnknownResourceClassifier {
  name: string;
  classify(input: UnknownClassificationInput): UnknownClassificationResult | Promise<UnknownClassificationResult>;
}

export class ConservativeUnknownClassifier implements UnknownResourceClassifier {
  name = 'conservative-unknown';

  classify(input: UnknownClassificationInput): UnknownClassificationResult {
    const missingEvidence = input.missingEvidence?.map(item => item.key) ?? [
      'resource-semantics',
      'backup-state',
      'dependency-graph',
    ];

    return {
      tier: RecoverabilityTier.NEEDS_REVIEW,
      label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
      reasoning: 'Unknown resource semantics; human review required before treating this mutation as safe',
      source: 'classifier',
      confidence: 0,
      resourceKind: 'unknown',
      evidence: input.evidence?.map(item => item.key) ?? [],
      missingEvidence,
      abstain: true,
    };
  }
}

export const conservativeUnknownClassifier = new ConservativeUnknownClassifier();
