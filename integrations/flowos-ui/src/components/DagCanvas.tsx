import * as React from 'react';
import { DagNode, type NodeStatusType } from './NodeStatus';
import { DagEdge, edgeAnimationStyles } from './DagEdge';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DagNodeDef {
  id: string;
  name?: string;
  status: NodeStatusType;
  /** IDs of nodes that this node depends on (incoming edges) */
  dependsOn?: string[];
  /** Whether this node has a RecourseOS consequence gate */
  hasConsequenceGate?: boolean;
  /** Custom position override (optional) */
  position?: { x: number; y: number };
}

export interface DagCanvasProps {
  /** Node definitions */
  nodes: DagNodeDef[];
  /** Currently selected node ID */
  selectedNodeId?: string | null;
  /** Called when a node is clicked */
  onNodeClick?: (nodeId: string) => void;
  /** Canvas width */
  width?: number;
  /** Canvas height */
  height?: number;
  /** Node width for layout */
  nodeWidth?: number;
  /** Node height for layout */
  nodeHeight?: number;
  /** Horizontal gap between nodes */
  horizontalGap?: number;
  /** Vertical gap between levels */
  verticalGap?: number;
  /** Show minimap */
  showMinimap?: boolean;
  /** Canvas background color */
  backgroundColor?: string;
  /** Additional class name */
  className?: string;
}

interface LayoutNode extends DagNodeDef {
  x: number;
  y: number;
  level: number;
  indexInLevel: number;
}

interface Edge {
  from: string;
  to: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout Algorithm
// ─────────────────────────────────────────────────────────────────────────────

function computeLayout(
  nodes: DagNodeDef[],
  nodeWidth: number,
  nodeHeight: number,
  horizontalGap: number,
  verticalGap: number,
): { layoutNodes: LayoutNode[]; edges: Edge[]; width: number; height: number } {
  const nodeMap = new Map<string, DagNodeDef>(nodes.map(n => [n.id, n]));
  const edges: Edge[] = [];

  // Build edges from dependsOn
  for (const node of nodes) {
    if (node.dependsOn) {
      for (const depId of node.dependsOn) {
        edges.push({ from: depId, to: node.id });
      }
    }
  }

  // Compute levels using topological sort
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  function computeLevel(nodeId: string): number {
    if (levels.has(nodeId)) return levels.get(nodeId)!;
    if (visited.has(nodeId)) return 0; // Cycle detection

    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return 0;

    let maxDepLevel = -1;
    if (node.dependsOn) {
      for (const depId of node.dependsOn) {
        maxDepLevel = Math.max(maxDepLevel, computeLevel(depId));
      }
    }

    const level = maxDepLevel + 1;
    levels.set(nodeId, level);
    return level;
  }

  // Compute level for each node
  for (const node of nodes) {
    computeLevel(node.id);
  }

  // Group nodes by level
  const levelGroups = new Map<number, string[]>();
  for (const [nodeId, level] of levels) {
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(nodeId);
  }

  // Compute positions
  const layoutNodes: LayoutNode[] = [];
  const maxLevel = Math.max(...levels.values(), 0);
  let maxWidth = 0;

  for (let level = 0; level <= maxLevel; level++) {
    const nodesAtLevel = levelGroups.get(level) || [];
    const levelWidth = nodesAtLevel.length * (nodeWidth + horizontalGap) - horizontalGap;
    maxWidth = Math.max(maxWidth, levelWidth);
  }

  const padding = 60;

  for (let level = 0; level <= maxLevel; level++) {
    const nodesAtLevel = levelGroups.get(level) || [];
    const levelWidth = nodesAtLevel.length * (nodeWidth + horizontalGap) - horizontalGap;
    const startX = (maxWidth - levelWidth) / 2 + padding;

    nodesAtLevel.forEach((nodeId, index) => {
      const node = nodeMap.get(nodeId)!;
      layoutNodes.push({
        ...node,
        x: node.position?.x ?? startX + index * (nodeWidth + horizontalGap),
        y: node.position?.y ?? padding + level * (nodeHeight + verticalGap),
        level,
        indexInLevel: index,
      });
    });
  }

  const totalWidth = maxWidth + padding * 2;
  const totalHeight = (maxLevel + 1) * (nodeHeight + verticalGap) - verticalGap + padding * 2;

  return { layoutNodes, edges, width: totalWidth, height: totalHeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Component
// ─────────────────────────────────────────────────────────────────────────────

export function DagCanvas({
  nodes,
  selectedNodeId,
  onNodeClick,
  width: propWidth,
  height: propHeight,
  nodeWidth = 140,
  nodeHeight = 72,
  horizontalGap = 40,
  verticalGap = 60,
  showMinimap = false,
  backgroundColor,
  className = '',
}: DagCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [panStart, setPanStart] = React.useState({ x: 0, y: 0 });

  // Compute layout
  const { layoutNodes, edges, width: computedWidth, height: computedHeight } = React.useMemo(
    () => computeLayout(nodes, nodeWidth, nodeHeight, horizontalGap, verticalGap),
    [nodes, nodeWidth, nodeHeight, horizontalGap, verticalGap]
  );

  const canvasWidth = propWidth || computedWidth;
  const canvasHeight = propHeight || computedHeight;

  // Create node position map for edge drawing
  const nodePositions = React.useMemo(() => {
    const map = new Map<string, { x: number; y: number; status: NodeStatusType }>();
    for (const node of layoutNodes) {
      map.set(node.id, {
        x: node.x + nodeWidth / 2,
        y: node.y + nodeHeight / 2,
        status: node.status,
      });
    }
    return map;
  }, [layoutNodes, nodeWidth, nodeHeight]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.25, Math.min(2, z * delta)));
    }
  };

  // Reset view
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden select-none ${className}`}
      style={{
        backgroundColor: backgroundColor || 'var(--canvas-bg, #f9fafb)',
        cursor: isPanning ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Inject animation styles */}
      <style>{edgeAnimationStyles}</style>

      {/* Grid background */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.5 }}
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-gray-300 dark:text-gray-700"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Zoomable/pannable container */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: canvasWidth,
          height: canvasHeight,
          position: 'relative',
        }}
      >
        {/* Edges layer (SVG) */}
        <svg
          width={canvasWidth}
          height={canvasHeight}
          className="absolute inset-0 pointer-events-none"
          style={{ overflow: 'visible' }}
        >
          {edges.map((edge, index) => {
            const fromPos = nodePositions.get(edge.from);
            const toPos = nodePositions.get(edge.to);
            if (!fromPos || !toPos) return null;

            const sourceStatus = fromPos.status;
            const isRunning = sourceStatus === 'running';

            return (
              <DagEdge
                key={`${edge.from}-${edge.to}-${index}`}
                from={{ x: fromPos.x, y: fromPos.y + nodeHeight / 2 }}
                to={{ x: toPos.x, y: toPos.y - nodeHeight / 2 - 8 }}
                sourceStatus={sourceStatus}
                animated={isRunning}
                variant={
                  selectedNodeId === edge.from || selectedNodeId === edge.to
                    ? 'highlighted'
                    : 'default'
                }
              />
            );
          })}
        </svg>

        {/* Nodes layer */}
        {layoutNodes.map(node => (
          <div
            key={node.id}
            className="absolute"
            style={{
              left: node.x,
              top: node.y,
              width: nodeWidth,
            }}
          >
            <DagNode
              id={node.id}
              name={node.name || node.id}
              status={node.status}
              selected={selectedNodeId === node.id}
              hasConsequenceGate={node.hasConsequenceGate}
              onClick={() => onNodeClick?.(node.id)}
            />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <button
          onClick={() => setZoom(z => Math.min(2, z * 1.2))}
          className="w-8 h-8 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom(z => Math.max(0.25, z / 1.2))}
          className="w-8 h-8 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="w-8 h-8 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Reset view"
        >
          ⟲
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Minimap */}
      {showMinimap && (
        <div className="absolute top-4 right-4 w-32 h-24 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-sm overflow-hidden">
          <svg
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            className="w-full h-full"
          >
            {edges.map((edge, index) => {
              const fromPos = nodePositions.get(edge.from);
              const toPos = nodePositions.get(edge.to);
              if (!fromPos || !toPos) return null;

              return (
                <line
                  key={`mini-${edge.from}-${edge.to}-${index}`}
                  x1={fromPos.x}
                  y1={fromPos.y}
                  x2={toPos.x}
                  y2={toPos.y}
                  stroke="#9ca3af"
                  strokeWidth="2"
                />
              );
            })}
            {layoutNodes.map(node => (
              <rect
                key={`mini-${node.id}`}
                x={node.x}
                y={node.y}
                width={nodeWidth}
                height={nodeHeight}
                rx="4"
                fill={
                  node.status === 'completed' ? '#22c55e' :
                  node.status === 'running' ? '#3b82f6' :
                  node.status === 'waiting' ? '#f59e0b' :
                  node.status === 'failed' ? '#ef4444' :
                  '#9ca3af'
                }
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
