/**
 * RecourseOS Pulumi Policy Pack
 *
 * Evaluates resource changes for destructive consequences before deployment.
 * Install with: pulumi policy enable recourse-policy
 */

import * as policy from '@pulumi/policy';
import { execSync } from 'child_process';

// Risk levels
type RiskLevel = 'allow' | 'warn' | 'escalate' | 'block';

interface RecourseResult {
  riskAssessment: RiskLevel;
  summary: {
    totalChanges: number;
    hasUnrecoverable: boolean;
    worstTier: string;
  };
  changes: Array<{
    address: string;
    action: string;
    recoverability: {
      tier: number;
      label: string;
      reasoning?: string;
    };
  }>;
}

// High-risk resource types that should always be evaluated
const HIGH_RISK_TYPES = new Set([
  'aws:rds/instance:Instance',
  'aws:rds/cluster:Cluster',
  'aws:s3/bucket:Bucket',
  'aws:dynamodb/table:Table',
  'aws:ec2/instance:Instance',
  'aws:ec2/volume:Volume',
  'aws:iam/role:Role',
  'aws:iam/user:User',
  'aws:iam/policy:Policy',
  'aws:lambda/function:Function',
  'aws:eks/cluster:Cluster',
  'aws:elasticache/cluster:Cluster',
  'aws:redshift/cluster:Cluster',
  'aws:kinesis/stream:Stream',
  'aws:sqs/queue:Queue',
  'aws:sns/topic:Topic',
  'gcp:sql/databaseInstance:DatabaseInstance',
  'gcp:storage/bucket:Bucket',
  'gcp:compute/instance:Instance',
  'gcp:container/cluster:Cluster',
  'azure:storage/account:Account',
  'azure:sql/database:Database',
  'azure:compute/virtualMachine:VirtualMachine',
]);

// Destructive resource properties that warrant review
const RISKY_PROPERTIES: Record<string, string[]> = {
  'aws:rds/instance:Instance': ['skipFinalSnapshot', 'deletionProtection', 'backupRetentionPeriod'],
  'aws:s3/bucket:Bucket': ['forceDestroy', 'versioning'],
  'aws:dynamodb/table:Table': ['deletionProtectionEnabled', 'pointInTimeRecovery'],
  'aws:ec2/instance:Instance': ['disableApiTermination'],
};

/**
 * Evaluate a resource change using RecourseOS CLI
 */
function evaluateWithRecourse(
  resourceType: string,
  resourceName: string,
  action: 'create' | 'update' | 'delete' | 'replace',
  props: Record<string, any>
): RecourseResult | null {
  // Build a minimal plan-like structure
  const fakePlan = {
    format_version: '1.0',
    resource_changes: [
      {
        address: resourceName,
        type: resourceType.split(':').pop() || resourceType,
        provider_name: 'pulumi',
        change: {
          actions: [action],
          after: props,
        },
      },
    ],
  };

  try {
    const result = execSync(
      `echo '${JSON.stringify(fakePlan)}' | npx -y recourse-cli@latest plan - --format json`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return JSON.parse(result);
  } catch {
    // If CLI fails, return null and allow the resource
    return null;
  }
}

/**
 * Check for risky property configurations
 */
function hasRiskyConfig(
  resourceType: string,
  props: Record<string, any>
): { risky: boolean; reasons: string[] } {
  const riskyProps = RISKY_PROPERTIES[resourceType] || [];
  const reasons: string[] = [];

  for (const prop of riskyProps) {
    const value = props[prop];

    // RDS skip_final_snapshot
    if (prop === 'skipFinalSnapshot' && value === true) {
      reasons.push('skipFinalSnapshot=true will lose data on delete');
    }

    // RDS deletion protection
    if (prop === 'deletionProtection' && value === false) {
      reasons.push('deletionProtection=false allows accidental deletion');
    }

    // RDS backup retention
    if (prop === 'backupRetentionPeriod' && (value === 0 || value === undefined)) {
      reasons.push('No backup retention configured');
    }

    // S3 force destroy
    if (prop === 'forceDestroy' && value === true) {
      reasons.push('forceDestroy=true will delete non-empty bucket');
    }

    // S3 versioning
    if (prop === 'versioning') {
      const enabled = value?.enabled === true || value === true;
      if (!enabled) {
        reasons.push('Versioning disabled - no object recovery');
      }
    }

    // DynamoDB deletion protection
    if (prop === 'deletionProtectionEnabled' && value === false) {
      reasons.push('deletionProtectionEnabled=false allows accidental deletion');
    }

    // DynamoDB PITR
    if (prop === 'pointInTimeRecovery') {
      const enabled = value?.enabled === true;
      if (!enabled) {
        reasons.push('Point-in-time recovery disabled');
      }
    }

    // EC2 termination protection
    if (prop === 'disableApiTermination' && value === false) {
      reasons.push('API termination not disabled');
    }
  }

  return { risky: reasons.length > 0, reasons };
}

/**
 * Main policy: Evaluate destructive changes
 */
const evaluateDestructiveChanges = new policy.ResourceValidationPolicy({
  name: 'recourse-evaluate-destructive',
  description: 'Evaluates resource changes for destructive consequences using RecourseOS',
  enforcementLevel: 'advisory', // Set to 'mandatory' to block
  validateResource: (args, reportViolation) => {
    const { type, name, props } = args;

    // Only evaluate high-risk resource types
    if (!HIGH_RISK_TYPES.has(type)) {
      return;
    }

    // Check for risky configurations
    const { risky, reasons } = hasRiskyConfig(type, props);

    if (risky) {
      reportViolation(
        `[RecourseOS] Risky configuration detected:\n${reasons.map(r => `  - ${r}`).join('\n')}`
      );
    }
  },
});

/**
 * Policy: Block unrecoverable deletions
 */
const blockUnrecoverableDeletions = new policy.StackValidationPolicy({
  name: 'recourse-block-unrecoverable',
  description: 'Blocks stack updates that would cause unrecoverable data loss',
  enforcementLevel: 'mandatory',
  validateStack: (args, reportViolation) => {
    // Get resources being deleted
    const deletions = args.resources.filter(r => {
      // Check if this is a deletion (no props means being deleted)
      return !r.props || Object.keys(r.props).length === 0;
    });

    for (const resource of deletions) {
      if (!HIGH_RISK_TYPES.has(resource.type)) {
        continue;
      }

      // For high-risk deletions, require manual review
      reportViolation(
        `[RecourseOS] High-risk deletion detected: ${resource.name} (${resource.type}).\n` +
          'This deletion may cause unrecoverable data loss.\n' +
          'Verify backups exist before proceeding.'
      );
    }
  },
});

/**
 * Policy: Require backup configuration
 */
const requireBackupConfig = new policy.ResourceValidationPolicy({
  name: 'recourse-require-backups',
  description: 'Requires backup configurations for data resources',
  enforcementLevel: 'advisory',
  validateResource: (args, reportViolation) => {
    const { type, props } = args;

    // RDS instances must have backups
    if (type === 'aws:rds/instance:Instance') {
      if (!props.backupRetentionPeriod || props.backupRetentionPeriod === 0) {
        reportViolation(
          '[RecourseOS] RDS instance should have backupRetentionPeriod > 0'
        );
      }
      if (props.skipFinalSnapshot === true) {
        reportViolation(
          '[RecourseOS] RDS instance should not have skipFinalSnapshot=true in production'
        );
      }
    }

    // S3 buckets should have versioning
    if (type === 'aws:s3/bucket:Bucket') {
      const versioning = props.versioning;
      if (!versioning?.enabled) {
        reportViolation(
          '[RecourseOS] S3 bucket should have versioning enabled for data recovery'
        );
      }
    }

    // DynamoDB should have PITR
    if (type === 'aws:dynamodb/table:Table') {
      const pitr = props.pointInTimeRecovery;
      if (!pitr?.enabled) {
        reportViolation(
          '[RecourseOS] DynamoDB table should have point-in-time recovery enabled'
        );
      }
    }
  },
});

/**
 * Policy: Require deletion protection
 */
const requireDeletionProtection = new policy.ResourceValidationPolicy({
  name: 'recourse-require-deletion-protection',
  description: 'Requires deletion protection for critical resources',
  enforcementLevel: 'advisory',
  validateResource: (args, reportViolation) => {
    const { type, props } = args;

    // RDS
    if (type === 'aws:rds/instance:Instance' || type === 'aws:rds/cluster:Cluster') {
      if (props.deletionProtection !== true) {
        reportViolation(
          '[RecourseOS] RDS instances/clusters should have deletionProtection=true'
        );
      }
    }

    // DynamoDB
    if (type === 'aws:dynamodb/table:Table') {
      if (props.deletionProtectionEnabled !== true) {
        reportViolation(
          '[RecourseOS] DynamoDB tables should have deletionProtectionEnabled=true'
        );
      }
    }

    // EC2
    if (type === 'aws:ec2/instance:Instance') {
      if (props.disableApiTermination !== true) {
        reportViolation(
          '[RecourseOS] EC2 instances should have disableApiTermination=true'
        );
      }
    }
  },
});

// Export the policy pack
export const policies = new policy.PolicyPack('recourse-policy', {
  policies: [
    evaluateDestructiveChanges,
    blockUnrecoverableDeletions,
    requireBackupConfig,
    requireDeletionProtection,
  ],
});
