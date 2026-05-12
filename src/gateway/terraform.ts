/**
 * Terraform Gate
 *
 * Evaluates Terraform plans before apply, blocking dangerous operations.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateTerraformPlanConsequences } from '../evaluator/index.js';
import { parsePlanJson } from '../parsers/plan.js';
import { parseStateJson } from '../parsers/state.js';
import type {
  GateDecision,
  GatePolicy,
  GateResult,
  TerraformApplyOptions,
  CommandResult,
} from './types.js';

export class TerraformGate {
  constructor(private policy: GatePolicy) {}

  /**
   * Run terraform plan (always allowed - planning is safe).
   * Returns the plan output and saves plan file for later apply.
   */
  async plan(
    cwd: string = '.',
    args: string[] = []
  ): Promise<GateResult<{ planFile: string; planJson: unknown }>> {
    const planFile = path.join(cwd, 'tfplan');
    const planJsonFile = path.join(cwd, 'tfplan.json');

    // Run terraform plan
    const planResult = await this.runTerraform(
      ['plan', '-out=' + planFile, ...args],
      cwd
    );

    if (planResult.code !== 0) {
      return {
        decision: 'allow', // Planning itself is allowed
        executed: true,
        error: `Terraform plan failed: ${planResult.stderr}`,
        report: {
          riskAssessment: 'allow',
          assessmentReason: 'Planning is always allowed',
          tier: 0,
          tierLabel: 'plan-only',
          mutations: 0,
          blastRadius: [],
        },
        result: { planFile: '', planJson: null },
      };
    }

    // Generate plan JSON
    const showResult = await this.runTerraform(
      ['show', '-json', planFile],
      cwd
    );

    let planJson: unknown = null;
    if (showResult.code === 0) {
      try {
        planJson = JSON.parse(showResult.stdout);
        fs.writeFileSync(planJsonFile, showResult.stdout);
      } catch {
        // Failed to parse, that's okay
      }
    }

    return {
      decision: 'allow',
      executed: true,
      result: { planFile, planJson },
      report: {
        riskAssessment: 'allow',
        assessmentReason: 'Planning is always allowed',
        tier: 0,
        tierLabel: 'plan-only',
        mutations: 0,
        blastRadius: [],
      },
    };
  }

  /**
   * Apply a Terraform plan through the gate.
   * Evaluates the plan first, then applies if allowed.
   */
  async apply(options: TerraformApplyOptions = {}): Promise<GateResult<CommandResult>> {
    const cwd = options.cwd || '.';

    // Get plan JSON
    let planJson = options.planJson;
    if (!planJson && options.planFile) {
      // Read and convert plan file to JSON
      const showResult = await this.runTerraform(
        ['show', '-json', options.planFile],
        cwd
      );
      if (showResult.code === 0) {
        try {
          planJson = JSON.parse(showResult.stdout);
        } catch {
          return {
            decision: 'block',
            executed: false,
            error: 'Failed to parse Terraform plan JSON',
            report: {
              riskAssessment: 'block',
              assessmentReason: 'Cannot evaluate plan without valid JSON',
              tier: 5,
              tierLabel: 'needs-review',
              mutations: 0,
              blastRadius: [],
            },
          };
        }
      }
    }

    if (!planJson) {
      // No plan provided - block by default
      return {
        decision: 'block',
        executed: false,
        error: 'No plan provided. Run terraform plan first.',
        report: {
          riskAssessment: 'block',
          assessmentReason: 'Apply without plan is not allowed through gate',
          tier: 5,
          tierLabel: 'needs-review',
          mutations: 0,
          blastRadius: [],
        },
      };
    }

    // Parse the plan
    const plan = parsePlanJson(JSON.stringify(planJson));
    const state = options.stateJson
      ? parseStateJson(JSON.stringify(options.stateJson))
      : null;

    // Evaluate consequences
    const report = evaluateTerraformPlanConsequences(plan, state, {});
    const decision = report.riskAssessment as GateDecision;

    const gateResult: GateResult<CommandResult> = {
      decision,
      executed: false,
      report: {
        riskAssessment: decision,
        assessmentReason: report.assessmentReason || '',
        tier: report.summary.worstRecoverability?.tier || 0,
        tierLabel: report.summary.worstRecoverability?.label || 'unknown',
        mutations: report.mutations.length,
        blastRadius: report.mutations.map(m => m.intent.target.id),
      },
    };

    // Check policy overrides
    if (this.shouldEscalate(report)) {
      gateResult.decision = 'escalate';
    }

    // Notify callback
    this.policy.onEvaluate?.(gateResult);

    // Determine if we should execute
    const shouldExecute = await this.shouldExecute(gateResult);

    if (!shouldExecute) {
      gateResult.error = `Blocked by RecourseOS gate: ${gateResult.report.assessmentReason}`;
      return gateResult;
    }

    // Execute terraform apply
    try {
      const applyArgs = ['apply'];
      if (options.autoApprove) {
        applyArgs.push('-auto-approve');
      }
      if (options.planFile) {
        applyArgs.push(options.planFile);
      }
      if (options.args) {
        applyArgs.push(...options.args);
      }

      const result = await this.runTerraform(applyArgs, cwd);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `Terraform apply failed with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  /**
   * Evaluate a plan without applying it.
   */
  async evaluate(planJson: unknown, stateJson?: unknown): Promise<GateResult> {
    const plan = parsePlanJson(JSON.stringify(planJson));
    const state = stateJson ? parseStateJson(JSON.stringify(stateJson)) : null;

    const report = evaluateTerraformPlanConsequences(plan, state, {});
    const decision = report.riskAssessment as GateDecision;

    const result: GateResult = {
      decision: this.shouldEscalate(report) ? 'escalate' : decision,
      executed: false,
      report: {
        riskAssessment: decision,
        assessmentReason: report.assessmentReason || '',
        tier: report.summary.worstRecoverability?.tier || 0,
        tierLabel: report.summary.worstRecoverability?.label || 'unknown',
        mutations: report.mutations.length,
        blastRadius: report.mutations.map(m => m.intent.target.id),
      },
    };

    return result;
  }

  /**
   * Destroy infrastructure through the gate.
   * Always escalates by default - destroying is high-risk.
   */
  async destroy(cwd: string = '.', args: string[] = []): Promise<GateResult<CommandResult>> {
    // Always escalate for destroy
    const gateResult: GateResult<CommandResult> = {
      decision: 'escalate',
      executed: false,
      report: {
        riskAssessment: 'escalate',
        assessmentReason: 'terraform destroy requires explicit approval',
        tier: 5,
        tierLabel: 'needs-review',
        mutations: 1,
        blastRadius: ['all-terraform-managed-resources'],
      },
    };

    // Notify callback
    this.policy.onEvaluate?.(gateResult);

    // Check for approval
    const shouldExecute = await this.shouldExecute(gateResult);

    if (!shouldExecute) {
      gateResult.error = 'Blocked: terraform destroy requires approval';
      return gateResult;
    }

    // Execute destroy
    try {
      const result = await this.runTerraform(['destroy', '-auto-approve', ...args], cwd);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `Terraform destroy failed with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  private shouldEscalate(report: { mutations: Array<{ intent: { target: { type: string } } }> }): boolean {
    // Check protected environments
    if (
      this.policy.environment &&
      this.policy.protectedEnvironments?.includes(this.policy.environment)
    ) {
      return true;
    }

    // Check always-escalate resource types
    const patterns = this.policy.alwaysEscalate || [];
    for (const mutation of report.mutations) {
      const type = mutation.intent.target.type.toLowerCase();
      for (const pattern of patterns) {
        if (type.includes(pattern.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  private async shouldExecute(result: GateResult): Promise<boolean> {
    switch (result.decision) {
      case 'allow':
        return true;

      case 'warn':
        return this.policy.executeOnWarn !== false;

      case 'escalate':
        if (this.policy.onEscalate) {
          return await this.policy.onEscalate(result);
        }
        return false;

      case 'block':
        return false;

      default:
        return false;
    }
  }

  private runTerraform(args: string[], cwd: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('terraform', args, { cwd });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => {
        stdout += data.toString();
      });

      proc.stderr.on('data', data => {
        stderr += data.toString();
      });

      proc.on('close', code => {
        resolve({ code: code ?? 0, stdout, stderr });
      });

      proc.on('error', err => {
        reject(err);
      });
    });
  }
}
