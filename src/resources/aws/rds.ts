import {
  RecoverabilityTier,
  RecoverabilityLabels,
  type ResourceHandler,
  type ResourceChange,
  type TerraformState,
  type RecoverabilityResult,
  type StateResource,
  type ResourceDependency,
  type ClassificationTrace,
} from '../types.js';
import { ClassificationContext } from '../../analyzer/trace.js';
import type { VerificationSuggestion } from '../../core/mutation.js';
import { rdsManualSnapshots, rdsAwsBackupRecoveryPoints, rdsAutomatedBackups } from '../../verification/index.js';

export const rdsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_db_instance',
    'aws_rds_cluster',
    'aws_rds_cluster_instance',
    'aws_db_snapshot',
    'aws_db_cluster_snapshot',
  ],

  getRecoverability(
    change: ResourceChange,
    state: TerraformState | null
  ): RecoverabilityResult {
    const ctx = new ClassificationContext(change.address, change.type,
      change.actions.includes('delete') ? 'delete' : 'update');
    const trace = this.getRecoverabilityTraced!(change, state, ctx);
    return trace.result;
  },

  getRecoverabilityTraced(
    change: ResourceChange,
    state: TerraformState | null,
    ctx: ClassificationContext
  ): ClassificationTrace {
    const isDelete = change.actions.includes('delete');

    ctx.check('action', change.actions, {
      passed: true,
      note: isDelete ? 'Resource will be deleted' : 'Resource will be modified',
    });

    let result: RecoverabilityResult;

    if (change.type === 'aws_db_instance') {
      result = classifyDbInstance(change, state, isDelete, ctx);
    } else if (change.type === 'aws_rds_cluster') {
      result = classifyRdsCluster(change, state, isDelete, ctx);
    } else if (change.type === 'aws_rds_cluster_instance') {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Cluster instance can be recreated if cluster exists',
      };
      ctx.check('resource_type', 'aws_rds_cluster_instance', {
        passed: true,
        note: 'Cluster instances are ephemeral; cluster holds the data',
      });
    } else if (change.type === 'aws_db_snapshot' || change.type === 'aws_db_cluster_snapshot') {
      if (isDelete) {
        result = {
          tier: RecoverabilityTier.UNRECOVERABLE,
          label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
          reasoning: 'Snapshot deletion is permanent; this is your backup',
        };
        ctx.check('resource_type', change.type, {
          passed: false,
          note: 'Snapshots ARE the recovery mechanism; deleting them removes recovery options',
        });
      } else {
        result = {
          tier: RecoverabilityTier.REVERSIBLE,
          label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
          reasoning: 'Snapshot metadata update is reversible',
        };
      }
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'RDS resource can likely be recreated',
      };
    }

    // Add common limitations for RDS
    ctx.limitation('Cannot verify AWS Backup vault configurations outside the plan');
    ctx.limitation('Cannot check for cross-region or cross-account snapshots');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_db_instance' || resource.type === 'aws_rds_cluster') {
      const endpoint = resource.values.endpoint as string;
      const address = resource.values.address as string;
      const identifier = resource.values.identifier as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (endpoint && values.includes(endpoint)) ||
          (address && values.includes(address)) ||
          (identifier && values.includes(identifier))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'endpoint',
          });
        }
      }
    }

    return deps;
  },
};

function classifyDbInstance(
  change: ResourceChange,
  state: TerraformState | null,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    const before = change.before || {};
    const after = change.after || {};

    if (before.engine !== after.engine || before.engine_version !== after.engine_version) {
      ctx.check('engine_change', { before: before.engine, after: after.engine }, {
        passed: false,
        note: 'Engine change may require restore from snapshot',
      });
      return {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'Engine change may require restore from snapshot',
      };
    }

    ctx.check('update_type', 'configuration', {
      passed: true,
      note: 'Configuration update, no data at risk',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Instance configuration update is reversible',
    };
  }

  const values = change.before || {};

  // Check deletion protection
  const deletionProtection = values.deletion_protection;
  ctx.check('deletion_protection', deletionProtection, {
    passed: deletionProtection !== true,
    note: deletionProtection === true
      ? 'AWS will block this deletion'
      : 'No deletion protection',
    counterfactual: deletionProtection !== true ? {
      condition: 'deletion_protection were set to true',
      resultingTier: 'blocked',
      explanation: 'Apply would fail; AWS blocks deletion when protection is enabled',
    } : undefined,
  });

  if (deletionProtection === true) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: 'blocked',
      reasoning: 'APPLY WILL FAIL: deletion_protection=true; disable protection first to delete',
    };
  }

  // Check skip_final_snapshot
  const skipFinalSnapshot = values.skip_final_snapshot as boolean;
  const finalSnapshotIdentifier = values.final_snapshot_identifier as string;

  ctx.check('skip_final_snapshot', skipFinalSnapshot, {
    passed: !skipFinalSnapshot || !!finalSnapshotIdentifier,
    note: skipFinalSnapshot
      ? 'No automatic snapshot on deletion'
      : 'Final snapshot will be created',
    counterfactual: skipFinalSnapshot && !finalSnapshotIdentifier ? {
      condition: 'skip_final_snapshot were false',
      resultingTier: 'recoverable-from-backup',
      explanation: 'A final snapshot would be created before deletion',
    } : undefined,
  });

  if (finalSnapshotIdentifier) {
    ctx.check('final_snapshot_identifier', finalSnapshotIdentifier, {
      passed: true,
      note: `Snapshot "${finalSnapshotIdentifier}" will be created`,
    });
  }

  // Check backup retention
  const backupRetentionPeriod = values.backup_retention_period as number;
  ctx.check('backup_retention_period', backupRetentionPeriod, {
    passed: !!backupRetentionPeriod && backupRetentionPeriod > 0,
    note: backupRetentionPeriod
      ? `${backupRetentionPeriod} days of automated backups`
      : 'No automated backups',
    counterfactual: (!backupRetentionPeriod || backupRetentionPeriod === 0) ? {
      condition: 'backup_retention_period were > 0',
      resultingTier: 'recoverable-from-backup',
      explanation: 'Automated backups would exist for point-in-time recovery',
    } : undefined,
  });

  if (skipFinalSnapshot && !finalSnapshotIdentifier) {
    if (!backupRetentionPeriod || backupRetentionPeriod === 0) {
      // Generate verification suggestions for unrecoverable case
      const suggestions: VerificationSuggestion[] = [];
      const identifier = values.identifier as string;

      if (identifier) {
        suggestions.push(rdsManualSnapshots(identifier));
        suggestions.push(rdsAutomatedBackups(identifier));

        // If we have ARN info, suggest AWS Backup check
        const arn = values.arn as string;
        if (arn) {
          suggestions.push(rdsAwsBackupRecoveryPoints(arn));
        }
      }

      return {
        tier: RecoverabilityTier.UNRECOVERABLE,
        label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
        reasoning: 'skip_final_snapshot=true, no backup retention, no final snapshot; data will be lost',
        verificationSuggestions: suggestions.length > 0 ? suggestions : undefined,
      };
    }

    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: `skip_final_snapshot=true but automated backups exist (retention: ${backupRetentionPeriod} days)`,
    };
  }

  if (finalSnapshotIdentifier) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: `Final snapshot will be created: ${finalSnapshotIdentifier}`,
    };
  }

  // Check for existing snapshots in state
  if (state) {
    const identifier = values.identifier as string;
    const hasSnapshot = state.resources.some(
      r => r.type === 'aws_db_snapshot' &&
           r.values.db_instance_identifier === identifier
    );

    ctx.check('existing_snapshots', hasSnapshot, {
      passed: hasSnapshot,
      note: hasSnapshot
        ? 'Manual snapshot exists in state'
        : 'No manual snapshots found in state',
    });

    if (hasSnapshot) {
      return {
        tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
        reasoning: 'Manual snapshot exists for this instance',
      };
    }
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
    reasoning: 'Final snapshot will be created by default',
  };
}

function classifyRdsCluster(
  change: ResourceChange,
  state: TerraformState | null,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    ctx.check('update_type', 'configuration', {
      passed: true,
      note: 'Configuration update, no data at risk',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Cluster configuration update is reversible',
    };
  }

  const values = change.before || {};

  // Check deletion protection
  const deletionProtection = values.deletion_protection;
  ctx.check('deletion_protection', deletionProtection, {
    passed: deletionProtection !== true,
    note: deletionProtection === true
      ? 'AWS will block this deletion'
      : 'No deletion protection',
    counterfactual: deletionProtection !== true ? {
      condition: 'deletion_protection were set to true',
      resultingTier: 'blocked',
      explanation: 'Apply would fail; AWS blocks deletion when protection is enabled',
    } : undefined,
  });

  if (deletionProtection === true) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: 'blocked',
      reasoning: 'APPLY WILL FAIL: deletion_protection=true; disable protection first to delete',
    };
  }

  const skipFinalSnapshot = values.skip_final_snapshot as boolean;
  const finalSnapshotIdentifier = values.final_snapshot_identifier as string;

  ctx.check('skip_final_snapshot', skipFinalSnapshot, {
    passed: !skipFinalSnapshot || !!finalSnapshotIdentifier,
    note: skipFinalSnapshot
      ? 'No automatic snapshot on deletion'
      : 'Final snapshot will be created',
    counterfactual: skipFinalSnapshot && !finalSnapshotIdentifier ? {
      condition: 'skip_final_snapshot were false',
      resultingTier: 'recoverable-from-backup',
      explanation: 'A final snapshot would be created before deletion',
    } : undefined,
  });

  const backupRetentionPeriod = values.backup_retention_period as number;
  ctx.check('backup_retention_period', backupRetentionPeriod, {
    passed: !!backupRetentionPeriod && backupRetentionPeriod > 0,
    note: backupRetentionPeriod
      ? `${backupRetentionPeriod} days of automated backups`
      : 'No automated backups',
  });

  if (skipFinalSnapshot && !finalSnapshotIdentifier) {
    if (!backupRetentionPeriod || backupRetentionPeriod === 0) {
      // Generate verification suggestions for unrecoverable cluster
      const suggestions: VerificationSuggestion[] = [];
      const clusterIdentifier = values.cluster_identifier as string;

      if (clusterIdentifier) {
        // For clusters, we'd check cluster snapshots (similar pattern)
        const arn = values.arn as string;
        if (arn) {
          suggestions.push(rdsAwsBackupRecoveryPoints(arn));
        }
      }

      return {
        tier: RecoverabilityTier.UNRECOVERABLE,
        label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
        reasoning: 'skip_final_snapshot=true, no backup retention; all cluster data will be lost',
        verificationSuggestions: suggestions.length > 0 ? suggestions : undefined,
      };
    }

    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: `Automated backups exist (retention: ${backupRetentionPeriod} days)`,
    };
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
    reasoning: finalSnapshotIdentifier
      ? `Final snapshot will be created: ${finalSnapshotIdentifier}`
      : 'Final snapshot will be created by default',
  };
}
