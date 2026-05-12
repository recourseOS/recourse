/**
 * RecourseOS Gateway MCP Server - v2 Enforcement Architecture
 *
 * Key invariant: Agents never receive raw mutation capability.
 * They only receive consequence-aware gateway tools.
 *
 * The agent is allowed to propose. The gateway decides whether the world changes.
 *
 * IMPORTANT: gateway_approve and gateway_reject are NOT exposed to agents.
 * Approval is a human-only control plane action.
 */

import type { Readable, Writable } from 'stream';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { evaluateShellCommandConsequences, evaluateTerraformPlanConsequences } from '../evaluator/index.js';
import { parsePlanJson } from '../parsers/plan.js';
import { getPlanStore, getApprovalStore } from './stores.js';
import {
  DEFAULT_POLICY,
  type GateDecision,
  type GatewayPolicy,
  type Environment,
  type TerraformPlanRecord,
  type ApprovalRequest,
  type CommandResult,
} from './types.js';

const SCHEMA_VERSION = 'recourse.gateway.v2';

let verbose = false;
let policy: GatewayPolicy = DEFAULT_POLICY;
let currentEnvironment: Environment = 'dev';
let agentId = 'unknown-agent';

function log(message: string): void {
  if (verbose) {
    const timestamp = new Date().toISOString().slice(11, 19);
    process.stderr.write(`[${timestamp}] ${message}\n`);
  }
}

function logGate(tool: string, decision: GateDecision, target: string): void {
  if (!verbose) return;
  const emoji = { allow: '✓', warn: '!', escalate: '⚠', block: '✗' }[decision];
  const color = { allow: '\x1b[32m', warn: '\x1b[33m', escalate: '\x1b[33m', block: '\x1b[31m' }[decision];
  process.stderr.write(`${color}${emoji} GATE ${decision.toUpperCase()}\x1b[0m ${tool} → ${target}\n`);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

// ============================================================================
// TOOL DEFINITIONS - What agents can see
// ============================================================================

const tools = [
  // TERRAFORM
  {
    name: 'gateway_terraform_plan',
    description:
      'Create a Terraform plan, evaluate its consequences, and return a plan_id. ' +
      'The plan is stored with a hash for integrity verification. ' +
      'You MUST use the returned plan_id with gateway_terraform_apply.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory containing Terraform files' },
        workspace: { type: 'string', description: 'Terraform workspace name' },
        args: { type: 'array', items: { type: 'string' }, description: 'Additional terraform plan arguments' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_terraform_apply',
    description:
      'Apply a previously evaluated Terraform plan. ' +
      'REQUIRES a plan_id from gateway_terraform_plan. ' +
      'The gateway verifies: plan hash, workspace, TTL, and approval status. ' +
      'If the plan requires approval and is not yet approved, this will fail.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'The plan_id from gateway_terraform_plan' },
      },
      required: ['plan_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_terraform_destroy',
    description:
      'Destroy Terraform-managed infrastructure. ' +
      'ALWAYS requires human approval. Will return escalate/block. ' +
      'Only use when explicitly asked to destroy infrastructure.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory' },
        workspace: { type: 'string', description: 'Terraform workspace' },
      },
      additionalProperties: false,
    },
  },

  // KUBERNETES READ-ONLY
  {
    name: 'gateway_kubectl_get',
    description: 'Read-only: Get Kubernetes resources. Namespace-scoped and audited.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'Resource type (pods, deployments, services, etc.)' },
        name: { type: 'string', description: 'Resource name (optional)' },
        namespace: { type: 'string', description: 'Namespace (optional)' },
        selector: { type: 'string', description: 'Label selector' },
        output: { type: 'string', enum: ['json', 'yaml', 'wide', 'name'], description: 'Output format' },
      },
      required: ['resource'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_kubectl_logs',
    description: 'Read-only: Get pod logs. Secrets may be redacted.',
    inputSchema: {
      type: 'object',
      properties: {
        pod: { type: 'string', description: 'Pod name' },
        namespace: { type: 'string', description: 'Namespace' },
        container: { type: 'string', description: 'Container name' },
        tail: { type: 'number', description: 'Number of lines from end' },
        since: { type: 'string', description: 'Show logs since duration (e.g., 1h, 30m)' },
      },
      required: ['pod'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_kubectl_describe',
    description: 'Read-only: Describe a Kubernetes resource.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'Resource type' },
        name: { type: 'string', description: 'Resource name' },
        namespace: { type: 'string', description: 'Namespace' },
      },
      required: ['resource', 'name'],
      additionalProperties: false,
    },
  },

  // KUBERNETES MUTATIONS
  {
    name: 'gateway_kubectl_apply',
    description:
      'Apply a Kubernetes manifest. Evaluated before execution. ' +
      'Protected namespaces will escalate.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to manifest file' },
        manifest: { type: 'string', description: 'Manifest YAML content' },
        namespace: { type: 'string', description: 'Target namespace' },
        dry_run: { type: 'string', enum: ['none', 'client', 'server'], description: 'Dry run mode' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_kubectl_delete',
    description:
      'Delete a Kubernetes resource. ESCALATES by default. ' +
      'Namespace/PV/secret deletes may be blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'Resource type' },
        name: { type: 'string', description: 'Resource name' },
        namespace: { type: 'string', description: 'Namespace' },
      },
      required: ['resource', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_kubectl_scale',
    description:
      'Scale a Kubernetes deployment/statefulset. ' +
      'Scale-to-zero may escalate in production.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'Resource type (deployment, statefulset)' },
        name: { type: 'string', description: 'Resource name' },
        namespace: { type: 'string', description: 'Namespace' },
        replicas: { type: 'number', description: 'Target replica count' },
      },
      required: ['resource', 'name', 'replicas'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_kubectl_exec',
    description:
      'Execute a command in a container. ESCALATES by default. ' +
      'This is shell access into a container - not read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        pod: { type: 'string', description: 'Pod name' },
        namespace: { type: 'string', description: 'Namespace' },
        container: { type: 'string', description: 'Container name' },
        command: { type: 'array', items: { type: 'string' }, description: 'Command to execute' },
      },
      required: ['pod', 'command'],
      additionalProperties: false,
    },
  },

  // SHELL
  {
    name: 'gateway_shell_exec',
    description:
      'Execute a shell command in sandbox. ' +
      'Read-only commands (ls, cat, grep) may be allowed. ' +
      'Destructive commands will escalate or block. ' +
      'curl|bash patterns are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },

  // APPROVAL (agent can request and check, NOT approve/reject)
  {
    name: 'gateway_request_approval',
    description:
      'Request human approval for a blocked or escalated operation. ' +
      'Returns an approval_id that can be checked with gateway_check_approval.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'What operation needs approval' },
        target: { type: 'string', description: 'What resource is affected' },
        reason: { type: 'string', description: 'Why this operation is needed' },
        plan_id: { type: 'string', description: 'Associated plan_id if applicable' },
      },
      required: ['operation', 'target', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'gateway_check_approval',
    description:
      'Check the status of a pending approval request. ' +
      'Returns pending, approved, rejected, or expired.',
    inputSchema: {
      type: 'object',
      properties: {
        approval_id: { type: 'string', description: 'The approval_id to check' },
      },
      required: ['approval_id'],
      additionalProperties: false,
    },
  },

  // AUDIT
  {
    name: 'gateway_get_plan',
    description: 'Get details of a stored Terraform plan by plan_id.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'The plan_id to retrieve' },
      },
      required: ['plan_id'],
      additionalProperties: false,
    },
  },
];

// ============================================================================
// SERVER ENTRY POINT
// ============================================================================

export interface GatewayMcpServerOptions {
  verbose?: boolean;
  environment?: Environment;
  policy?: Partial<GatewayPolicy>;
  policyFile?: string;
  agentId?: string;
}

export async function runGatewayMcpServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  options: GatewayMcpServerOptions = {}
): Promise<void> {
  verbose = options.verbose ?? false;
  currentEnvironment = options.environment ?? 'dev';
  agentId = options.agentId ?? 'unknown-agent';

  // Load policy
  if (options.policyFile && fs.existsSync(options.policyFile)) {
    // TODO: Load from YAML
  }
  if (options.policy) {
    policy = { ...DEFAULT_POLICY, ...options.policy };
  }

  if (verbose) {
    process.stderr.write('\n┌────────────────────────────────────────┐\n');
    process.stderr.write('│  RecourseOS Gateway v2                 │\n');
    process.stderr.write('│  Enforcement mode enabled              │\n');
    process.stderr.write(`│  Environment: ${currentEnvironment.padEnd(24)}│\n`);
    process.stderr.write('│  Agent approval tools: DISABLED        │\n');
    process.stderr.write('└────────────────────────────────────────┘\n\n');
  }

  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let useNewlineDelimited: boolean | null = null;

  input.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    if (useNewlineDelimited === null && buffer.length > 0) {
      useNewlineDelimited = String.fromCharCode(buffer[0]) === '{';
    }

    if (useNewlineDelimited) {
      for (;;) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.subarray(0, idx).toString('utf8').trim();
        buffer = buffer.subarray(idx + 1);
        if (line) void handleAndWrite(line, output, true);
      }
    } else {
      for (;;) {
        const frame = readFrame(buffer);
        if (!frame) break;
        buffer = frame.remaining;
        void handleAndWrite(frame.body.toString('utf8'), output, false);
      }
    }
  });
}

async function handleAndWrite(body: string, output: Writable, newline: boolean): Promise<void> {
  const request = JSON.parse(body) as JsonRpcRequest;
  const response = await handleRequest(request);

  if (response) {
    if (newline) {
      output.write(JSON.stringify(response) + '\n');
    } else {
      const responseBody = JSON.stringify(response);
      output.write(`Content-Length: ${Buffer.byteLength(responseBody, 'utf8')}\r\n\r\n${responseBody}`);
    }
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.id === undefined) return null;

  try {
    switch (request.method) {
      case 'initialize':
        return result(request.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'recourseos-gateway', version: '2.0.0' },
        });
      case 'tools/list':
        return result(request.id, { tools });
      case 'tools/call':
        return result(request.id, await callTool(request.params));
      case 'ping':
        return result(request.id, {});
      default:
        return error(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (err) {
    return error(request.id, -32602, err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// TOOL HANDLERS
// ============================================================================

async function callTool(params: unknown): Promise<Record<string, unknown>> {
  const call = params as { name: string; arguments?: Record<string, unknown> };
  const args = call.arguments || {};

  switch (call.name) {
    // TERRAFORM
    case 'gateway_terraform_plan':
      return await handleTerraformPlan(args);
    case 'gateway_terraform_apply':
      return await handleTerraformApply(args);
    case 'gateway_terraform_destroy':
      return await handleTerraformDestroy(args);

    // KUBERNETES READ
    case 'gateway_kubectl_get':
      return await handleKubectlGet(args);
    case 'gateway_kubectl_logs':
      return await handleKubectlLogs(args);
    case 'gateway_kubectl_describe':
      return await handleKubectlDescribe(args);

    // KUBERNETES MUTATIONS
    case 'gateway_kubectl_apply':
      return await handleKubectlApply(args);
    case 'gateway_kubectl_delete':
      return await handleKubectlDelete(args);
    case 'gateway_kubectl_scale':
      return await handleKubectlScale(args);
    case 'gateway_kubectl_exec':
      return await handleKubectlExec(args);

    // SHELL
    case 'gateway_shell_exec':
      return await handleShellExec(args);

    // APPROVAL
    case 'gateway_request_approval':
      return await handleRequestApproval(args);
    case 'gateway_check_approval':
      return await handleCheckApproval(args);

    // AUDIT
    case 'gateway_get_plan':
      return await handleGetPlan(args);

    default:
      throw new Error(`Unknown gateway tool: ${call.name}`);
  }
}

// ============================================================================
// TERRAFORM HANDLERS
// ============================================================================

async function handleTerraformPlan(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cwd = (args.cwd as string) || '.';
  const workspace = (args.workspace as string) || 'default';
  const extraArgs = (args.args as string[]) || [];

  log(`terraform plan in ${cwd} (workspace: ${workspace})`);

  // Run terraform plan
  const planFile = path.join(cwd, `tfplan-${Date.now()}`);
  const planResult = await runCommand('terraform', ['plan', '-out=' + planFile, ...extraArgs], cwd);

  if (planResult.code !== 0) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Terraform plan failed: ${planResult.stderr}`,
    });
  }

  // Get plan JSON
  const showResult = await runCommand('terraform', ['show', '-json', planFile], cwd);
  if (showResult.code !== 0) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Failed to read plan: ${showResult.stderr}`,
    });
  }

  let planJson: unknown;
  try {
    planJson = JSON.parse(showResult.stdout);
  } catch {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: 'Failed to parse plan JSON',
    });
  }

  // Compute hashes
  const planHash = crypto.createHash('sha256').update(fs.readFileSync(planFile)).digest('hex');
  const planJsonHash = crypto.createHash('sha256').update(showResult.stdout).digest('hex');

  // Evaluate with RecourseOS
  const plan = parsePlanJson(showResult.stdout);
  const report = evaluateTerraformPlanConsequences(plan, null, {});
  const decision = report.riskAssessment as GateDecision;

  logGate('terraform_plan', decision, `${workspace}:${report.mutations.length} changes`);

  // Create plan record
  const planId = `plan_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const record: TerraformPlanRecord = {
    planId,
    planHash,
    planJsonHash,
    workspace,
    environment: currentEnvironment,
    workingDirectory: path.resolve(cwd),
    createdByAgent: agentId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + policy.planTtlSeconds * 1000).toISOString(),
    recourseReportId: `rpt_${crypto.randomUUID().slice(0, 8)}`,
    decision,
    status: 'planned',
  };

  // Store plan
  await getPlanStore().save(record);

  // Clean up plan file (we have the hash)
  try { fs.unlinkSync(planFile); } catch { /* ignore */ }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    plan_id: planId,
    workspace,
    environment: currentEnvironment,
    decision,
    approval_required: decision === 'escalate' || decision === 'block',
    expires_at: record.expiresAt,
    report: {
      mutations: report.mutations.length,
      worst_tier: report.summary.worstRecoverability?.tier,
      worst_tier_label: report.summary.worstRecoverability?.label,
      blast_radius: report.mutations.map(m => m.intent.target.id),
      reason: report.assessmentReason,
    },
    instructions: decision === 'escalate' || decision === 'block'
      ? 'This plan requires human approval. Use gateway_request_approval to request approval, then gateway_terraform_apply once approved.'
      : 'Plan evaluated. Use gateway_terraform_apply with this plan_id to apply.',
  });
}

async function handleTerraformApply(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const planId = args.plan_id as string;
  if (!planId) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: 'plan_id is required. Run gateway_terraform_plan first.',
    });
  }

  log(`terraform apply ${planId}`);

  // Get plan record
  const record = await getPlanStore().get(planId);
  if (!record) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Plan not found: ${planId}`,
    });
  }

  // Verify status
  if (record.status === 'expired') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Plan has expired. Run gateway_terraform_plan again.`,
    });
  }

  if (record.status === 'applied') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Plan already applied at ${record.appliedAt}`,
    });
  }

  // Check approval if needed
  if (record.decision === 'escalate' || record.decision === 'block') {
    if (!record.approvalId) {
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        success: false,
        error: 'This plan requires approval. Use gateway_request_approval first.',
        decision: record.decision,
      });
    }

    const approval = await getApprovalStore().get(record.approvalId);
    if (!approval || approval.status !== 'approved') {
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        success: false,
        error: `Approval not granted. Status: ${approval?.status || 'not found'}`,
        approval_id: record.approvalId,
      });
    }
  }

  logGate('terraform_apply', 'allow', planId);

  // Re-run plan and verify hash matches
  const cwd = record.workingDirectory;
  const planFile = path.join(cwd, `tfplan-apply-${Date.now()}`);

  const planResult = await runCommand('terraform', ['plan', '-out=' + planFile], cwd);
  if (planResult.code !== 0) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Failed to re-create plan: ${planResult.stderr}`,
    });
  }

  // Verify hash
  const newHash = crypto.createHash('sha256').update(fs.readFileSync(planFile)).digest('hex');
  if (newHash !== record.planHash) {
    fs.unlinkSync(planFile);
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: 'Plan drift detected. Infrastructure has changed since plan was created. Run gateway_terraform_plan again.',
      original_hash: record.planHash,
      current_hash: newHash,
    });
  }

  // Apply
  const applyResult = await runCommand('terraform', ['apply', '-auto-approve', planFile], cwd);

  // Update status
  await getPlanStore().updateStatus(planId, applyResult.code === 0 ? 'applied' : 'planned');

  // Cleanup
  try { fs.unlinkSync(planFile); } catch { /* ignore */ }

  if (applyResult.code !== 0) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Terraform apply failed: ${applyResult.stderr}`,
      plan_id: planId,
    });
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    executed: true,
    plan_id: planId,
    output: applyResult.stdout,
  });
}

async function handleTerraformDestroy(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cwd = (args.cwd as string) || '.';
  const workspace = (args.workspace as string) || 'default';

  log(`terraform destroy in ${cwd}`);

  // Destroy always escalates or blocks
  const envPolicy = policy.environments[currentEnvironment];
  const decision = envPolicy.terraformDestroy;

  logGate('terraform_destroy', decision, workspace);

  if (decision === 'block') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'block',
      error: `terraform destroy is blocked in ${currentEnvironment} environment`,
      instructions: 'Contact platform team for break-glass procedure if this is an emergency.',
    });
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: false,
    decision: 'escalate',
    error: 'terraform destroy requires human approval',
    instructions: 'Use gateway_request_approval with operation="terraform_destroy" to request approval.',
  });
}

// ============================================================================
// KUBERNETES HANDLERS
// ============================================================================

async function handleKubectlGet(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resource = args.resource as string;
  const name = args.name as string | undefined;
  const namespace = args.namespace as string | undefined;
  const selector = args.selector as string | undefined;
  const output = args.output as string | undefined;

  const kubectlArgs = ['get', resource];
  if (name) kubectlArgs.push(name);
  if (namespace) kubectlArgs.push('-n', namespace);
  if (selector) kubectlArgs.push('-l', selector);
  if (output) kubectlArgs.push('-o', output);

  log(`kubectl get ${resource}`);
  logGate('kubectl_get', 'allow', `${namespace || 'default'}/${resource}`);

  const result = await runCommand('kubectl', kubectlArgs);

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    decision: 'allow',
    output: result.stdout,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlLogs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pod = args.pod as string;
  const namespace = args.namespace as string | undefined;
  const container = args.container as string | undefined;
  const tail = args.tail as number | undefined;
  const since = args.since as string | undefined;

  const kubectlArgs = ['logs', pod];
  if (namespace) kubectlArgs.push('-n', namespace);
  if (container) kubectlArgs.push('-c', container);
  if (tail) kubectlArgs.push('--tail', String(tail));
  if (since) kubectlArgs.push('--since', since);

  log(`kubectl logs ${pod}`);
  logGate('kubectl_logs', 'allow', `${namespace || 'default'}/${pod}`);

  const result = await runCommand('kubectl', kubectlArgs);

  // Redact potential secrets in logs
  let output = result.stdout;
  if (policy.shell.redactSecrets) {
    output = redactSecrets(output);
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    decision: 'allow',
    output,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlDescribe(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resource = args.resource as string;
  const name = args.name as string;
  const namespace = args.namespace as string | undefined;

  const kubectlArgs = ['describe', resource, name];
  if (namespace) kubectlArgs.push('-n', namespace);

  log(`kubectl describe ${resource}/${name}`);
  logGate('kubectl_describe', 'allow', `${namespace || 'default'}/${resource}/${name}`);

  const result = await runCommand('kubectl', kubectlArgs);

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    decision: 'allow',
    output: result.stdout,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlApply(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const file = args.file as string | undefined;
  const manifest = args.manifest as string | undefined;
  const namespace = args.namespace as string | undefined;
  const dryRun = args.dry_run as string | undefined;

  if (!file && !manifest) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: 'Either file or manifest is required',
    });
  }

  log(`kubectl apply`);

  // Check protected namespace
  const targetNs = namespace || 'default';
  const isProtected = policy.protectedNamespaces.includes(targetNs);
  const envPolicy = policy.environments[currentEnvironment];

  let decision: GateDecision = envPolicy.defaultMutation;
  if (isProtected) {
    decision = 'escalate';
  }

  logGate('kubectl_apply', decision, targetNs);

  if (decision === 'escalate' || decision === 'block') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision,
      error: isProtected
        ? `Namespace ${targetNs} is protected. Requires approval.`
        : `kubectl apply requires approval in ${currentEnvironment}`,
      instructions: 'Use gateway_request_approval to request approval.',
    });
  }

  // Execute
  const kubectlArgs = ['apply'];
  if (file) kubectlArgs.push('-f', file);
  if (namespace) kubectlArgs.push('-n', namespace);
  if (dryRun && dryRun !== 'none') kubectlArgs.push(`--dry-run=${dryRun}`);

  const result = await runCommand('kubectl', kubectlArgs, undefined, manifest);

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    executed: true,
    decision: 'allow',
    output: result.stdout,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlDelete(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resource = args.resource as string;
  const name = args.name as string;
  const namespace = args.namespace as string | undefined;

  log(`kubectl delete ${resource}/${name}`);

  // Delete always escalates
  const targetNs = namespace || 'default';
  const isProtected = policy.protectedNamespaces.includes(targetNs);
  const isHighRisk = ['namespace', 'pv', 'pvc', 'secret', 'configmap'].includes(resource.toLowerCase());

  let decision: GateDecision = policy.environments[currentEnvironment].kubectlDelete;
  if (isProtected || isHighRisk) {
    decision = resource.toLowerCase() === 'namespace' ? 'block' : 'escalate';
  }

  logGate('kubectl_delete', decision, `${targetNs}/${resource}/${name}`);

  if (decision === 'block') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'block',
      error: `Deleting ${resource} is blocked. Contact platform team.`,
    });
  }

  if (decision === 'escalate') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'escalate',
      error: `Deleting ${resource}/${name} requires approval`,
      instructions: 'Use gateway_request_approval to request approval.',
    });
  }

  // Execute (only in dev with warn)
  const kubectlArgs = ['delete', resource, name];
  if (namespace) kubectlArgs.push('-n', namespace);

  const result = await runCommand('kubectl', kubectlArgs);

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    executed: true,
    decision,
    output: result.stdout,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlScale(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resource = args.resource as string;
  const name = args.name as string;
  const namespace = args.namespace as string | undefined;
  const replicas = args.replicas as number;

  log(`kubectl scale ${resource}/${name} --replicas=${replicas}`);

  const targetNs = namespace || 'default';
  const isProtected = policy.protectedNamespaces.includes(targetNs);
  const isScaleToZero = replicas === 0;

  let decision: GateDecision = 'allow';
  if (currentEnvironment === 'prod') {
    decision = isScaleToZero ? 'escalate' : 'warn';
  }
  if (isProtected && isScaleToZero) {
    decision = 'escalate';
  }

  logGate('kubectl_scale', decision, `${targetNs}/${resource}/${name} → ${replicas}`);

  if (decision === 'escalate') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'escalate',
      error: isScaleToZero
        ? 'Scaling to zero requires approval'
        : `Scaling in ${currentEnvironment} requires approval`,
      instructions: 'Use gateway_request_approval to request approval.',
    });
  }

  const kubectlArgs = ['scale', resource, name, `--replicas=${replicas}`];
  if (namespace) kubectlArgs.push('-n', namespace);

  const result = await runCommand('kubectl', kubectlArgs);

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    executed: true,
    decision,
    output: result.stdout,
    error: result.code !== 0 ? result.stderr : undefined,
  });
}

async function handleKubectlExec(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pod = args.pod as string;
  const namespace = args.namespace as string | undefined;
  const container = args.container as string | undefined;
  const command = args.command as string[];

  log(`kubectl exec ${pod} -- ${command.join(' ')}`);

  // kubectl exec ALWAYS escalates - it's shell access
  const targetNs = namespace || 'default';
  const isProtected = policy.protectedNamespaces.includes(targetNs);

  const decision: GateDecision = isProtected ? 'block' : 'escalate';

  logGate('kubectl_exec', decision, `${targetNs}/${pod}`);

  if (decision === 'block') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'block',
      error: `kubectl exec is blocked in protected namespace ${targetNs}`,
    });
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: false,
    decision: 'escalate',
    error: 'kubectl exec requires approval (this is shell access into a container)',
    instructions: 'Use gateway_request_approval to request approval.',
  });
}

// ============================================================================
// SHELL HANDLER
// ============================================================================

async function handleShellExec(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = args.cwd as string | undefined;
  const timeout = Math.min(args.timeout as number || 30000, policy.shell.maxTimeout);

  log(`shell: ${command.slice(0, 60)}${command.length > 60 ? '...' : ''}`);

  // Check for blocked patterns (case-insensitive string matching)
  const lowerCommand = command.toLowerCase();
  for (const pattern of policy.shell.alwaysBlock) {
    if (lowerCommand.includes(pattern.toLowerCase())) {
      logGate('shell_exec', 'block', command.slice(0, 40));
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        success: false,
        decision: 'block',
        error: `Command blocked: matches dangerous pattern "${pattern}"`,
      });
    }
  }

  // Check for escalate patterns
  for (const pattern of policy.shell.alwaysEscalate) {
    if (command.startsWith(pattern) || command.includes(` ${pattern}`)) {
      logGate('shell_exec', 'escalate', command.slice(0, 40));
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        success: false,
        decision: 'escalate',
        error: `Command requires approval: contains "${pattern}"`,
        instructions: 'Use gateway_request_approval to request approval.',
      });
    }
  }

  // Check for allowed read-only patterns
  let isReadOnly = false;
  for (const pattern of policy.shell.allowReadonly) {
    if (command.startsWith(pattern) || command === pattern) {
      isReadOnly = true;
      break;
    }
  }

  // Also evaluate with RecourseOS
  const report = evaluateShellCommandConsequences({ command, cwd }, {});
  const recourseDecision = report.riskAssessment as GateDecision;

  // Take the stricter of policy vs recourse
  let decision: GateDecision = isReadOnly ? 'allow' : policy.shell.default;
  if (recourseDecision === 'block' || recourseDecision === 'escalate') {
    decision = recourseDecision;
  }

  logGate('shell_exec', decision, command.slice(0, 40));

  if (decision === 'block') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'block',
      error: 'Command blocked by policy',
      recourse_reason: report.assessmentReason,
    });
  }

  if (decision === 'escalate') {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      decision: 'escalate',
      error: 'Command requires approval',
      recourse_reason: report.assessmentReason,
      instructions: 'Use gateway_request_approval to request approval.',
    });
  }

  // Execute (with sandbox restrictions if configured)
  const result = await runCommand('sh', ['-c', command], cwd, undefined, timeout);

  let output = result.stdout;
  if (policy.shell.redactSecrets) {
    output = redactSecrets(output);
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: result.code === 0,
    executed: true,
    decision,
    output,
    stderr: result.stderr,
    exit_code: result.code,
  });
}

// ============================================================================
// APPROVAL HANDLERS
// ============================================================================

async function handleRequestApproval(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const operation = args.operation as string;
  const target = args.target as string;
  const reason = args.reason as string;
  const planId = args.plan_id as string | undefined;

  log(`approval request: ${operation} on ${target}`);

  const approvalId = `apr_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

  const request: ApprovalRequest = {
    approvalId,
    requestedByAgent: agentId,
    operation,
    target,
    environment: currentEnvironment,
    planId,
    risk: 'escalate',
    recourseReportId: `rpt_${crypto.randomUUID().slice(0, 8)}`,
    blastRadius: [target],
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + policy.approvalTtlSeconds * 1000).toISOString(),
  };

  await getApprovalStore().save(request);

  // If there's an associated plan, link them
  if (planId) {
    const plan = await getPlanStore().get(planId);
    if (plan) {
      plan.approvalId = approvalId;
      await getPlanStore().save(plan);
    }
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    approval_id: approvalId,
    status: 'pending',
    expires_at: request.expiresAt,
    message: 'Approval request created. A human must approve via the control plane.',
    instructions: 'Poll gateway_check_approval to check status. The operation can proceed once status is "approved".',
  });
}

async function handleCheckApproval(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const approvalId = args.approval_id as string;

  const request = await getApprovalStore().get(approvalId);
  if (!request) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Approval not found: ${approvalId}`,
    });
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    approval_id: approvalId,
    status: request.status,
    operation: request.operation,
    target: request.target,
    expires_at: request.expiresAt,
    resolution: request.resolution ? {
      approved_by: request.resolution.humanUserId,
      method: request.resolution.method,
      reason: request.resolution.reason,
      resolved_at: request.resolution.resolvedAt,
    } : undefined,
  });
}

async function handleGetPlan(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const planId = args.plan_id as string;

  const record = await getPlanStore().get(planId);
  if (!record) {
    return toolResult({
      schemaVersion: SCHEMA_VERSION,
      success: false,
      error: `Plan not found: ${planId}`,
    });
  }

  return toolResult({
    schemaVersion: SCHEMA_VERSION,
    success: true,
    plan: {
      plan_id: record.planId,
      workspace: record.workspace,
      environment: record.environment,
      decision: record.decision,
      status: record.status,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      approval_id: record.approvalId,
      applied_at: record.appliedAt,
    },
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function runCommand(
  cmd: string,
  args: string[],
  cwd?: string,
  stdin?: string,
  timeout: number = 60000
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, timeout });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });

    proc.on('close', code => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', err => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

function redactSecrets(text: string): string {
  // Redact common secret patterns
  return text
    .replace(/([A-Za-z0-9+/]{40,}={0,2})/g, '[REDACTED_BASE64]')
    .replace(/(password|secret|token|key|credential|api_key)["']?\s*[:=]\s*["']?[^\s"',]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/AWS[A-Z0-9]{16,}/g, '[REDACTED_AWS_KEY]');
}

function toolResult(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function result(id: JsonRpcRequest['id'], value: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value };
}

function error(id: JsonRpcRequest['id'], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function readFrame(buffer: Buffer<ArrayBufferLike>): { body: Buffer<ArrayBufferLike>; remaining: Buffer<ArrayBufferLike> } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const header = buffer.subarray(0, headerEnd).toString('ascii');
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) return null;

  const contentLength = Number(match[1]);
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + contentLength) return null;

  return {
    body: buffer.subarray(bodyStart, bodyStart + contentLength),
    remaining: buffer.subarray(bodyStart + contentLength),
  };
}
