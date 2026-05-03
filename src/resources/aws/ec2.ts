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
import type { EvidenceRequirement } from '../../core/state-schema.js';

export const ec2Handler: ResourceHandler = {
  resourceTypes: [
    'aws_instance',
    'aws_ami',
    'aws_ami_copy',
    'aws_launch_template',
    'aws_spot_instance_request',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'ec2.termination_protection',
        level: 'required',
        description: 'Whether termination protection is enabled',
        blocksSafeVerdict: false,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'ec2.ebs_volumes',
        level: 'required',
        description: 'Attached EBS volumes and their delete_on_termination settings',
        blocksSafeVerdict: true,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'ec2.instance_state',
        level: 'recommended',
        description: 'Current instance state (running/stopped/etc)',
        blocksSafeVerdict: false,
        defaultAssumption: 'running',
        maxFreshnessSeconds: 300,
      },
      {
        key: 'ec2.ami_id',
        level: 'optional',
        description: 'AMI used to launch the instance',
        blocksSafeVerdict: false,
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

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

    if (change.type === 'aws_instance') {
      result = classifyInstance(change, state, isDelete, ctx);
    } else if (change.type === 'aws_ami') {
      result = classifyAmi(change, isDelete, ctx);
    } else if (change.type === 'aws_launch_template') {
      ctx.check('resource_type', 'aws_launch_template', {
        passed: true,
        note: 'Launch templates are configuration only',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Launch template can be recreated from configuration',
      };
    } else if (change.type === 'aws_spot_instance_request') {
      ctx.check('resource_type', 'aws_spot_instance_request', {
        passed: true,
        note: 'Spot instances are ephemeral by design',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Spot instance is ephemeral by nature',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'EC2 resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify EBS snapshot existence outside the plan');
    ctx.limitation('Cannot check for instance store data');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_instance') {
      const instanceId = resource.values.id as string;
      const privateIp = resource.values.private_ip as string;
      const publicIp = resource.values.public_ip as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (instanceId && values.includes(instanceId)) ||
          (privateIp && values.includes(privateIp)) ||
          (publicIp && values.includes(publicIp))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'instance_id',
          });
        }
      }
    }

    if (resource.type === 'aws_ami') {
      const amiId = resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (
          other.type === 'aws_instance' &&
          other.values.ami === amiId
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'ami',
          });
        }

        if (
          other.type === 'aws_launch_template' &&
          other.values.image_id === amiId
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'image_id',
          });
        }
      }
    }

    return deps;
  },
};

function classifyInstance(
  change: ResourceChange,
  state: TerraformState | null,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    const before = change.before || {};
    const after = change.after || {};

    // Check if this is a replace
    if (before.instance_type !== after.instance_type || before.ami !== after.ami) {
      ctx.check('instance_change', {
        instance_type: { before: before.instance_type, after: after.instance_type },
        ami: { before: before.ami, after: after.ami },
      }, {
        passed: false,
        note: 'Instance type or AMI change triggers replacement',
      });
      return {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Instance will be replaced; data on instance store volumes will be lost',
      };
    }

    ctx.check('update_type', 'configuration', {
      passed: true,
      note: 'In-place configuration update',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Instance configuration update is reversible',
    };
  }

  const values = change.before || {};
  const instanceId = values.id as string;
  const amiId = values.ami as string;

  ctx.check('instance_id', instanceId, {
    passed: true,
    note: `Instance: ${instanceId || 'unknown'}`,
  });

  // Check EBS volumes with delete_on_termination
  const rootBlockDevice = values.root_block_device as
    Array<{ delete_on_termination?: boolean }> | undefined;
  const ebsBlockDevices = values.ebs_block_device as
    Array<{ delete_on_termination?: boolean }> | undefined;

  const rootPreserved = rootBlockDevice?.[0]?.delete_on_termination === false;
  const ebsPreserved = ebsBlockDevices?.some(d => d.delete_on_termination === false);

  ctx.check('root_block_device.delete_on_termination', rootBlockDevice?.[0]?.delete_on_termination, {
    passed: rootPreserved,
    note: rootPreserved
      ? 'Root volume will be preserved'
      : 'Root volume will be deleted with instance',
    counterfactual: !rootPreserved ? {
      condition: 'root_block_device.delete_on_termination were false',
      resultingTier: 'recoverable-from-backup',
      explanation: 'Root EBS volume would be preserved after instance termination',
    } : undefined,
  });

  if (ebsBlockDevices && ebsBlockDevices.length > 0) {
    ctx.check('ebs_block_devices', ebsBlockDevices.length, {
      passed: !!ebsPreserved,
      note: ebsPreserved
        ? 'Some EBS volumes will be preserved'
        : `${ebsBlockDevices.length} additional EBS volumes will be deleted`,
    });
  }

  if (rootPreserved || ebsPreserved) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'EBS volumes will be preserved (delete_on_termination=false)',
    };
  }

  // Check for ephemeral storage
  const ephemeralBlockDevices = values.ephemeral_block_device as
    Array<Record<string, unknown>> | undefined;

  if (ephemeralBlockDevices && ephemeralBlockDevices.length > 0) {
    ctx.check('ephemeral_block_device', ephemeralBlockDevices.length, {
      passed: false,
      note: `Instance has ${ephemeralBlockDevices.length} instance store volume(s); data is ephemeral`,
    });
    return {
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'Instance has ephemeral storage; data will be permanently lost',
    };
  }

  // Check for AMI
  ctx.check('ami', amiId, {
    passed: true,
    note: amiId ? `Can recreate from AMI: ${amiId}` : 'AMI unknown',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'Instance can be recreated from AMI; EBS volumes will be deleted',
  };
}

function classifyAmi(
  change: ResourceChange,
  isDelete: boolean,
  ctx: ClassificationContext
): RecoverabilityResult {
  if (!isDelete) {
    ctx.check('update_type', 'metadata', {
      passed: true,
      note: 'AMI metadata update',
    });
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'AMI metadata update is reversible',
    };
  }

  const values = change.before || {};
  const amiId = values.id as string;
  const name = values.name as string;

  ctx.check('ami_id', amiId, {
    passed: false,
    note: `AMI: ${amiId || 'unknown'} (${name || 'unnamed'})`,
  });

  ctx.check('ami_deletion', null, {
    passed: false,
    note: 'AMI deletion is permanent; instances using this AMI cannot be relaunched',
  });

  ctx.addCounterfactual({
    condition: 'AMI were copied to another account first',
    resultingTier: 'recoverable-with-effort',
    explanation: 'Cross-account AMI copy would preserve the image',
  });

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'AMI deletion is permanent; instances using it cannot be launched',
  };
}
