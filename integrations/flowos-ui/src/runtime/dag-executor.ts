/**
 * FlowOS DAG Executor
 *
 * Executes DAGs with support for recourse_node types that wrap agent
 * execution with RecourseOS interception.
 *
 * Example DAG:
 * ```
 * [plan_task] → [recourse_node: shell] → [approval_gate] → [commit]
 * ```
 */

import { RecourseNodeExecutor } from './recourse-node.js';
import type {
  NodeExecutionContext,
  NodeResult,
  RecourseNodeConfig,
  EventDatabase,
  SSEBroadcaster,
  RecourseEvent,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// DAG Definition Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DagNode {
  id: string;
  name: string;
  type: 'task' | 'recourse_node' | 'approval_gate';
  config?: RecourseNodeConfig | TaskConfig | ApprovalGateConfig;
  dependsOn?: string[];
}

export interface TaskConfig {
  handler: () => Promise<unknown>;
}

export interface ApprovalGateConfig {
  /** If true, auto-approve (for testing) */
  autoApprove?: boolean;
}

export interface DagDefinition {
  id: string;
  name: string;
  nodes: DagNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution State
// ─────────────────────────────────────────────────────────────────────────────

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  result?: NodeResult;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RunState {
  runId: string;
  dagId: string;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  nodes: Map<string, NodeState>;
  events: RunEvent[];
  startedAt: Date;
  completedAt?: Date;
}

export interface RunEvent {
  id: string;
  runId: string;
  nodeId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database (for demo/testing)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryEventDatabase implements EventDatabase {
  private events: RunEvent[] = [];
  private nodeStatuses = new Map<string, string>();

  async insertEvent(event: {
    runId: string;
    nodeId: string;
    type: string;
    payload: RecourseEvent;
    createdAt: Date;
  }): Promise<void> {
    this.events.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...event,
    });
  }

  async updateNodeStatus(nodeId: string, status: string): Promise<void> {
    this.nodeStatuses.set(nodeId, status);
  }

  getEvents(): RunEvent[] {
    return [...this.events];
  }

  getNodeStatus(nodeId: string): string | undefined {
    return this.nodeStatuses.get(nodeId);
  }

  clear(): void {
    this.events = [];
    this.nodeStatuses.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE Broadcaster (connects to API server)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemorySSEBroadcaster implements SSEBroadcaster {
  private listeners = new Map<string, Array<(event: RecourseEvent) => void>>();

  broadcast(runId: string, event: RecourseEvent): void {
    const callbacks = this.listeners.get(runId) || [];
    for (const cb of callbacks) {
      cb(event);
    }
  }

  subscribe(runId: string, callback: (event: RecourseEvent) => void): () => void {
    const callbacks = this.listeners.get(runId) || [];
    callbacks.push(callback);
    this.listeners.set(runId, callbacks);

    return () => {
      const idx = callbacks.indexOf(callback);
      if (idx >= 0) callbacks.splice(idx, 1);
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DAG Executor
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  db?: EventDatabase;
  sse?: SSEBroadcaster;
  onNodeStart?: (nodeId: string, node: DagNode) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
  onRunComplete?: (state: RunState) => void;
}

export class DagExecutor {
  private db: EventDatabase;
  private sse: SSEBroadcaster;
  private recourseExecutor: RecourseNodeExecutor;
  private options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.db = options.db || new InMemoryEventDatabase();
    this.sse = options.sse || new InMemorySSEBroadcaster();
    this.recourseExecutor = new RecourseNodeExecutor();
    this.options = options;
  }

  /**
   * Execute a DAG and return the final run state.
   */
  async execute(dag: DagDefinition): Promise<RunState> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Initialize run state
    const state: RunState = {
      runId,
      dagId: dag.id,
      status: 'running',
      nodes: new Map(),
      events: [],
      startedAt: new Date(),
    };

    // Initialize node states
    for (const node of dag.nodes) {
      state.nodes.set(node.id, {
        nodeId: node.id,
        status: 'pending',
      });
    }

    // Build dependency graph
    const dependencyGraph = this.buildDependencyGraph(dag);

    // Execute in topological order
    const executionOrder = this.topologicalSort(dag.nodes, dependencyGraph);

    for (const nodeId of executionOrder) {
      const node = dag.nodes.find((n) => n.id === nodeId)!;
      const nodeState = state.nodes.get(nodeId)!;

      // Check if dependencies are satisfied
      const deps = dependencyGraph.get(nodeId) || [];
      const depsFailed = deps.some((depId) => {
        const depState = state.nodes.get(depId);
        return depState?.status === 'failed' || depState?.status === 'skipped';
      });

      if (depsFailed) {
        nodeState.status = 'skipped';
        continue;
      }

      // Execute node
      nodeState.status = 'running';
      nodeState.startedAt = new Date();
      this.options.onNodeStart?.(nodeId, node);

      try {
        const result = await this.executeNode(node, runId);
        nodeState.result = result;
        nodeState.status = result.status === 'failed' ? 'failed' : 'completed';
        nodeState.completedAt = new Date();
        this.options.onNodeComplete?.(nodeId, result);

        // If node failed, mark run as failed but continue to allow cleanup
        if (result.status === 'failed') {
          state.status = 'failed';
        }
      } catch (error) {
        nodeState.status = 'failed';
        nodeState.result = {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
        nodeState.completedAt = new Date();
        state.status = 'failed';
        this.options.onNodeComplete?.(nodeId, nodeState.result);
      }
    }

    // Finalize run
    if (state.status === 'running') {
      state.status = 'completed';
    }
    state.completedAt = new Date();
    this.options.onRunComplete?.(state);

    return state;
  }

  private async executeNode(node: DagNode, runId: string): Promise<NodeResult> {
    switch (node.type) {
      case 'task':
        return this.executeTaskNode(node);

      case 'recourse_node':
        return this.executeRecourseNode(node, runId);

      case 'approval_gate':
        return this.executeApprovalGate(node);

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  private async executeTaskNode(node: DagNode): Promise<NodeResult> {
    const config = node.config as TaskConfig | undefined;
    if (config?.handler) {
      const output = await config.handler();
      return { status: 'completed', artifacts: { output } };
    }
    return { status: 'completed' };
  }

  private async executeRecourseNode(node: DagNode, runId: string): Promise<NodeResult> {
    const config = node.config as RecourseNodeConfig | undefined;
    if (!config?.agentCommand) {
      throw new Error(`recourse_node '${node.id}' missing agentCommand config`);
    }

    const ctx: NodeExecutionContext = {
      runId,
      nodeId: node.id,
      nodeConfig: config,
      db: this.db,
      sse: this.sse,
    };

    return this.recourseExecutor.execute(ctx);
  }

  private async executeApprovalGate(node: DagNode): Promise<NodeResult> {
    const config = node.config as ApprovalGateConfig | undefined;

    // For now, auto-approve if configured (for testing)
    if (config?.autoApprove) {
      return { status: 'completed', artifacts: { approved: true } };
    }

    // In a real implementation, this would wait for external approval
    // For now, just pass through
    return { status: 'completed', artifacts: { approved: true } };
  }

  private buildDependencyGraph(dag: DagDefinition): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const node of dag.nodes) {
      graph.set(node.id, node.dependsOn || []);
    }
    return graph;
  }

  private topologicalSort(
    nodes: DagNode[],
    dependencyGraph: Map<string, string[]>
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error(`Cycle detected in DAG at node: ${nodeId}`);
      }

      visiting.add(nodeId);
      const deps = dependencyGraph.get(nodeId) || [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createDagExecutor(options?: ExecutorOptions): DagExecutor {
  return new DagExecutor(options);
}
