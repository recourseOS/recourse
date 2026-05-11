/**
 * Performance timing utilities for RecourseOS evaluations.
 *
 * Used to measure latency and enforce SLA targets.
 */

/**
 * SLA targets for different operation types (in milliseconds).
 *
 * These are p95 targets - 95% of evaluations should complete within these times.
 */
export const SLA_TARGETS = {
  /** Single resource evaluation without network calls */
  localEvaluation: 10,
  /** Single resource evaluation with AWS state lookup */
  remoteEvaluation: 500,
  /** Full plan evaluation (up to 50 resources) */
  planEvaluation: 2000,
  /** Shell command parsing and evaluation */
  shellEvaluation: 5,
  /** MCP tool call evaluation */
  mcpEvaluation: 10,
} as const;

export type SLATarget = keyof typeof SLA_TARGETS;

/**
 * Timing metrics for an evaluation.
 */
export interface EvaluationTiming {
  /** Total wall-clock time in milliseconds */
  totalMs: number;
  /** Time spent in parsing/preparation */
  parseMs?: number;
  /** Time spent in blast radius analysis */
  analysisMs?: number;
  /** Time spent in policy evaluation */
  policyMs?: number;
  /** Time spent waiting for remote state lookups */
  remoteMs?: number;
  /** Whether the evaluation met its SLA target */
  metSla: boolean;
  /** The SLA target used for comparison */
  slaTarget: SLATarget;
  /** The target time in milliseconds */
  slaTargetMs: number;
}

/**
 * Timer for tracking evaluation performance.
 */
export class EvaluationTimer {
  private startTime: number;
  private phases: Map<string, { start: number; end?: number }> = new Map();
  private slaTarget: SLATarget;

  constructor(slaTarget: SLATarget = 'localEvaluation') {
    this.startTime = performance.now();
    this.slaTarget = slaTarget;
  }

  /**
   * Start timing a phase.
   */
  startPhase(name: string): void {
    this.phases.set(name, { start: performance.now() });
  }

  /**
   * End timing a phase.
   */
  endPhase(name: string): number {
    const phase = this.phases.get(name);
    if (!phase) {
      return 0;
    }
    phase.end = performance.now();
    return phase.end - phase.start;
  }

  /**
   * Get the duration of a completed phase.
   */
  getPhaseMs(name: string): number | undefined {
    const phase = this.phases.get(name);
    if (!phase || phase.end === undefined) {
      return undefined;
    }
    return phase.end - phase.start;
  }

  /**
   * Set the SLA target for this evaluation.
   */
  setSlaTarget(target: SLATarget): void {
    this.slaTarget = target;
  }

  /**
   * Complete timing and return metrics.
   */
  finish(): EvaluationTiming {
    const totalMs = performance.now() - this.startTime;
    const slaTargetMs = SLA_TARGETS[this.slaTarget];

    return {
      totalMs: Math.round(totalMs * 100) / 100,
      parseMs: this.getPhaseMs('parse'),
      analysisMs: this.getPhaseMs('analysis'),
      policyMs: this.getPhaseMs('policy'),
      remoteMs: this.getPhaseMs('remote'),
      metSla: totalMs <= slaTargetMs,
      slaTarget: this.slaTarget,
      slaTargetMs,
    };
  }
}

/**
 * Format timing metrics for human-readable output.
 */
export function formatTiming(timing: EvaluationTiming): string {
  const status = timing.metSla ? '✓' : '⚠';
  const parts = [`${status} ${timing.totalMs.toFixed(1)}ms`];

  if (timing.parseMs !== undefined) {
    parts.push(`parse=${timing.parseMs.toFixed(1)}ms`);
  }
  if (timing.analysisMs !== undefined) {
    parts.push(`analysis=${timing.analysisMs.toFixed(1)}ms`);
  }
  if (timing.policyMs !== undefined) {
    parts.push(`policy=${timing.policyMs.toFixed(1)}ms`);
  }
  if (timing.remoteMs !== undefined) {
    parts.push(`remote=${timing.remoteMs.toFixed(1)}ms`);
  }

  parts.push(`(target: ${timing.slaTargetMs}ms ${timing.slaTarget})`);

  return parts.join(' | ');
}
