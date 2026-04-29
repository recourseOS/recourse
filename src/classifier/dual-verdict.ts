/**
 * Dual-verdict architecture for recoverability classification.
 *
 * Combines rule-based handlers (high trust) with ML classifier (generalization)
 * and tracks confidence/source for each verdict.
 *
 * Rules:
 * 1. If rule-based handler exists → use rules, check classifier agreement
 * 2. If only classifier (unknown resource type) → use classifier with confidence
 * 3. Agreement/disagreement is tracked for trust calibration
 */

import {
  RecoverabilityTier,
  RecoverabilityLabels,
  type RecoverabilityResult,
  type ResourceChange,
  type TerraformState,
  type VerdictSource,
} from '../resources/types.js';
import { getHandler, hasHandler } from '../resources/index.js';
import { classifyFromFeatures, type ClassifierResult } from './decision-tree.js';
import { extractFeatures, explainFeatures } from './feature-extractor.js';
import { classifyUnknownResourceSemantically, type SemanticClassifierResult } from './semantic-unknown.js';
import { isConfigOnlyResource, isRelationshipResource } from './semantic-profile.js';

type UnknownClassifierResult = ClassifierResult | SemanticClassifierResult;

// Map classifier tier strings to enum
const tierFromString: Record<UnknownClassifierResult['tier'], RecoverabilityTier> = {
  'reversible': RecoverabilityTier.REVERSIBLE,
  'recoverable-with-effort': RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
  'recoverable-from-backup': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
  'unrecoverable': RecoverabilityTier.UNRECOVERABLE,
  'needs-review': RecoverabilityTier.NEEDS_REVIEW,
};

// Minimum confidence threshold for classifier-only verdicts
const CONFIDENCE_THRESHOLD = 0.7;

export interface DualVerdictResult extends RecoverabilityResult {
  source: VerdictSource;
  confidence: number;
  classifierAgreement?: boolean;
  classifierVerdict?: RecoverabilityResult;
  featureExplanation?: string[];
}

/**
 * Get recoverability using dual-verdict architecture.
 *
 * If a rule-based handler exists for this resource type, it is the source of truth.
 * The classifier runs in parallel to check agreement, which helps calibrate trust.
 *
 * If no handler exists, the classifier provides the verdict with a confidence score.
 */
export function getRecoverabilityDual(
  change: ResourceChange,
  state: TerraformState | null
): DualVerdictResult {
  // Always run classifier to get its verdict
  const classifierResult = getClassifierVerdict(change, state);

  // Check if we have a rule-based handler
  if (hasHandler(change.type)) {
    // Rule-based handler exists - it's the source of truth
    const handler = getHandler(change.type);
    const rulesResult = handler.getRecoverability(change, state);

    // Check if classifier agrees
    const classifierTier = tierFromString[classifierResult.tier];
    const agrees = rulesResult.tier === classifierTier;

    return {
      ...rulesResult,
      source: 'rules',
      confidence: 1.0,  // Rules are always fully confident
      classifierAgreement: agrees,
      classifierVerdict: {
        tier: classifierTier,
        label: classifierResult.tier,
        reasoning: `Classifier verdict: ${classifierResult.tier} (confidence: ${(classifierResult.confidence * 100).toFixed(0)}%)`,
        source: 'classifier',
        confidence: classifierResult.confidence,
      },
    };
  }

  // No handler - check for special resource categories before using classifier

  // Config-only resources are always reversible (no data loss possible)
  if (isConfigOnlyResource(change.type) && change.actions.includes('delete')) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Config-only resource — can be recreated with identical settings',
      source: 'rules',  // This is a rule, just pattern-based
      confidence: 1.0,
      classifierAgreement: classifierResult.tier === 'reversible',
      classifierVerdict: {
        tier: tierFromString[classifierResult.tier],
        label: classifierResult.tier,
        reasoning: `Classifier verdict: ${classifierResult.tier}`,
        source: 'classifier',
        confidence: classifierResult.confidence,
      },
    };
  }

  // Attachment resources are always reversible (parent resources unaffected)
  if (isRelationshipResource(change.type) && change.actions.includes('delete')) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Attachment resource — parent resources are unaffected, can re-attach',
      source: 'rules',  // This is a rule, just pattern-based
      confidence: 1.0,
      classifierAgreement: classifierResult.tier === 'reversible',
      classifierVerdict: {
        tier: tierFromString[classifierResult.tier],
        label: classifierResult.tier,
        reasoning: `Classifier verdict: ${classifierResult.tier}`,
        source: 'classifier',
        confidence: classifierResult.confidence,
      },
    };
  }

  // No handler, not a special category - use classifier
  const tier = tierFromString[classifierResult.tier];
  const features = extractFeatures(change, state);
  const featureExplanation = explainFeatures(features);

  // Build reasoning from features
  const reasoning = buildClassifierReasoning(
    change.type,
    classifierResult,
    featureExplanation
  );

  return {
    tier,
    label: RecoverabilityLabels[tier],
    reasoning,
    source: 'classifier',
    confidence: classifierResult.confidence,
    featureExplanation,
  };
}

/**
 * Get classifier verdict for a resource change.
 */
function getClassifierVerdict(
  change: ResourceChange,
  state: TerraformState | null
): UnknownClassifierResult {
  const features = extractFeatures(change, state);
  if (features.resource_type_encoded === -1) {
    return classifyUnknownResourceSemantically(change, state, features);
  }
  return classifyFromFeatures(features);
}

/**
 * Build human-readable reasoning from classifier verdict.
 */
function buildClassifierReasoning(
  resourceType: string,
  result: UnknownClassifierResult,
  featureExplanation: string[]
): string {
  const confidencePct = (result.confidence * 100).toFixed(0);
  const featureSummary = featureExplanation.length > 0
    ? ` Based on: ${featureExplanation.slice(0, 3).join(', ')}`
    : '';

  if (result.confidence >= 0.9) {
    return `Classified as ${result.tier}${featureSummary}${evidenceSummary(result)}`;
  } else if (result.confidence >= CONFIDENCE_THRESHOLD) {
    return `Likely ${result.tier} (${confidencePct}% confidence)${featureSummary}${evidenceSummary(result)}`;
  } else {
    return `Uncertain: ${result.tier} (${confidencePct}% confidence) — limited training data for ${resourceType}${evidenceSummary(result)}`;
  }
}

function evidenceSummary(result: UnknownClassifierResult): string {
  if (!('evidence' in result) || !result.evidence.length) return '';
  return ` Evidence: ${result.evidence.slice(0, 3).join(', ')}`;
}

/**
 * Check if we have high confidence in a verdict.
 * Used to decide whether to show the ~ marker.
 */
export function isHighConfidence(result: DualVerdictResult): boolean {
  if (result.source === 'rules') return true;
  return result.confidence >= 0.9;
}

/**
 * Check if a verdict came from the classifier (not rules).
 */
export function isClassifierVerdict(result: DualVerdictResult): boolean {
  return result.source === 'classifier';
}

/**
 * Get the confidence display string.
 */
export function formatConfidence(result: DualVerdictResult): string {
  if (result.source === 'rules') {
    if (result.classifierAgreement === false) {
      return 'rules (classifier disagrees)';
    }
    return 'rules';
  }
  return `${(result.confidence * 100).toFixed(0)}% confidence`;
}
