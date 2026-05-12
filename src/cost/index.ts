/**
 * Cost tracking module for RecourseOS.
 *
 * Provides cloud resource cost estimation and usage metering.
 */

export {
  getHourlyPrice,
  getMonthlyPrice,
  HOURS_PER_MONTH,
  AWS_EC2_PRICING,
  AWS_RDS_PRICING,
  AWS_STORAGE_PRICING,
  GCP_COMPUTE_PRICING,
  GCP_CLOUDSQL_PRICING,
  AZURE_VM_PRICING,
} from './pricing.js';

export type {
  ResourcePrice,
  RegionalPricing,
  ResourcePricing,
} from './pricing.js';

export {
  estimateTerraformCost,
  estimateMutationCost,
} from './estimator.js';

export type {
  CostEstimate,
  CostBreakdown,
} from './estimator.js';

export {
  createBillingClient,
  getBillingClient,
} from './billing-client.js';

export type {
  LicenseInfo,
  ManagedResource,
  BudgetInfo,
  BillingClientConfig,
} from './billing-client.js';
