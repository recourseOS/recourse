/**
 * Full FlowOS + RecourseOS Demo
 *
 * DAG visualization with real RecourseOS evaluation.
 */

import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';

type NodeStatus = 'pending' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'skipped';

interface DagNode {
  id: string;
  name: string;
  type: 'task' | 'recourse_node';
  status: NodeStatus;
  dependsOn?: string[];
  command?: string;
  evaluation?: any;
}

interface LogEntry {
  id: string;
  type: string;
  nodeId: string;
  message: string;
  timestamp: Date;
}

const API_URL = 'http://localhost:3099';

async function evaluateCommand(command: string) {
  const res = await fetch(`${API_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: { source: 'shell', command }, description: command.slice(0, 50) }),
  });
  return res.json();
}

async function approveEvaluation(id: string) {
  await fetch(`${API_URL}/approve/${id}`, { method: 'POST' });
}

async function rejectEvaluation(id: string) {
  await fetch(`${API_URL}/reject/${id}`, { method: 'POST' });
}

const DEMO_DAGS = {
  'db-cleanup': {
    name: 'Database Cleanup Pipeline',
    nodes: [
      { id: 'plan', name: 'Plan Cleanup', type: 'task' as const },
      { id: 'cleanup-db', name: 'Delete Staging DB', type: 'recourse_node' as const, dependsOn: ['plan'], command: 'aws rds delete-db-instance --db-instance-identifier staging-db --skip-final-snapshot' },
      { id: 'notify', name: 'Send Notification', type: 'task' as const, dependsOn: ['cleanup-db'] },
    ],
  },
  's3-migration': {
    name: 'S3 Bucket Migration',
    nodes: [
      { id: 'backup', name: 'Create Backup', type: 'task' as const },
      { id: 'delete-old', name: 'Delete Old Bucket', type: 'recourse_node' as const, dependsOn: ['backup'], command: 'aws s3 rb s3://legacy-data-bucket --force' },
      { id: 'verify', name: 'Verify Migration', type: 'task' as const, dependsOn: ['delete-old'] },
    ],
  },
  'k8s-deploy': {
    name: 'Kubernetes Deployment',
    nodes: [
      { id: 'build', name: 'Build Image', type: 'task' as const },
      { id: 'delete-old', name: 'Delete Old Deployment', type: 'recourse_node' as const, dependsOn: ['build'], command: 'kubectl delete deployment api-server -n production' },
      { id: 'deploy', name: 'Deploy New Version', type: 'task' as const, dependsOn: ['delete-old'] },
      { id: 'healthcheck', name: 'Health Check', type: 'task' as const, dependsOn: ['deploy'] },
    ],
  },
  'infra-destroy': {
    name: 'Infrastructure Teardown',
    nodes: [
      { id: 'snapshot', name: 'Create Snapshots', type: 'task' as const },
      { id: 'destroy-rds', name: 'Destroy RDS', type: 'recourse_node' as const, dependsOn: ['snapshot'], command: 'aws rds delete-db-instance --db-instance-identifier prod-database --skip-final-snapshot' },
      { id: 'destroy-ec2', name: 'Terminate EC2', type: 'recourse_node' as const, dependsOn: ['snapshot'], command: 'aws ec2 terminate-instances --instance-ids i-0123456789abcdef0' },
      { id: 'destroy-s3', name: 'Delete S3', type: 'recourse_node' as const, dependsOn: ['destroy-rds', 'destroy-ec2'], command: 'aws s3 rb s3://app-assets --force' },
      { id: 'cleanup', name: 'Final Cleanup', type: 'task' as const, dependsOn: ['destroy-s3'] },
    ],
  },
};

const statusColors: Record<NodeStatus, string> = {
  pending: 'rgba(232, 232, 232, 0.3)',
  running: '#00d4ff',
  waiting_for_approval: '#ffb800',
  completed: '#00ff66',
  failed: '#ff5f57',
  skipped: 'rgba(232, 232, 232, 0.15)',
};

function DagCanvas({ nodes, onNodeClick, selectedId }: { nodes: DagNode[]; onNodeClick: (n: DagNode) => void; selectedId: string | null }) {
  const layers: DagNode[][] = [];
  const placed = new Set<string>();
  while (placed.size < nodes.length) {
    const layer: DagNode[] = [];
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      if ((node.dependsOn || []).every((d) => placed.has(d))) layer.push(node);
    }
    if (layer.length === 0) break;
    layer.forEach((n) => placed.add(n.id));
    layers.push(layer);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      {layers.map((layer, li) => (
        <React.Fragment key={li}>
          {li > 0 && <div style={{ color: 'rgba(232, 232, 232, 0.2)', fontSize: '14px' }}>↓</div>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {layer.map((node) => {
              const color = statusColors[node.status];
              const selected = node.id === selectedId;
              return (
                <div
                  key={node.id}
                  onClick={() => onNodeClick(node)}
                  style={{
                    padding: '12px 20px',
                    border: `1px solid ${selected ? '#00ff66' : color}`,
                    borderRadius: '4px',
                    minWidth: '130px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: node.status === 'waiting_for_approval' ? 'rgba(255, 184, 0, 0.08)' : selected ? 'rgba(0, 255, 102, 0.05)' : 'transparent',
                    boxShadow: node.status === 'running' || node.status === 'waiting_for_approval' ? `0 0 15px ${color}40` : 'none',
                    position: 'relative',
                  }}
                >
                  <div style={{ fontSize: '9px', color: 'rgba(232, 232, 232, 0.4)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {node.type.replace('_', ' ')}
                  </div>
                  <div style={{ fontSize: '11px', marginBottom: '4px' }}>{node.name}</div>
                  <div style={{ fontSize: '9px', color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {node.status.replace(/_/g, ' ')}
                  </div>
                  {node.status === 'waiting_for_approval' && (
                    <div style={{ position: 'absolute', top: -5, right: -5, width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ffb800', animation: 'pulse 2s infinite' }} />
                  )}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function ConsequenceDrawer({ node, onApprove, onReject }: { node: DagNode | null; onApprove: () => void; onReject: () => void }) {
  if (!node) return <div style={{ padding: 16, color: 'rgba(232, 232, 232, 0.4)', fontSize: 11 }}>Select a node to view details</div>;
  const e = node.evaluation;
  return (
    <div style={{ padding: 16, overflow: 'auto', flex: 1, borderBottom: '1px solid rgba(232, 232, 232, 0.1)' }}>
      <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>{node.type.replace('_', ' ')}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>{node.name}</div>
      {node.command && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Command</div>
          <div style={{ padding: 10, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 2, fontSize: 10, color: '#ff5f57', wordBreak: 'break-all' }}>{node.command}</div>
        </div>
      )}
      {e && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Verdict</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: e.result.decision === 'allow' ? '#00ff66' : e.result.decision === 'block' ? '#ff5f57' : '#ffb800', textTransform: 'uppercase' }}>{e.result.decision}</span>
              <span style={{ padding: '2px 8px', fontSize: 9, backgroundColor: 'rgba(255, 95, 87, 0.15)', color: '#ff5f57', borderRadius: 2 }}>{e.result.summary.worstRecoverability.label}</span>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', textTransform: 'uppercase', marginBottom: 4 }}>Reason</div>
            <div style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.7)', lineHeight: 1.5 }}>{e.result.reason}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', textTransform: 'uppercase', marginBottom: 6 }}>Affected Resources</div>
            {e.result.mutations.map((m: any, i: number) => (
              <div key={i} style={{ padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(232, 232, 232, 0.06)', marginBottom: 4, borderRadius: 2, fontSize: 10 }}>
                <span style={{ color: '#00d4ff' }}>{m.target.type}</span>
                <span style={{ color: 'rgba(232, 232, 232, 0.3)', margin: '0 6px' }}>→</span>
                <span style={{ color: '#ff5f57' }}>{m.action}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {node.status === 'waiting_for_approval' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onApprove} style={{ flex: 1, padding: '10px 16px', border: 'none', borderRadius: 2, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', backgroundColor: '#00ff66', color: '#0a0a0a', fontFamily: 'inherit' }}>Approve</button>
          <button onClick={onReject} style={{ flex: 1, padding: '10px 16px', border: '1px solid #ff5f57', borderRadius: 2, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', backgroundColor: 'transparent', color: '#ff5f57', fontFamily: 'inherit' }}>Reject</button>
        </div>
      )}
    </div>
  );
}

function EventLog({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries.length]);
  return (
    <div style={{ height: 150, padding: 12, overflow: 'auto', fontSize: 10 }}>
      <div style={{ fontSize: 9, color: 'rgba(232, 232, 232, 0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.15em' }}>Event Log</div>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '3px 0', borderBottom: '1px solid rgba(232, 232, 232, 0.03)' }}>
          <span style={{ color: 'rgba(232, 232, 232, 0.25)', marginRight: 6 }}>{e.timestamp.toLocaleTimeString()}</span>
          <span style={{ color: e.type.includes('approved') ? '#00ff66' : e.type.includes('rejected') || e.type.includes('failed') ? '#ff5f57' : e.type.includes('waiting') ? '#ffb800' : e.type.includes('running') ? '#00d4ff' : 'rgba(232, 232, 232, 0.6)' }}>[{e.nodeId}]</span>
          <span style={{ marginLeft: 6, color: 'rgba(232, 232, 232, 0.7)' }}>{e.message}</span>
        </div>
      ))}
      <div ref={ref} />
    </div>
  );
}

export function FullDemo() {
  const [dagKey, setDagKey] = useState<keyof typeof DEMO_DAGS>('db-cleanup');
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const approvalResolver = useRef<((approved: boolean) => void) | null>(null);

  useEffect(() => {
    const dag = DEMO_DAGS[dagKey];
    setNodes(dag.nodes.map((n) => ({ ...n, status: 'pending' as NodeStatus })));
    setSelectedId(null);
    setLogs([]);
    setRunStatus('idle');
  }, [dagKey]);

  const addLog = useCallback((nodeId: string, type: string, message: string) => {
    setLogs((p) => [...p, { id: `${Date.now()}`, type, nodeId, message, timestamp: new Date() }]);
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<DagNode>) => {
    setNodes((p) => p.map((n) => n.id === id ? { ...n, ...updates } : n));
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  const runDag = useCallback(async () => {
    const dag = DEMO_DAGS[dagKey];
    setNodes(dag.nodes.map((n) => ({ ...n, status: 'pending' as NodeStatus, evaluation: undefined })));
    setLogs([]);
    setRunStatus('running');
    addLog('system', 'start', 'DAG execution started');

    const completed = new Set<string>();
    let failed = false;

    while (completed.size < dag.nodes.length && !failed) {
      const ready = dag.nodes.filter((n) => !completed.has(n.id) && (n.dependsOn || []).every((d) => completed.has(d)));
      if (ready.length === 0) break;

      for (const node of ready) {
        updateNode(node.id, { status: 'running' });
        addLog(node.id, 'running', `Starting ${node.type}`);
        setSelectedId(node.id);
        await sleep(500);

        if (node.type === 'recourse_node' && node.command) {
          addLog(node.id, 'evaluating', 'Calling RecourseOS...');
          try {
            const eval_ = await evaluateCommand(node.command);
            updateNode(node.id, { evaluation: eval_ });

            if (eval_.result.decision === 'allow') {
              addLog(node.id, 'approved', `Auto-approved`);
              updateNode(node.id, { status: 'completed' });
              completed.add(node.id);
            } else if (eval_.result.decision === 'block') {
              addLog(node.id, 'blocked', `Blocked: ${eval_.result.reason.slice(0, 40)}...`);
              updateNode(node.id, { status: 'failed' });
              failed = true;
            } else {
              addLog(node.id, 'waiting', `Escalated - awaiting approval`);
              updateNode(node.id, { status: 'waiting_for_approval' });
              const approved = await new Promise<boolean>((resolve) => { approvalResolver.current = resolve; });
              if (approved) {
                await approveEvaluation(eval_.id);
                addLog(node.id, 'approved', 'Human approved');
                updateNode(node.id, { status: 'completed' });
                completed.add(node.id);
              } else {
                await rejectEvaluation(eval_.id);
                addLog(node.id, 'rejected', 'Human rejected');
                updateNode(node.id, { status: 'failed' });
                failed = true;
              }
            }
          } catch (err) {
            addLog(node.id, 'error', `API error: ${err}`);
            updateNode(node.id, { status: 'failed' });
            failed = true;
          }
        } else {
          await sleep(300);
          updateNode(node.id, { status: 'completed' });
          addLog(node.id, 'completed', 'Task completed');
          completed.add(node.id);
        }
      }
    }

    for (const node of dag.nodes) {
      if (!completed.has(node.id)) updateNode(node.id, { status: 'skipped' });
    }
    setRunStatus(failed ? 'failed' : 'completed');
    addLog('system', failed ? 'failed' : 'completed', `DAG ${failed ? 'failed' : 'completed'}`);
  }, [dagKey, addLog, updateNode]);

  const handleApprove = useCallback(() => { approvalResolver.current?.(true); approvalResolver.current = null; }, []);
  const handleReject = useCallback(() => { approvalResolver.current?.(false); approvalResolver.current = null; }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#0a0a0a', color: '#e8e8e8', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(232, 232, 232, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>FlowOS + RecourseOS</span>
          <select value={dagKey} onChange={(e) => setDagKey(e.target.value as keyof typeof DEMO_DAGS)} disabled={runStatus === 'running'} style={{ padding: '6px 10px', backgroundColor: 'rgba(0,0,0,0.4)', border: '1px solid rgba(232, 232, 232, 0.15)', borderRadius: 2, color: '#e8e8e8', fontSize: 11, fontFamily: 'inherit' }}>
            {Object.entries(DEMO_DAGS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, padding: '4px 10px', color: runStatus === 'completed' ? '#00ff66' : runStatus === 'failed' ? '#ff5f57' : runStatus === 'running' ? '#00d4ff' : 'rgba(232, 232, 232, 0.5)', border: '1px solid currentColor', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{runStatus}</span>
          <button onClick={runDag} disabled={runStatus === 'running'} style={{ padding: '8px 20px', border: 'none', borderRadius: 2, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', backgroundColor: runStatus !== 'running' ? '#00ff66' : 'rgba(232, 232, 232, 0.2)', color: runStatus !== 'running' ? '#0a0a0a' : 'rgba(232, 232, 232, 0.5)' }}>{runStatus === 'idle' ? 'Run DAG' : 'Restart'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DagCanvas nodes={nodes} onNodeClick={(n) => setSelectedId(n.id)} selectedId={selectedId} />
        </div>
        <div style={{ width: 400, borderLeft: '1px solid rgba(232, 232, 232, 0.1)', display: 'flex', flexDirection: 'column' }}>
          <ConsequenceDrawer node={selectedNode} onApprove={handleApprove} onReject={handleReject} />
          <EventLog entries={logs} />
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export default FullDemo;
