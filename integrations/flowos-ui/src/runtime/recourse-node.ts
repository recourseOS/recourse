/**
 * RecourseNode Executor
 *
 * A FlowOS node type that wraps agent execution with RecourseOS interception.
 *
 * When an agent (Claude Code, shell command, MCP tool) attempts a mutation,
 * RecourseOS intercepts it, evaluates consequences, and either:
 * - Approves: Execution continues
 * - Blocks: Execution stops, node fails
 * - Escalates: Execution suspends, waits for human approval via FlowOS UI
 *
 * This is the synthesis: proactive DAG structure + reactive runtime safety.
 */

import {
  evaluateShellCommandConsequences,
  evaluateMcpToolCallConsequences,
} from '../../../../src/evaluator/index.js';
import type { ConsequenceReport, AnalyzedMutation } from '../../../../src/core/index.js';
import { FlowOSEventSink, sinkRegistry } from './event-sink.js';
import type {
  NodeExecutionContext,
  NodeResult,
  AgentCommand,
  PolicyConfig,
  EventSink,
  Verdict,
  MutationIntent,
  ConsequenceReportSummary,
  RecourseEvent,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// RecourseOS Wrapper
// ─────────────────────────────────────────────────────────────────────────────

interface RecourseExecutionOptions {
  eventSink: EventSink;
  policy?: PolicyConfig;
}

interface RecourseExecutionResult {
  blocked: boolean;
  artifacts: Record<string, unknown>;
  interceptedActions: number;
  approvedActions: number;
  blockedActions: number;
}

/**
 * Execute a command under RecourseOS interception.
 *
 * This is the core integration point. For each mutation the agent attempts:
 * 1. Intercept and evaluate via RecourseOS
 * 2. Emit action_intercepted event to FlowOS
 * 3. Based on verdict:
 *    - approved: continue execution
 *    - blocked: stop execution
 *    - escalated: await human decision via eventSink.waitForApproval()
 */
async function executeWithInterception(
  command: AgentCommand,
  options: RecourseExecutionOptions
): Promise<RecourseExecutionResult> {
  const { eventSink, policy } = options;
  const result: RecourseExecutionResult = {
    blocked: false,
    artifacts: {},
    interceptedActions: 0,
    approvedActions: 0,
    blockedActions: 0,
  };

  // Convert command to mutation intent
  const mutation = commandToMutationIntent(command);

  // Evaluate via RecourseOS
  const report = evaluateMutation(mutation);
  const mutationId = generateMutationId();

  // Determine verdict based on report and policy
  const verdict = determineVerdict(report, policy);

  // Emit interception event
  const interceptEvent: RecourseEvent = {
    type: 'action_intercepted',
    mutationId,
    mutation,
    verdict,
    report: reportToSummary(report),
    timestamp: new Date().toISOString(),
  };
  await eventSink.emit(interceptEvent);
  result.interceptedActions++;

  // Handle verdict
  switch (verdict) {
    case 'approved':
      result.approvedActions++;
      result.artifacts = { output: 'Execution approved by RecourseOS' };
      break;

    case 'blocked':
      result.blockedActions++;
      result.blocked = true;
      await eventSink.emit({
        type: 'action_blocked',
        mutationId,
        reason: report.assessmentReason,
        timestamp: new Date().toISOString(),
      });
      break;

    case 'escalated':
      // Suspend and wait for human decision
      const decision = await eventSink.waitForApproval(mutationId);

      if (decision.approved) {
        result.approvedActions++;
        await eventSink.emit({
          type: 'action_approved',
          mutationId,
          approver: decision.approver,
          timestamp: new Date().toISOString(),
        });
        result.artifacts = {
          output: `Execution approved by ${decision.approver}`,
        };
      } else {
        result.blockedActions++;
        result.blocked = true;
        await eventSink.emit({
          type: 'action_blocked',
          mutationId,
          reason: decision.reason,
          timestamp: new Date().toISOString(),
        });
      }
      break;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Executor
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeExecutor {
  execute(ctx: NodeExecutionContext): Promise<NodeResult>;
}

/**
 * RecourseNodeExecutor
 *
 * The FlowOS node executor for recourse_node type.
 * Wraps agent execution with RecourseOS interception and routes events
 * to the FlowOS event log.
 */
export class RecourseNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutionContext): Promise<NodeResult> {
    // Create the event sink for this execution
    const sink = new FlowOSEventSink(ctx.runId, ctx.nodeId, ctx.db, ctx.sse);

    // Register sink so API can route approval decisions to it
    sinkRegistry.register(ctx.nodeId, sink);

    try {
      // Execute command under RecourseOS interception
      const result = await executeWithInterception(ctx.nodeConfig.agentCommand, {
        eventSink: sink,
        policy: ctx.nodeConfig.policy,
      });

      return {
        status: result.blocked ? 'failed' : 'completed',
        artifacts: {
          ...result.artifacts,
          interceptedActions: result.interceptedActions,
          approvedActions: result.approvedActions,
          blockedActions: result.blockedActions,
        },
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Unregister sink when done
      sinkRegistry.unregister(ctx.nodeId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function commandToMutationIntent(command: AgentCommand): MutationIntent {
  switch (command.type) {
    case 'shell':
      return { source: 'shell', command: command.command };
    case 'claude-code':
      return { source: 'shell', command: command.task };
    case 'mcp':
      return {
        source: 'mcp',
        server: command.server,
        tool: command.tool,
        arguments: command.arguments,
      };
  }
}

function evaluateMutation(mutation: MutationIntent): ConsequenceReport {
  if (mutation.source === 'shell' && mutation.command) {
    return evaluateShellCommandConsequences(
      { command: mutation.command },
      { adapterContext: { actorId: 'flowos-recourse-node', environment: 'flowos' } }
    );
  }

  if (mutation.source === 'mcp' && mutation.tool) {
    return evaluateMcpToolCallConsequences(
      {
        server: mutation.server || 'unknown',
        tool: mutation.tool,
        arguments: mutation.arguments || {},
      },
      { adapterContext: { actorId: 'flowos-recourse-node', environment: 'flowos' } }
    );
  }

  throw new Error(`Unsupported mutation source: ${mutation.source}`);
}

function determineVerdict(report: ConsequenceReport, policy?: PolicyConfig): Verdict {
  const worstTier = report.summary.worstRecoverability.tier;

  // Policy-based auto-decisions
  if (policy) {
    if (policy.autoBlockTier !== undefined && worstTier >= policy.autoBlockTier) {
      return 'blocked';
    }
    if (policy.autoApproveTier !== undefined && worstTier <= policy.autoApproveTier) {
      return 'approved';
    }
  }

  // Map RecourseOS risk assessment to verdict
  switch (report.riskAssessment) {
    case 'allow':
      return 'approved';
    case 'block':
      return 'blocked';
    case 'warn':
    case 'escalate':
      return 'escalated';
    default:
      return 'escalated'; // Default to human decision
  }
}

function reportToSummary(report: ConsequenceReport): ConsequenceReportSummary {
  return {
    totalMutations: report.summary.totalMutations,
    worstRecoverability: {
      tier: report.summary.worstRecoverability.tier,
      label: report.summary.worstRecoverability.label,
    },
    needsReview: report.summary.needsReview,
    hasUnrecoverable: report.summary.hasUnrecoverable,
    reason: report.assessmentReason,
    mutations: report.mutations.map((m: AnalyzedMutation) => ({
      target: {
        service: m.intent.target.service,
        type: m.intent.target.type,
        id: m.intent.target.id,
      },
      action: m.intent.action,
      recoverability: {
        tier: m.recoverability.tier,
        label: m.recoverability.label,
        reasoning: m.recoverability.reasoning,
      },
    })),
  };
}

function generateMutationId(): string {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createRecourseNode(): RecourseNodeExecutor {
  return new RecourseNodeExecutor();
}
