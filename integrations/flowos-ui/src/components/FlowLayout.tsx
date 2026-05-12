import * as React from 'react';
import { FlowHeader, type RunStatus } from './FlowHeader';
import { DagCanvas, type DagNodeDef } from './DagCanvas';
import { EventLog, type LogEvent } from './EventLog';
import { ConsequenceDrawer, type ConsequenceReport, type MutationIntent } from './ConsequenceDrawer';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNode extends DagNodeDef {
  /** Mutation intent if this node has a consequence gate */
  mutationIntent?: MutationIntent;
  /** Consequence report from RecourseOS */
  consequenceReport?: ConsequenceReport;
}

export interface FlowLayoutProps {
  /** Flow/DAG name */
  flowName: string;
  /** Current run ID */
  runId?: string | number;
  /** Run status */
  runStatus: RunStatus;
  /** Node definitions */
  nodes: FlowNode[];
  /** Event log */
  events: LogEvent[];
  /** Currently selected node ID */
  selectedNodeId?: string | null;
  /** Called when a node is selected */
  onNodeSelect?: (nodeId: string | null) => void;
  /** Called when approve is clicked */
  onApprove?: (nodeId: string) => void;
  /** Called when reject is clicked */
  onReject?: (nodeId: string) => void;
  /** Called when re-run is clicked */
  onRerun?: () => void;
  /** Called when export is clicked */
  onExport?: () => void;
  /** Called when settings is clicked */
  onSettings?: () => void;
  /** Show event log */
  showEventLog?: boolean;
  /** Show minimap on canvas */
  showMinimap?: boolean;
  /** Loading state for drawer buttons */
  loading?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout Component
// ─────────────────────────────────────────────────────────────────────────────

export function FlowLayout({
  flowName,
  runId,
  runStatus,
  nodes,
  events,
  selectedNodeId,
  onNodeSelect,
  onApprove,
  onReject,
  onRerun,
  onExport,
  onSettings,
  showEventLog = true,
  showMinimap = false,
  loading = false,
}: FlowLayoutProps) {
  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const hasDrawerContent = selectedNode?.consequenceReport || selectedNode?.status === 'waiting';

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950">
      {/* Header */}
      <FlowHeader
        flowName={flowName}
        runId={runId}
        runStatus={runStatus}
        nodes={nodes}
        onRerun={onRerun}
        onExport={onExport}
        onSettings={onSettings}
      />

      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative">
          <DagCanvas
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onNodeClick={(nodeId) => onNodeSelect?.(nodeId)}
            showMinimap={showMinimap}
            className="absolute inset-0"
          />
        </div>

        {/* Drawer */}
        <div
          className={`
            w-96 border-l border-gray-200 dark:border-gray-800
            bg-white dark:bg-gray-900
            transition-all duration-300
            ${selectedNodeId ? 'translate-x-0' : 'translate-x-full w-0 border-l-0'}
          `}
        >
          {selectedNode && (
            <>
              {selectedNode.consequenceReport ? (
                <ConsequenceDrawer
                  nodeId={selectedNode.id}
                  nodeName={selectedNode.name || selectedNode.id}
                  intent={selectedNode.mutationIntent || { source: 'unknown' }}
                  report={selectedNode.consequenceReport}
                  onApprove={() => onApprove?.(selectedNode.id)}
                  onReject={() => onReject?.(selectedNode.id)}
                  loading={loading}
                  className="h-full"
                />
              ) : (
                <NodeDetailsPanel
                  node={selectedNode}
                  onClose={() => onNodeSelect?.(null)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Event Log */}
      {showEventLog && (
        <EventLog
          events={events}
          maxHeight={160}
          onEventClick={(event) => {
            if (event.nodeId) {
              onNodeSelect?.(event.nodeId);
            }
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Details Panel (for nodes without consequence gates)
// ─────────────────────────────────────────────────────────────────────────────

interface NodeDetailsPanelProps {
  node: FlowNode;
  onClose: () => void;
}

function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {node.name || node.id}
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Status
            </label>
            <div className="mt-1 text-sm text-gray-900 dark:text-gray-100 capitalize">
              {node.status}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Node ID
            </label>
            <div className="mt-1 text-sm font-mono text-gray-900 dark:text-gray-100">
              {node.id}
            </div>
          </div>

          {node.dependsOn && node.dependsOn.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Dependencies
              </label>
              <div className="mt-1 space-y-1">
                {node.dependsOn.map(dep => (
                  <div key={dep} className="text-sm font-mono text-gray-600 dark:text-gray-300">
                    → {dep}
                  </div>
                ))}
              </div>
            </div>
          )}

          {node.hasConsequenceGate && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <span>⚡</span>
                <span className="text-sm font-medium">Consequence Gate</span>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400/80 mt-1">
                This node will be evaluated by RecourseOS before execution.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
