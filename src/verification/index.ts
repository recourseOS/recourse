// Hardcoded catalog (for resources with specific handlers)
export {
  // EBS
  ebsExternalSnapshots,
  ebsAwsBackupRecoveryPoints,
  ebsCrossRegionSnapshots,
  // RDS
  rdsManualSnapshots,
  rdsAwsBackupRecoveryPoints,
  rdsAutomatedBackups,
  // S3
  s3CrossRegionReplication,
  s3VersioningStatus,
  // DynamoDB
  dynamoDbPointInTimeRecovery,
  dynamoDbAwsBackupRecoveryPoints,
} from './catalog.js';

// Categories
export type { VerificationCategory, CategoryMetadata, IdentifierPattern } from './categories.js';
export { CATEGORY_METADATA, IDENTIFIER_PATTERNS } from './categories.js';

// Classifier
export type { ClassificationResult, VerificationClassifier, BitNetClassifier } from './classifier.js';
export {
  DecisionTreeClassifier,
  BitNetClassifierPlaceholder,
  BitNetResourceClassifier,
  defaultClassifier,
  classifyResourceType,
} from './classifier.js';

// BitNet model (for direct access)
export {
  trainBitNet,
  evaluateBitNet,
  classifyWithBitNet,
  serializeModel,
  deserializeModel,
  getPretrainedModel,
  loadPretrainedWeights,
  type BitNetModel,
} from './bitnet.js';

// Training data
export {
  TRAINING_DATA,
  getCategoryDistribution,
  splitTrainTest,
  type TrainingExample,
} from './training-data.js';

// Templates
export type { ResourceContext } from './templates.js';
export { generateVerificationSuggestions } from './templates.js';

// Main function: classify + generate
import { classifyResourceType, defaultClassifier } from './classifier.js';
import { generateVerificationSuggestions, type ResourceContext } from './templates.js';
import { CATEGORY_METADATA } from './categories.js';
import type { VerificationSuggestion } from '../core/mutation.js';
import type { VerificationClassifier } from './classifier.js';

/**
 * Confidence floor - below this threshold, return no suggestions
 * rather than potentially misleading low-confidence guesses
 */
export const CONFIDENCE_FLOOR = 0.7;

/**
 * Verification status - explicit states for the agent
 */
export type VerificationStatus =
  | 'suggestions_available'      // Suggestions generated successfully
  | 'not_required'               // Resource doesn't need verification (IAM, networking, etc.)
  | 'low_confidence'             // Classification confidence below threshold, no suggestions
  | 'no_suggestions_available';  // High-risk but no templates for this category

/**
 * Classification audit trail for debugging and training data
 */
export interface ClassificationAudit {
  resourceType: string;
  category: string;
  confidence: number;
  source: 'exact-match' | 'pattern-match' | 'bitnet' | 'fallback';
  patternMatched?: string;        // If pattern-match, which pattern
  confidenceAboveFloor: boolean;
  suggestionsGenerated: number;
  timestamp: string;
}

/**
 * Result of verification suggestion generation
 */
export interface VerificationResult {
  status: VerificationStatus;
  statusReason: string;
  suggestions: VerificationSuggestion[];
  classification: {
    category: string;
    confidence: number;
    source: string;
    riskLevel: 'high' | 'medium' | 'low';
  };
  audit: ClassificationAudit;
}

/**
 * Generate verification suggestions for any resource type
 * Uses BitNet (or decision tree fallback) to classify, then templates to generate
 */
export function getVerificationSuggestions(
  resourceType: string,
  attributes: Record<string, unknown>,
  options: {
    address?: string;
    region?: string;
    accountId?: string;
    classifier?: VerificationClassifier;
    confidenceFloor?: number;
  } = {}
): VerificationResult {
  const classifier = options.classifier || defaultClassifier;
  const confidenceFloor = options.confidenceFloor ?? CONFIDENCE_FLOOR;
  const classification = classifyResourceType(resourceType, attributes, classifier);
  const categoryMeta = CATEGORY_METADATA[classification.category];

  // Build audit trail
  const audit: ClassificationAudit = {
    resourceType,
    category: classification.category,
    confidence: classification.confidence,
    source: classification.source,
    confidenceAboveFloor: classification.confidence >= confidenceFloor,
    suggestionsGenerated: 0,
    timestamp: new Date().toISOString(),
  };

  // Check confidence floor FIRST
  if (classification.confidence < confidenceFloor && classification.source !== 'exact-match') {
    return {
      status: 'low_confidence',
      statusReason: `Classification confidence ${classification.confidence.toFixed(2)} below threshold ${confidenceFloor}; escalate to human`,
      suggestions: [],
      classification: {
        category: classification.category,
        confidence: classification.confidence,
        source: classification.source,
        riskLevel: categoryMeta?.riskLevel || 'medium',
      },
      audit,
    };
  }

  // Handle no-verification-needed with POSITIVE output
  if (classification.category === 'no-verification-needed') {
    return {
      status: 'not_required',
      statusReason: `${resourceType} is ${categoryMeta?.description || 'a config-only resource'}; recoverable by recreation without external backup verification`,
      suggestions: [],
      classification: {
        category: classification.category,
        confidence: classification.confidence,
        source: classification.source,
        riskLevel: 'low',
      },
      audit,
    };
  }

  // Generate suggestions
  const context: ResourceContext = {
    resourceType,
    address: options.address || resourceType,
    attributes,
    region: options.region,
    accountId: options.accountId,
  };

  const suggestions = generateVerificationSuggestions(classification.category, context);
  audit.suggestionsGenerated = suggestions.length;

  if (suggestions.length === 0) {
    return {
      status: 'no_suggestions_available',
      statusReason: `No verification templates available for category ${classification.category}; manual review recommended`,
      suggestions: [],
      classification: {
        category: classification.category,
        confidence: classification.confidence,
        source: classification.source,
        riskLevel: categoryMeta?.riskLevel || 'medium',
      },
      audit,
    };
  }

  return {
    status: 'suggestions_available',
    statusReason: `${suggestions.length} verification command(s) available to confirm recoverability`,
    suggestions,
    classification: {
      category: classification.category,
      confidence: classification.confidence,
      source: classification.source,
      riskLevel: categoryMeta?.riskLevel || 'medium',
    },
    audit,
  };
}
