/**
 * FlowOS + RecourseOS LIVE Demo
 *
 * Connects to the API server and shows real RecourseOS evaluations.
 *
 * When Claude Code (or any client) sends a mutation intent to the server,
 * it appears here in real-time for approval.
 */

import * as React from 'react';
import {
  FlowLayout,
  type FlowNode,
  type LogEvent,
  type RunStatus,
} from '../src/index';

const API_URL = 'http://localhost:3099';

// ─────────────────────────────────────────────────────────────────────────────
// Types from server
// ─────────────────────────────────────────────────────────────────────────────

interface PendingEvaluation {
  id: string;
  intent: {
    source: string;
    command?: string;
    tool?: string;
    server?: string;
    arguments?: Record<string, unknown>;
  };
  result: {
    decision: 'allow' | 'warn' | 'escalate' | 'block';
    reason: string;
    permitted: boolean;
    approvalRequested: boolean;
    summary: {
      totalMutations: number;
      worstRecoverability: { tier: number; label: string };
      needsReview: boolean;
      hasUnrecoverable: boolean;
    };
    mutations: Array<{
      target: { service?: string; type: string; id?: string };
      action: string;
      recoverability: { tier: number; label: string; reasoning?: string };
    }>;
    costEstimate?: { monthlyCost: number; currency: string };
    timing?: { totalMs: number; evaluationMs: number };
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Demo Component
// ─────────────────────────────────────────────────────────────────────────────

export function LiveDemo() {
  const [evaluations, setEvaluations] = React.useState<PendingEvaluation[]>([]);
  const [events, setEvents] = React.useState<LogEvent[]>([]);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [connected, setConnected] = React.useState(false);

  // Add event helper
  const addEvent = React.useCallback((event: Omit<LogEvent, 'id' | 'timestamp'>) => {
    setEvents(prev => [
      ...prev,
      {
        ...event,
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date(),
      },
    ].slice(-100)); // Keep last 100 events
  }, []);

  // Connect to SSE for real-time updates
  React.useEffect(() => {
    const eventSource = new EventSource(`${API_URL}/events`);

    eventSource.onopen = () => {
      setConnected(true);
      addEvent({ type: 'info', message: 'Connected to RecourseOS server' });
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'connected') {
        return;
      }

      if (data.id === 'clear') {
        setEvaluations([]);
        addEvent({ type: 'info', message: 'Evaluations cleared' });
        return;
      }

      // Update or add evaluation
      setEvaluations(prev => {
        const existing = prev.findIndex(e => e.id === data.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = data;
          return updated;
        }
        return [data, ...prev];
      });

      // Add event based on status
      if (data.status === 'pending') {
        addEvent({
          type: 'consequence_evaluated',
          nodeId: data.id,
          message: `RecourseOS: ${data.result.decision}`,
        });
        if (data.result.approvalRequested) {
          addEvent({
            type: 'approval_requested',
            nodeId: data.id,
            details: 'awaiting user',
          });
        }
        // Auto-select new pending evaluations
        if (data.result.decision === 'escalate' || data.result.decision === 'block') {
          setSelectedNodeId(data.id);
        }
      } else if (data.status === 'approved') {
        addEvent({ type: 'approval_granted', nodeId: data.id });
      } else if (data.status === 'rejected') {
        addEvent({ type: 'approval_denied', nodeId: data.id });
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      addEvent({ type: 'error', message: 'Disconnected from server' });
    };

    // Initial fetch
    fetch(`${API_URL}/evaluations`)
      .then(r => r.json())
      .then(data => setEvaluations(data))
      .catch(() => {});

    return () => eventSource.close();
  }, [addEvent]);

  // Convert evaluations to FlowNodes
  const nodes: FlowNode[] = React.useMemo(() => {
    return evaluations.map(evaluation => {
      const statusMap: Record<string, FlowNode['status']> = {
        pending: evaluation.result.decision === 'block' ? 'failed' : 'waiting',
        approved: 'completed',
        rejected: 'failed',
      };

      // Format the intent for display
      let intentLabel = evaluation.intent.source;
      if (evaluation.intent.command) {
        intentLabel = evaluation.intent.command.slice(0, 40) + (evaluation.intent.command.length > 40 ? '...' : '');
      } else if (evaluation.intent.tool) {
        intentLabel = `${evaluation.intent.server || 'mcp'}:${evaluation.intent.tool}`;
      }

      return {
        id: evaluation.id,
        name: intentLabel,
        status: statusMap[evaluation.status] || 'pending',
        hasConsequenceGate: true,
        mutationIntent: {
          source: evaluation.intent.source,
          command: evaluation.intent.command,
          tool: evaluation.intent.tool,
        },
        consequenceReport: {
          decision: evaluation.result.decision,
          reason: evaluation.result.reason,
          permitted: evaluation.result.permitted,
          approvalRequested: evaluation.result.approvalRequested,
          summary: evaluation.result.summary,
          mutations: evaluation.result.mutations,
          costEstimate: evaluation.result.costEstimate,
          timing: evaluation.result.timing,
        },
      };
    });
  }, [evaluations]);

  // Handle approve
  const handleApprove = React.useCallback(async (nodeId: string) => {
    setLoading(true);
    try {
      await fetch(`${API_URL}/approve/${nodeId}`, { method: 'POST' });
    } catch (error) {
      addEvent({ type: 'error', message: `Approve failed: ${error}` });
    }
    setLoading(false);
    setSelectedNodeId(null);
  }, [addEvent]);

  // Handle reject
  const handleReject = React.useCallback(async (nodeId: string) => {
    setLoading(true);
    try {
      await fetch(`${API_URL}/reject/${nodeId}`, { method: 'POST' });
    } catch (error) {
      addEvent({ type: 'error', message: `Reject failed: ${error}` });
    }
    setLoading(false);
    setSelectedNodeId(null);
  }, [addEvent]);

  // Determine run status
  const runStatus: RunStatus = React.useMemo(() => {
    if (!connected) return 'idle';
    const pending = evaluations.filter(e => e.status === 'pending');
    const rejected = evaluations.filter(e => e.status === 'rejected');
    if (rejected.length > 0) return 'failed';
    if (pending.length > 0) return 'paused';
    if (evaluations.length > 0) return 'completed';
    return 'running';
  }, [evaluations, connected]);

  return (
    <div className="h-screen flex flex-col">
      {/* Connection status banner */}
      {!connected && (
        <div className="bg-red-500 text-white px-4 py-2 text-center text-sm">
          Not connected to server. Run: <code className="bg-red-600 px-2 py-0.5 rounded">npm run server</code>
        </div>
      )}

      {/* Empty state */}
      {connected && evaluations.length === 0 && (
        <div className="bg-blue-500 text-white px-4 py-2 text-center text-sm">
          Waiting for mutations... Have Claude Code run a destructive command!
        </div>
      )}

      <FlowLayout
        flowName="live-evaluations"
        runId={evaluations.length > 0 ? evaluations.length : undefined}
        runStatus={runStatus}
        nodes={nodes}
        events={events}
        selectedNodeId={selectedNodeId}
        onNodeSelect={setSelectedNodeId}
        onApprove={handleApprove}
        onReject={handleReject}
        onRerun={() => {
          fetch(`${API_URL}/clear`, { method: 'POST' });
          setSelectedNodeId(null);
        }}
        showEventLog={true}
        loading={loading}
      />
    </div>
  );
}

export default LiveDemo;
