/**
 * RecourseOS + FlowOS Dashboard
 *
 * Multi-source approval dashboard showing requests from:
 * - Claude Code (MCP)
 * - Terraform Cloud (Run Tasks)
 * - kubectl (Admission Controller)
 * - GitHub Actions (CI/CD)
 * - Direct CLI
 */

import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Source = 'claude-code' | 'terraform-cloud' | 'kubectl' | 'github-actions' | 'cli';
type Decision = 'allow' | 'block' | 'escalate';
type Status = 'pending' | 'approved' | 'rejected' | 'blocked' | 'expired';

interface EvaluationRequest {
  id: string;
  source: Source;
  sourceDetails: {
    agent?: string;
    workspace?: string;
    runId?: string;
    user?: string;
    workflow?: string;
    repo?: string;
  };
  command: string;
  timestamp: Date;
  decision: Decision;
  status: Status;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recoverability: { tier: number; label: string };
  resource: { type: string; identifier: string };
  mutations: { action: string; resource: string }[];
  reason: string;
  attestationId: string;
}

interface DAGNode {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'blocked' | 'waiting';
  output?: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Config
// ─────────────────────────────────────────────────────────────────────────────

const sourceConfig: Record<Source, { label: string; color: string; icon: string }> = {
  'claude-code': { label: 'Claude Code', color: '#cc785c', icon: '⌘' },
  'terraform-cloud': { label: 'Terraform Cloud', color: '#7b42bc', icon: '⬡' },
  'kubectl': { label: 'kubectl', color: '#326ce5', icon: '☸' },
  'github-actions': { label: 'GitHub Actions', color: '#2088ff', icon: '⚡' },
  'cli': { label: 'CLI', color: '#00ff66', icon: '$' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sample Data Generator
// ─────────────────────────────────────────────────────────────────────────────

function generateSampleRequests(): EvaluationRequest[] {
  return [
    {
      id: 'eval-' + Math.random().toString(16).slice(2, 8),
      source: 'claude-code',
      sourceDetails: { agent: 'claude-opus-4' },
      command: 'aws rds delete-db-instance --db-instance-identifier prod-analytics --skip-final-snapshot',
      timestamp: new Date(Date.now() - 45000),
      decision: 'escalate',
      status: 'pending',
      riskLevel: 'CRITICAL',
      recoverability: { tier: 4, label: 'UNRECOVERABLE' },
      resource: { type: 'aws_db_instance', identifier: 'prod-analytics' },
      mutations: [
        { action: 'DELETE', resource: 'aws_db_instance.prod-analytics' },
        { action: 'DELETE', resource: 'aws_db_subnet_group.prod-analytics' },
      ],
      reason: 'Database deletion without final snapshot - data will be permanently lost',
      attestationId: 'att-' + Math.random().toString(16).slice(2, 8),
    },
    {
      id: 'eval-' + Math.random().toString(16).slice(2, 8),
      source: 'terraform-cloud',
      sourceDetails: { workspace: 'production-us-east', runId: 'run-qM4x7yNpK2v' },
      command: 'terraform apply (destroy 3 resources)',
      timestamp: new Date(Date.now() - 120000),
      decision: 'escalate',
      status: 'pending',
      riskLevel: 'HIGH',
      recoverability: { tier: 3, label: 'RECOVERABLE_FROM_BACKUP' },
      resource: { type: 'aws_s3_bucket', identifier: 'customer-uploads-prod' },
      mutations: [
        { action: 'DELETE', resource: 'aws_s3_bucket.customer-uploads-prod' },
        { action: 'DELETE', resource: 'aws_s3_bucket_policy.customer-uploads-prod' },
        { action: 'DELETE', resource: 'aws_cloudfront_distribution.uploads-cdn' },
      ],
      reason: 'S3 bucket with customer data - versioning enabled but deletion affects CDN',
      attestationId: 'att-' + Math.random().toString(16).slice(2, 8),
    },
    {
      id: 'eval-' + Math.random().toString(16).slice(2, 8),
      source: 'kubectl',
      sourceDetails: { user: 'deploy-bot' },
      command: 'kubectl delete deployment api-gateway -n production',
      timestamp: new Date(Date.now() - 30000),
      decision: 'escalate',
      status: 'pending',
      riskLevel: 'HIGH',
      recoverability: { tier: 2, label: 'RECOVERABLE_WITH_EFFORT' },
      resource: { type: 'kubernetes_deployment', identifier: 'production/api-gateway' },
      mutations: [
        { action: 'DELETE', resource: 'deployment/api-gateway' },
        { action: 'DELETE', resource: 'replicaset/api-gateway-*' },
        { action: 'DELETE', resource: 'pods/api-gateway-*' },
      ],
      reason: 'Production deployment deletion - will cause service downtime',
      attestationId: 'att-' + Math.random().toString(16).slice(2, 8),
    },
    {
      id: 'eval-' + Math.random().toString(16).slice(2, 8),
      source: 'github-actions',
      sourceDetails: { workflow: 'deploy-prod', repo: 'acme/platform' },
      command: 'terraform destroy -target=aws_instance.batch_processor',
      timestamp: new Date(Date.now() - 180000),
      decision: 'escalate',
      status: 'pending',
      riskLevel: 'MEDIUM',
      recoverability: { tier: 2, label: 'RECOVERABLE_WITH_EFFORT' },
      resource: { type: 'aws_instance', identifier: 'batch_processor' },
      mutations: [
        { action: 'TERMINATE', resource: 'aws_instance.batch_processor' },
        { action: 'DETACH', resource: 'aws_ebs_volume.batch_data' },
      ],
      reason: 'EC2 instance termination - EBS volume will be detached but not deleted',
      attestationId: 'att-' + Math.random().toString(16).slice(2, 8),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: Source }) {
  const config = sourceConfig[source];
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      backgroundColor: `${config.color}20`,
      border: `1px solid ${config.color}40`,
      borderRadius: 3,
      fontSize: 11,
      color: config.color,
    }}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    LOW: '#00ff66',
    MEDIUM: '#ffb800',
    HIGH: '#ff8c00',
    CRITICAL: '#ff5f57',
  };
  return (
    <span style={{
      padding: '2px 8px',
      backgroundColor: `${colors[level]}20`,
      color: colors[level],
      borderRadius: 2,
      fontSize: 10,
      fontWeight: 500,
    }}>
      {level}
    </span>
  );
}

function MiniDAG({ nodes }: { nodes: DAGNode[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 0' }}>
      {nodes.map((node, i) => (
        <React.Fragment key={node.id}>
          <div style={{
            padding: '4px 8px',
            fontSize: 9,
            borderRadius: 2,
            backgroundColor: node.status === 'completed' ? 'rgba(0, 255, 102, 0.15)' :
                             node.status === 'running' ? 'rgba(0, 212, 255, 0.15)' :
                             node.status === 'waiting' ? 'rgba(255, 184, 0, 0.15)' :
                             node.status === 'blocked' ? 'rgba(255, 95, 87, 0.15)' : 'rgba(232, 232, 232, 0.05)',
            border: `1px solid ${
              node.status === 'completed' ? '#00ff66' :
              node.status === 'running' ? '#00d4ff' :
              node.status === 'waiting' ? '#ffb800' :
              node.status === 'blocked' ? '#ff5f57' : 'rgba(232, 232, 232, 0.2)'
            }`,
            color: node.status === 'pending' ? 'rgba(232, 232, 232, 0.5)' : '#e8e8e8',
          }}>
            {node.label}
          </div>
          {i < nodes.length - 1 && (
            <span style={{ color: 'rgba(232, 232, 232, 0.3)', fontSize: 8 }}>→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function RequestCard({ request, onApprove, onReject, onSelect, isSelected }: {
  request: EvaluationRequest;
  onApprove: () => void;
  onReject: () => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const dagNodes: DAGNode[] = [
    { id: 'intercept', label: 'Intercept', status: 'completed' },
    { id: 'parse', label: 'Parse', status: 'completed' },
    { id: 'evaluate', label: 'Evaluate', status: 'completed' },
    { id: 'decision', label: 'Decision', status: 'completed' },
    { id: 'approval', label: 'Approval', status: request.status === 'pending' ? 'waiting' : request.status === 'approved' ? 'completed' : 'blocked' },
    { id: 'execute', label: 'Execute', status: request.status === 'pending' ? 'pending' : request.status === 'approved' ? 'completed' : 'blocked' },
  ];

  const timeAgo = getTimeAgo(request.timestamp);

  return (
    <div
      onClick={onSelect}
      style={{
        padding: 16,
        backgroundColor: isSelected ? 'rgba(0, 255, 102, 0.05)' : 'rgba(232, 232, 232, 0.02)',
        border: `1px solid ${isSelected ? 'rgba(0, 255, 102, 0.3)' : 'rgba(232, 232, 232, 0.08)'}`,
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SourceBadge source={request.source} />
          <span style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.5)' }}>{timeAgo}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RiskBadge level={request.riskLevel} />
          {request.status === 'pending' && (
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: '#ffb800',
              animation: 'pulse 2s infinite',
            }} />
          )}
        </div>
      </div>

      {/* Source Details */}
      <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.5)', marginBottom: 8 }}>
        {request.source === 'claude-code' && `Agent: ${request.sourceDetails.agent}`}
        {request.source === 'terraform-cloud' && `Workspace: ${request.sourceDetails.workspace} • Run: ${request.sourceDetails.runId}`}
        {request.source === 'kubectl' && `User: ${request.sourceDetails.user}`}
        {request.source === 'github-actions' && `${request.sourceDetails.repo} • ${request.sourceDetails.workflow}`}
      </div>

      {/* Command */}
      <div style={{
        padding: '8px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: 3,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        color: '#ff5f57',
        marginBottom: 12,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        $ {request.command}
      </div>

      {/* Mini DAG */}
      <MiniDAG nodes={dagNodes} />

      {/* Resource & Recoverability */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11 }}>
        <div>
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Resource: </span>
          <span style={{ color: '#00d4ff' }}>{request.resource.identifier}</span>
        </div>
        <div>
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Recoverability: </span>
          <span style={{
            color: request.recoverability.tier >= 4 ? '#ff5f57' :
                   request.recoverability.tier >= 3 ? '#ffb800' : '#00ff66'
          }}>
            Tier {request.recoverability.tier}
          </span>
        </div>
      </div>

      {/* Reason */}
      <div style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.7)', marginBottom: 16 }}>
        {request.reason}
      </div>

      {/* Actions */}
      {request.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={onApprove}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#00ff66',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: 3,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Approve
          </button>
          <button
            onClick={onReject}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: 'transparent',
              color: '#ff5f57',
              border: '1px solid #ff5f57',
              borderRadius: 3,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Reject
          </button>
        </div>
      )}

      {request.status !== 'pending' && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: request.status === 'approved' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 95, 87, 0.1)',
          border: `1px solid ${request.status === 'approved' ? '#00ff66' : '#ff5f57'}`,
          borderRadius: 3,
          fontSize: 11,
          color: request.status === 'approved' ? '#00ff66' : '#ff5f57',
          textAlign: 'center',
        }}>
          {request.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ request }: { request: EvaluationRequest | null }) {
  if (!request) {
    return (
      <div style={{ padding: 24, color: 'rgba(232, 232, 232, 0.4)', fontSize: 12 }}>
        Select a request to view details
      </div>
    );
  }

  const config = sourceConfig[request.source];

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 20, color: config.color }}>{config.icon}</span>
          <span style={{ fontSize: 16, fontWeight: 500 }}>{config.label}</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.5)' }}>
          ID: {request.id} • Attestation: {request.attestationId}
        </div>
      </div>

      {/* Command */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Command
        </div>
        <div style={{
          padding: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: 4,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          color: '#ff5f57',
          wordBreak: 'break-all',
        }}>
          $ {request.command}
        </div>
      </div>

      {/* Blast Radius */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Blast Radius ({request.mutations.length} mutations)
        </div>
        <div style={{
          padding: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: 4,
        }}>
          {request.mutations.map((m, i) => (
            <div key={i} style={{ marginBottom: i < request.mutations.length - 1 ? 8 : 0, fontSize: 11 }}>
              <span style={{ color: '#ff5f57' }}>{m.action}</span>
              <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}> → </span>
              <span style={{ color: '#00d4ff' }}>{m.resource}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Assessment */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Risk Assessment
        </div>
        <div style={{
          padding: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: 4,
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          gap: '8px 16px',
          fontSize: 11,
        }}>
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Risk Level</span>
          <RiskBadge level={request.riskLevel} />
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Recoverability</span>
          <span style={{
            color: request.recoverability.tier >= 4 ? '#ff5f57' :
                   request.recoverability.tier >= 3 ? '#ffb800' : '#00ff66'
          }}>
            Tier {request.recoverability.tier}: {request.recoverability.label}
          </span>
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Resource Type</span>
          <span>{request.resource.type}</span>
          <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Identifier</span>
          <span style={{ color: '#00d4ff' }}>{request.resource.identifier}</span>
        </div>
      </div>

      {/* Attestation */}
      <div>
        <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Attestation
        </div>
        <div style={{
          padding: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: 4,
          fontSize: 11,
        }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>ID: </span>
            <span style={{ color: '#00d4ff' }}>{request.attestationId}</span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Verify: </span>
            <span style={{ color: '#00d4ff' }}>/.well-known/attestations/{request.attestationId}.json</span>
          </div>
          <div>
            <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Keys: </span>
            <span style={{ color: '#00d4ff' }}>/.well-known/recourse-keys.json</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsBar({ requests }: { requests: EvaluationRequest[] }) {
  const pending = requests.filter(r => r.status === 'pending').length;
  const approved = requests.filter(r => r.status === 'approved').length;
  const rejected = requests.filter(r => r.status === 'rejected').length;
  const sources = new Set(requests.map(r => r.source)).size;

  return (
    <div style={{
      display: 'flex',
      gap: 24,
      padding: '12px 24px',
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
      fontSize: 11,
    }}>
      <div>
        <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Pending: </span>
        <span style={{ color: pending > 0 ? '#ffb800' : 'rgba(232, 232, 232, 0.7)' }}>{pending}</span>
      </div>
      <div>
        <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Approved: </span>
        <span style={{ color: '#00ff66' }}>{approved}</span>
      </div>
      <div>
        <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Rejected: </span>
        <span style={{ color: '#ff5f57' }}>{rejected}</span>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <span style={{ color: 'rgba(232, 232, 232, 0.5)' }}>Sources: </span>
        <span style={{ color: '#00d4ff' }}>{sources}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export function Dashboard() {
  const [requests, setRequests] = useState<EvaluationRequest[]>(generateSampleRequests);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Source | 'all'>('all');

  // Simulate new requests coming in
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const sources: Source[] = ['claude-code', 'terraform-cloud', 'kubectl', 'github-actions', 'cli'];
        const source = sources[Math.floor(Math.random() * sources.length)];
        const newRequest = generateNewRequest(source);
        setRequests(prev => [newRequest, ...prev].slice(0, 10));
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = useCallback((id: string) => {
    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, status: 'approved' as Status } : r
    ));
  }, []);

  const handleReject = useCallback((id: string) => {
    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, status: 'rejected' as Status } : r
    ));
  }, []);

  const filteredRequests = filter === 'all'
    ? requests
    : requests.filter(r => r.source === filter);

  const selectedRequest = requests.find(r => r.id === selectedId) || null;

  return (
    <div style={{
      height: '100vh',
      backgroundColor: '#0a0a0a',
      color: '#e8e8e8',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 600, color: '#00ff66' }}>RecourseOS</span>
            <span style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.4)', marginLeft: 12 }}>
              Multi-Source Approval Dashboard
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            padding: '6px 12px',
            fontSize: 10,
            color: '#00ff66',
            border: '1px solid rgba(0, 255, 102, 0.3)',
            borderRadius: 3,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}>
            ● Live
          </span>
        </div>
      </header>

      {/* Stats */}
      <StatsBar requests={requests} />

      {/* Filter Bar */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
        display: 'flex',
        gap: 8,
      }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 12px',
            backgroundColor: filter === 'all' ? 'rgba(0, 255, 102, 0.15)' : 'transparent',
            border: `1px solid ${filter === 'all' ? '#00ff66' : 'rgba(232, 232, 232, 0.2)'}`,
            borderRadius: 3,
            color: filter === 'all' ? '#00ff66' : 'rgba(232, 232, 232, 0.6)',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          All Sources
        </button>
        {(Object.keys(sourceConfig) as Source[]).map(source => (
          <button
            key={source}
            onClick={() => setFilter(source)}
            style={{
              padding: '6px 12px',
              backgroundColor: filter === source ? `${sourceConfig[source].color}20` : 'transparent',
              border: `1px solid ${filter === source ? sourceConfig[source].color : 'rgba(232, 232, 232, 0.2)'}`,
              borderRadius: 3,
              color: filter === source ? sourceConfig[source].color : 'rgba(232, 232, 232, 0.6)',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{sourceConfig[source].icon}</span>
            <span>{sourceConfig[source].label}</span>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 400px', overflow: 'hidden' }}>
        {/* Request List */}
        <div style={{ overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredRequests.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'rgba(232, 232, 232, 0.4)' }}>
                No requests from this source
              </div>
            ) : (
              filteredRequests.map(request => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onApprove={() => handleApprove(request.id)}
                  onReject={() => handleReject(request.id)}
                  onSelect={() => setSelectedId(request.id)}
                  isSelected={selectedId === request.id}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <div style={{
          borderLeft: '1px solid rgba(232, 232, 232, 0.1)',
          backgroundColor: 'rgba(0, 0, 0, 0.15)',
          overflow: 'auto',
        }}>
          <DetailPanel request={selectedRequest} />
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        padding: '12px 24px',
        borderTop: '1px solid rgba(232, 232, 232, 0.1)',
        textAlign: 'center',
        fontSize: 11,
        color: 'rgba(232, 232, 232, 0.4)',
      }}>
        Real infrastructure. Real agent. Real protection.
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function generateNewRequest(source: Source): EvaluationRequest {
  const commands: Record<Source, { cmd: string; resource: any; mutations: any[] }> = {
    'claude-code': {
      cmd: 'aws dynamodb delete-table --table-name user-sessions',
      resource: { type: 'aws_dynamodb_table', identifier: 'user-sessions' },
      mutations: [{ action: 'DELETE', resource: 'aws_dynamodb_table.user-sessions' }],
    },
    'terraform-cloud': {
      cmd: 'terraform apply (modify 2 resources)',
      resource: { type: 'aws_security_group', identifier: 'allow-all-ingress' },
      mutations: [
        { action: 'MODIFY', resource: 'aws_security_group.allow-all-ingress' },
        { action: 'MODIFY', resource: 'aws_security_group_rule.allow-all' },
      ],
    },
    'kubectl': {
      cmd: 'kubectl delete pvc data-volume -n production',
      resource: { type: 'kubernetes_pvc', identifier: 'production/data-volume' },
      mutations: [{ action: 'DELETE', resource: 'pvc/data-volume' }],
    },
    'github-actions': {
      cmd: 'terraform destroy -target=aws_lambda_function.processor',
      resource: { type: 'aws_lambda_function', identifier: 'processor' },
      mutations: [{ action: 'DELETE', resource: 'aws_lambda_function.processor' }],
    },
    'cli': {
      cmd: 'rm -rf /var/data/backups/*',
      resource: { type: 'filesystem', identifier: '/var/data/backups' },
      mutations: [{ action: 'DELETE', resource: 'filesystem./var/data/backups/*' }],
    },
  };

  const config = commands[source];

  return {
    id: 'eval-' + Math.random().toString(16).slice(2, 8),
    source,
    sourceDetails: {
      agent: source === 'claude-code' ? 'claude-opus-4' : undefined,
      workspace: source === 'terraform-cloud' ? 'staging-eu-west' : undefined,
      runId: source === 'terraform-cloud' ? 'run-' + Math.random().toString(16).slice(2, 8) : undefined,
      user: source === 'kubectl' ? 'ci-bot' : undefined,
      workflow: source === 'github-actions' ? 'cleanup-resources' : undefined,
      repo: source === 'github-actions' ? 'acme/infrastructure' : undefined,
    },
    command: config.cmd,
    timestamp: new Date(),
    decision: 'escalate',
    status: 'pending',
    riskLevel: ['MEDIUM', 'HIGH', 'CRITICAL'][Math.floor(Math.random() * 3)] as any,
    recoverability: { tier: Math.floor(Math.random() * 3) + 2, label: ['RECOVERABLE_WITH_EFFORT', 'RECOVERABLE_FROM_BACKUP', 'UNRECOVERABLE'][Math.floor(Math.random() * 3)] },
    resource: config.resource,
    mutations: config.mutations,
    reason: 'Action requires human approval before execution',
    attestationId: 'att-' + Math.random().toString(16).slice(2, 8),
  };
}

export default Dashboard;
