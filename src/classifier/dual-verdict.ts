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

// Config-only resources: pure configuration, no data stored
// Deleting these is always reversible - you can recreate the exact same config
const CONFIG_ONLY_SUFFIXES = [
  // AWS
  '_policy',               // aws_s3_bucket_policy, aws_iam_role_policy
  '_configuration',        // aws_s3_bucket_lifecycle_configuration
  '_config',               // aws_lambda_function_event_invoke_config
  '_setting',              // aws_api_gateway_settings
  '_settings',             // aws_cognito_user_pool_client_settings
  '_rule',                 // aws_security_group_rule, aws_lb_listener_rule
  '_permission',           // aws_lambda_permission
  '_endpoint',             // aws_vpc_endpoint

  // GCP
  '_iam_policy',           // google_project_iam_policy
  '_iam_binding',          // google_project_iam_binding (also attachment-like)
  '_iam_member',           // google_project_iam_member (also attachment-like)
  '_access_level',         // google_access_context_manager_access_level

  // Azure
  '_configuration',        // azurerm_app_configuration (already covered)
  '_diagnostic_setting',   // azurerm_monitor_diagnostic_setting
];

// Attachment resources: join-table style, both parent resources unaffected
// Deleting these is always reversible - you can re-attach immediately
const ATTACHMENT_SUFFIXES = [
  // AWS
  '_attachment',           // aws_iam_role_policy_attachment
  '_membership',           // aws_iam_group_membership
  '_association',          // aws_route_table_association

  // GCP
  '_binding',              // google_project_iam_binding, google_service_account_iam_binding
  '_member',               // google_project_iam_member, google_storage_bucket_iam_member

  // Azure
  '_assignment',           // azurerm_role_assignment
];

// Full resource types that are known to be config-only (not caught by suffix)
const CONFIG_ONLY_TYPES = new Set([
  // AWS
  'aws_lambda_function_event_invoke_config',
  'aws_s3_bucket_cors_configuration',
  'aws_s3_bucket_website_configuration',
  'aws_s3_bucket_notification',
  'aws_s3_bucket_object_lock_configuration',
  'aws_api_gateway_deployment',
  'aws_api_gateway_stage',
  'aws_cloudwatch_event_rule',
  'aws_cloudwatch_event_target',

  // GCP - config resources that don't end with standard suffixes
  'google_project_service',              // Enabling an API
  'google_project_iam_audit_config',     // Audit logging config
  'google_compute_project_metadata',     // Project-level metadata
  'google_compute_project_metadata_item', // Single metadata key
  'google_dns_record_set',               // DNS record (config, can recreate)
  'google_cloud_run_service_iam_policy', // IAM for Cloud Run

  // Azure - config resources that don't end with standard suffixes
  'azurerm_resource_group',              // Just a container, resources inside matter
  'azurerm_dns_a_record',                // DNS record
  'azurerm_dns_cname_record',            // DNS record
  'azurerm_private_dns_a_record',        // Private DNS record
  'azurerm_management_lock',             // Lock config
]);

/**
 * Check if a resource type is config-only (no data stored).
 */
function isConfigOnlyResource(resourceType: string): boolean {
  if (CONFIG_ONLY_TYPES.has(resourceType)) return true;

  for (const suffix of CONFIG_ONLY_SUFFIXES) {
    if (resourceType.endsWith(suffix)) return true;
  }

  return false;
}

/**
 * Check if a resource type is an attachment/relationship resource.
 */
function isAttachmentResource(resourceType: string): boolean {
  for (const suffix of ATTACHMENT_SUFFIXES) {
    if (resourceType.endsWith(suffix)) return true;
  }

  return false;
}

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
  if (isAttachmentResource(change.type) && change.actions.includes('delete')) {
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
