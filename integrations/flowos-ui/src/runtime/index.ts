/**
 * FlowOS + RecourseOS Runtime
 *
 * The integration layer that makes RecourseOS a first-class node type
 * within FlowOS DAG execution.
 *
 * Architecture:
 * - RecourseOS = reactive interception (catches dangerous actions at runtime)
 * - FlowOS = proactive structure (defines execution order and approval gates)
 * - Together = proactive structure + reactive safety in one execution model
 *
 * Usage:
 *
 * ```ts
 * import { RecourseNodeExecutor, sinkRegistry } from '@recourse/flowos-ui/runtime';
 *
 * // In your DAG definition
 * const dag = {
 *   nodes: [
 *     { id: 'plan', type: 'task', ... },
 *     { id: 'execute', type: 'recourse_node', config: {
 *       agentCommand: { type: 'shell', command: 'aws rds delete-db-instance ...' }
 *     }},
 *     { id: 'commit', type: 'task', ... },
 *   ],
 *   edges: [
 *     { from: 'plan', to: 'execute' },
 *     { from: 'execute', to: 'commit' },
 *   ]
 * };
 *
 * // In your node executor router
 * if (node.type === 'recourse_node') {
 *   const executor = new RecourseNodeExecutor();
 *   return executor.execute(ctx);
 * }
 *
 * // In your API route for approvals
 * app.post('/approve/:nodeId/:mutationId', (req, res) => {
 *   const success = sinkRegistry.resolveApproval(
 *     req.params.nodeId,
 *     req.params.mutationId,
 *     { approved: true, approver: req.user.id }
 *   );
 *   res.json({ success });
 * });
 * ```
 */

// Types
export type {
  Verdict,
  MutationIntent,
  RecourseEvent,
  ActionInterceptedEvent,
  ActionApprovedEvent,
  ActionBlockedEvent,
  ConsequenceReportSummary,
  MutationSummary,
  ApprovalDecision,
  EventSink,
  NodeExecutionContext,
  RecourseNodeConfig,
  AgentCommand,
  PolicyConfig,
  NodeResult,
  EventDatabase,
  SSEBroadcaster,
} from './types.js';

// Event Sink
export { FlowOSEventSink, sinkRegistry } from './event-sink.js';

// Node Executor
export {
  RecourseNodeExecutor,
  createRecourseNode,
  type NodeExecutor,
} from './recourse-node.js';

// DAG Executor
export {
  DagExecutor,
  createDagExecutor,
  InMemoryEventDatabase,
  InMemorySSEBroadcaster,
  type DagNode,
  type DagDefinition,
  type TaskConfig,
  type ApprovalGateConfig,
  type NodeStatus,
  type NodeState,
  type RunState,
  type RunEvent,
  type ExecutorOptions,
} from './dag-executor.js';
