/**
 * Runtime Router <-> RecourseOS Integration Types
 *
 * These types define the contract between a runtime router and RecourseOS
 * as the consequence-verification layer for agent mutations.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Intent — what the router detects before execution
// ─────────────────────────────────────────────────────────────────────────────

export type MutationSource =
  | 'terraform'
  | 'shell'
  | 'mcp'
  | 'kubernetes'
  | 'docker'
  | 'cloud-api';

export interface TerraformIntent {
  source: 'terraform';
  planJson: string;
  stateJson?: string;
}

export interface ShellIntent {
  source: 'shell';
  command: string;
  cwd?: string;
}

export interface McpIntent {
  source: 'mcp';
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface KubernetesIntent {
  source: 'kubernetes';
  operation: 'apply' | 'delete' | 'patch' | 'replace';
  resource: {
    apiVersion: string;
    kind: string;
    metadata: {
      name: string;
      namespace?: string;
    };
  };
  manifest?: string;
}

export interface DockerIntent {
  source: 'docker';
  operation: 'rm' | 'rmi' | 'volume-rm' | 'network-rm' | 'system-prune';
  target: string;
  force?: boolean;
}

export interface CloudApiIntent {
  source: 'cloud-api';
  provider: 'aws' | 'gcp' | 'azure';
  service: string;
  operation: string;
  parameters: Record<string, unknown>;
}

export type MutationIntent =
  | TerraformIntent
  | ShellIntent
  | McpIntent
  | KubernetesIntent
  | DockerIntent
  | CloudApiIntent;

// ─────────────────────────────────────────────────────────────────────────────
// Gate Configuration
// ─────────────────────────────────────────────────────────────────────────────

export type GateMode =
  | 'gateway'    // Hard enforcement - block execution on escalate/block
  | 'advisory'   // Soft enforcement - warn but allow (dev/local)
  | 'ci';        // CI mode - generate reports, fail pipeline on block

export type RiskDecision = 'allow' | 'warn' | 'escalate' | 'block';

export interface GateConfig {
  /** Operating mode */
  mode: GateMode;

  /** RecourseOS API URL (for remote evaluation) */
  apiUrl?: string;

  /** License key for billing/usage tracking */
  licenseKey?: string;

  /** Actor identity for audit trail */
  actorId?: string;

  /** Environment name (dev, staging, prod) */
  environment?: string;

  /** Organization/team owner */
  owner?: string;

  /** Decisions that require human approval (default: ['escalate']) */
  escalateOn?: RiskDecision[];

  /** Decisions that hard-block execution (default: ['block']) */
  blockOn?: RiskDecision[];

  /** Timeout for evaluation in ms (default: 30000) */
  timeoutMs?: number;

  /** Whether to require signed attestations (default: true in gateway mode) */
  requireAttestation?: boolean;

  /** Callback when approval is needed */
  onEscalate?: (report: GateResult) => Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate Result — what the router receives back
// ─────────────────────────────────────────────────────────────────────────────

export interface RecoverabilityInfo {
  tier: number;
  label: string;
  reasoning?: string;
}

export interface MutationAnalysis {
  target: {
    service?: string;
    type: string;
    id?: string;
  };
  action: string;
  recoverability: RecoverabilityInfo;
}

export interface ConsequenceSummary {
  totalMutations: number;
  worstRecoverability: RecoverabilityInfo;
  needsReview: boolean;
  hasUnrecoverable: boolean;
}

export interface Attestation {
  id: string;
  signature: string;
  keyId: string;
  timestamp: string;
  attestationUri: string;
}

export interface GateResult {
  /** The decision: allow, warn, escalate, or block */
  decision: RiskDecision;

  /** Human-readable reason for the decision */
  reason: string;

  /** Whether execution should proceed */
  permitted: boolean;

  /** Whether human approval was requested */
  approvalRequested: boolean;

  /** Whether human approved (if approval was requested) */
  approved?: boolean;

  /** Summary of consequences */
  summary: ConsequenceSummary;

  /** Individual mutation analyses */
  mutations: MutationAnalysis[];

  /** Signed attestation (if enabled) */
  attestation?: Attestation;

  /** Cost estimate for the mutation */
  costEstimate?: {
    monthlyCost: number;
    currency: string;
  };

  /** Evaluation timing */
  timing?: {
    totalMs: number;
    evaluationMs: number;
  };

  /** Raw consequence report (for debugging/logging) */
  raw?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Integration Events
// ─────────────────────────────────────────────────────────────────────────────

export type GateEventType =
  | 'mutation_detected'
  | 'evaluation_started'
  | 'evaluation_completed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'execution_allowed'
  | 'execution_blocked';

export interface GateEvent {
  type: GateEventType;
  timestamp: string;
  runId?: string;
  nodeId?: string;
  intent: MutationIntent;
  result?: GateResult;
  error?: string;
}

export type GateEventHandler = (event: GateEvent) => void;
