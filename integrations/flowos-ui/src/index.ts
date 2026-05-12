/**
 * FlowOS UI Components for RecourseOS Integration
 *
 * React components for displaying consequence reports in FlowOS DAG workflows.
 *
 * @example Full Layout
 * ```tsx
 * import { FlowLayout } from '@recourse/flowos-ui';
 *
 * function App() {
 *   return (
 *     <FlowLayout
 *       flowName="data-pipeline"
 *       runId={42}
 *       runStatus="running"
 *       nodes={nodes}
 *       events={events}
 *       selectedNodeId={selectedId}
 *       onNodeSelect={setSelectedId}
 *       onApprove={handleApprove}
 *       onReject={handleReject}
 *     />
 *   );
 * }
 * ```
 *
 * @example Individual Components
 * ```tsx
 * import { DagCanvas, ConsequenceDrawer, EventLog } from '@recourse/flowos-ui';
 *
 * // Build your own layout with individual pieces
 * <div className="flex">
 *   <DagCanvas nodes={nodes} onNodeClick={handleClick} />
 *   <ConsequenceDrawer report={report} onApprove={...} onReject={...} />
 * </div>
 * <EventLog events={events} />
 * ```
 */

// Full layout component
export {
  FlowLayout,
  type FlowLayoutProps,
  type FlowNode,
} from './components/FlowLayout';

// Header component
export {
  FlowHeader,
  type FlowHeaderProps,
  type RunStatus,
} from './components/FlowHeader';

// DAG Canvas
export {
  DagCanvas,
  type DagCanvasProps,
  type DagNodeDef,
} from './components/DagCanvas';

// Edges
export {
  DagEdge,
  type DagEdgeProps,
  edgeAnimationStyles,
} from './components/DagEdge';

// Event log
export {
  EventLog,
  type EventLogProps,
  type LogEvent,
  type EventType,
} from './components/EventLog';

// Consequence drawer
export {
  ConsequenceDrawer,
  type ConsequenceDrawerProps,
  type ConsequenceReport,
  type ConsequenceSummary,
  type MutationIntent,
} from './components/ConsequenceDrawer';

// Risk and recoverability badges
export {
  RiskBadge,
  type RiskBadgeProps,
  type RiskDecision,
} from './components/RiskBadge';

export {
  RecoverabilityBadge,
  type RecoverabilityBadgeProps,
  type RecoverabilityTier,
} from './components/RecoverabilityBadge';

// Mutation display components
export {
  MutationCard,
  MutationList,
  type MutationCardProps,
  type MutationListProps,
  type MutationInfo,
} from './components/MutationCard';

// DAG node components
export {
  NodeStatusIcon,
  NodeStatusBadge,
  DagNode,
  type NodeStatusProps,
  type NodeStatusType,
  type DagNodeProps,
} from './components/NodeStatus';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime (RecourseOS + FlowOS integration layer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime exports for FlowOS + RecourseOS integration.
 *
 * Import from '@recourse/flowos-ui/runtime' for:
 * - RecourseNodeExecutor: Execute agent commands with RecourseOS interception
 * - FlowOSEventSink: Route RecourseOS events to FlowOS event log
 * - sinkRegistry: Global registry for routing approval decisions
 *
 * @example
 * ```ts
 * import { RecourseNodeExecutor, sinkRegistry } from '@recourse/flowos-ui/runtime';
 * ```
 */
export * from './runtime/index.js';
