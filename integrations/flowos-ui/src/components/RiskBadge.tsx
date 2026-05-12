import * as React from 'react';

export type RiskDecision = 'allow' | 'warn' | 'escalate' | 'block';

export interface RiskBadgeProps {
  decision: RiskDecision;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}

const decisionConfig: Record<RiskDecision, { color: string; bg: string; icon: string; label: string }> = {
  'allow': {
    color: 'text-green-700 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800',
    icon: '✓',
    label: 'ALLOW',
  },
  'warn': {
    color: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800',
    icon: '⚠',
    label: 'WARN',
  },
  'escalate': {
    color: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800',
    icon: '🖐',
    label: 'ESCALATE',
  },
  'block': {
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800',
    icon: '⛔',
    label: 'BLOCK',
  },
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1',
  lg: 'text-base px-4 py-1.5',
};

export function RiskBadge({
  decision,
  size = 'md',
  pulse = false,
}: RiskBadgeProps) {
  const config = decisionConfig[decision];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-semibold border
        ${config.bg} ${config.color} ${sizeClasses[size]}
        ${pulse ? 'animate-pulse' : ''}
      `}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}
