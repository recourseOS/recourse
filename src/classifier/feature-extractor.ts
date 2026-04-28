/**
 * Feature extraction from Terraform plan data for the classifier.
 *
 * Converts variable resource attributes into a fixed-size feature vector
 * that captures the "safety-relevant" patterns across all resource types.
 */

import type { ResourceChange, TerraformState } from '../resources/types.js';
import { ClassifierFeatures, encodeResourceType } from './decision-tree.js';

// Attribute name patterns that map to features
const DELETION_PROTECTION_ATTRS = [
  'deletion_protection', 'deletion_protection_enabled', 'protect_from_delete',
  'termination_protection', 'prevent_destroy', 'enable_deletion_protection'
];

const BACKUP_ATTRS = [
  'backup_retention_period', 'backup_window', 'automated_backup',
  'backup_retention', 'backup_policy', 'backup_retention_days'
];

const SNAPSHOT_ATTRS = [
  'snapshot_id', 'snapshot_identifier', 'final_snapshot_identifier',
  'source_snapshot_id', 'snapshot_copy_grant_name'
];

const VERSIONING_ATTRS = [
  'versioning', 'bucket_versioning', 'versioning_configuration',
  'version_id', 'enable_versioning', 'versioning_enabled'
];

const PITR_ATTRS = [
  'point_in_time_recovery', 'pitr', 'continuous_backup',
  'point_in_time_recovery_enabled'
];

const RETENTION_ATTRS = [
  'retention_in_days', 'retention_period', 'backup_retention_period',
  'message_retention_seconds', 'deletion_window_in_days', 'retention_days'
];

const EMPTY_ATTRS = [
  'object_count', 'message_count', 'item_count', 'size', 'approximate_message_count'
];

/**
 * Extract a boolean feature from attributes.
 * Returns: 1 = true, 0 = false, -1 = unknown
 */
function extractBoolFeature(
  attrs: Record<string, unknown>,
  patterns: string[],
  evaluate?: (v: unknown) => boolean
): number {
  for (const pattern of patterns) {
    if (pattern in attrs) {
      const value = attrs[pattern];
      if (value === null || value === undefined) return -1;
      if (evaluate) return evaluate(value) ? 1 : 0;
      return value ? 1 : 0;
    }
  }
  return -1; // unknown
}

/**
 * Extract snapshot-related feature.
 * Handles skip_final_snapshot inverse logic.
 */
function extractHasSnapshot(attrs: Record<string, unknown>): number {
  // Check skip_final_snapshot first (inverse logic)
  if ('skip_final_snapshot' in attrs) {
    const skip = attrs['skip_final_snapshot'];
    if (skip === null || skip === undefined) return -1;
    return skip ? 0 : 1; // if skipping, no snapshot
  }

  for (const key of SNAPSHOT_ATTRS) {
    if (key in attrs) {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;
      return value ? 1 : 0;
    }
  }
  return -1;
}

/**
 * Extract versioning feature.
 * Handles various formats (bool, string, nested config).
 */
function extractVersioning(
  attrs: Record<string, unknown>,
  state: TerraformState | null,
  resourceType: string,
  resourceAttrs: Record<string, unknown>
): number {
  // For S3 objects, check the parent bucket's versioning
  if (resourceType === 'aws_s3_object' && state) {
    const bucketName = resourceAttrs['bucket'] as string;
    if (bucketName) {
      const versioningResource = state.resources.find(
        r => r.type === 'aws_s3_bucket_versioning' &&
             (r.values.bucket === bucketName ||
              (r.values.bucket as string)?.includes(bucketName))
      );

      if (versioningResource) {
        const versioningConfig = versioningResource.values.versioning_configuration as
          { status?: string }[] | undefined;
        return versioningConfig?.[0]?.status === 'Enabled' ? 1 : 0;
      }
    }
  }

  for (const key of VERSIONING_ATTRS) {
    if (key in attrs) {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;

      // Handle various formats
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === 'Enabled' || value === 'enabled' || value === true) return 1;
      if (value === 'Disabled' || value === 'disabled' || value === false) return 0;

      // Handle nested config
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if ('status' in obj) return obj['status'] === 'Enabled' ? 1 : 0;
        if ('enabled' in obj) return obj['enabled'] ? 1 : 0;
      }

      return -1;
    }
  }
  return -1;
}

/**
 * Extract PITR feature.
 */
function extractPitr(attrs: Record<string, unknown>): number {
  for (const key of PITR_ATTRS) {
    if (key in attrs) {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;

      if (typeof value === 'boolean') return value ? 1 : 0;

      // Handle nested config like { enabled: true }
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if ('enabled' in obj) return obj['enabled'] ? 1 : 0;
      }

      return -1;
    }
  }
  return -1;
}

/**
 * Extract retention days (normalized to 0-1 range).
 */
function extractRetentionDays(attrs: Record<string, unknown>): number {
  for (const key of RETENTION_ATTRS) {
    if (key in attrs) {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;
      if (typeof value === 'number') {
        // Normalize to 0-1 range (assuming max 365 days)
        return Math.min(value / 365, 1);
      }
    }
  }
  return -1;
}

/**
 * Extract skip_final_snapshot feature.
 */
function extractSkipFinalSnapshot(attrs: Record<string, unknown>): number {
  if ('skip_final_snapshot' in attrs) {
    const value = attrs['skip_final_snapshot'];
    if (value === null || value === undefined) return -1;
    return value ? 1 : 0;
  }
  return -1;
}

/**
 * Extract deletion window days (normalized).
 */
function extractDeletionWindow(attrs: Record<string, unknown>): number {
  if ('deletion_window_in_days' in attrs) {
    const value = attrs['deletion_window_in_days'];
    if (value === null || value === undefined) return -1;
    if (typeof value === 'number') {
      // Normalize to 0-1 range (assuming max 30 days)
      return Math.min(value / 30, 1);
    }
  }
  return -1;
}

/**
 * Extract is_empty feature.
 */
function extractIsEmpty(attrs: Record<string, unknown>): number {
  for (const key of EMPTY_ATTRS) {
    if (key in attrs) {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;
      if (typeof value === 'number') return value === 0 ? 1 : 0;
    }
  }
  return -1;
}

/**
 * Extract features from a Terraform resource change.
 */
export function extractFeatures(
  change: ResourceChange,
  state: TerraformState | null
): ClassifierFeatures {
  const attrs = change.before || change.after || {};
  const action = change.actions.includes('delete') ? 'delete' :
                 change.actions.includes('create') ? 'create' :
                 change.actions.includes('update') ? 'update' : 'replace';

  return {
    resource_type_encoded: encodeResourceType(change.type),

    // Action encoding
    action_delete: action === 'delete' ? 1 : 0,
    action_update: action === 'update' ? 1 : 0,
    action_create: action === 'create' ? 1 : 0,
    action_replace: action === 'replace' ? 1 : 0,

    // Feature extraction
    has_deletion_protection: extractBoolFeature(attrs, DELETION_PROTECTION_ATTRS),
    has_backup: extractBoolFeature(attrs, BACKUP_ATTRS, (v) => {
      if (typeof v === 'number') return v > 0;
      return !!v;
    }),
    has_snapshot: extractHasSnapshot(attrs),
    has_versioning: extractVersioning(attrs, state, change.type, attrs),
    has_pitr: extractPitr(attrs),
    has_retention_period: extractBoolFeature(attrs, RETENTION_ATTRS, (v) => {
      if (typeof v === 'number') return v > 0;
      return !!v;
    }),
    retention_days: extractRetentionDays(attrs),
    skip_final_snapshot: extractSkipFinalSnapshot(attrs),
    deletion_window_days: extractDeletionWindow(attrs),
    is_empty: extractIsEmpty(attrs),
  };
}

/**
 * Get feature explanations for debugging/tracing.
 */
export function explainFeatures(features: ClassifierFeatures): string[] {
  const explanations: string[] = [];

  if (features.action_delete) explanations.push('Action: delete');
  else if (features.action_update) explanations.push('Action: update');
  else if (features.action_create) explanations.push('Action: create');
  else if (features.action_replace) explanations.push('Action: replace');

  if (features.has_deletion_protection === 1) explanations.push('Has deletion protection');
  else if (features.has_deletion_protection === 0) explanations.push('No deletion protection');

  if (features.has_backup === 1) explanations.push('Has backup configuration');
  else if (features.has_backup === 0) explanations.push('No backup configuration');

  if (features.has_snapshot === 1) explanations.push('Has snapshot/will create final snapshot');
  else if (features.has_snapshot === 0) explanations.push('No snapshot available');

  if (features.has_versioning === 1) explanations.push('Versioning enabled');
  else if (features.has_versioning === 0) explanations.push('Versioning disabled');

  if (features.has_pitr === 1) explanations.push('Point-in-time recovery enabled');
  else if (features.has_pitr === 0) explanations.push('Point-in-time recovery disabled');

  if (features.skip_final_snapshot === 1) explanations.push('Will skip final snapshot');
  else if (features.skip_final_snapshot === 0) explanations.push('Will create final snapshot');

  if (features.is_empty === 1) explanations.push('Resource is empty');
  else if (features.is_empty === 0) explanations.push('Resource is not empty');

  return explanations;
}
