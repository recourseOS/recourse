/**
 * Cloud resource pricing data.
 *
 * Prices are hourly rates in USD. Multiply by 730 for monthly estimates.
 * Data sourced from public cloud pricing pages.
 *
 * This is a subset of common resources. In production, this would be
 * fetched from cloud pricing APIs and cached.
 */

export interface ResourcePrice {
  hourly: number;
  monthly?: number;
  unit?: string;
}

export interface RegionalPricing {
  [region: string]: ResourcePrice;
}

export interface ResourcePricing {
  [instanceType: string]: RegionalPricing | ResourcePrice;
}

// Hours per month (average)
export const HOURS_PER_MONTH = 730;

/**
 * AWS EC2 instance pricing (on-demand, Linux)
 */
export const AWS_EC2_PRICING: ResourcePricing = {
  // General purpose
  't3.micro': { hourly: 0.0104 },
  't3.small': { hourly: 0.0208 },
  't3.medium': { hourly: 0.0416 },
  't3.large': { hourly: 0.0832 },
  't3.xlarge': { hourly: 0.1664 },
  't3.2xlarge': { hourly: 0.3328 },
  'm5.large': { hourly: 0.096 },
  'm5.xlarge': { hourly: 0.192 },
  'm5.2xlarge': { hourly: 0.384 },
  'm5.4xlarge': { hourly: 0.768 },
  'm6i.large': { hourly: 0.096 },
  'm6i.xlarge': { hourly: 0.192 },
  'm6i.2xlarge': { hourly: 0.384 },
  // Compute optimized
  'c5.large': { hourly: 0.085 },
  'c5.xlarge': { hourly: 0.17 },
  'c5.2xlarge': { hourly: 0.34 },
  'c5.4xlarge': { hourly: 0.68 },
  'c6i.large': { hourly: 0.085 },
  'c6i.xlarge': { hourly: 0.17 },
  // Memory optimized
  'r5.large': { hourly: 0.126 },
  'r5.xlarge': { hourly: 0.252 },
  'r5.2xlarge': { hourly: 0.504 },
  'r5.4xlarge': { hourly: 1.008 },
  'r6i.large': { hourly: 0.126 },
  'r6i.xlarge': { hourly: 0.252 },
  // GPU instances
  'p3.2xlarge': { hourly: 3.06 },
  'p3.8xlarge': { hourly: 12.24 },
  'p4d.24xlarge': { hourly: 32.77 },
  'g4dn.xlarge': { hourly: 0.526 },
  'g4dn.2xlarge': { hourly: 0.752 },
};

/**
 * AWS RDS instance pricing (on-demand, MySQL/PostgreSQL)
 */
export const AWS_RDS_PRICING: ResourcePricing = {
  'db.t3.micro': { hourly: 0.017 },
  'db.t3.small': { hourly: 0.034 },
  'db.t3.medium': { hourly: 0.068 },
  'db.t3.large': { hourly: 0.136 },
  'db.m5.large': { hourly: 0.171 },
  'db.m5.xlarge': { hourly: 0.342 },
  'db.m5.2xlarge': { hourly: 0.684 },
  'db.m5.4xlarge': { hourly: 1.368 },
  'db.r5.large': { hourly: 0.24 },
  'db.r5.xlarge': { hourly: 0.48 },
  'db.r5.2xlarge': { hourly: 0.96 },
  'db.r5.4xlarge': { hourly: 1.92 },
};

/**
 * AWS storage pricing (per GB per month)
 */
export const AWS_STORAGE_PRICING = {
  's3_standard': { monthly: 0.023, unit: 'GB' },
  's3_ia': { monthly: 0.0125, unit: 'GB' },
  's3_glacier': { monthly: 0.004, unit: 'GB' },
  'ebs_gp2': { monthly: 0.10, unit: 'GB' },
  'ebs_gp3': { monthly: 0.08, unit: 'GB' },
  'ebs_io1': { monthly: 0.125, unit: 'GB' },
  'ebs_st1': { monthly: 0.045, unit: 'GB' },
};

/**
 * AWS Lambda pricing
 */
export const AWS_LAMBDA_PRICING = {
  requests: 0.0000002, // per request (after free tier)
  duration: 0.0000166667, // per GB-second
};

/**
 * GCP Compute Engine pricing (on-demand)
 */
export const GCP_COMPUTE_PRICING: ResourcePricing = {
  'e2-micro': { hourly: 0.0084 },
  'e2-small': { hourly: 0.0168 },
  'e2-medium': { hourly: 0.0336 },
  'e2-standard-2': { hourly: 0.0672 },
  'e2-standard-4': { hourly: 0.1344 },
  'e2-standard-8': { hourly: 0.2688 },
  'n2-standard-2': { hourly: 0.0971 },
  'n2-standard-4': { hourly: 0.1942 },
  'n2-standard-8': { hourly: 0.3884 },
  'c2-standard-4': { hourly: 0.2088 },
  'c2-standard-8': { hourly: 0.4176 },
};

/**
 * GCP Cloud SQL pricing
 */
export const GCP_CLOUDSQL_PRICING: ResourcePricing = {
  'db-f1-micro': { hourly: 0.0105 },
  'db-g1-small': { hourly: 0.025 },
  'db-n1-standard-1': { hourly: 0.0965 },
  'db-n1-standard-2': { hourly: 0.193 },
  'db-n1-standard-4': { hourly: 0.386 },
  'db-n1-highmem-2': { hourly: 0.207 },
  'db-n1-highmem-4': { hourly: 0.414 },
};

/**
 * Azure VM pricing (on-demand, Linux)
 */
export const AZURE_VM_PRICING: ResourcePricing = {
  'Standard_B1s': { hourly: 0.0104 },
  'Standard_B1ms': { hourly: 0.0207 },
  'Standard_B2s': { hourly: 0.0416 },
  'Standard_B2ms': { hourly: 0.0832 },
  'Standard_D2s_v3': { hourly: 0.096 },
  'Standard_D4s_v3': { hourly: 0.192 },
  'Standard_D8s_v3': { hourly: 0.384 },
  'Standard_E2s_v3': { hourly: 0.126 },
  'Standard_E4s_v3': { hourly: 0.252 },
  'Standard_F2s_v2': { hourly: 0.085 },
  'Standard_F4s_v2': { hourly: 0.169 },
};

/**
 * Get hourly price for a resource.
 */
export function getHourlyPrice(
  provider: 'aws' | 'gcp' | 'azure',
  resourceType: string,
  instanceType: string,
  region?: string
): number | null {
  let pricing: ResourcePricing;

  switch (provider) {
    case 'aws':
      if (resourceType === 'aws_instance' || resourceType === 'ec2') {
        pricing = AWS_EC2_PRICING;
      } else if (resourceType === 'aws_db_instance' || resourceType === 'rds') {
        pricing = AWS_RDS_PRICING;
      } else {
        return null;
      }
      break;
    case 'gcp':
      if (resourceType === 'google_compute_instance' || resourceType === 'compute') {
        pricing = GCP_COMPUTE_PRICING;
      } else if (resourceType === 'google_sql_database_instance' || resourceType === 'cloudsql') {
        pricing = GCP_CLOUDSQL_PRICING;
      } else {
        return null;
      }
      break;
    case 'azure':
      if (resourceType === 'azurerm_virtual_machine' || resourceType === 'vm') {
        pricing = AZURE_VM_PRICING;
      } else {
        return null;
      }
      break;
    default:
      return null;
  }

  const price = pricing[instanceType];
  if (!price) {
    return null;
  }

  // Check if this is a ResourcePrice (has hourly directly)
  if ('hourly' in price && typeof (price as ResourcePrice).hourly === 'number') {
    return (price as ResourcePrice).hourly;
  }

  // Regional pricing
  const regionalPrice = price as RegionalPricing;
  if (region && region in regionalPrice) {
    return regionalPrice[region].hourly;
  }

  // Default region
  const regions = Object.keys(regionalPrice);
  if (regions.length > 0) {
    return regionalPrice[regions[0]].hourly;
  }

  return null;
}

/**
 * Get monthly price for a resource.
 */
export function getMonthlyPrice(
  provider: 'aws' | 'gcp' | 'azure',
  resourceType: string,
  instanceType: string,
  region?: string
): number | null {
  const hourly = getHourlyPrice(provider, resourceType, instanceType, region);
  if (hourly === null) {
    return null;
  }
  return Math.round(hourly * HOURS_PER_MONTH * 100) / 100;
}
