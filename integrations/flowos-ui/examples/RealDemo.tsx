/**
 * Real FlowOS + RecourseOS Demo
 *
 * Actually calls RecourseOS via the API server - real evaluations,
 * real verdicts, real consequences.
 *
 * Supports:
 * - Shell commands (aws, terraform, kubectl, docker, rm, etc.)
 * - MCP tool calls
 * - Custom mutation intents
 */

import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MutationIntent {
  source: 'shell' | 'mcp' | 'terraform';
  command?: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

interface EvaluationResult {
  id: string;
  intent: MutationIntent;
  result: {
    decision: string;
    reason: string;
    permitted: boolean;
    summary: {
      totalMutations: number;
      worstRecoverability: { tier: number; label: string };
      needsReview: boolean;
    };
    mutations: Array<{
      target: { service?: string; type: string; id?: string };
      action: string;
      recoverability: { tier: number; label: string; reasoning?: string };
    }>;
    timing?: { totalMs: number };
    evidenceFetched?: { source: string; resources: string[] };
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface LogEntry {
  id: string;
  type: 'info' | 'evaluation' | 'approved' | 'rejected' | 'error';
  message: string;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Client
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = 'http://localhost:3099';

async function evaluate(intent: MutationIntent, description?: string): Promise<EvaluationResult> {
  const res = await fetch(`${API_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, description }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function approve(id: string): Promise<EvaluationResult> {
  const res = await fetch(`${API_URL}/approve/${id}`, { method: 'POST' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function reject(id: string): Promise<EvaluationResult> {
  const res = await fetch(`${API_URL}/reject/${id}`, { method: 'POST' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

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
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  inputPane: {
    flex: 1,
    padding: '24px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  sidebar: {
    width: '450px',
    borderLeft: '1px solid rgba(232, 232, 232, 0.1)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  commandInput: {
    width: '100%',
    padding: '16px',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(232, 232, 232, 0.15)',
    borderRadius: '4px',
    color: '#e8e8e8',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'none' as const,
  },
  button: {
    padding: '12px 24px',
    border: 'none',
    borderRadius: '2px',
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  presetButton: {
    padding: '8px 16px',
    backgroundColor: 'rgba(232, 232, 232, 0.05)',
    border: '1px solid rgba(232, 232, 232, 0.1)',
    borderRadius: '2px',
    color: 'rgba(232, 232, 232, 0.7)',
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  drawer: {
    flex: 1,
    padding: '20px',
    overflow: 'auto',
    borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
  },
  log: {
    height: '180px',
    padding: '12px',
    overflow: 'auto',
    fontSize: '11px',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Preset Commands
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'RDS Delete', command: 'aws rds delete-db-instance --db-instance-identifier prod-db --skip-final-snapshot' },
  { label: 'S3 Delete', command: 'aws s3 rb s3://customer-data-bucket --force' },
  { label: 'EC2 Terminate', command: 'aws ec2 terminate-instances --instance-ids i-1234567890abcdef0' },
  { label: 'kubectl delete', command: 'kubectl delete deployment production-api -n default' },
  { label: 'rm -rf', command: 'rm -rf /var/data/production/*' },
  { label: 'docker rm', command: 'docker rm -f $(docker ps -aq)' },
  { label: 'Safe: S3 List', command: 'aws s3 ls s3://my-bucket' },
  { label: 'Safe: kubectl get', command: 'kubectl get pods -n default' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function ResultDrawer({
  evaluation,
  onApprove,
  onReject,
  loading,
}: {
  evaluation: EvaluationResult | null;
  onApprove: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={styles.drawer}>
        <div style={{ color: '#00d4ff', fontSize: '12px' }}>
          Evaluating with RecourseOS...
        </div>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div style={styles.drawer}>
        <div style={{ color: 'rgba(232, 232, 232, 0.4)', fontSize: '12px' }}>
          Enter a command and click Evaluate to see RecourseOS analysis
        </div>
      </div>
    );
  }

  const { result, status } = evaluation;
  const decisionColors: Record<string, string> = {
    allow: '#00ff66',
    warn: '#ffb800',
    escalate: '#ffb800',
    block: '#ff5f57',
  };
  const decisionColor = decisionColors[result.decision] || '#e8e8e8';

  return (
    <div style={styles.drawer}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          RecourseOS Verdict
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            fontSize: '18px',
            fontWeight: 500,
            color: decisionColor,
            textTransform: 'uppercase',
          }}>
            {result.decision}
          </span>
          {status !== 'pending' && (
            <span style={{
              padding: '2px 8px',
              fontSize: '10px',
              backgroundColor: status === 'approved' ? 'rgba(0, 255, 102, 0.15)' : 'rgba(255, 95, 87, 0.15)',
              color: status === 'approved' ? '#00ff66' : '#ff5f57',
              borderRadius: '2px',
              textTransform: 'uppercase',
            }}>
              {status}
            </span>
          )}
        </div>
      </div>

      {/* Timing & Evidence */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '11px' }}>
        {result.timing && (
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>
            {result.timing.totalMs}ms
          </span>
        )}
        {result.evidenceFetched && (
          <span style={{ color: '#00d4ff' }}>
            Live evidence: {result.evidenceFetched.resources.join(', ')}
          </span>
        )}
      </div>

      {/* Reason */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '6px', textTransform: 'uppercase' }}>
          Assessment
        </div>
        <div style={{ fontSize: '12px', color: 'rgba(232, 232, 232, 0.8)', lineHeight: 1.6 }}>
          {result.reason}
        </div>
      </div>

      {/* Recoverability */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '6px', textTransform: 'uppercase' }}>
          Recoverability
        </div>
        <span style={{
          padding: '4px 10px',
          fontSize: '11px',
          backgroundColor: result.summary.worstRecoverability.tier >= 4 ? 'rgba(255, 95, 87, 0.15)' : 'rgba(255, 184, 0, 0.15)',
          color: result.summary.worstRecoverability.tier >= 4 ? '#ff5f57' : '#ffb800',
          borderRadius: '2px',
        }}>
          {result.summary.worstRecoverability.label}
        </span>
      </div>

      {/* Mutations */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase' }}>
          Detected Mutations ({result.mutations.length})
        </div>
        {result.mutations.map((m, i) => (
          <div key={i} style={{
            padding: '10px 12px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(232, 232, 232, 0.08)',
            marginBottom: '8px',
            borderRadius: '2px',
          }}>
            <div style={{ fontSize: '12px', marginBottom: '4px', display: 'flex', gap: '8px' }}>
              <span style={{ color: '#00d4ff' }}>{m.target.service || m.target.type}</span>
              <span style={{ color: 'rgba(232, 232, 232, 0.4)' }}>→</span>
              <span style={{ color: '#ff5f57' }}>{m.action}</span>
              {m.target.id && <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>({m.target.id})</span>}
            </div>
            {m.recoverability.reasoning && (
              <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginTop: '4px' }}>
                {m.recoverability.reasoning}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      {status === 'pending' && (result.decision === 'escalate' || result.decision === 'warn') && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            style={{ ...styles.button, flex: 1, backgroundColor: '#00ff66', color: '#0a0a0a' }}
            onClick={onApprove}
          >
            Approve Execution
          </button>
          <button
            style={{ ...styles.button, flex: 1, backgroundColor: 'transparent', color: '#ff5f57', border: '1px solid #ff5f57' }}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function EventLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const colors: Record<string, string> = {
    info: 'rgba(232, 232, 232, 0.6)',
    evaluation: '#00d4ff',
    approved: '#00ff66',
    rejected: '#ff5f57',
    error: '#ff5f57',
  };

  return (
    <div style={styles.log}>
      <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
        Activity Log
      </div>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '4px 0', borderBottom: '1px solid rgba(232, 232, 232, 0.05)' }}>
          <span style={{ color: 'rgba(232, 232, 232, 0.3)', marginRight: '8px' }}>
            {e.timestamp.toLocaleTimeString()}
          </span>
          <span style={{ color: colors[e.type] }}>{e.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function RealDemo() {
  const [command, setCommand] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs((prev) => [...prev, {
      id: `log-${Date.now()}`,
      type,
      message,
      timestamp: new Date(),
    }]);
  }, []);

  // Check API connection
  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        setConnected(true);
        addLog('info', `Connected to RecourseOS API (AWS: ${data.awsEnabled ? 'enabled' : 'disabled'})`);
      })
      .catch(() => {
        setConnected(false);
        addLog('error', 'Cannot connect to API server at localhost:3099');
      });
  }, [addLog]);

  const handleEvaluate = useCallback(async () => {
    if (!command.trim()) return;

    setLoading(true);
    setEvaluation(null);
    addLog('info', `Evaluating: ${command.slice(0, 50)}...`);

    try {
      const result = await evaluate(
        { source: 'shell', command },
        command.slice(0, 50)
      );
      setEvaluation(result);
      addLog('evaluation', `Verdict: ${result.result.decision.toUpperCase()} - ${result.result.reason.slice(0, 60)}...`);
    } catch (err) {
      addLog('error', `Evaluation failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [command, addLog]);

  const handleApprove = useCallback(async () => {
    if (!evaluation) return;
    try {
      const result = await approve(evaluation.id);
      setEvaluation(result);
      addLog('approved', `Approved: ${evaluation.id}`);
    } catch (err) {
      addLog('error', `Approval failed: ${err}`);
    }
  }, [evaluation, addLog]);

  const handleReject = useCallback(async () => {
    if (!evaluation) return;
    try {
      const result = await reject(evaluation.id);
      setEvaluation(result);
      addLog('rejected', `Rejected: ${evaluation.id}`);
    } catch (err) {
      addLog('error', `Rejection failed: ${err}`);
    }
  }, [evaluation, addLog]);

  const handlePreset = useCallback((cmd: string) => {
    setCommand(cmd);
    setEvaluation(null);
  }, []);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500, letterSpacing: '0.05em' }}>
            RecourseOS
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(232, 232, 232, 0.5)' }}>
            Real-time Consequence Evaluation
          </span>
        </div>
        <div style={{
          fontSize: '10px',
          padding: '4px 12px',
          borderRadius: '2px',
          color: connected ? '#00ff66' : '#ff5f57',
          border: `1px solid ${connected ? '#00ff66' : '#ff5f57'}`,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Main */}
      <div style={styles.main}>
        {/* Input Pane */}
        <div style={styles.inputPane}>
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Enter Command
            </div>
            <textarea
              style={{ ...styles.commandInput, height: '100px' }}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="aws rds delete-db-instance --db-instance-identifier prod-db"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  e.preventDefault();
                  handleEvaluate();
                }
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              style={{
                ...styles.button,
                backgroundColor: connected ? '#00ff66' : 'rgba(232, 232, 232, 0.2)',
                color: connected ? '#0a0a0a' : 'rgba(232, 232, 232, 0.5)',
              }}
              onClick={handleEvaluate}
              disabled={!connected || loading}
            >
              {loading ? 'Evaluating...' : 'Evaluate (⌘↵)'}
            </button>
            <button
              style={{ ...styles.button, backgroundColor: 'rgba(232, 232, 232, 0.1)', color: 'rgba(232, 232, 232, 0.7)' }}
              onClick={() => { setCommand(''); setEvaluation(null); }}
            >
              Clear
            </button>
          </div>

          {/* Presets */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(232, 232, 232, 0.5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Try These Commands
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  style={{
                    ...styles.presetButton,
                    backgroundColor: p.label.startsWith('Safe') ? 'rgba(0, 255, 102, 0.05)' : 'rgba(255, 95, 87, 0.05)',
                    borderColor: p.label.startsWith('Safe') ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 95, 87, 0.2)',
                  }}
                  onClick={() => handlePreset(p.command)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={styles.sidebar}>
          <ResultDrawer
            evaluation={evaluation}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={loading}
          />
          <EventLog entries={logs} />
        </div>
      </div>
    </div>
  );
}

export default RealDemo;
