import * as React from 'react';
import type { NodeStatusType } from './NodeStatus';

export interface DagEdgeProps {
  /** Starting position */
  from: { x: number; y: number };
  /** Ending position */
  to: { x: number; y: number };
  /** Status of the source node (affects edge color) */
  sourceStatus?: NodeStatusType;
  /** Whether this edge is animated (data flowing) */
  animated?: boolean;
  /** Edge style */
  variant?: 'default' | 'highlighted' | 'dimmed';
}

const statusColors: Record<NodeStatusType, string> = {
  completed: '#22c55e',  // green-500
  running: '#3b82f6',    // blue-500
  waiting: '#f59e0b',    // amber-500
  pending: '#9ca3af',    // gray-400
  blocked: '#9ca3af',    // gray-400
  failed: '#ef4444',     // red-500
  skipped: '#9ca3af',    // gray-400
};

export function DagEdge({
  from,
  to,
  sourceStatus = 'pending',
  animated = false,
  variant = 'default',
}: DagEdgeProps) {
  // Calculate control points for a smooth bezier curve
  const midY = (from.y + to.y) / 2;

  // Path for smooth vertical curve
  const path = `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;

  const color = statusColors[sourceStatus];
  const opacity = variant === 'dimmed' ? 0.3 : variant === 'highlighted' ? 1 : 0.6;
  const strokeWidth = variant === 'highlighted' ? 3 : 2;

  return (
    <g>
      {/* Background path for better visibility */}
      <path
        d={path}
        fill="none"
        stroke="white"
        strokeWidth={strokeWidth + 2}
        opacity={0.5}
      />

      {/* Main edge */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        strokeLinecap="round"
        className={animated ? 'animate-dash' : ''}
        style={animated ? {
          strokeDasharray: '8 4',
          animation: 'dash 0.5s linear infinite',
        } : undefined}
      />

      {/* Arrow head */}
      <polygon
        points={`${to.x},${to.y} ${to.x - 5},${to.y - 8} ${to.x + 5},${to.y - 8}`}
        fill={color}
        opacity={opacity}
      />
    </g>
  );
}

// CSS for animated dashes (add to your global styles)
export const edgeAnimationStyles = `
@keyframes dash {
  to {
    stroke-dashoffset: -12;
  }
}
.animate-dash {
  animation: dash 0.5s linear infinite;
}
`;
