/**
 * Reasoning Trace Builder
 *
 * Captures the step-by-step evaluation process for inclusion in attestations.
 * This provides transparency into how RecourseOS reached its verdict.
 */

export interface TraceStep {
  step: number;
  action: string;
  target?: string;
  result: string;
  evidence_gathered?: EvidenceItem[];
  decision?: string;
  confidence?: number;
  duration_ms?: number;
}

export interface EvidenceItem {
  key: string;
  value?: unknown;
  present: boolean;
  description?: string;
}

export interface ReasoningTrace {
  steps: TraceStep[];
  duration_ms: number;
  handlers_invoked: string[];
  state_sources: string[];
}

export interface VerificationCommand {
  description: string;
  command: string;
  expected_pattern?: string;
  confirms?: string;
}

export interface ApiCheck {
  service: string;
  operation: string;
  parameters?: Record<string, unknown>;
  expected_result?: Record<string, unknown>;
}

export interface VerificationInstructions {
  commands?: VerificationCommand[];
  api_checks?: ApiCheck[];
  reproducibility: 'deterministic' | 'state-dependent' | 'time-sensitive';
  state_snapshot?: {
    captured_at: string;
    resources: Record<string, unknown>;
  };
}

/**
 * Trace Builder - captures evaluation steps as they occur
 */
export class TraceBuilder {
  private steps: TraceStep[] = [];
  private handlers: Set<string> = new Set();
  private sources: Set<string> = new Set();
  private startTime: number;
  private stepCount = 0;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Record a step in the evaluation process
   */
  step(action: string, result: string, options?: {
    target?: string;
    evidence?: EvidenceItem[];
    decision?: string;
    confidence?: number;
  }): void {
    this.stepCount++;
    this.steps.push({
      step: this.stepCount,
      action,
      result,
      target: options?.target,
      evidence_gathered: options?.evidence,
      decision: options?.decision,
      confidence: options?.confidence,
    });
  }

  /**
   * Record that a handler was invoked
   */
  handler(name: string): void {
    this.handlers.add(name);
  }

  /**
   * Record a state source that was used
   */
  source(name: string): void {
    this.sources.add(name);
  }

  /**
   * Build the final trace object
   */
  build(): ReasoningTrace {
    return {
      steps: this.steps,
      duration_ms: Math.round(performance.now() - this.startTime),
      handlers_invoked: Array.from(this.handlers),
      state_sources: Array.from(this.sources),
    };
  }
}

/**
 * Build verification instructions for a resource
 */
export function buildVerificationInstructions(
  resourceType: string,
  resourceId: string | undefined,
  recoverabilityTier: number,
  stateSnapshot?: Record<string, unknown>
): VerificationInstructions {
  const commands: VerificationCommand[] = [];
  const apiChecks: ApiCheck[] = [];

  // AWS-specific verification commands
  if (resourceType.startsWith('aws_')) {
    const service = resourceType.split('_')[1];

    switch (resourceType) {
      case 'aws_s3_bucket':
        if (resourceId) {
          commands.push({
            description: 'Check bucket exists and get object count',
            command: `aws s3api list-objects-v2 --bucket ${resourceId} --query 'length(Contents || \`[]\`)'`,
            expected_pattern: '\\d+',
            confirms: 'object_count',
          });
          commands.push({
            description: 'Check bucket versioning status',
            command: `aws s3api get-bucket-versioning --bucket ${resourceId}`,
            confirms: 'versioning_enabled',
          });
          apiChecks.push({
            service: 's3',
            operation: 'ListObjectsV2',
            parameters: { Bucket: resourceId },
          });
        }
        break;

      case 'aws_db_instance':
        if (resourceId) {
          commands.push({
            description: 'Check RDS instance backup configuration',
            command: `aws rds describe-db-instances --db-instance-identifier ${resourceId} --query 'DBInstances[0].{BackupRetention:BackupRetentionPeriod,DeletionProtection:DeletionProtection}'`,
            confirms: 'backup_configuration',
          });
          commands.push({
            description: 'Check for existing snapshots',
            command: `aws rds describe-db-snapshots --db-instance-identifier ${resourceId} --query 'length(DBSnapshots)'`,
            expected_pattern: '\\d+',
            confirms: 'snapshot_count',
          });
          apiChecks.push({
            service: 'rds',
            operation: 'DescribeDBInstances',
            parameters: { DBInstanceIdentifier: resourceId },
          });
        }
        break;

      case 'aws_dynamodb_table':
        if (resourceId) {
          commands.push({
            description: 'Check DynamoDB table backup status',
            command: `aws dynamodb describe-continuous-backups --table-name ${resourceId}`,
            confirms: 'pitr_enabled',
          });
          commands.push({
            description: 'Check deletion protection',
            command: `aws dynamodb describe-table --table-name ${resourceId} --query 'Table.DeletionProtectionEnabled'`,
            confirms: 'deletion_protection',
          });
        }
        break;

      case 'aws_ebs_volume':
        if (resourceId) {
          commands.push({
            description: 'Check for existing snapshots of this volume',
            command: `aws ec2 describe-snapshots --filters "Name=volume-id,Values=${resourceId}" --query 'length(Snapshots)'`,
            expected_pattern: '\\d+',
            confirms: 'snapshot_exists',
          });
        }
        break;

      case 'aws_kms_key':
        if (resourceId) {
          commands.push({
            description: 'Check KMS key deletion window',
            command: `aws kms describe-key --key-id ${resourceId} --query 'KeyMetadata.DeletionDate'`,
            confirms: 'deletion_window',
          });
        }
        break;

      default:
        // Generic AWS resource check
        if (resourceId && service) {
          commands.push({
            description: `Verify ${resourceType} state`,
            command: `aws ${service} describe-* (resource-specific command needed)`,
            confirms: 'resource_exists',
          });
        }
    }
  }

  // Determine reproducibility based on tier and resource type
  let reproducibility: 'deterministic' | 'state-dependent' | 'time-sensitive' = 'state-dependent';

  if (recoverabilityTier <= 2) {
    reproducibility = 'deterministic';
  } else if (resourceType.includes('snapshot') || resourceType.includes('backup')) {
    reproducibility = 'time-sensitive';
  }

  return {
    commands: commands.length > 0 ? commands : undefined,
    api_checks: apiChecks.length > 0 ? apiChecks : undefined,
    reproducibility,
    state_snapshot: stateSnapshot ? {
      captured_at: new Date().toISOString(),
      resources: stateSnapshot,
    } : undefined,
  };
}

/**
 * Create a trace for a simple pass-through evaluation
 */
export function createSimpleTrace(
  inputType: string,
  verdict: string,
  reason: string
): ReasoningTrace {
  const builder = new TraceBuilder();
  builder.step('parse_input', `Parsed ${inputType} input`);
  builder.step('evaluate', reason, { decision: verdict });
  return builder.build();
}
