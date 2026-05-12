/**
 * RecourseOS Gate Client for Runtime Routers
 *
 * The router chooses the lane. RecourseOS guards the dangerous turns.
 *
 * Usage:
 *   const gate = new RecourseGate({ mode: 'gateway' });
 *
 *   // Before executing a mutation
 *   const result = await gate.evaluate({
 *     source: 'shell',
 *     command: 'aws s3 rm s3://prod-bucket --recursive'
 *   });
 *
 *   if (result.permitted) {
 *     // Execute the mutation
 *   } else {
 *     // Block or escalate to human
 *   }
 */

import type {
  GateConfig,
  GateResult,
  GateEvent,
  GateEventHandler,
  MutationIntent,
  RiskDecision,
  MutationAnalysis,
  ConsequenceSummary,
} from './types.js';

// Import core evaluators
import {
  evaluateTerraformPlanConsequences,
  evaluateShellCommandConsequences,
  evaluateMcpToolCallConsequences,
} from '../../../src/evaluator/index.js';
import { parsePlanJson } from '../../../src/parsers/plan.js';
import { parseStateJson } from '../../../src/parsers/state.js';
import type { ConsequenceReport } from '../../../src/core/index.js';

const DEFAULT_CONFIG: Required<Omit<GateConfig, 'apiUrl' | 'licenseKey' | 'actorId' | 'environment' | 'owner' | 'onEscalate'>> = {
  mode: 'gateway',
  escalateOn: ['escalate'],
  blockOn: ['block'],
  timeoutMs: 30000,
  requireAttestation: true,
};

export class RecourseGate {
  private config: GateConfig;
  private eventHandlers: GateEventHandler[] = [];

  constructor(config: Partial<GateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Advisory mode is more permissive by default
    if (this.config.mode === 'advisory') {
      this.config.escalateOn = config.escalateOn ?? [];
      this.config.blockOn = config.blockOn ?? ['block'];
      this.config.requireAttestation = config.requireAttestation ?? false;
    }

    // CI mode blocks on escalate too
    if (this.config.mode === 'ci') {
      this.config.blockOn = config.blockOn ?? ['escalate', 'block'];
    }
  }

  /**
   * Evaluate a mutation intent and return a gate decision.
   *
   * This is the main entry point for the router.
   */
  async evaluate(intent: MutationIntent): Promise<GateResult> {
    const startTime = Date.now();

    this.emit({
      type: 'mutation_detected',
      timestamp: new Date().toISOString(),
      intent,
    });

    this.emit({
      type: 'evaluation_started',
      timestamp: new Date().toISOString(),
      intent,
    });

    try {
      // Route to appropriate evaluator
      const report = await this.evaluateIntent(intent);
      const evaluationTime = Date.now() - startTime;

      // Map to gate result
      const result = this.mapReportToResult(report, intent, evaluationTime);

      this.emit({
        type: 'evaluation_completed',
        timestamp: new Date().toISOString(),
        intent,
        result,
      });

      // Handle escalation if needed
      if (result.approvalRequested && this.config.onEscalate) {
        this.emit({
          type: 'approval_requested',
          timestamp: new Date().toISOString(),
          intent,
          result,
        });

        const approved = await this.config.onEscalate(result);
        result.approved = approved;
        result.permitted = approved;

        this.emit({
          type: approved ? 'approval_granted' : 'approval_denied',
          timestamp: new Date().toISOString(),
          intent,
          result,
        });
      }

      // Final event
      this.emit({
        type: result.permitted ? 'execution_allowed' : 'execution_blocked',
        timestamp: new Date().toISOString(),
        intent,
        result,
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.emit({
        type: 'evaluation_completed',
        timestamp: new Date().toISOString(),
        intent,
        error: errorMessage,
      });

      // On evaluation failure, default behavior depends on mode
      if (this.config.mode === 'advisory') {
        // Advisory mode: warn but allow
        return {
          decision: 'warn',
          reason: `Evaluation failed: ${errorMessage}. Allowing in advisory mode.`,
          permitted: true,
          approvalRequested: false,
          summary: this.emptySummary(),
          mutations: [],
        };
      } else {
        // Gateway/CI mode: block on failure (fail-safe)
        return {
          decision: 'block',
          reason: `Evaluation failed: ${errorMessage}. Blocking in ${this.config.mode} mode.`,
          permitted: false,
          approvalRequested: false,
          summary: this.emptySummary(),
          mutations: [],
        };
      }
    }
  }

  /**
   * Quick check if an intent would be allowed without full evaluation.
   * Useful for UI hints before the user confirms an action.
   */
  async wouldAllow(intent: MutationIntent): Promise<{ likely: boolean; reason: string }> {
    try {
      const result = await this.evaluate(intent);
      return {
        likely: result.decision === 'allow' || result.decision === 'warn',
        reason: result.reason,
      };
    } catch {
      return {
        likely: this.config.mode === 'advisory',
        reason: 'Evaluation unavailable',
      };
    }
  }

  /**
   * Register an event handler for gate events.
   * Useful for logging, metrics, and UI updates.
   */
  on(handler: GateEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Update gate configuration at runtime.
   */
  configure(config: Partial<GateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): GateConfig {
    return { ...this.config };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async evaluateIntent(intent: MutationIntent): Promise<ConsequenceReport> {
    const adapterContext = {
      actorId: this.config.actorId,
      environment: this.config.environment,
      owner: this.config.owner,
    };

    switch (intent.source) {
      case 'terraform': {
        const plan = parsePlanJson(intent.planJson);
        const state = intent.stateJson ? parseStateJson(intent.stateJson) : null;
        return evaluateTerraformPlanConsequences(plan, state, { adapterContext });
      }

      case 'shell': {
        return evaluateShellCommandConsequences(
          { command: intent.command, cwd: intent.cwd },
          { adapterContext }
        );
      }

      case 'mcp': {
        return evaluateMcpToolCallConsequences(
          { server: intent.server, tool: intent.tool, arguments: intent.arguments },
          { adapterContext }
        );
      }

      case 'kubernetes': {
        // Map k8s operations to shell commands for now
        // TODO: Native k8s evaluator
        const cmd = this.kubernetesIntentToCommand(intent);
        return evaluateShellCommandConsequences({ command: cmd }, { adapterContext });
      }

      case 'docker': {
        // Map docker operations to shell commands
        const cmd = this.dockerIntentToCommand(intent);
        return evaluateShellCommandConsequences({ command: cmd }, { adapterContext });
      }

      case 'cloud-api': {
        // Map cloud API calls to MCP format
        return evaluateMcpToolCallConsequences(
          {
            server: intent.provider,
            tool: `${intent.service}.${intent.operation}`,
            arguments: intent.parameters,
          },
          { adapterContext }
        );
      }

      default:
        throw new Error(`Unsupported mutation source: ${(intent as MutationIntent).source}`);
    }
  }

  private mapReportToResult(
    report: ConsequenceReport,
    intent: MutationIntent,
    evaluationMs: number
  ): GateResult {
    const decision = report.riskAssessment;

    // Determine if this decision requires approval
    const needsApproval = this.config.escalateOn?.includes(decision) ?? false;

    // Determine if this decision blocks execution
    const isBlocked = this.config.blockOn?.includes(decision) ?? false;

    // In gateway mode, escalate means wait for approval
    // In advisory mode, escalate means warn but allow
    // In CI mode, escalate means fail the pipeline
    let permitted: boolean;
    let approvalRequested = false;

    if (isBlocked) {
      permitted = false;
    } else if (needsApproval) {
      if (this.config.mode === 'gateway' && this.config.onEscalate) {
        permitted = false; // Will be set after approval
        approvalRequested = true;
      } else if (this.config.mode === 'advisory') {
        permitted = true; // Warn but allow
      } else {
        permitted = false; // CI mode blocks on escalate
      }
    } else {
      permitted = true;
    }

    // Map mutations
    const mutations: MutationAnalysis[] = report.mutations.map(m => ({
      target: {
        service: m.intent.target.service,
        type: m.intent.target.type,
        id: m.intent.target.id,
      },
      action: m.intent.action,
      recoverability: {
        tier: m.recoverability.tier,
        label: m.recoverability.label,
        reasoning: m.recoverability.reasoning,
      },
    }));

    // Map summary
    const summary: ConsequenceSummary = {
      totalMutations: report.summary.totalMutations,
      worstRecoverability: {
        tier: report.summary.worstRecoverability.tier,
        label: report.summary.worstRecoverability.label,
      },
      needsReview: report.summary.needsReview,
      hasUnrecoverable: report.summary.hasUnrecoverable,
    };

    return {
      decision,
      reason: report.assessmentReason,
      permitted,
      approvalRequested,
      summary,
      mutations,
      costEstimate: report.costEstimate ? {
        monthlyCost: report.costEstimate.monthlyCost,
        currency: 'USD',
      } : undefined,
      timing: {
        totalMs: evaluationMs,
        evaluationMs,
      },
      raw: report,
    };
  }

  private kubernetesIntentToCommand(intent: MutationIntent & { source: 'kubernetes' }): string {
    const { operation, resource } = intent;
    const ns = resource.metadata.namespace ? `-n ${resource.metadata.namespace}` : '';

    switch (operation) {
      case 'delete':
        return `kubectl delete ${resource.kind.toLowerCase()} ${resource.metadata.name} ${ns}`.trim();
      case 'apply':
        return `kubectl apply -f - ${ns}`.trim();
      case 'patch':
        return `kubectl patch ${resource.kind.toLowerCase()} ${resource.metadata.name} ${ns}`.trim();
      case 'replace':
        return `kubectl replace -f - ${ns}`.trim();
      default:
        return `kubectl ${operation} ${resource.kind.toLowerCase()} ${resource.metadata.name} ${ns}`.trim();
    }
  }

  private dockerIntentToCommand(intent: MutationIntent & { source: 'docker' }): string {
    const { operation, target, force } = intent;
    const forceFlag = force ? '-f' : '';

    switch (operation) {
      case 'rm':
        return `docker rm ${forceFlag} ${target}`.trim();
      case 'rmi':
        return `docker rmi ${forceFlag} ${target}`.trim();
      case 'volume-rm':
        return `docker volume rm ${forceFlag} ${target}`.trim();
      case 'network-rm':
        return `docker network rm ${target}`.trim();
      case 'system-prune':
        return `docker system prune ${forceFlag}`.trim();
      default:
        return `docker ${operation} ${target}`.trim();
    }
  }

  private emptySummary(): ConsequenceSummary {
    return {
      totalMutations: 0,
      worstRecoverability: { tier: 0, label: 'unknown' },
      needsReview: false,
      hasUnrecoverable: false,
    };
  }

  private emit(event: GateEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }
}

/**
 * Create a RecourseGate with common presets.
 */
export const createGate = {
  /**
   * Development mode: warnings only, no blocking.
   */
  advisory: (config?: Partial<GateConfig>) =>
    new RecourseGate({ mode: 'advisory', ...config }),

  /**
   * CI mode: block on escalate and block decisions.
   */
  ci: (config?: Partial<GateConfig>) =>
    new RecourseGate({ mode: 'ci', ...config }),

  /**
   * Production mode: full enforcement with attestation.
   */
  gateway: (config?: Partial<GateConfig>) =>
    new RecourseGate({ mode: 'gateway', requireAttestation: true, ...config }),

  /**
   * Enterprise mode: gateway + human approval for escalations.
   */
  enterprise: (onEscalate: (result: GateResult) => Promise<boolean>, config?: Partial<GateConfig>) =>
    new RecourseGate({ mode: 'gateway', requireAttestation: true, onEscalate, ...config }),
};
