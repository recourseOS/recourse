/**
 * FlowOS + RecourseOS Integration Demo
 *
 * This example shows how the consequence drawer integrates with a DAG workflow.
 * The layout matches the FlowOS UI spec:
 *
 * ┌─────────────────────────────────────────┬─────────────────────────────┐
 * │           GRAPH CANVAS                  │      NODE DRAWER            │
 * │                                         │                             │
 * │   ┌──────────┐     ┌──────────┐        │   [ConsequenceDrawer]       │
 * │   │fetch_data│────▶│ validate │        │                             │
 * │   │ ✓ done   │     │ ✓ done   │        │   - Mutation Intent         │
 * │   └──────────┘     └──────────┘        │   - Risk Assessment         │
 * │                         │              │   - Affected Resources      │
 * │                         ▼              │   - Cost & Performance      │
 * │                  ┌──────────┐          │                             │
 * │                  │write_to_db│         │   [APPROVE] [REJECT]        │
 * │                  │ ⏸ waiting│◀─────────│                             │
 * │                  └──────────┘          │                             │
 * └─────────────────────────────────────────┴─────────────────────────────┘
 */

import * as React from 'react';
import {
  ConsequenceDrawer,
  DagNode,
  type ConsequenceReport,
  type NodeStatusType,
} from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────────────────────────────────────

interface DagNodeData {
  id: string;
  name: string;
  status: NodeStatusType;
  hasConsequenceGate?: boolean;
  consequenceReport?: ConsequenceReport;
}

const mockNodes: DagNodeData[] = [
  { id: 'fetch_data', name: 'fetch_data', status: 'completed' },
  { id: 'validate_schema', name: 'validate_schema', status: 'completed' },
  {
    id: 'write_to_db',
    name: 'write_to_db',
    status: 'waiting',
    hasConsequenceGate: true,
    consequenceReport: {
      decision: 'escalate',
      reason: 'This operation will modify production database records. The DELETE statement affects the users table which contains customer PII. Recovery would require restoring from the most recent backup.',
      permitted: false,
      approvalRequested: true,
      summary: {
        totalMutations: 1,
        worstRecoverability: { tier: 3, label: 'recoverable-from-backup' },
        needsReview: true,
        hasUnrecoverable: false,
      },
      mutations: [
        {
          target: {
            service: 'postgresql',
            type: 'table',
            id: 'public.users',
          },
          action: 'delete',
          recoverability: {
            tier: 3,
            label: 'recoverable-from-backup',
            reasoning: 'DELETE FROM users WHERE last_login < 2024-01-01 will remove rows from the users table. This data can be recovered from the daily backup taken at 03:00 UTC, but any changes since then would be lost.',
          },
        },
      ],
      costEstimate: { monthlyCost: 0, currency: 'USD' },
      timing: { totalMs: 45, evaluationMs: 42 },
    },
  },
  { id: 'notify', name: 'notify', status: 'blocked' },
];

const mockIntent = {
  source: 'shell',
  command: 'psql -c "DELETE FROM users WHERE last_login < \'2024-01-01\'"',
};

// ─────────────────────────────────────────────────────────────────────────────
// Demo Component
// ─────────────────────────────────────────────────────────────────────────────

export function FlowOSDemo() {
  const [nodes, setNodes] = React.useState(mockNodes);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>('write_to_db');
  const [loading, setLoading] = React.useState(false);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const handleApprove = async () => {
    if (!selectedNodeId) return;

    setLoading(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update node statuses
    setNodes(prev => prev.map(node => {
      if (node.id === selectedNodeId) {
        return { ...node, status: 'running' as NodeStatusType };
      }
      if (node.id === 'notify') {
        return { ...node, status: 'pending' as NodeStatusType };
      }
      return node;
    }));

    // Simulate completion
    setTimeout(() => {
      setNodes(prev => prev.map(node => {
        if (node.id === selectedNodeId) {
          return { ...node, status: 'completed' as NodeStatusType };
        }
        if (node.id === 'notify') {
          return { ...node, status: 'running' as NodeStatusType };
        }
        return node;
      }));
    }, 1500);

    setLoading(false);
    setSelectedNodeId(null);
  };

  const handleReject = async () => {
    if (!selectedNodeId) return;

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    setNodes(prev => prev.map(node => {
      if (node.id === selectedNodeId) {
        return { ...node, status: 'failed' as NodeStatusType };
      }
      if (node.id === 'notify') {
        return { ...node, status: 'skipped' as NodeStatusType };
      }
      return node;
    }));

    setLoading(false);
    setSelectedNodeId(null);
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-950">
      {/* Graph Canvas */}
      <div className="flex-1 p-8 overflow-auto">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            FlowOS + RecourseOS Demo
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click on a node to view details. The write_to_db node requires approval.
          </p>
        </div>

        {/* Simple DAG layout */}
        <div className="flex flex-col items-center gap-4">
          {/* Row 1 */}
          <div className="flex gap-8">
            <DagNode
              id="fetch_data"
              name="fetch_data"
              status={nodes[0].status}
              selected={selectedNodeId === 'fetch_data'}
              onClick={() => setSelectedNodeId('fetch_data')}
            />
            <div className="flex items-center text-gray-400">→</div>
            <DagNode
              id="validate_schema"
              name="validate_schema"
              status={nodes[1].status}
              selected={selectedNodeId === 'validate_schema'}
              onClick={() => setSelectedNodeId('validate_schema')}
            />
          </div>

          {/* Arrow down */}
          <div className="text-gray-400 text-2xl">↓</div>

          {/* Row 2 */}
          <DagNode
            id="write_to_db"
            name="write_to_db"
            status={nodes[2].status}
            selected={selectedNodeId === 'write_to_db'}
            onClick={() => setSelectedNodeId('write_to_db')}
            hasConsequenceGate={nodes[2].hasConsequenceGate}
          />

          {/* Arrow down */}
          <div className="text-gray-400 text-2xl">↓</div>

          {/* Row 3 */}
          <DagNode
            id="notify"
            name="notify"
            status={nodes[3].status}
            selected={selectedNodeId === 'notify'}
            onClick={() => setSelectedNodeId('notify')}
          />
        </div>
      </div>

      {/* Node Drawer */}
      <div className="w-96 border-l border-gray-200 dark:border-gray-800">
        {selectedNode?.consequenceReport ? (
          <ConsequenceDrawer
            nodeId={selectedNode.id}
            nodeName={selectedNode.name}
            intent={mockIntent}
            report={selectedNode.consequenceReport}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={loading}
          />
        ) : selectedNode ? (
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {selectedNode.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Status: {selectedNode.status}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              This node does not have a consequence gate.
            </p>
          </div>
        ) : (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400">
            Select a node to view details
          </div>
        )}
      </div>
    </div>
  );
}

export default FlowOSDemo;
