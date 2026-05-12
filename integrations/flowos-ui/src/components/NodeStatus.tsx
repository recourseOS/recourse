import * as React from 'react';

export type NodeStatusType =
  | 'pending'
  | 'running'
  | 'waiting'      // Approval gate
  | 'blocked'      // Waiting for upstream
  | 'completed'
  | 'failed'
  | 'skipped';

export interface NodeStatusProps {
  status: NodeStatusType;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const statusConfig: Record<NodeStatusType, {
  icon: string;
  color: string;
  bg: string;
  label: string;
  animate?: string;
}> = {
  pending: {
    icon: '○',
    color: 'text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
    label: 'Pending',
  },
  running: {
    icon: '▶',
    color: 'text-blue-500',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Running',
    animate: 'animate-pulse',
  },
  waiting: {
    icon: '⏸',
    color: 'text-amber-500',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'Waiting',
    animate: 'animate-pulse',
  },
  blocked: {
    icon: '○',
    color: 'text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
    label: 'Blocked',
  },
  completed: {
    icon: '✓',
    color: 'text-green-500',
    bg: 'bg-green-100 dark:bg-green-900/30',
    label: 'Done',
  },
  failed: {
    icon: '✗',
    color: 'text-red-500',
    bg: 'bg-red-100 dark:bg-red-900/30',
    label: 'Failed',
  },
  skipped: {
    icon: '–',
    color: 'text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
    label: 'Skipped',
  },
};

const sizeClasses = {
  sm: { wrapper: 'w-4 h-4 text-xs', icon: 'text-[10px]' },
  md: { wrapper: 'w-5 h-5 text-sm', icon: 'text-xs' },
  lg: { wrapper: 'w-6 h-6 text-base', icon: 'text-sm' },
};

export function NodeStatusIcon({ status, size = 'md' }: NodeStatusProps) {
  const config = statusConfig[status];
  const sizes = sizeClasses[size];

  return (
    <span
      className={`
        inline-flex items-center justify-center rounded-full
        ${config.bg} ${config.color} ${sizes.wrapper}
        ${config.animate || ''}
      `}
      title={config.label}
    >
      <span className={sizes.icon}>{config.icon}</span>
    </span>
  );
}

export function NodeStatusBadge({ status, size = 'md', showLabel = true }: NodeStatusProps) {
  const config = statusConfig[status];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full px-2 py-0.5
        ${config.bg} ${config.color} ${config.animate || ''}
        text-${size === 'sm' ? 'xs' : size === 'md' ? 'sm' : 'base'}
      `}
    >
      <span>{config.icon}</span>
      {showLabel && <span className="font-medium">{config.label}</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAG Node Component (for the canvas)
// ─────────────────────────────────────────────────────────────────────────────

export interface DagNodeProps {
  id: string;
  name: string;
  status: NodeStatusType;
  selected?: boolean;
  onClick?: () => void;
  hasConsequenceGate?: boolean;
}

export function DagNode({
  id,
  name,
  status,
  selected = false,
  onClick,
  hasConsequenceGate = false,
}: DagNodeProps) {
  const config = statusConfig[status];

  return (
    <button
      onClick={onClick}
      className={`
        relative group w-32 p-3 rounded-lg border-2 transition-all
        ${selected
          ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }
        bg-white dark:bg-gray-900
      `}
    >
      {/* Consequence gate indicator */}
      {hasConsequenceGate && (
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[10px] text-white">
          ⚡
        </div>
      )}

      {/* Node content */}
      <div className="text-center">
        <div className="font-mono text-sm truncate text-gray-900 dark:text-gray-100 mb-2">
          {name}
        </div>
        <div className={`flex items-center justify-center gap-1 text-xs ${config.color}`}>
          <span className={config.animate || ''}>{config.icon}</span>
          <span>{config.label.toLowerCase()}</span>
        </div>
      </div>
    </button>
  );
}
