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

// Map classifier tier strings to enum
const tierFromString: Record<string, RecoverabilityTier> = {
  'reversible': RecoverabilityTier.REVERSIBLE,
  'recoverable-with-effort': RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
  'recoverable-from-backup': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
  'unrecoverable': RecoverabilityTier.UNRECOVERABLE,
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

  // No handler - use classifier
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
): ClassifierResult {
  const features = extractFeatures(change, state);
  return classifyFromFeatures(features);
}

/**
 * Build human-readable reasoning from classifier verdict.
 */
function buildClassifierReasoning(
  resourceType: string,
  result: ClassifierResult,
  featureExplanation: string[]
): string {
  const confidencePct = (result.confidence * 100).toFixed(0);
  const featureSummary = featureExplanation.length > 0
    ? ` Based on: ${featureExplanation.slice(0, 3).join(', ')}`
    : '';

  if (result.confidence >= 0.9) {
    return `Classified as ${result.tier}${featureSummary}`;
  } else if (result.confidence >= CONFIDENCE_THRESHOLD) {
    return `Likely ${result.tier} (${confidencePct}% confidence)${featureSummary}`;
  } else {
    return `Uncertain: ${result.tier} (${confidencePct}% confidence) — limited training data for ${resourceType}`;
  }
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
