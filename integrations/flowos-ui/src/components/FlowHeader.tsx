import * as React from 'react';
import type { NodeStatusType } from './NodeStatus';

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface FlowHeaderProps {
  /** Flow/DAG name */
  flowName: string;
  /** Current run ID */
  runId?: string | number;
  /** Run status */
  runStatus: RunStatus;
  /** Nodes summary for progress */
  nodes?: Array<{ status: NodeStatusType }>;
  /** Called when re-run is clicked */
  onRerun?: () => void;
  /** Called when export is clicked */
  onExport?: () => void;
  /** Called when settings is clicked */
  onSettings?: () => void;
  /** Additional class name */
  className?: string;
}

const statusConfig: Record<RunStatus, { color: string; label: string; icon: string }> = {
  idle: { color: 'text-gray-500', label: 'Idle', icon: '○' },
  running: { color: 'text-blue-500', label: 'Running', icon: '●' },
  paused: { color: 'text-amber-500', label: 'Paused', icon: '⏸' },
  completed: { color: 'text-green-500', label: 'Completed', icon: '✓' },
  failed: { color: 'text-red-500', label: 'Failed', icon: '✗' },
};

export function FlowHeader({
  flowName,
  runId,
  runStatus,
  nodes = [],
  onRerun,
  onExport,
  onSettings,
  className = '',
}: FlowHeaderProps) {
  const status = statusConfig[runStatus];

  // Calculate progress
  const completed = nodes.filter(n => n.status === 'completed').length;
  const total = nodes.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <header
      className={`
        flex items-center justify-between px-4 py-3
        border-b border-gray-200 dark:border-gray-800
        bg-white dark:bg-gray-900
        ${className}
      `}
    >
      {/* Left: Logo + Flow name */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">⬡</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">FlowOS</span>
        </div>

        {runId && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span>Run: #{runId}</span>
            <span className={`flex items-center gap-1 ${status.color}`}>
              <span className={runStatus === 'running' ? 'animate-pulse' : ''}>
                {status.icon}
              </span>
              <span>{status.label}</span>
            </span>
          </div>
        )}
      </div>

      {/* Center: Progress bar (when running) */}
      {runStatus === 'running' && total > 0 && (
        <div className="flex-1 max-w-xs mx-8">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {completed}/{total}
            </span>
          </div>
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {onRerun && (
          <button
            onClick={onRerun}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
          >
            Re-run
          </button>
        )}
        {onExport && (
          <button
            onClick={onExport}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
          >
            Export
          </button>
        )}
        {onSettings && (
          <button
            onClick={onSettings}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
