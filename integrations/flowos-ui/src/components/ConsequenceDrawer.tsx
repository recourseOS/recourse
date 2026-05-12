import * as React from 'react';
import { RiskBadge, type RiskDecision } from './RiskBadge';
import { RecoverabilityBadge } from './RecoverabilityBadge';
import { MutationList, type MutationInfo } from './MutationCard';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors GateResult from runtime-router)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsequenceSummary {
  totalMutations: number;
  worstRecoverability: {
    tier: number;
    label: string;
  };
  needsReview: boolean;
  hasUnrecoverable: boolean;
}

export interface ConsequenceReport {
  decision: RiskDecision;
  reason: string;
  permitted: boolean;
  approvalRequested: boolean;
  summary: ConsequenceSummary;
  mutations: MutationInfo[];
  costEstimate?: {
    monthlyCost: number;
    currency: string;
  };
  timing?: {
    totalMs: number;
    evaluationMs: number;
  };
}

export interface MutationIntent {
  source: string;
  command?: string;
  tool?: string;
  target?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible Section
// ─────────────────────────────────────────────────────────────────────────────

interface CollapsibleProps {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Collapsible({ title, badge, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-900 dark:text-gray-100">{title}</span>
        </div>
        {badge}
      </button>
      {open && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Drawer Component
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsequenceDrawerProps {
  /** Node ID in the DAG */
  nodeId: string;
  /** Node display name */
  nodeName?: string;
  /** The mutation intent being evaluated */
  intent: MutationIntent;
  /** The consequence report from RecourseOS */
  report: ConsequenceReport;
  /** Called when user approves */
  onApprove: () => void;
  /** Called when user rejects */
  onReject: () => void;
  /** Whether buttons should be disabled (e.g., during submission) */
  loading?: boolean;
  /** Additional class names */
  className?: string;
}

export function ConsequenceDrawer({
  nodeId,
  nodeName,
  intent,
  report,
  onApprove,
  onReject,
  loading = false,
  className = '',
}: ConsequenceDrawerProps) {
  const { decision, reason, summary, mutations, costEstimate, timing } = report;

  const isBlocked = decision === 'block';
  const showApproveButton = !isBlocked && report.approvalRequested;

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}>
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {nodeName || nodeId}
          </h2>
          <RiskBadge decision={decision} pulse={decision === 'escalate'} />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Consequence verification • {decision === 'escalate' ? 'Awaiting approval' : decision}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Intent Section */}
        <Collapsible title="Mutation Intent" defaultOpen={true}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 dark:text-gray-400">Source:</span>
              <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-900 dark:text-gray-100">
                {intent.source}
              </code>
            </div>
            {intent.command && (
              <div className="mt-2">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Command:</div>
                <pre className="p-3 bg-gray-900 dark:bg-black rounded-lg text-sm text-green-400 overflow-x-auto font-mono">
                  {intent.command}
                </pre>
              </div>
            )}
            {intent.tool && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Tool:</span>
                <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                  {intent.tool}
                </code>
              </div>
            )}
          </div>
        </Collapsible>

        {/* Risk Assessment Section */}
        <Collapsible
          title="Risk Assessment"
          badge={<RecoverabilityBadge tier={summary.worstRecoverability.label} size="sm" />}
          defaultOpen={true}
        >
          <div className="space-y-4">
            {/* Reason */}
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {reason}
              </p>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {summary.totalMutations}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Total Mutations
                </div>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {summary.worstRecoverability.label.split('-')[0]}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Worst Recoverability
                </div>
              </div>
            </div>

            {/* Warnings */}
            {summary.hasUnrecoverable && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <span className="text-red-500">⛔</span>
                <div className="text-sm text-red-700 dark:text-red-400">
                  <strong>Unrecoverable changes detected.</strong> This action will cause permanent data loss.
                </div>
              </div>
            )}
            {summary.needsReview && !summary.hasUnrecoverable && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <span className="text-amber-500">🖐</span>
                <div className="text-sm text-amber-700 dark:text-amber-400">
                  <strong>Human review required.</strong> Please verify the consequences before proceeding.
                </div>
              </div>
            )}
          </div>
        </Collapsible>

        {/* Mutations Section */}
        <Collapsible
          title="Affected Resources"
          badge={
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {mutations.length} resource{mutations.length !== 1 ? 's' : ''}
            </span>
          }
          defaultOpen={mutations.length <= 3}
        >
          <MutationList mutations={mutations} maxVisible={5} />
        </Collapsible>

        {/* Cost & Timing Section */}
        {(costEstimate || timing) && (
          <Collapsible title="Cost & Performance">
            <div className="flex items-center gap-6 text-sm">
              {costEstimate && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Est. Monthly Cost: </span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    ${costEstimate.monthlyCost.toFixed(2)}
                  </span>
                </div>
              )}
              {timing && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Evaluation: </span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {timing.evaluationMs}ms
                  </span>
                </div>
              )}
            </div>
          </Collapsible>
        )}
      </div>

      {/* Footer with Actions */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        {isBlocked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <span>⛔</span>
              <span className="font-medium">Execution Blocked</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This action has been blocked due to unrecoverable consequences.
              The downstream nodes will not execute.
            </p>
            <button
              onClick={onReject}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Acknowledge & Continue
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {showApproveButton && (
              <button
                onClick={onApprove}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="animate-spin">◌</span>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Approve & Continue</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={onReject}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span>✗</span>
              <span>Reject & Stop Run</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
