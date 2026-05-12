/**
 * FlowOS Event Sink
 *
 * The FlowOS-side implementation of EventSink that:
 * 1. Writes RecourseOS events to the FlowOS event log
 * 2. Broadcasts to connected SSE clients
 * 3. Handles approval resolution from the UI
 *
 * LIFECYCLE NOTE (V1):
 * The pendingApprovals map is held in memory. If the process restarts,
 * pending approvals are lost. For V1.1, this should be backed by the
 * event log with RecourseOS subscribing to approval_granted/rejected events.
 */

import type {
  EventSink,
  RecourseEvent,
  ApprovalDecision,
  EventDatabase,
  SSEBroadcaster,
} from './types.js';

export class FlowOSEventSink implements EventSink {
  /**
   * In-memory map of pending approvals.
   * Key: mutationId
   * Value: Promise resolver for that approval
   *
   * WARNING: Does not survive process restart. See lifecycle note above.
   */
  private pendingApprovals = new Map<
    string,
    { resolve: (decision: ApprovalDecision) => void }
  >();

  constructor(
    private runId: string,
    private nodeId: string,
    private db: EventDatabase,
    private sse: SSEBroadcaster
  ) {}

  /**
   * Emit a RecourseOS event into the FlowOS event log.
   *
   * Flow:
   * 1. Write to persistent event log (database)
   * 2. Broadcast to connected SSE clients (real-time UI)
   * 3. If escalated, transition node to waiting_for_approval state
   */
  async emit(event: RecourseEvent): Promise<void> {
    // 1. Write to event log
    await this.db.insertEvent({
      runId: this.runId,
      nodeId: this.nodeId,
      type: event.type,
      payload: event,
      createdAt: new Date(),
    });

    // 2. Broadcast to connected clients
    this.sse.broadcast(this.runId, event);

    // 3. If escalated, transition node to waiting_for_approval
    if (event.type === 'action_intercepted' && event.verdict === 'escalated') {
      await this.db.updateNodeStatus(this.nodeId, 'waiting_for_approval');
    }
  }

  /**
   * Suspend execution and wait for human approval.
   *
   * Called by RecourseOS when verdict is 'escalated'.
   * The promise resolves when resolveApproval() is called
   * (triggered by user clicking Approve/Reject in the UI).
   */
  async waitForApproval(mutationId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(mutationId, { resolve });
    });
  }

  /**
   * Resolve a pending approval.
   *
   * Called by the FlowOS API when user clicks Approve/Reject.
   * This unblocks the RecourseOS execution that's awaiting the decision.
   */
  resolveApproval(mutationId: string, decision: ApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(mutationId);
    if (!pending) {
      return false; // No pending approval with this ID
    }

    pending.resolve(decision);
    this.pendingApprovals.delete(mutationId);
    return true;
  }

  /**
   * Check if there's a pending approval for a mutation.
   */
  hasPendingApproval(mutationId: string): boolean {
    return this.pendingApprovals.has(mutationId);
  }

  /**
   * Get all pending mutation IDs for this sink.
   */
  getPendingMutationIds(): string[] {
    return Array.from(this.pendingApprovals.keys());
  }

  /**
   * Cancel all pending approvals (e.g., on timeout or run cancellation).
   */
  cancelAll(reason: string): void {
    for (const [mutationId, { resolve }] of this.pendingApprovals) {
      resolve({ approved: false, reason });
    }
    this.pendingApprovals.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sink Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global registry of active event sinks by nodeId.
 *
 * This allows the FlowOS API to route approval decisions to the correct sink.
 * The API receives a nodeId + mutationId, looks up the sink, and calls resolveApproval.
 *
 * WARNING: This is process-local. In a multi-process deployment,
 * you'd need a shared registry (Redis, etc.) or route approvals
 * to the correct process.
 */
class SinkRegistry {
  private sinks = new Map<string, FlowOSEventSink>();

  register(nodeId: string, sink: FlowOSEventSink): void {
    this.sinks.set(nodeId, sink);
  }

  unregister(nodeId: string): void {
    this.sinks.delete(nodeId);
  }

  get(nodeId: string): FlowOSEventSink | undefined {
    return this.sinks.get(nodeId);
  }

  resolveApproval(
    nodeId: string,
    mutationId: string,
    decision: ApprovalDecision
  ): boolean {
    const sink = this.sinks.get(nodeId);
    if (!sink) {
      return false;
    }
    return sink.resolveApproval(mutationId, decision);
  }
}

export const sinkRegistry = new SinkRegistry();
