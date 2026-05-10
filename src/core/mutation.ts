export type MutationSource =
  | 'terraform'
  | 'kubernetes'
  | 'sql'
  | 'cloud-api'
  | 'mcp'
  | 'shell'
  | 'git'
  | 'saas'
  | 'internal-api';

export type ActorKind = 'human' | 'agent' | 'ci' | 'service' | 'unknown';

export type MutationAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'replace'
  | 'execute'
  | 'grant'
  | 'revoke'
  | 'no-op';

export interface MutationActor {
  id: string;
  kind: ActorKind;
  identityProvider?: string;
  displayName?: string;
}

export interface MutationTarget {
  provider?: string;
  service?: string;
  type: string;
  id: string;
  name?: string;
  environment?: string;
  owner?: string;
  region?: string;
  account?: string;
}

export interface MutationIntent {
  source: MutationSource;
  action: MutationAction;
  target: MutationTarget;
  actor?: MutationActor;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  raw?: unknown;
  metadata?: Record<string, unknown>;
}

export interface EvidenceItem {
  key: string;
  value?: unknown;
  present: boolean;
  description: string;
}

export interface MissingEvidence {
  key: string;
  description: string;
  effect: 'lowers-confidence' | 'requires-review' | 'blocks-safe-verdict';
}

export interface DependencyImpact {
  targetId: string;
  targetType?: string;
  reason: string;
  transitive: boolean;
}

// Verification Protocol v1

export type VerificationType =
  | 'aws_cli'
  | 'gcloud_cli'
  | 'az_cli'
  | 'kubectl'
  | 'terraform_state'
  | 'aws_api'
  | 'gcp_api'
  | 'azure_api';

export interface VerificationApiCall {
  service: string;
  operation: string;
  parameters: Record<string, unknown>;
}

export interface VerificationCommand {
  type: VerificationType;

  // For CLI-based verification
  argv?: string[];

  // For API-based verification
  api_call?: VerificationApiCall;

  // Execution hints
  timeout_seconds?: number;

  // Required permissions (IAM-style notation)
  // AWS: 'ec2:DescribeSnapshots'
  // GCP: 'compute.snapshots.list'
  // Azure: 'Microsoft.Compute/snapshots/read'
  requires_permissions?: string[];
}

export type VerificationUncertainty = 'high' | 'medium' | 'low';
export type VerificationPriority = 'critical' | 'recommended' | 'informational';

export interface VerificationVerdictImpact {
  current_tier: string;
  potential_tier: string;
  decision_change?: {
    from: string;
    to: string;
  };
}

/**
 * Structured pattern for matching verification output.
 * Enables automatic interpretation of verification results.
 */
export interface OutputPattern {
  /**
   * Pattern type determines how to evaluate the output.
   */
  type: 'json_array_not_empty' | 'json_field_equals' | 'json_field_exists' | 'regex' | 'exit_code';

  /**
   * For json_* types: JSON path to evaluate (dot notation).
   * Example: "DBSnapshots", "Status", "PointInTimeRecoveryDescription.PointInTimeRecoveryStatus"
   */
  path?: string;

  /**
   * For json_field_equals: expected value.
   */
  expected_value?: unknown;

  /**
   * For regex: pattern to match against raw output.
   */
  regex?: string;

  /**
   * For exit_code: expected exit code (default 0).
   */
  expected_exit_code?: number;
}

export interface VerificationSuggestion {
  evidence_key: string;
  description: string;
  uncertainty: VerificationUncertainty;
  verification: VerificationCommand;
  expected_signal: string;
  failure_signal: string;
  verdict_impact: VerificationVerdictImpact;
  // Derived from verdict_impact for agent convenience
  priority: VerificationPriority;

  /**
   * Structured pattern for automatic output interpretation.
   * If provided, agents can auto-match output without manual interpretation.
   */
  expected_pattern?: OutputPattern;

  /**
   * Structured pattern for failure detection.
   * If matched, indicates evidence does NOT confirm recovery.
   */
  failure_pattern?: OutputPattern;

  /**
   * Human-readable example of expected output.
   * Helps agents understand what they're looking for.
   */
  example_output?: string;
}

// Evidence submission from agent

export type AgentInterpretation =
  | 'matches_expected'
  | 'matches_failure'
  | 'ambiguous'
  | 'error';

export interface EvidenceSubmission {
  evidence_key: string;
  command_executed: VerificationCommand;
  exit_code?: number;
  raw_output?: string;
  parsed_evidence?: Record<string, unknown>;
  agent_interpretation: AgentInterpretation;
  agent_notes?: string;
}
