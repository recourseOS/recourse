/**
 * Feature extractor for recoverability classifier
 *
 * Converts variable resource attributes into a fixed-size feature vector
 * that captures the "safety-relevant" patterns across all resource types.
 */

interface RawExample {
  resource_type: string;
  action: string;
  attributes: Record<string, unknown>;
  tier: string;
}

interface FeatureVector {
  // Resource type embedding (one-hot or learned)
  resource_type: string;

  // Action (one-hot)
  action_delete: number;
  action_update: number;
  action_create: number;
  action_replace: number;

  // Universal safety features (normalized to 0/1/-1 for unknown)
  has_deletion_protection: number;       // 1=yes, 0=no, -1=unknown
  has_backup: number;                    // 1=yes, 0=no, -1=unknown
  has_snapshot: number;                  // 1=yes, 0=no, -1=unknown
  has_versioning: number;                // 1=yes, 0=no, -1=unknown
  has_pitr: number;                      // 1=yes, 0=no, -1=unknown
  has_retention_period: number;          // 1=yes, 0=no, -1=unknown
  retention_days: number;                // normalized, -1=unknown
  skip_final_snapshot: number;           // 1=yes, 0=no, -1=unknown
  deletion_window_days: number;          // normalized, -1=unknown
  is_empty: number;                      // 1=yes, 0=no, -1=unknown

  // Target
  tier: string;
}

// Attribute name patterns that map to features
const DELETION_PROTECTION_ATTRS = [
  'deletion_protection', 'deletion_protection_enabled', 'protect_from_delete',
  'termination_protection', 'prevent_destroy'
];

const BACKUP_ATTRS = [
  'backup_retention_period', 'backup_window', 'automated_backup',
  'backup_retention', 'backup_policy'
];

const SNAPSHOT_ATTRS = [
  'snapshot_id', 'snapshot_identifier', 'final_snapshot_identifier',
  'source_snapshot_id', 'skip_final_snapshot'
];

const VERSIONING_ATTRS = [
  'versioning', 'bucket_versioning', 'versioning_configuration',
  'version_id', 'enable_versioning'
];

const PITR_ATTRS = [
  'point_in_time_recovery', 'pitr', 'continuous_backup'
];

const RETENTION_ATTRS = [
  'retention_in_days', 'retention_period', 'backup_retention_period',
  'message_retention_seconds', 'deletion_window_in_days'
];

const EMPTY_ATTRS = [
  'object_count', 'message_count', 'item_count', 'size'
];

function extractFeatures(example: RawExample): FeatureVector {
  const attrs = example.attributes;

  return {
    resource_type: example.resource_type,

    // Action encoding
    action_delete: example.action === 'delete' ? 1 : 0,
    action_update: example.action === 'update' ? 1 : 0,
    action_create: example.action === 'create' ? 1 : 0,
    action_replace: example.action === 'replace' ? 1 : 0,

    // Feature extraction
    has_deletion_protection: extractBoolFeature(attrs, DELETION_PROTECTION_ATTRS),
    has_backup: extractBoolFeature(attrs, BACKUP_ATTRS, (v) => {
      if (typeof v === 'number') return v > 0;
      return !!v;
    }),
    has_snapshot: extractHasSnapshot(attrs),
    has_versioning: extractVersioning(attrs),
    has_pitr: extractPitr(attrs),
    has_retention_period: extractBoolFeature(attrs, RETENTION_ATTRS, (v) => {
      if (typeof v === 'number') return v > 0;
      return !!v;
    }),
    retention_days: extractRetentionDays(attrs),
    skip_final_snapshot: extractSkipFinalSnapshot(attrs),
    deletion_window_days: extractDeletionWindow(attrs),
    is_empty: extractIsEmpty(attrs),

    tier: example.tier,
  };
}

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

function extractHasSnapshot(attrs: Record<string, unknown>): number {
  // Check skip_final_snapshot first (inverse logic)
  if ('skip_final_snapshot' in attrs) {
    const skip = attrs['skip_final_snapshot'];
    if (skip === null || skip === undefined) return -1;
    return skip ? 0 : 1; // if skipping, no snapshot
  }

  for (const key of SNAPSHOT_ATTRS) {
    if (key in attrs && key !== 'skip_final_snapshot') {
      const value = attrs[key];
      if (value === null || value === undefined) return -1;
      return value ? 1 : 0;
    }
  }
  return -1;
}

function extractVersioning(attrs: Record<string, unknown>): number {
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

function extractSkipFinalSnapshot(attrs: Record<string, unknown>): number {
  if ('skip_final_snapshot' in attrs) {
    const value = attrs['skip_final_snapshot'];
    if (value === null || value === undefined) return -1;
    return value ? 1 : 0;
  }
  return -1;
}

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

// =============================================================================
// Main
// =============================================================================

import { readFileSync } from 'fs';

const trainingData = JSON.parse(
  readFileSync('src/training/training-data.json', 'utf-8')
) as RawExample[];

const features = trainingData.map(extractFeatures);

// Output as CSV for easy analysis
const headers = Object.keys(features[0]).join(',');
console.log(headers);

for (const f of features) {
  const values = Object.values(f).map(v =>
    typeof v === 'string' ? `"${v}"` : v
  ).join(',');
  console.log(values);
}

// Stats
console.error(`\nExtracted features for ${features.length} examples`);

// Show feature coverage
const featureCoverage: Record<string, { known: number; unknown: number }> = {};
for (const f of features) {
  for (const [key, value] of Object.entries(f)) {
    if (typeof value === 'number' && key !== 'action_delete' && key !== 'action_update' && key !== 'action_create' && key !== 'action_replace') {
      if (!featureCoverage[key]) {
        featureCoverage[key] = { known: 0, unknown: 0 };
      }
      if (value === -1) {
        featureCoverage[key].unknown++;
      } else {
        featureCoverage[key].known++;
      }
    }
  }
}

console.error('\nFeature coverage:');
for (const [key, { known, unknown }] of Object.entries(featureCoverage)) {
  const pct = ((known / (known + unknown)) * 100).toFixed(1);
  console.error(`  ${key}: ${pct}% known (${known}/${known + unknown})`);
}
