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

export const vpcHandler: ResourceHandler = {
  resourceTypes: [
    'aws_vpc',
    'aws_subnet',
    'aws_route_table',
    'aws_route',
    'aws_route_table_association',
    'aws_internet_gateway',
    'aws_nat_gateway',
    'aws_eip',
    'aws_network_acl',
    'aws_network_acl_rule',
  ],

  // Per-type evidence requirements
  evidenceRequirements: {
    'aws_vpc': {
      delete: [
        {
          key: 'vpc.dependent_count',
          level: 'required',
          description: 'Number of resources depending on this VPC',
          blocksSafeVerdict: true,
          defaultAssumption: undefined,
          maxFreshnessSeconds: 300,
        },
        {
          key: 'vpc.cidr_block',
          level: 'required',
          description: 'VPC CIDR block',
          blocksSafeVerdict: false,
          defaultAssumption: undefined,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'vpc.has_internet_gateway',
          level: 'recommended',
          description: 'Whether VPC has an attached internet gateway',
          blocksSafeVerdict: false,
          defaultAssumption: false,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'vpc.peering_connections',
          level: 'recommended',
          description: 'VPC peering connections',
          blocksSafeVerdict: false,
          defaultAssumption: [],
          maxFreshnessSeconds: 3600,
        },
      ] satisfies EvidenceRequirement[],
    },
    'aws_subnet': {
      delete: [
        {
          key: 'subnet.eni_count',
          level: 'required',
          description: 'Number of network interfaces using this subnet',
          blocksSafeVerdict: true,
          defaultAssumption: undefined,
          maxFreshnessSeconds: 300,
        },
        {
          key: 'subnet.cidr_block',
          level: 'required',
          description: 'The CIDR block that will be released',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'subnet.availability_zone',
          level: 'recommended',
          description: 'The availability zone this subnet is in',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'subnet.vpc_id',
          level: 'optional',
          description: 'The VPC this subnet belongs to',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
      ] satisfies EvidenceRequirement[],
    },
    'aws_nat_gateway': {
      delete: [
        {
          key: 'nat.route_table_count',
          level: 'required',
          description: 'Number of route tables with routes pointing to this NAT gateway',
          blocksSafeVerdict: true,
          defaultAssumption: undefined,
          maxFreshnessSeconds: 300,
        },
        {
          key: 'nat.state',
          level: 'required',
          description: 'Current state (available, pending, deleting, deleted, failed)',
          blocksSafeVerdict: false,
          defaultAssumption: 'available',
          maxFreshnessSeconds: 60,
        },
        {
          key: 'nat.public_ip',
          level: 'recommended',
          description: 'The public IP address associated with this NAT gateway',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'nat.subnet_id',
          level: 'optional',
          description: 'The subnet this NAT gateway is deployed in',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
      ] satisfies EvidenceRequirement[],
    },
    'aws_eip': {
      delete: [
        {
          key: 'eip.public_ip',
          level: 'required',
          description: 'The public IP address that will be released',
          blocksSafeVerdict: true,
          defaultAssumption: undefined,
          maxFreshnessSeconds: 3600,
        },
        {
          key: 'eip.association_id',
          level: 'required',
          description: 'Whether the EIP is currently associated with a resource',
          blocksSafeVerdict: true,
          defaultAssumption: 'unknown',
          maxFreshnessSeconds: 300,
        },
        {
          key: 'eip.domain',
          level: 'optional',
          description: 'Whether this is a VPC or EC2-Classic EIP',
          blocksSafeVerdict: false,
          maxFreshnessSeconds: 3600,
        },
      ] satisfies EvidenceRequirement[],
    },
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

    if (!isDelete) {
      ctx.check('update_type', 'configuration', {
        passed: true,
        note: 'VPC configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'VPC resource update is reversible',
      };
    } else if (change.type === 'aws_vpc') {
      result = classifyVpc(change, state, ctx);
    } else if (change.type === 'aws_subnet') {
      result = classifySubnet(change, state, ctx);
    } else if (change.type === 'aws_eip') {
      result = classifyEip(change, ctx);
    } else if (change.type === 'aws_nat_gateway') {
      ctx.check('resource_type', 'aws_nat_gateway', {
        passed: true,
        note: 'NAT Gateway can be recreated; outbound connectivity will be disrupted',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'NAT Gateway can be recreated; private subnet connectivity will be disrupted',
      };
    } else {
      ctx.check('resource_type', change.type, {
        passed: true,
        note: 'VPC networking resource',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'VPC resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify ENI attachments outside the plan');
    ctx.limitation('Cannot check for VPC peering connections in other accounts');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_vpc') {
      const vpcId = resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (other.values.vpc_id === vpcId) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'vpc_id',
          });
        }
      }
    }

    if (resource.type === 'aws_subnet') {
      const subnetId = resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (
          other.values.subnet_id === subnetId ||
          (other.values.subnet_ids as string[])?.includes(subnetId)
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'subnet_id',
          });
        }
      }
    }

    return deps;
  },
};

function classifyVpc(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const vpcId = values.id as string;
  const cidrBlock = values.cidr_block as string;

  ctx.check('vpc_id', vpcId, {
    passed: true,
    note: `VPC: ${vpcId || 'unknown'}`,
  });

  ctx.check('cidr_block', cidrBlock, {
    passed: true,
    note: `CIDR: ${cidrBlock || 'unknown'}`,
  });

  // Count dependent resources
  let dependentCount = 0;
  if (state && vpcId) {
    dependentCount = state.resources.filter(r =>
      r.values.vpc_id === vpcId
    ).length;
  }

  ctx.check('dependent_resources', dependentCount, {
    passed: dependentCount === 0,
    note: dependentCount > 0
      ? `${dependentCount} resources depend on this VPC`
      : 'No dependent resources found',
  });

  if (dependentCount > 0) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: `VPC deletion affects ${dependentCount} dependent resources; all must be recreated`,
    };
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: 'VPC can be recreated, but IP ranges may change',
  };
}

function classifySubnet(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const subnetId = values.id as string;
  const cidrBlock = values.cidr_block as string;
  const availabilityZone = values.availability_zone as string;

  ctx.check('subnet_id', subnetId, {
    passed: true,
    note: `Subnet: ${subnetId || 'unknown'}`,
  });

  ctx.check('cidr_block', cidrBlock, {
    passed: true,
    note: `CIDR: ${cidrBlock || 'unknown'} in ${availabilityZone || 'unknown AZ'}`,
  });

  // Count resources in this subnet
  let resourceCount = 0;
  if (state && subnetId) {
    resourceCount = state.resources.filter(r =>
      r.values.subnet_id === subnetId ||
      (r.values.subnet_ids as string[])?.includes(subnetId)
    ).length;
  }

  ctx.check('resources_in_subnet', resourceCount, {
    passed: resourceCount === 0,
    note: resourceCount > 0
      ? `${resourceCount} resources in this subnet must be moved`
      : 'No resources found in subnet',
  });

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: resourceCount > 0
      ? `Subnet can be recreated; ${resourceCount} resources in it must be moved`
      : 'Subnet can be recreated',
  };
}

function classifyEip(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const publicIp = values.public_ip as string;
  const associationId = values.association_id as string;

  ctx.check('public_ip', publicIp, {
    passed: false,
    note: `IP: ${publicIp || 'unknown'} - will be released permanently`,
  });

  ctx.check('association', associationId, {
    passed: !associationId,
    note: associationId
      ? 'EIP is currently associated with a resource'
      : 'EIP is not associated',
  });

  ctx.addCounterfactual({
    condition: 'DNS were used instead of direct IP references',
    resultingTier: 'recoverable-with-effort',
    explanation: 'DNS abstraction allows IP changes without breaking clients',
  });

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: `Elastic IP ${publicIp || ''} will be released; cannot reclaim same IP`,
  };
}
