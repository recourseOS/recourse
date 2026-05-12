/**
 * RecourseOS Agent Gateway
 *
 * The enforcement layer that agents cannot bypass.
 * All infrastructure mutations flow through the gate.
 *
 * @example
 * ```typescript
 * import { RecourseGate } from 'recourse-cli/gateway';
 *
 * const gate = new RecourseGate({
 *   environment: 'production',
 *   protectedEnvironments: ['production', 'staging'],
 *   onEscalate: async (result) => {
 *     // Send to approval system, return true if approved
 *     return await requestApproval(result);
 *   },
 * });
 *
 * // All mutations go through the gate
 * const result = await gate.terraform.apply({ planFile: 'tfplan' });
 * if (!result.executed) {
 *   console.error('Blocked:', result.error);
 * }
 * ```
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import { ShellGate } from './shell.js';
import { TerraformGate } from './terraform.js';
import { KubectlGate } from './kubectl.js';
import type { GatePolicy, GateResult, GateDecision } from './types.js';

export { ShellGate } from './shell.js';
export { TerraformGate } from './terraform.js';
export { KubectlGate } from './kubectl.js';
export * from './types.js';

// V2 Enforcement Architecture
export { runGatewayMcpServer, type GatewayMcpServerOptions } from './mcp-server.js';
export {
  InMemoryPlanStore,
  InMemoryApprovalStore,
  getPlanStore,
  getApprovalStore,
  setPlanStore,
  setApprovalStore,
} from './stores.js';
export { runGatewayDoctor, type DoctorOptions } from './doctor.js';

export interface RecourseGateOptions extends Partial<GatePolicy> {
  /** Path to policy YAML file */
  policyFile?: string;
}

/**
 * RecourseOS Agent Gateway
 *
 * Provides gated access to infrastructure mutation tools.
 * Every operation is evaluated before execution.
 */
export class RecourseGate {
  readonly terraform: TerraformGate;
  readonly shell: ShellGate;
  readonly kubectl: KubectlGate;

  private policy: GatePolicy;

  constructor(options: RecourseGateOptions = {}) {
    this.policy = this.loadPolicy(options);

    this.terraform = new TerraformGate(this.policy);
    this.shell = new ShellGate(this.policy);
    this.kubectl = new KubectlGate(this.policy);
  }

  /**
   * Get the current policy configuration.
   */
  getPolicy(): Readonly<GatePolicy> {
    return { ...this.policy };
  }

  /**
   * Update the policy at runtime.
   */
  updatePolicy(updates: Partial<GatePolicy>): void {
    this.policy = { ...this.policy, ...updates };

    // Recreate gates with new policy
    (this as { terraform: TerraformGate }).terraform = new TerraformGate(this.policy);
    (this as { shell: ShellGate }).shell = new ShellGate(this.policy);
    (this as { kubectl: KubectlGate }).kubectl = new KubectlGate(this.policy);
  }

  /**
   * Set the current environment.
   * Affects whether operations are escalated based on protected environments.
   */
  setEnvironment(environment: string): void {
    this.updatePolicy({ environment });
  }

  /**
   * Quick evaluation without execution.
   * Useful for pre-flight checks.
   */
  async evaluate(
    type: 'shell' | 'terraform' | 'kubectl',
    input: string | unknown
  ): Promise<GateResult> {
    switch (type) {
      case 'shell':
        return this.shell.evaluate(input as string);

      case 'terraform':
        return this.terraform.evaluate(input);

      case 'kubectl':
        // For kubectl, input is the command args as array or string
        if (typeof input === 'string') {
          return this.shell.evaluate(`kubectl ${input}`);
        }
        return this.shell.evaluate(`kubectl ${(input as string[]).join(' ')}`);

      default:
        return {
          decision: 'block',
          executed: false,
          error: `Unknown gate type: ${type}`,
          report: {
            riskAssessment: 'block',
            assessmentReason: 'Unknown gate type',
            tier: 5,
            tierLabel: 'needs-review',
            mutations: 0,
            blastRadius: [],
          },
        };
    }
  }

  private loadPolicy(options: RecourseGateOptions): GatePolicy {
    let filePolicy: Partial<GatePolicy> = {};

    // Load from file if specified
    if (options.policyFile && fs.existsSync(options.policyFile)) {
      try {
        const content = fs.readFileSync(options.policyFile, 'utf-8');
        const parsed = yaml.parse(content);

        if (parsed?.recourseos) {
          filePolicy = {
            defaultAction: parsed.recourseos.default_action,
            alwaysEscalate: parsed.recourseos.always_escalate,
            protectedEnvironments: parsed.recourseos.protected_environments,
            executeOnWarn: parsed.recourseos.decisions?.warn?.execute !== false,
          };
        }
      } catch (err) {
        console.warn(`Failed to load policy file: ${err}`);
      }
    }

    // Merge with defaults and options
    return {
      defaultAction: options.defaultAction || filePolicy.defaultAction || 'escalate',
      alwaysEscalate: options.alwaysEscalate || filePolicy.alwaysEscalate || [
        'database_delete',
        'iam_policy_change',
        'encryption_key_change',
        'terraform_destroy',
      ],
      protectedEnvironments: options.protectedEnvironments || filePolicy.protectedEnvironments || [
        'production',
        'prod',
      ],
      environment: options.environment,
      executeOnWarn: options.executeOnWarn ?? filePolicy.executeOnWarn ?? true,
      onEscalate: options.onEscalate,
      onEvaluate: options.onEvaluate,
    };
  }
}

/**
 * Create a simple gate with default policy.
 * For quick usage without custom configuration.
 */
export function createGate(options: RecourseGateOptions = {}): RecourseGate {
  return new RecourseGate(options);
}

/**
 * Utility: Check if a result should block execution.
 */
export function shouldBlock(result: GateResult): boolean {
  return result.decision === 'block' || result.decision === 'escalate';
}

/**
 * Utility: Format a gate result for logging/display.
 */
export function formatGateResult(result: GateResult): string {
  const icon = {
    allow: '\x1b[32m✓\x1b[0m',
    warn: '\x1b[33m!\x1b[0m',
    escalate: '\x1b[33m⚠\x1b[0m',
    block: '\x1b[31m✗\x1b[0m',
  }[result.decision];

  const lines = [
    `${icon} ${result.decision.toUpperCase()}`,
    `  Tier: ${result.report.tierLabel} (${result.report.tier})`,
    `  Reason: ${result.report.assessmentReason}`,
  ];

  if (result.report.blastRadius.length > 0) {
    lines.push(`  Blast radius: ${result.report.blastRadius.join(', ')}`);
  }

  if (result.executed) {
    lines.push(`  Executed: yes`);
  } else if (result.error) {
    lines.push(`  Error: ${result.error}`);
  }

  return lines.join('\n');
}
