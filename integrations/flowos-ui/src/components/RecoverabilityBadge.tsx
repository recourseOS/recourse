import * as React from 'react';

export type RecoverabilityTier =
  | 'reversible'
  | 'recoverable-with-effort'
  | 'recoverable-from-backup'
  | 'unrecoverable'
  | 'needs-review'
  | 'unknown';

export interface RecoverabilityBadgeProps {
  tier: RecoverabilityTier | string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

const tierConfig: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  'reversible': {
    color: 'text-green-700 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    icon: '↩',
    label: 'Reversible',
  },
  'recoverable-with-effort': {
    color: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    icon: '⚙',
    label: 'Recoverable',
  },
  'recoverable-from-backup': {
    color: 'text-orange-700 dark:text-orange-400',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    icon: '💾',
    label: 'From Backup',
  },
  'unrecoverable': {
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30',
    icon: '⛔',
    label: 'Unrecoverable',
  },
  'needs-review': {
    color: 'text-purple-700 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    icon: '👁',
    label: 'Needs Review',
  },
  'unknown': {
    color: 'text-gray-700 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
    icon: '?',
    label: 'Unknown',
  },
};

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-1',
  lg: 'text-base px-3 py-1.5',
};

export function RecoverabilityBadge({
  tier,
  size = 'md',
  showIcon = true,
}: RecoverabilityBadgeProps) {
  const config = tierConfig[tier] || tierConfig['unknown'];

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-md font-medium
        ${config.bg} ${config.color} ${sizeClasses[size]}
      `}
    >
      {showIcon && <span>{config.icon}</span>}
      <span>{config.label}</span>
    </span>
  );
}
