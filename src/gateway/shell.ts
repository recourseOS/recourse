/**
 * Shell Command Gate
 *
 * Evaluates shell commands before execution, blocking dangerous operations.
 */

import { spawn } from 'child_process';
import { evaluateShellCommandConsequences } from '../evaluator/index.js';
import type {
  GateDecision,
  GatePolicy,
  GateResult,
  ShellExecOptions,
  CommandResult,
} from './types.js';

export class ShellGate {
  constructor(private policy: GatePolicy) {}

  /**
   * Execute a shell command through the gate.
   * Evaluates consequences first, then executes if allowed.
   */
  async exec(
    command: string,
    options: ShellExecOptions = {}
  ): Promise<GateResult<CommandResult>> {
    // Evaluate the command
    const report = evaluateShellCommandConsequences(
      { command, cwd: options.cwd },
      {}
    );

    const decision = report.riskAssessment as GateDecision;
    const mutation = report.mutations[0];

    const gateResult: GateResult<CommandResult> = {
      decision,
      executed: false,
      report: {
        riskAssessment: decision,
        assessmentReason: report.assessmentReason || '',
        tier: mutation?.recoverability?.tier || 0,
        tierLabel: mutation?.recoverability?.label || 'unknown',
        mutations: report.mutations.length,
        blastRadius: report.mutations.map(m => m.intent.target.id),
      },
    };

    // Check policy overrides
    if (this.shouldEscalate(command)) {
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

    // Execute the command
    try {
      const result = await this.runCommand(command, options);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `Command exited with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  /**
   * Evaluate a command without executing it.
   * Useful for preview/dry-run scenarios.
   */
  async evaluate(command: string, cwd?: string): Promise<GateResult> {
    const report = evaluateShellCommandConsequences({ command, cwd }, {});
    const decision = report.riskAssessment as GateDecision;
    const mutation = report.mutations[0];

    return {
      decision: this.shouldEscalate(command) ? 'escalate' : decision,
      executed: false,
      report: {
        riskAssessment: decision,
        assessmentReason: report.assessmentReason || '',
        tier: mutation?.recoverability?.tier || 0,
        tierLabel: mutation?.recoverability?.label || 'unknown',
        mutations: report.mutations.length,
        blastRadius: report.mutations.map(m => m.intent.target.id),
      },
    };
  }

  private shouldEscalate(command: string): boolean {
    // Check if command matches always-escalate patterns
    const patterns = this.policy.alwaysEscalate || [];
    const lowerCommand = command.toLowerCase();

    for (const pattern of patterns) {
      if (lowerCommand.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    // Check protected environments
    if (
      this.policy.environment &&
      this.policy.protectedEnvironments?.includes(this.policy.environment)
    ) {
      return true;
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

  private runCommand(
    command: string,
    options: ShellExecOptions
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        timeout: options.timeout,
      });

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
