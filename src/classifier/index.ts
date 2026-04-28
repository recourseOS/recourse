/**
 * Classifier module for recoverability prediction.
 *
 * Provides ML-based classification for resource types without rule-based handlers,
 * and validates rule-based verdicts via agreement checking.
 */

export {
  classifyFromFeatures,
  encodeResourceType,
  RESOURCE_TYPE_ENCODING,
  type ClassifierFeatures,
  type ClassifierResult,
  type ClassifierTier,
} from './decision-tree.js';

export {
  extractFeatures,
  explainFeatures,
} from './feature-extractor.js';

export {
  getRecoverabilityDual,
  isHighConfidence,
  isClassifierVerdict,
  formatConfidence,
  type DualVerdictResult,
} from './dual-verdict.js';
