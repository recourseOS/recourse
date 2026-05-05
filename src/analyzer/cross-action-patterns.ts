/**
 * Cross-Action Pattern Catalog
 *
 * Each pattern is a self-describing detector for dangerous
 * combinations of actions in a Terraform plan.
 *
 * Design doc: docs/design/cross-action-analysis.md
 */

import { RecoverabilityTier } from '../resources/types.js';
import type {
  CrossActionPattern,
  CrossActionContext,
  PatternMatch,
  CrossActionRelationship,
} from './cross-action.js';
import { meetsConfidenceThreshold } from './cross-action.js';

// -----------------------------------------------------------------------------
// Pattern 1: Backup and Protected Resource Both Deleted
// -----------------------------------------------------------------------------

export const backupAndProtectedDeleted: CrossActionPattern = {
  id: 'backup_and_protected_both_deleted',
  name: 'Backup and protected resource both deleted',
  minimumConfidence: 'probable',
  upgradeTier: RecoverabilityTier.UNRECOVERABLE,
  explanationTemplate:
    "The backup '{source}' is being deleted in the same plan as the resource it backs up ('{target}'). " +
    'Recovery from this backup would not be possible after this plan applies.',

  detect(context: CrossActionContext): PatternMatch[] {
    const matches: PatternMatch[] = [];
    const deletions = context.changes.filter(c => c.actions.includes('delete'));

    // Find all snapshot deletions
    const snapshotDeletions = deletions.filter(c =>
      c.type === 'aws_db_snapshot' ||
      c.type === 'aws_ebs_snapshot' ||
      c.type === 'aws_rds_cluster_snapshot'
    );

    // Find all instance/database deletions
    const instanceDeletions = deletions.filter(c =>
      c.type === 'aws_db_instance' ||
      c.type === 'aws_instance' ||
      c.type === 'aws_rds_cluster'
    );

    // Build a set of deleted instance identifiers for fast lookup
    const deletedInstanceIds = new Set<string>();
    for (const instance of instanceDeletions) {
      const id = instance.before?.identifier as string | undefined
        ?? instance.before?.id as string | undefined
        ?? instance.name;
      if (id) deletedInstanceIds.add(id);
    }

    // Check each snapshot for relationship to deleted instance
    for (const snapshot of snapshotDeletions) {
      const relationship = detectBackupRelationship(
        snapshot,
        instanceDeletions,
        context.stateIndex,
        deletedInstanceIds
      );

      if (relationship && meetsConfidenceThreshold(relationship.confidence, this.minimumConfidence)) {
        matches.push({
          affectedResources: [relationship.target, snapshot.address],
          relationship,
          context: {
            snapshotType: snapshot.type,
            instanceType: instanceDeletions.find(i =>
              (i.before?.identifier ?? i.name) === relationship.target.split('.').pop()
            )?.type,
          },
        });
      }
    }

    return matches;
  },
};

/**
 * Detects backup relationship between a snapshot and deleted instances.
 */
function detectBackupRelationship(
  snapshot: { address: string; type: string; before: Record<string, unknown> | null },
  instanceDeletions: { address: string; before: Record<string, unknown> | null; name: string }[],
  _stateIndex: Map<string, Record<string, unknown>> | null,
  deletedInstanceIds: Set<string>
): CrossActionRelationship | null {
  // Check explicit reference in snapshot
  const snapshotInstanceId = snapshot.before?.db_instance_identifier as string | undefined
    ?? snapshot.before?.volume_id as string | undefined
    ?? snapshot.before?.db_cluster_identifier as string | undefined;

  if (snapshotInstanceId && deletedInstanceIds.has(snapshotInstanceId)) {
    // Find the instance address
    const instance = instanceDeletions.find(i =>
      (i.before?.identifier ?? i.name) === snapshotInstanceId
    );
    if (instance) {
      return {
        type: 'backup',
        source: snapshot.address,
        target: instance.address,
        detectionMethod: 'explicit_reference',
        confidence: 'definite',
      };
    }
  }

  // TODO: State lookup for additional relationships
  // TODO: Naming convention detection (low confidence)

  return null;
}

// -----------------------------------------------------------------------------
// Pattern 2: Replica and Primary Both Deleted
// -----------------------------------------------------------------------------

export const replicaAndPrimaryDeleted: CrossActionPattern = {
  id: 'replica_and_primary_both_deleted',
  name: 'Replica and primary both deleted',
  minimumConfidence: 'probable',
  upgradeTier: RecoverabilityTier.UNRECOVERABLE,
  explanationTemplate:
    "The replica '{source}' is being deleted in the same plan as its primary ('{target}'). " +
    'All copies of the data would be lost after this plan applies.',

  detect(context: CrossActionContext): PatternMatch[] {
    const matches: PatternMatch[] = [];
    const deletions = context.changes.filter(c => c.actions.includes('delete'));

    // Find all DB instance deletions
    const dbDeletions = deletions.filter(c =>
      c.type === 'aws_db_instance' ||
      c.type === 'aws_rds_cluster'
    );

    // Build a set of deleted primary identifiers
    const deletedPrimaryIds = new Set<string>();
    for (const db of dbDeletions) {
      const id = db.before?.identifier as string | undefined ?? db.name;
      if (id) deletedPrimaryIds.add(id);
    }

    // Check each deletion for replica relationship
    for (const db of dbDeletions) {
      const replicaSourceId = db.before?.replicate_source_db as string | undefined
        ?? db.before?.replication_source_identifier as string | undefined;

      if (replicaSourceId && deletedPrimaryIds.has(replicaSourceId)) {
        // Find the primary's address
        const primary = dbDeletions.find(d =>
          (d.before?.identifier ?? d.name) === replicaSourceId
        );

        if (primary) {
          matches.push({
            affectedResources: [primary.address, db.address],
            relationship: {
              type: 'replica',
              source: db.address,
              target: primary.address,
              detectionMethod: 'explicit_reference',
              confidence: 'definite',
            },
          });
        }
      }
    }

    return matches;
  },
};

// -----------------------------------------------------------------------------
// Pattern 3: Protection Disabled Then Resource Deleted
// -----------------------------------------------------------------------------

export const protectionDisabledThenDeleted: CrossActionPattern = {
  id: 'protection_disabled_then_deleted',
  name: 'Protection disabled then resource deleted',
  minimumConfidence: 'definite',
  upgradeTier: RecoverabilityTier.UNRECOVERABLE,
  explanationTemplate:
    "Deletion protection was disabled and the resource '{target}' was deleted in the same plan. " +
    'This bypasses the protection mechanism designed to prevent accidental deletion.',

  detect(context: CrossActionContext): PatternMatch[] {
    const matches: PatternMatch[] = [];

    // Group changes by address
    const changesByAddress = new Map<string, typeof context.changes>();
    for (const change of context.changes) {
      const existing = changesByAddress.get(change.address) ?? [];
      existing.push(change);
      changesByAddress.set(change.address, existing);
    }

    // Find resources with both update and delete actions
    for (const [address, changes] of changesByAddress) {
      const updates = changes.filter(c => c.actions.includes('update'));
      const deletes = changes.filter(c => c.actions.includes('delete'));

      if (updates.length === 0 || deletes.length === 0) continue;

      // Check if any update disabled deletion protection
      for (const update of updates) {
        const beforeProtection = update.before?.deletion_protection as boolean | undefined;
        const afterProtection = update.after?.deletion_protection as boolean | undefined;

        if (beforeProtection === true && afterProtection === false) {
          matches.push({
            affectedResources: [address],
            relationship: {
              type: 'protection',
              source: address,
              target: address,
              detectionMethod: 'explicit_reference',
              confidence: 'definite',
            },
            context: {
              protectionField: 'deletion_protection',
              beforeValue: beforeProtection,
              afterValue: afterProtection,
            },
          });
        }
      }
    }

    return matches;
  },
};

// -----------------------------------------------------------------------------
// Pattern Registry
// -----------------------------------------------------------------------------

/**
 * All registered cross-action patterns.
 * Adding a new pattern = adding one entry to this array.
 */
export const crossActionPatterns: CrossActionPattern[] = [
  backupAndProtectedDeleted,
  replicaAndPrimaryDeleted,
  protectionDisabledThenDeleted,
];
