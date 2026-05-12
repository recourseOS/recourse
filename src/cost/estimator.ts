/**
 * Cost estimation for cloud resources.
 *
 * Extracts resource details from Terraform plans, shell commands, etc.
 * and estimates monthly cost.
 */

import {
  getMonthlyPrice,
  AWS_STORAGE_PRICING,
} from './pricing.js';
import type { ResourceChange } from '../resources/types.js';
import type { MutationIntent } from '../core/index.js';

export interface CostEstimate {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Cost breakdown by component */
  breakdown?: CostBreakdown[];
  /** Whether this is a cost increase (+) or decrease (-) */
  direction: 'increase' | 'decrease' | 'unchanged';
  /** Confidence level in the estimate */
  confidence: 'high' | 'medium' | 'low';
  /** Resource details used for estimation */
  details?: {
    provider?: string;
    resourceType?: string;
    instanceType?: string;
    region?: string;
  };
}

export interface CostBreakdown {
  component: string;
  monthlyCost: number;
  unit?: string;
  quantity?: number;
}

/**
 * Estimate cost for a Terraform resource change.
 */
export function estimateTerraformCost(change: ResourceChange): CostEstimate {
  const { type: resourceType, actions, after } = change;

  // Determine direction based on actions
  let direction: CostEstimate['direction'] = 'unchanged';
  if (actions.includes('create') && !actions.includes('delete')) {
    direction = 'increase';
  } else if (actions.includes('delete') && !actions.includes('create')) {
    direction = 'decrease';
  }
  // Replace (delete + create) or update = unchanged for cost comparison

  // Extract provider from resource type
  const provider = getProviderFromResourceType(resourceType);

  // Estimate based on resource type
  let estimate: CostEstimate | null = null;

  if (resourceType === 'aws_instance') {
    estimate = estimateAwsInstance(after);
  } else if (resourceType === 'aws_db_instance') {
    estimate = estimateAwsRds(after);
  } else if (resourceType === 'aws_s3_bucket') {
    estimate = estimateAwsS3(after);
  } else if (resourceType === 'google_compute_instance') {
    estimate = estimateGcpCompute(after);
  } else if (resourceType === 'google_sql_database_instance') {
    estimate = estimateGcpCloudSql(after);
  } else if (resourceType === 'azurerm_virtual_machine' || resourceType === 'azurerm_linux_virtual_machine') {
    estimate = estimateAzureVm(after);
  }

  if (estimate) {
    estimate.direction = direction;
    estimate.details = {
      ...estimate.details,
      provider,
      resourceType,
    };
    return estimate;
  }

  // Unknown resource type
  return {
    monthlyCost: 0,
    direction,
    confidence: 'low',
    details: { provider, resourceType },
  };
}

/**
 * Estimate cost from a mutation intent (shell command, MCP call).
 */
export function estimateMutationCost(intent: MutationIntent): CostEstimate {
  const { target, action } = intent;

  const direction: CostEstimate['direction'] =
    action === 'create' ? 'increase' :
    action === 'delete' ? 'decrease' : 'unchanged';

  // Try to extract instance type from metadata or after state
  const params = (intent.metadata || intent.after || {}) as Record<string, unknown>;
  const instanceType = (params.instance_type || params.instanceType || params.machine_type) as string | undefined;
  const az = params.availability_zone as string | undefined;
  const region = (params.region as string | undefined) || az?.slice(0, -1);

  if (target?.type && instanceType) {
    const provider = getProviderFromResourceType(target.type);
    const monthly = getMonthlyPrice(
      provider as 'aws' | 'gcp' | 'azure',
      target.type,
      instanceType,
      region
    );

    if (monthly !== null) {
      return {
        monthlyCost: monthly,
        direction,
        confidence: 'high',
        details: {
          provider,
          resourceType: target.type,
          instanceType,
          region,
        },
      };
    }
  }

  return {
    monthlyCost: 0,
    direction,
    confidence: 'low',
    details: {
      resourceType: target?.type,
    },
  };
}

/**
 * Estimate cost for AWS EC2 instance.
 */
function estimateAwsInstance(config: Record<string, unknown> | null): CostEstimate {
  if (!config) {
    return { monthlyCost: 0, direction: 'unchanged', confidence: 'low' };
  }

  const instanceType = config.instance_type as string || 't3.micro';
  const region = extractRegion(config);

  const monthly = getMonthlyPrice('aws', 'aws_instance', instanceType, region);

  if (monthly === null) {
    return {
      monthlyCost: 0,
      direction: 'increase',
      confidence: 'low',
      details: { instanceType, region },
    };
  }

  const breakdown: CostBreakdown[] = [
    { component: 'Instance', monthlyCost: monthly },
  ];

  // Add EBS volume estimate if present
  const rootVolume = config.root_block_device as Record<string, unknown>[] | undefined;
  if (rootVolume && rootVolume[0]) {
    const volumeSize = (rootVolume[0].volume_size as number) || 8;
    const volumeType = (rootVolume[0].volume_type as string) || 'gp3';
    const ebsKey = `ebs_${volumeType}` as keyof typeof AWS_STORAGE_PRICING;
    const ebsPrice = AWS_STORAGE_PRICING[ebsKey]?.monthly || 0.08;
    const volumeCost = volumeSize * ebsPrice;
    breakdown.push({
      component: 'EBS Volume',
      monthlyCost: volumeCost,
      unit: 'GB',
      quantity: volumeSize,
    });
  }

  const totalCost = breakdown.reduce((sum, b) => sum + b.monthlyCost, 0);

  return {
    monthlyCost: Math.round(totalCost * 100) / 100,
    breakdown,
    direction: 'increase',
    confidence: 'high',
    details: { instanceType, region },
  };
}

/**
 * Estimate cost for AWS RDS instance.
 */
function estimateAwsRds(config: Record<string, unknown> | null): CostEstimate {
  if (!config) {
    return { monthlyCost: 0, direction: 'unchanged', confidence: 'low' };
  }

  const instanceClass = config.instance_class as string || 'db.t3.micro';
  const region = extractRegion(config);
  const multiAz = config.multi_az as boolean || false;

  let monthly = getMonthlyPrice('aws', 'aws_db_instance', instanceClass, region);

  if (monthly === null) {
    return {
      monthlyCost: 0,
      direction: 'increase',
      confidence: 'low',
      details: { instanceType: instanceClass, region },
    };
  }

  // Multi-AZ doubles the cost
  if (multiAz) {
    monthly *= 2;
  }

  const breakdown: CostBreakdown[] = [
    { component: `RDS Instance${multiAz ? ' (Multi-AZ)' : ''}`, monthlyCost: monthly },
  ];

  // Add storage estimate
  const allocatedStorage = (config.allocated_storage as number) || 20;
  const storageType = (config.storage_type as string) || 'gp2';
  const storageCost = allocatedStorage * 0.115; // Approximate RDS storage cost
  breakdown.push({
    component: 'Storage',
    monthlyCost: storageCost,
    unit: 'GB',
    quantity: allocatedStorage,
  });

  const totalCost = breakdown.reduce((sum, b) => sum + b.monthlyCost, 0);

  return {
    monthlyCost: Math.round(totalCost * 100) / 100,
    breakdown,
    direction: 'increase',
    confidence: 'high',
    details: { instanceType: instanceClass, region },
  };
}

/**
 * Estimate cost for AWS S3 bucket.
 */
function estimateAwsS3(config: Record<string, unknown> | null): CostEstimate {
  // S3 cost depends heavily on usage, provide a baseline estimate
  return {
    monthlyCost: 1, // Minimal baseline
    direction: 'increase',
    confidence: 'low',
    details: { resourceType: 'aws_s3_bucket' },
  };
}

/**
 * Estimate cost for GCP Compute instance.
 */
function estimateGcpCompute(config: Record<string, unknown> | null): CostEstimate {
  if (!config) {
    return { monthlyCost: 0, direction: 'unchanged', confidence: 'low' };
  }

  const machineType = config.machine_type as string || 'e2-micro';
  const zone = config.zone as string;
  const region = zone?.replace(/-[a-z]$/, '');

  const monthly = getMonthlyPrice('gcp', 'google_compute_instance', machineType, region);

  if (monthly === null) {
    return {
      monthlyCost: 0,
      direction: 'increase',
      confidence: 'low',
      details: { instanceType: machineType, region },
    };
  }

  return {
    monthlyCost: monthly,
    direction: 'increase',
    confidence: 'high',
    details: { instanceType: machineType, region },
  };
}

/**
 * Estimate cost for GCP Cloud SQL instance.
 */
function estimateGcpCloudSql(config: Record<string, unknown> | null): CostEstimate {
  if (!config) {
    return { monthlyCost: 0, direction: 'unchanged', confidence: 'low' };
  }

  const settings = config.settings as Record<string, unknown>[] | undefined;
  const tier = settings?.[0]?.tier as string || 'db-f1-micro';

  const monthly = getMonthlyPrice('gcp', 'google_sql_database_instance', tier);

  if (monthly === null) {
    return {
      monthlyCost: 0,
      direction: 'increase',
      confidence: 'low',
      details: { instanceType: tier },
    };
  }

  return {
    monthlyCost: monthly,
    direction: 'increase',
    confidence: 'high',
    details: { instanceType: tier },
  };
}

/**
 * Estimate cost for Azure VM.
 */
function estimateAzureVm(config: Record<string, unknown> | null): CostEstimate {
  if (!config) {
    return { monthlyCost: 0, direction: 'unchanged', confidence: 'low' };
  }

  const vmSize = config.size as string || config.vm_size as string || 'Standard_B1s';
  const location = config.location as string;

  const monthly = getMonthlyPrice('azure', 'azurerm_virtual_machine', vmSize, location);

  if (monthly === null) {
    return {
      monthlyCost: 0,
      direction: 'increase',
      confidence: 'low',
      details: { instanceType: vmSize, region: location },
    };
  }

  return {
    monthlyCost: monthly,
    direction: 'increase',
    confidence: 'high',
    details: { instanceType: vmSize, region: location },
  };
}

/**
 * Get cloud provider from resource type.
 */
function getProviderFromResourceType(resourceType: string): string {
  if (resourceType.startsWith('aws_')) return 'aws';
  if (resourceType.startsWith('google_')) return 'gcp';
  if (resourceType.startsWith('azurerm_')) return 'azure';
  return 'unknown';
}

/**
 * Extract region from config.
 */
function extractRegion(config: Record<string, unknown>): string | undefined {
  if (config.availability_zone) {
    // Remove the AZ letter suffix (us-east-1a -> us-east-1)
    return (config.availability_zone as string).slice(0, -1);
  }
  if (config.region) {
    return config.region as string;
  }
  return undefined;
}
