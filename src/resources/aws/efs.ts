import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
  type ResourceChange,
  type ResourceDependency,
  type ResourceHandler,
  type StateResource,
  type TerraformState,
} from '../types.js';

export const efsHandler: ResourceHandler = {
  resourceTypes: [
    'aws_efs_file_system',
    'aws_efs_mount_target',
    'aws_efs_access_point',
    'aws_efs_backup_policy',
    'aws_efs_file_system_policy',
    'aws_efs_replication_configuration',
  ],

  getRecoverability(change: ResourceChange, state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('EFS configuration update is reversible');

    if (change.type === 'aws_efs_file_system') {
      return classifyFileSystem(change, state);
    }

    if (
      change.type === 'aws_efs_mount_target' ||
      change.type === 'aws_efs_access_point' ||
      change.type === 'aws_efs_backup_policy' ||
      change.type === 'aws_efs_file_system_policy'
    ) {
      return reversible('EFS supporting configuration can be recreated from Terraform');
    }

    if (change.type === 'aws_efs_replication_configuration') {
      return recoverableWithEffort('EFS replication configuration can be recreated, but destination replica state may require coordinated repair');
    }

    return recoverableWithEffort('EFS resource can be recreated with effort');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.id ?? resource.values.file_system_id ?? resource.values.arn) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'file_system_id',
      }));
  },
};

function classifyFileSystem(change: ResourceChange, state: TerraformState | null): RecoverabilityResult {
  const values = change.before ?? {};
  const fileSystemId = (values.id ?? values.file_system_id) as string | undefined;
  const backupPolicyEnabled = hasBackupPolicyEnabled(fileSystemId, state);

  if (backupPolicyEnabled || values.backup_policy_status === 'ENABLED') {
    return recoverableFromBackup('EFS backup policy is enabled; file system data may be recoverable from AWS Backup');
  }

  return unrecoverable('EFS file system deletion without backup policy evidence can permanently destroy file data');
}

function hasBackupPolicyEnabled(fileSystemId: string | undefined, state: TerraformState | null): boolean {
  if (!fileSystemId || !state) return false;

  return state.resources.some(resource => {
    if (resource.type !== 'aws_efs_backup_policy') return false;
    const values = resource.values;
    const status = nestedString(values, ['backup_policy', 'status']);
    return values.file_system_id === fileSystemId && status === 'ENABLED';
  });
}

function nestedString(values: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = values;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function reversible(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning,
  };
}

function recoverableWithEffort(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning,
  };
}

function recoverableFromBackup(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
    reasoning,
  };
}

function unrecoverable(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning,
  };
}
