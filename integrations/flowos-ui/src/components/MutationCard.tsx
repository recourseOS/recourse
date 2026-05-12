import * as React from 'react';
import { RecoverabilityBadge } from './RecoverabilityBadge';

export interface MutationInfo {
  target: {
    service?: string;
    type: string;
    id?: string;
  };
  action: string;
  recoverability: {
    tier: number;
    label: string;
    reasoning?: string;
  };
}

export interface MutationCardProps {
  mutation: MutationInfo;
  expanded?: boolean;
  onToggle?: () => void;
}

const actionIcons: Record<string, string> = {
  'create': '➕',
  'update': '✏️',
  'delete': '🗑️',
  'replace': '🔄',
  'read': '👁️',
};

export function MutationCard({
  mutation,
  expanded = false,
  onToggle,
}: MutationCardProps) {
  const { target, action, recoverability } = mutation;
  const icon = actionIcons[action] || '•';

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg flex-shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="font-mono text-sm truncate text-gray-900 dark:text-gray-100">
              {target.id || target.type}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {target.service && <span>{target.service} · </span>}
              <span className="capitalize">{action}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <RecoverabilityBadge tier={recoverability.label} size="sm" />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && recoverability.reasoning && (
        <div className="px-4 pb-4 pt-0">
          <div className="pl-9 border-l-2 border-gray-200 dark:border-gray-700 ml-2">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {recoverability.reasoning}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export interface MutationListProps {
  mutations: MutationInfo[];
  maxVisible?: number;
}

export function MutationList({ mutations, maxVisible = 5 }: MutationListProps) {
  const [expandedIndex, setExpandedIndex] = React.useState<number | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visibleMutations = showAll ? mutations : mutations.slice(0, maxVisible);
  const hiddenCount = mutations.length - maxVisible;

  return (
    <div className="space-y-2">
      {visibleMutations.map((mutation, index) => (
        <MutationCard
          key={index}
          mutation={mutation}
          expanded={expandedIndex === index}
          onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
        />
      ))}

      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          + {hiddenCount} more mutation{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
