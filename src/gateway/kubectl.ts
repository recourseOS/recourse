/**
 * Kubectl Gate
 *
 * Evaluates kubectl commands before execution, blocking dangerous operations.
 */

import { spawn } from 'child_process';
import { evaluateShellCommandConsequences } from '../evaluator/index.js';
import type {
  GateDecision,
  GatePolicy,
  GateResult,
  KubectlApplyOptions,
  CommandResult,
} from './types.js';

// Dangerous kubectl operations that should be gated
const DANGEROUS_OPERATIONS = [
  'delete',
  'drain',
  'cordon',
  'taint',
  'label --overwrite',
  'annotate --overwrite',
  'scale --replicas=0',
  'rollout undo',
  'replace --force',
  'patch',
];

// Safe operations that can always proceed
const SAFE_OPERATIONS = [
  'get',
  'describe',
  'logs',
  'top',
  'api-resources',
  'api-versions',
  'cluster-info',
  'config view',
  'version',
  'explain',
];

export class KubectlGate {
  constructor(private policy: GatePolicy) {}

  /**
   * Execute a kubectl command through the gate.
   */
  async exec(args: string[], namespace?: string): Promise<GateResult<CommandResult>> {
    const fullArgs = namespace ? ['-n', namespace, ...args] : args;
    const command = `kubectl ${fullArgs.join(' ')}`;

    // Check if this is a safe operation
    if (this.isSafeOperation(args)) {
      const result = await this.runKubectl(fullArgs);
      return {
        decision: 'allow',
        executed: true,
        result,
        report: {
          riskAssessment: 'allow',
          assessmentReason: 'Safe read-only operation',
          tier: 1,
          tierLabel: 'reversible',
          mutations: 0,
          blastRadius: [],
        },
      };
    }

    // Evaluate the command
    const report = evaluateShellCommandConsequences({ command }, {});
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

    // Check for dangerous patterns
    if (this.isDangerousOperation(args)) {
      gateResult.decision = 'escalate';
      gateResult.report.assessmentReason = 'Dangerous kubectl operation requires approval';
    }

    // Check policy overrides
    if (this.shouldEscalate(command, namespace)) {
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
      const result = await this.runKubectl(fullArgs);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `kubectl exited with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  /**
   * Apply a manifest through the gate.
   */
  async apply(options: KubectlApplyOptions): Promise<GateResult<CommandResult>> {
    const args = ['apply'];

    if (options.file) {
      args.push('-f', options.file);
    } else if (options.manifest) {
      // Will pipe manifest to stdin
      args.push('-f', '-');
    }

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.dryRun && options.dryRun !== 'none') {
      args.push(`--dry-run=${options.dryRun}`);
    }

    if (options.args) {
      args.push(...options.args);
    }

    // For applies, we evaluate and gate
    const command = `kubectl ${args.join(' ')}`;
    const report = evaluateShellCommandConsequences({ command }, {});
    const decision = report.riskAssessment as GateDecision;

    const gateResult: GateResult<CommandResult> = {
      decision,
      executed: false,
      report: {
        riskAssessment: decision,
        assessmentReason: report.assessmentReason || 'Kubernetes apply operation',
        tier: 2, // Kubernetes resources are generally recoverable
        tierLabel: 'recoverable-with-effort',
        mutations: 1,
        blastRadius: [options.file || 'stdin-manifest'],
      },
    };

    // Protected namespace check
    if (this.shouldEscalate(command, options.namespace)) {
      gateResult.decision = 'escalate';
      gateResult.report.assessmentReason = `Protected namespace: ${options.namespace}`;
    }

    // Notify callback
    this.policy.onEvaluate?.(gateResult);

    // Determine if we should execute
    const shouldExecute = await this.shouldExecute(gateResult);

    if (!shouldExecute) {
      gateResult.error = `Blocked by RecourseOS gate: ${gateResult.report.assessmentReason}`;
      return gateResult;
    }

    // Execute
    try {
      const result = await this.runKubectl(args, options.manifest);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `kubectl apply failed with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  /**
   * Delete resources through the gate.
   * Always escalates by default.
   */
  async delete(
    resource: string,
    name: string,
    namespace?: string
  ): Promise<GateResult<CommandResult>> {
    const gateResult: GateResult<CommandResult> = {
      decision: 'escalate',
      executed: false,
      report: {
        riskAssessment: 'escalate',
        assessmentReason: `kubectl delete ${resource}/${name} requires approval`,
        tier: 3,
        tierLabel: 'recoverable-from-backup',
        mutations: 1,
        blastRadius: [`${namespace || 'default'}/${resource}/${name}`],
      },
    };

    // Protected namespace makes it even more critical
    if (this.shouldEscalate(`kubectl delete ${resource} ${name}`, namespace)) {
      gateResult.report.assessmentReason = `Deleting ${resource}/${name} in protected namespace ${namespace}`;
    }

    // Notify callback
    this.policy.onEvaluate?.(gateResult);

    // Check for approval
    const shouldExecute = await this.shouldExecute(gateResult);

    if (!shouldExecute) {
      gateResult.error = 'Blocked: kubectl delete requires approval';
      return gateResult;
    }

    // Execute delete
    try {
      const args = ['delete', resource, name];
      if (namespace) {
        args.push('-n', namespace);
      }

      const result = await this.runKubectl(args);
      gateResult.executed = true;
      gateResult.result = result;

      if (result.code !== 0) {
        gateResult.error = `kubectl delete failed with code ${result.code}`;
      }
    } catch (err) {
      gateResult.error = err instanceof Error ? err.message : String(err);
    }

    return gateResult;
  }

  private isSafeOperation(args: string[]): boolean {
    const operation = args[0]?.toLowerCase();
    return SAFE_OPERATIONS.some(safe => {
      const parts = safe.split(' ');
      return parts.every((part, i) => args[i]?.toLowerCase() === part);
    });
  }

  private isDangerousOperation(args: string[]): boolean {
    const joined = args.join(' ').toLowerCase();
    return DANGEROUS_OPERATIONS.some(dangerous => joined.includes(dangerous));
  }

  private shouldEscalate(command: string, namespace?: string): boolean {
    // Check protected namespaces
    const protectedNamespaces = [
      ...(this.policy.protectedEnvironments || []),
      'production',
      'prod',
      'kube-system',
      'kube-public',
      'default',
    ];

    if (namespace && protectedNamespaces.includes(namespace.toLowerCase())) {
      return true;
    }

    // Check always-escalate patterns
    const patterns = this.policy.alwaysEscalate || [];
    const lowerCommand = command.toLowerCase();

    for (const pattern of patterns) {
      if (lowerCommand.includes(pattern.toLowerCase())) {
        return true;
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

  private runKubectl(args: string[], stdin?: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('kubectl', args);

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

      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      }
    });
  }
}
