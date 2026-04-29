// Recoverability tiers - lower number = easier to recover
export enum RecoverabilityTier {
  REVERSIBLE = 1,           // Can be undone with another API call
  RECOVERABLE_WITH_EFFORT = 2,  // Can be recreated but requires work
  RECOVERABLE_FROM_BACKUP = 3,  // Requires backup/snapshot to restore
  UNRECOVERABLE = 4,        // Data is gone forever
  NEEDS_REVIEW = 5,         // Evidence is insufficient or ambiguous
}

export const RecoverabilityLabels: Record<RecoverabilityTier, string> = {
  [RecoverabilityTier.REVERSIBLE]: 'reversible',
  [RecoverabilityTier.RECOVERABLE_WITH_EFFORT]: 'recoverable-with-effort',
  [RecoverabilityTier.RECOVERABLE_FROM_BACKUP]: 'recoverable-from-backup',
  [RecoverabilityTier.UNRECOVERABLE]: 'unrecoverable',
  [RecoverabilityTier.NEEDS_REVIEW]: 'needs-review',
};

// Verdict source - where the classification came from
export type VerdictSource = 'rules' | 'classifier' | 'default';

export interface RecoverabilityResult {
  tier: RecoverabilityTier;
  label: string;
  reasoning: string;
  // New fields for dual-verdict architecture
  source?: VerdictSource;       // 'rules' = hardcoded handler, 'classifier' = ML model
  confidence?: number;          // 0-1, always 1.0 for rules
  classifierAgreement?: boolean; // If rules fired, did classifier agree?
}

// Terraform plan action types
export type TerraformAction = 'create' | 'read' | 'update' | 'delete' | 'no-op';

export interface ResourceChange {
  address: string;           // e.g., "aws_s3_bucket.main"
  type: string;              // e.g., "aws_s3_bucket"
  name: string;              // e.g., "main"
  providerName: string;      // e.g., "registry.terraform.io/hashicorp/aws"
  actions: TerraformAction[];
  before: Record<string, unknown> | null;  // State before change
  after: Record<string, unknown> | null;   // State after change
  afterUnknown: Record<string, unknown>;   // Values computed at apply time
}

export interface StateResource {
  address: string;
  type: string;
  name: string;
  providerName: string;
  values: Record<string, unknown>;
  dependsOn: string[];
}

export interface TerraformPlan {
  formatVersion: string;
  terraformVersion: string;
  resourceChanges: ResourceChange[];
  priorState?: TerraformState;
}

export interface TerraformState {
  formatVersion: string;
  terraformVersion: string;
  resources: StateResource[];
}

// Dependency tracking
export interface ResourceDependency {
  address: string;
  dependencyType: 'explicit' | 'implicit';  // depends_on vs reference
  referenceAttribute?: string;  // Which attribute contains the reference
}

// Analysis results
export interface BlastRadiusChange {
  resource: ResourceChange;
  recoverability: RecoverabilityResult;
  cascadeImpact: CascadeImpact[];
}

export interface CascadeImpact {
  affectedResource: string;
  reason: string;
}

export interface BlastRadiusReport {
  changes: BlastRadiusChange[];
  summary: BlastRadiusSummary;
}

export interface BlastRadiusSummary {
  totalChanges: number;
  byTier: Record<RecoverabilityTier, number>;
  cascadeImpactCount: number;
  hasUnrecoverable: boolean;
}

// Import trace types
import type { ClassificationContext, ClassificationTrace } from '../analyzer/trace.js';

// Resource handler interface - each resource type implements this
export interface ResourceHandler {
  resourceTypes: string[];  // e.g., ["aws_s3_bucket"]

  getRecoverability(
    change: ResourceChange,
    state: TerraformState | null
  ): RecoverabilityResult;

  // Optional: traced version that returns full classification trace
  getRecoverabilityTraced?(
    change: ResourceChange,
    state: TerraformState | null,
    ctx: ClassificationContext
  ): ClassificationTrace;

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[];
}

export type { ClassificationContext, ClassificationTrace };
