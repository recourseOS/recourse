import * as React from 'react';

export type EventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_skipped'
  | 'node_output_produced'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'consequence_evaluated'
  | 'info'
  | 'warning'
  | 'error';

export interface LogEvent {
  id: string;
  timestamp: Date | string;
  type: EventType;
  nodeId?: string;
  message?: string;
  details?: string;
  artifacts?: string[];
}

export interface EventLogProps {
  events: LogEvent[];
  maxHeight?: number | string;
  onEventClick?: (event: LogEvent) => void;
  className?: string;
}

const eventConfig: Record<EventType, { icon: string; color: string; label: string }> = {
  run_started: { icon: '▶', color: 'text-blue-500', label: 'run_started' },
  run_completed: { icon: '✓', color: 'text-green-500', label: 'run_completed' },
  run_failed: { icon: '✗', color: 'text-red-500', label: 'run_failed' },
  node_started: { icon: '▶', color: 'text-blue-500', label: 'node_started' },
  node_completed: { icon: '✓', color: 'text-green-500', label: 'node_completed' },
  node_failed: { icon: '✗', color: 'text-red-500', label: 'node_failed' },
  node_skipped: { icon: '–', color: 'text-gray-400', label: 'node_skipped' },
  node_output_produced: { icon: '📦', color: 'text-purple-500', label: 'output_produced' },
  approval_requested: { icon: '🖐', color: 'text-amber-500', label: 'approval_requested' },
  approval_granted: { icon: '✓', color: 'text-green-500', label: 'approval_granted' },
  approval_denied: { icon: '✗', color: 'text-red-500', label: 'approval_denied' },
  consequence_evaluated: { icon: '⚡', color: 'text-amber-500', label: 'consequence_evaluated' },
  info: { icon: 'ℹ', color: 'text-blue-500', label: 'info' },
  warning: { icon: '⚠', color: 'text-amber-500', label: 'warning' },
  error: { icon: '⛔', color: 'text-red-500', label: 'error' },
};

function formatTimestamp(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function EventLog({
  events,
  maxHeight = 200,
  onEventClick,
  className = '',
}: EventLogProps) {
  const logRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  // Auto-scroll to bottom on new events
  React.useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 10;
    setAutoScroll(isAtBottom);
  };

  return (
    <div
      className={`border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Event Log
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {events.length} events
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="overflow-y-auto font-mono text-xs"
        style={{ maxHeight }}
      >
        {events.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
            No events yet
          </div>
        ) : (
          <table className="w-full">
            <tbody>
              {events.map((event) => {
                const config = eventConfig[event.type] || eventConfig.info;

                return (
                  <tr
                    key={event.id}
                    onClick={() => onEventClick?.(event)}
                    className={`
                      border-b border-gray-100 dark:border-gray-800 last:border-b-0
                      hover:bg-gray-100 dark:hover:bg-gray-800/50
                      ${onEventClick ? 'cursor-pointer' : ''}
                    `}
                  >
                    {/* Timestamp */}
                    <td className="px-4 py-1.5 text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </td>

                    {/* Event type */}
                    <td className={`px-2 py-1.5 whitespace-nowrap ${config.color}`}>
                      <span className="inline-flex items-center gap-1">
                        <span>{config.icon}</span>
                        <span>{config.label}</span>
                      </span>
                    </td>

                    {/* Node ID */}
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {event.nodeId || '—'}
                    </td>

                    {/* Message / Artifacts */}
                    <td className="px-4 py-1.5 text-gray-500 dark:text-gray-400 truncate max-w-xs">
                      {event.message && <span>{event.message}</span>}
                      {event.artifacts && event.artifacts.length > 0 && (
                        <span className="text-purple-500 dark:text-purple-400">
                          artifacts: [{event.artifacts.join(', ')}]
                        </span>
                      )}
                      {event.details && (
                        <span className="ml-2 text-gray-400">← {event.details}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && events.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (logRef.current) {
              logRef.current.scrollTop = logRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-2 right-4 px-2 py-1 text-xs bg-blue-500 text-white rounded shadow-lg hover:bg-blue-600"
        >
          ↓ New events
        </button>
      )}
    </div>
  );
}
