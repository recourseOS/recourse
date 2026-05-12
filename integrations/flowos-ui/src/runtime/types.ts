/**
 * FlowOS + RecourseOS Runtime Types
 *
 * The event contract between RecourseOS (reactive interception)
 * and FlowOS (DAG orchestration).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Verdicts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The outcome of RecourseOS evaluation.
 * - approved: Safe to proceed, no human needed
 * - blocked: Too dangerous, execution stopped
 * - escalated: Needs human decision before continuing
 */
export type Verdict = 'approved' | 'blocked' | 'escalated';

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Intent (what RecourseOS intercepts)
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationIntent {
  source: 'shell' | 'mcp' | 'terraform' | 'kubernetes' | 'docker' | 'cloud-api';
  command?: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// RecourseOS Events (emitted into FlowOS event log)
// ─────────────────────────────────────────────────────────────────────────────

export type RecourseEvent =
  | ActionInterceptedEvent
  | ActionApprovedEvent
  | ActionBlockedEvent;

export interface ActionInterceptedEvent {
  type: 'action_intercepted';
  mutationId: string;
  mutation: MutationIntent;
  verdict: Verdict;
  /** The full consequence report from RecourseOS */
  report: ConsequenceReportSummary;
  timestamp: string;
}

export interface ActionApprovedEvent {
  type: 'action_approved';
  mutationId: string;
  approver: string;
  timestamp: string;
}

export interface ActionBlockedEvent {
  type: 'action_blocked';
  mutationId: string;
  reason: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consequence Report Summary (subset for event payload)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsequenceReportSummary {
  totalMutations: number;
  worstRecoverability: {
    tier: number;
    label: string;
  };
  needsReview: boolean;
  hasUnrecoverable: boolean;
  reason: string;
  mutations: MutationSummary[];
}

export interface MutationSummary {
  target: {
    service?: string;
    type: string;
    id?: string;
  };
  action: string;
  recoverability: {
    tier: number;
    label: string;
    reasoning?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Decision (returned from human via FlowOS UI)
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalDecision =
  | { approved: true; approver: string }
  | { approved: false; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Event Sink Interface (the seam)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The interface RecourseOS uses to emit events and await human decisions.
 * FlowOS provides the implementation that routes to its event log.
 */
export interface EventSink {
  /**
   * Emit an event into the FlowOS event log.
   * Called by RecourseOS when an action is intercepted.
   */
  emit(event: RecourseEvent): Promise<void>;

  /**
   * Suspend execution and wait for human approval.
   * Called by RecourseOS when verdict is 'escalated'.
   * Returns when user clicks Approve/Reject in FlowOS UI.
   */
  waitForApproval(mutationId: string): Promise<ApprovalDecision>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Execution Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeExecutionContext {
  runId: string;
  nodeId: string;
  nodeConfig: RecourseNodeConfig;
  db: EventDatabase;
  sse: SSEBroadcaster;
}

export interface RecourseNodeConfig {
  /** The agent command to execute under interception */
  agentCommand: AgentCommand;
  /** Policy overrides for this node */
  policy?: PolicyConfig;
}

export type AgentCommand =
  | { type: 'shell'; command: string }
  | { type: 'claude-code'; task: string }
  | { type: 'mcp'; server: string; tool: string; arguments: Record<string, unknown> };

export interface PolicyConfig {
  /** Auto-approve mutations at or below this tier */
  autoApproveTier?: number;
  /** Block mutations at or above this tier without escalation */
  autoBlockTier?: number;
  /** Resource types to always escalate */
  alwaysEscalate?: string[];
}

export interface NodeResult {
  status: 'completed' | 'failed' | 'waiting_for_approval';
  artifacts?: Record<string, unknown>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Interface (FlowOS provides)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventDatabase {
  insertEvent(event: {
    runId: string;
    nodeId: string;
    type: string;
    payload: RecourseEvent;
    createdAt: Date;
  }): Promise<void>;

  updateNodeStatus(nodeId: string, status: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE Broadcaster Interface (FlowOS provides)
// ─────────────────────────────────────────────────────────────────────────────

export interface SSEBroadcaster {
  broadcast(runId: string, event: RecourseEvent): void;
}
