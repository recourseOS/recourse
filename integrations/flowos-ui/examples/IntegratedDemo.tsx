/**
 * Integrated FlowOS + RecourseOS Demo
 *
 * Full integration showing:
 * - DAG visualization with live node states
 * - RecourseOS interception events in real-time
 * - Consequence drawer for approving/rejecting escalated actions
 * - Event log streaming
 */

import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types (matching runtime types)
// ─────────────────────────────────────────────────────────────────────────────

type NodeStatus = 'pending' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'skipped';
type Verdict = 'approved' | 'blocked' | 'escalated';

interface RecourseEvent {
  type: 'action_intercepted' | 'action_approved' | 'action_blocked';
  mutationId: string;
  mutation?: {
    source: string;
    command?: string;
  };
  verdict?: Verdict;
  report?: {
    totalMutations: number;
    worstRecoverability: { tier: number; label: string };
    needsReview: boolean;
    reason: string;
    mutations: Array<{
      target: { service?: string; type: string; id?: string };
      action: string;
      recoverability: { tier: number; label: string; reasoning?: string };
    }>;
  };
  approver?: string;
  reason?: string;
  timestamp: string;
}

interface DagNode {
  id: string;
  name: string;
  type: 'task' | 'recourse_node' | 'approval_gate';
  status: NodeStatus;
  dependsOn?: string[];
  pendingMutation?: RecourseEvent;
}

interface LogEntry {
  id: string;
  type: string;
  nodeId: string;
  message: string;
  timestamp: Date;
  data?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo DAG Definition
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_DAG: DagNode[] = [
  { id: 'plan', name: 'Plan Cleanup', type: 'task', status: 'pending' },
  { id: 'cleanup-db', name: 'Cleanup Staging DB', type: 'recourse_node', status: 'pending', dependsOn: ['plan'] },
  { id: 'notify', name: 'Send Notification', type: 'task', status: 'pending', dependsOn: ['cleanup-db'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#e8e8e8',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },
  header: {
    padding: '16px 24px',
    borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '14px',
    fontWeight: 500,
    letterSpacing: '0.05em',
  },
  status: {
    fontSize: '11px',
    padding: '4px 12px',
    borderRadius: '2px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
    padding: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
  },
  sidebar: {
    width: '400px',
    borderLeft: '1px solid rgba(232, 232, 232, 0.1)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  drawer: {
    flex: 1,
    padding: '20px',
    borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
    overflow: 'auto',
  },
  eventLog: {
    height: '200px',
    padding: '12px',
    overflow: 'auto',
    fontSize: '11px',
  },
  node: {
    padding: '16px 24px',
    border: '1px solid rgba(232, 232, 232, 0.15)',
    borderRadius: '4px',
    minWidth: '160px',
    textAlign: 'center' as const,
    position: 'relative' as const,
  },
  arrow: {
    color: 'rgba(232, 232, 232, 0.3)',
    fontSize: '20px',
  },
  button: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '2px',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  logEntry: {
    padding: '6px 0',
    borderBottom: '1px solid rgba(232, 232, 232, 0.05)',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Node Component
// ─────────────────────────────────────────────────────────────────────────────

function NodeBox({ node, onClick }: { node: DagNode; onClick: () => void }) {
  const statusColors: Record<NodeStatus, string> = {
    pending: 'rgba(232, 232, 232, 0.3)',
    running: '#00d4ff',
    waiting_for_approval: '#ffb800',
    completed: '#00ff66',
    failed: '#ff5f57',
    skipped: 'rgba(232, 232, 232, 0.2)',
  };

  const borderColor = statusColors[node.status];
  const isClickable = node.status === 'waiting_for_approval';

  return (
    <div
      style={{
        ...styles.node,
        borderColor,
        backgroundColor: node.status === 'waiting_for_approval' ? 'rgba(255, 184, 0, 0.05)' : 'transparent',
        cursor: isClickable ? 'pointer' : 'default',
        boxShadow: node.status === 'running' ? `0 0 20px ${borderColor}40` : 'none',
      }}
      onClick={isClickable ? onClick : undefined}
    >
      <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {node.type.replace('_', ' ')}
      </div>
      <div style={{ fontSize: '13px', marginBottom: '8px' }}>{node.name}</div>
      <div style={{ fontSize: '10px', color: borderColor, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {node.status.replace('_', ' ')}
      </div>
      {node.status === 'waiting_for_approval' && (
        <div style={{
          position: 'absolute',
          top: '-8px',
          right: '-8px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: '#ffb800',
          animation: 'pulse 2s infinite',
        }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Consequence Drawer
// ─────────────────────────────────────────────────────────────────────────────

function ConsequenceDrawer({
  event,
  onApprove,
  onReject,
}: {
  event: RecourseEvent | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!event || event.type !== 'action_intercepted') {
    return (
      <div style={styles.drawer}>
        <div style={{ color: 'rgba(232, 232, 232, 0.4)', fontSize: '12px' }}>
          No pending actions requiring approval
        </div>
      </div>
    );
  }

  const report = event.report;
  const mutation = event.mutation;

  return (
    <div style={styles.drawer}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          Action Intercepted
        </div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: '#ffb800' }}>
          Awaiting Approval
        </div>
      </div>

      {/* Command */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '6px', textTransform: 'uppercase' }}>
          Command
        </div>
        <div style={{
          padding: '10px 12px',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '2px',
          fontSize: '11px',
          wordBreak: 'break-all',
          color: '#ff5f57',
        }}>
          {mutation?.command || 'Unknown command'}
        </div>
      </div>

      {/* Risk Assessment */}
      {report && (
        <>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '6px', textTransform: 'uppercase' }}>
              Risk Assessment
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(255, 184, 0, 0.15)',
                color: '#ffb800',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                borderRadius: '2px',
              }}>
                {event.verdict}
              </span>
              <span style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(255, 95, 87, 0.15)',
                color: '#ff5f57',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                borderRadius: '2px',
              }}>
                {report.worstRecoverability.label}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '6px', textTransform: 'uppercase' }}>
              Reason
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(232, 232, 232, 0.7)', lineHeight: 1.5 }}>
              {report.reason}
            </div>
          </div>

          {/* Affected Resources */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>
              Affected Resources
            </div>
            {report.mutations.map((m, i) => (
              <div key={i} style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(232, 232, 232, 0.08)',
                marginBottom: '8px',
                borderRadius: '2px',
              }}>
                <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                  {m.target.type} → {m.action}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)' }}>
                  {m.recoverability.reasoning || m.recoverability.label}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          style={{
            ...styles.button,
            flex: 1,
            backgroundColor: '#00ff66',
            color: '#0a0a0a',
          }}
          onClick={onApprove}
        >
          Approve
        </button>
        <button
          style={{
            ...styles.button,
            flex: 1,
            backgroundColor: 'transparent',
            color: '#ff5f57',
            border: '1px solid #ff5f57',
          }}
          onClick={onReject}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Log
// ─────────────────────────────────────────────────────────────────────────────

function EventLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div style={styles.eventLog}>
      <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
        Event Log
      </div>
      {entries.map((entry) => (
        <div key={entry.id} style={styles.logEntry}>
          <span style={{ color: 'rgba(232, 232, 232, 0.3)', marginRight: '8px' }}>
            {entry.timestamp.toLocaleTimeString()}
          </span>
          <span style={{
            color: entry.type.includes('approved') ? '#00ff66' :
                   entry.type.includes('blocked') ? '#ff5f57' :
                   entry.type.includes('intercepted') ? '#ffb800' :
                   entry.type.includes('start') ? '#00d4ff' :
                   'rgba(232, 232, 232, 0.7)',
          }}>
            [{entry.nodeId}]
          </span>
          <span style={{ marginLeft: '8px' }}>{entry.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Demo Component
// ─────────────────────────────────────────────────────────────────────────────

export function IntegratedDemo() {
  const [nodes, setNodes] = useState<DagNode[]>(DEMO_DAG);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [pendingEvent, setPendingEvent] = useState<RecourseEvent | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingMutationId, setPendingMutationId] = useState<string | null>(null);
  const approvalResolver = useRef<((decision: { approved: boolean; approver?: string; reason?: string }) => void) | null>(null);

  const addLog = useCallback((nodeId: string, type: string, message: string, data?: unknown) => {
    setLogs((prev) => [...prev, {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      nodeId,
      message,
      timestamp: new Date(),
      data,
    }]);
  }, []);

  const updateNode = useCallback((nodeId: string, updates: Partial<DagNode>) => {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, ...updates } : n));
  }, []);

  const runDag = useCallback(async () => {
    // Reset state
    setNodes(DEMO_DAG.map((n) => ({ ...n, status: 'pending' as NodeStatus })));
    setLogs([]);
    setPendingEvent(null);
    setRunStatus('running');
    addLog('system', 'run_start', 'DAG execution started');

    // Simulate DAG execution
    try {
      // Node 1: Plan
      updateNode('plan', { status: 'running' });
      addLog('plan', 'node_start', 'Starting plan task');
      await sleep(800);
      updateNode('plan', { status: 'completed' });
      addLog('plan', 'node_complete', 'Plan completed');

      // Node 2: Cleanup DB (recourse_node)
      updateNode('cleanup-db', { status: 'running' });
      addLog('cleanup-db', 'node_start', 'Starting recourse_node execution');
      await sleep(500);

      // Simulate RecourseOS interception
      const interceptEvent: RecourseEvent = {
        type: 'action_intercepted',
        mutationId: `mut-${Date.now()}`,
        mutation: {
          source: 'shell',
          command: 'aws rds delete-db-instance --db-instance-identifier staging-db --skip-final-snapshot',
        },
        verdict: 'escalated',
        report: {
          totalMutations: 1,
          worstRecoverability: { tier: 5, label: 'needs-review' },
          needsReview: true,
          reason: 'RDS instance deletion with skip-final-snapshot requires human approval',
          mutations: [{
            target: { service: 'aws-rds', type: 'rds_db_instance', id: 'staging-db' },
            action: 'delete',
            recoverability: {
              tier: 5,
              label: 'needs-review',
              reasoning: 'Cannot determine recoverability without live instance evidence',
            },
          }],
        },
        timestamp: new Date().toISOString(),
      };

      addLog('cleanup-db', 'action_intercepted', 'RecourseOS intercepted dangerous action', interceptEvent);
      updateNode('cleanup-db', { status: 'waiting_for_approval', pendingMutation: interceptEvent });
      setPendingEvent(interceptEvent);
      setPendingMutationId(interceptEvent.mutationId);

      // Wait for approval
      const decision = await new Promise<{ approved: boolean; approver?: string; reason?: string }>((resolve) => {
        approvalResolver.current = resolve;
      });

      if (decision.approved) {
        addLog('cleanup-db', 'action_approved', `Action approved by ${decision.approver || 'user'}`);
        updateNode('cleanup-db', { status: 'completed', pendingMutation: undefined });
        setPendingEvent(null);

        // Node 3: Notify
        updateNode('notify', { status: 'running' });
        addLog('notify', 'node_start', 'Starting notification task');
        await sleep(500);
        updateNode('notify', { status: 'completed' });
        addLog('notify', 'node_complete', 'Notification sent');

        setRunStatus('completed');
        addLog('system', 'run_complete', 'DAG execution completed successfully');
      } else {
        addLog('cleanup-db', 'action_blocked', `Action rejected: ${decision.reason || 'User rejected'}`);
        updateNode('cleanup-db', { status: 'failed', pendingMutation: undefined });
        updateNode('notify', { status: 'skipped' });
        setPendingEvent(null);
        setRunStatus('failed');
        addLog('system', 'run_failed', 'DAG execution failed - action rejected');
      }
    } catch (error) {
      setRunStatus('failed');
      addLog('system', 'run_error', `Error: ${error}`);
    }
  }, [addLog, updateNode]);

  const handleApprove = useCallback(() => {
    if (approvalResolver.current) {
      approvalResolver.current({ approved: true, approver: 'demo-user@flowos.dev' });
      approvalResolver.current = null;
    }
  }, []);

  const handleReject = useCallback(() => {
    if (approvalResolver.current) {
      approvalResolver.current({ approved: false, reason: 'Rejected by user' });
      approvalResolver.current = null;
    }
  }, []);

  const statusColors = {
    idle: 'rgba(232, 232, 232, 0.5)',
    running: '#00d4ff',
    completed: '#00ff66',
    failed: '#ff5f57',
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <span style={styles.title}>FlowOS + RecourseOS</span>
          <span style={{ marginLeft: '12px', fontSize: '11px', color: 'rgba(232, 232, 232, 0.5)' }}>
            Database Cleanup Pipeline
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ ...styles.status, color: statusColors[runStatus], border: `1px solid ${statusColors[runStatus]}` }}>
            {runStatus}
          </span>
          <button
            style={{
              ...styles.button,
              backgroundColor: runStatus === 'idle' || runStatus === 'completed' || runStatus === 'failed' ? '#00ff66' : 'rgba(232, 232, 232, 0.2)',
              color: runStatus === 'idle' || runStatus === 'completed' || runStatus === 'failed' ? '#0a0a0a' : 'rgba(232, 232, 232, 0.5)',
            }}
            onClick={runDag}
            disabled={runStatus === 'running'}
          >
            {runStatus === 'idle' ? 'Run DAG' : 'Restart'}
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={styles.main}>
        {/* DAG Canvas */}
        <div style={styles.canvas}>
          {nodes.map((node, i) => (
            <React.Fragment key={node.id}>
              <NodeBox
                node={node}
                onClick={() => {
                  if (node.pendingMutation) {
                    setPendingEvent(node.pendingMutation);
                  }
                }}
              />
              {i < nodes.length - 1 && <span style={styles.arrow}>→</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Sidebar */}
        <div style={styles.sidebar}>
          <ConsequenceDrawer
            event={pendingEvent}
            onApprove={handleApprove}
            onReject={handleReject}
          />
          <EventLog entries={logs} />
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default IntegratedDemo;
