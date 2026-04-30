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
import { ebsExternalSnapshots, ebsAwsBackupRecoveryPoints } from '../../verification/index.js';

export const ebsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_ebs_volume',
    'aws_ebs_snapshot',
    'aws_ebs_snapshot_copy',
    'aws_volume_attachment',
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

    if (!isDelete) {
      ctx.check('update_type', 'configuration', {
        passed: true,
        note: 'EBS configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'EBS resource update is reversible',
      };
    } else if (change.type === 'aws_ebs_volume') {
      result = classifyEbsVolume(change, state, ctx);
    } else if (change.type === 'aws_ebs_snapshot' || change.type === 'aws_ebs_snapshot_copy') {
      result = classifyEbsSnapshot(change, ctx);
    } else if (change.type === 'aws_volume_attachment') {
      ctx.check('resource_type', 'aws_volume_attachment', {
        passed: true,
        note: 'Volume attachment can be recreated',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Volume can be re-attached',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'EBS resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify AWS Backup vault snapshots outside Terraform state');
    ctx.limitation('Cannot check for cross-region snapshot copies');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_ebs_volume') {
      const volumeId = resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (
          other.type === 'aws_volume_attachment' &&
          other.values.volume_id === volumeId
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'volume_id',
          });
        }
      }
    }

    if (resource.type === 'aws_ebs_snapshot') {
      const snapshotId = resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (
          other.type === 'aws_ebs_volume' &&
          other.values.snapshot_id === snapshotId
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'snapshot_id',
          });
        }

        if (
          other.type === 'aws_ami' &&
          (other.values.ebs_block_device as Array<{ snapshot_id?: string }>)
            ?.some(d => d.snapshot_id === snapshotId)
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'snapshot_id',
          });
        }
      }
    }

    return deps;
  },
};

function classifyEbsVolume(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const volumeId = values.id as string;
  const size = values.size as number;
  const volumeType = values.type as string;
  const encrypted = values.encrypted as boolean;
  const availabilityZone = values.availability_zone as string;

  ctx.check('volume_id', volumeId, {
    passed: true,
    note: `Volume: ${volumeId || 'unknown'}`,
  });

  ctx.check('volume_details', { size, volumeType, encrypted }, {
    passed: true,
    note: `${size || '?'}GB ${volumeType || 'unknown'} volume${encrypted ? ' (encrypted)' : ''}`,
  });

  // Check for existing snapshots
  let hasSnapshot = false;
  if (state && volumeId) {
    hasSnapshot = state.resources.some(
      r => r.type === 'aws_ebs_snapshot' &&
           r.values.volume_id === volumeId
    );
  }

  ctx.check('existing_snapshot', hasSnapshot, {
    passed: hasSnapshot,
    note: hasSnapshot
      ? 'Volume has snapshot in Terraform state'
      : 'No snapshot found in Terraform state',
    counterfactual: !hasSnapshot ? {
      condition: 'volume had a snapshot',
      resultingTier: 'recoverable-from-backup',
      explanation: 'EBS snapshot would allow full data restoration',
    } : undefined,
  });

  if (hasSnapshot) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'Volume has snapshot; data can be restored',
    };
  }

  // No snapshot in state - generate verification suggestions
  const suggestions: VerificationSuggestion[] = [];

  if (volumeId) {
    // Suggest checking for snapshots outside Terraform state
    suggestions.push(ebsExternalSnapshots(volumeId));

    // Suggest checking AWS Backup if we can construct the ARN
    if (availabilityZone) {
      const region = availabilityZone.slice(0, -1); // us-east-1a -> us-east-1
      // Note: We'd need account ID for full ARN, but the agent can fill this in
      const volumeArn = `arn:aws:ec2:${region}:*:volume/${volumeId}`;
      suggestions.push(ebsAwsBackupRecoveryPoints(volumeArn));
    }
  }

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Volume deletion without snapshot means data is permanently lost',
    verificationSuggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

function classifyEbsSnapshot(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const snapshotId = values.id as string;
  const volumeId = values.volume_id as string;
  const description = values.description as string;

  ctx.check('snapshot_id', snapshotId, {
    passed: false,
    note: `Snapshot: ${snapshotId || 'unknown'}`,
  });

  ctx.check('source_volume', volumeId, {
    passed: true,
    note: `Source volume: ${volumeId || 'unknown'}`,
  });

  if (description) {
    ctx.check('description', description, {
      passed: true,
      note: `Description: ${description}`,
    });
  }

  ctx.addCounterfactual({
    condition: 'snapshot were copied to another region first',
    resultingTier: 'recoverable-from-backup',
    explanation: 'Cross-region copy would preserve the backup',
  });

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Snapshot deletion is permanent; this is your backup',
  };
}
