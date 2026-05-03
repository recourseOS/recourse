import type { Readable, Writable } from 'stream';
import { parsePlanJson } from '../parsers/plan.js';
import { parseStateJson } from '../parsers/state.js';
import {
  evaluateMcpToolCallConsequences,
  evaluateShellCommandConsequences,
  evaluateTerraformPlanConsequences,
} from '../evaluator/index.js';
import { getSupportedResourceTypes } from '../resources/index.js';
import { toConsequenceJson } from '../output/consequence-json.js';
import type { ConsequenceReport, EvidenceSubmission } from '../core/index.js';
import type { McpToolCall } from '../adapters/index.js';
import type { AdapterContext } from '../adapters/types.js';
import type { TerraformPlan, TerraformState } from '../resources/types.js';
import { getAttestationService, type AttestationService } from '../attestation/service.js';

const SCHEMA_VERSION = 'recourse.consequence.v1';

let verbose = false;
let attestationService: AttestationService | null = null;

function log(message: string): void {
  if (verbose) {
    const timestamp = new Date().toISOString().slice(11, 19);
    process.stderr.write(`[${timestamp}] ${message}\n`);
  }
}

function logDecision(tool: string, target: string, decision: string, tier: string): void {
  if (!verbose) return;
  const emoji = decision === 'allow' ? '✓' : decision === 'warn' ? '⚠' : decision === 'block' ? '✗' : '?';
  const color = decision === 'allow' ? '\x1b[32m' : decision === 'warn' ? '\x1b[33m' : decision === 'block' ? '\x1b[31m' : '\x1b[33m';
  const reset = '\x1b[0m';
  process.stderr.write(`${color}${emoji} ${decision.toUpperCase()}${reset} ${tool} → ${target} (${tier})\n`);
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonValue;
}

const tools: ToolDefinition[] = [
  {
    name: 'recourse_evaluate_terraform',
    description:
      'Analyzes a Terraform plan for destructive or unrecoverable changes. ' +
      'Call BEFORE `terraform apply` when the plan includes deletions, replacements, or state-mutating changes. ' +
      'Pass the plan JSON from `terraform show -json plan.out`. ' +
      'Returns a consequence report with riskAssessment (`allow`, `warn`, `escalate`, `block`), per-resource recoverability tier, and traced evidence for the verdict. ' +
      'If riskAssessment is `block` or `escalate`, do not apply until a human reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: ['object', 'string'], description: 'Terraform plan JSON from `terraform show -json plan.out`.' },
        state: { type: ['object', 'string'], description: 'Terraform state JSON for dependency analysis. Improves accuracy.' },
        classifier: { type: 'boolean', description: 'Enable semantic classifier for unknown resource types.' },
        actor: { type: 'string', description: 'Identifier for the agent or user initiating this action.' },
        environment: { type: 'string', description: 'Target environment (e.g., production, staging).' },
        owner: { type: 'string', description: 'Team or individual responsible for the resources.' },
      },
      required: ['plan'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_evaluate_shell',
    description:
      'Analyzes a shell command for destructive or unrecoverable side effects. ' +
      'Call BEFORE executing commands that modify state: `rm`, `dd`, cloud CLI deletions (`aws/gcloud/az ... delete`), ' +
      'database mutations (`DROP`, `TRUNCATE`), `kubectl delete`, `docker rm`, or any destructive verb. ' +
      'Returns a consequence report with riskAssessment, recoverability tier, and recognized patterns. ' +
      'If riskAssessment is `block` or `escalate`, do not execute until a human approves.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to evaluate.' },
        cwd: { type: 'string', description: 'Working directory context for the command.' },
        actor: { type: 'string', description: 'Identifier for the agent or user initiating this action.' },
        environment: { type: 'string', description: 'Target environment (e.g., production, staging).' },
        owner: { type: 'string', description: 'Team or individual responsible for affected resources.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_evaluate_mcp_call',
    description:
      'Analyzes an MCP tool call for destructive or unrecoverable side effects. ' +
      'Call BEFORE invoking tools that modify state: databases, cloud resources, files, repos, or external services. ' +
      'Pass the tool name and arguments. ' +
      'Returns a consequence report with riskAssessment, recoverability tier, and inferred mutation type. ' +
      'If riskAssessment is `block` or `escalate`, do not invoke until a human approves.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Name of the MCP tool to evaluate.' },
        server: { type: 'string', description: 'MCP server providing the tool (e.g., aws, kubernetes).' },
        arguments: { type: 'object', description: 'Arguments that will be passed to the tool.' },
        actor: { type: 'string', description: 'Identifier for the agent or user initiating this action.' },
        environment: { type: 'string', description: 'Target environment (e.g., production, staging).' },
        owner: { type: 'string', description: 'Team or individual responsible for affected resources.' },
      },
      required: ['tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_supported_resources',
    description:
      'Returns the catalog of resource types, providers, and shell command patterns that RecourseOS evaluates with high-confidence deterministic rules. ' +
      'Call this once when planning a session involving infrastructure changes, to understand which proposed actions will receive deep evaluation versus which will fall through to conservative classifier-based defaults. ' +
      'Use the response to decide which actions are safe to execute without preflight evaluation versus which require calling `recourse_evaluate_*` first.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_evaluate_with_evidence',
    description:
      'Re-evaluates with additional evidence gathered by the agent. ' +
      'Use after running verification commands from a prior evaluation. ' +
      'Submit the original input plus evidence from verification commands. ' +
      'Returns an updated riskAssessment — may upgrade from `block`/`escalate` to `warn`/`allow` if evidence confirms recovery paths.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['terraform', 'shell', 'mcp'],
          description: 'Type of original evaluation (terraform, shell, or mcp)',
        },
        original_input: {
          type: 'object',
          description: 'The original evaluation input (plan, command, or tool call)',
        },
        evidence: {
          type: 'array',
          description: 'Evidence gathered from verification commands',
          items: {
            type: 'object',
            properties: {
              evidence_key: { type: 'string', description: 'Key from verification suggestion' },
              command_executed: { type: 'object', description: 'The verification command that was run' },
              exit_code: { type: 'number', description: 'Command exit code' },
              raw_output: { type: 'string', description: 'Raw command output' },
              parsed_evidence: { type: 'object', description: 'Structured evidence if parseable' },
              agent_interpretation: {
                type: 'string',
                enum: ['matches_expected', 'matches_failure', 'ambiguous', 'error'],
                description: 'Agent interpretation of the result',
              },
              agent_notes: { type: 'string', description: 'Additional context' },
            },
            required: ['evidence_key', 'agent_interpretation'],
          },
        },
        actor: { type: 'string', description: 'Identifier for the agent or user initiating this action.' },
        environment: { type: 'string', description: 'Target environment (e.g., production, staging).' },
        owner: { type: 'string', description: 'Team or individual responsible for the resources.' },
      },
      required: ['source', 'original_input', 'evidence'],
      additionalProperties: false,
    },
  },
];

interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

const mcpPrompts: PromptDefinition[] = [
  {
    name: 'recourse_agent_instructions',
    description:
      'Instructions for AI agents on how to use RecourseOS as a safety layer. ' +
      'Read this prompt at the start of any session involving infrastructure changes.',
  },
];

const AGENT_INSTRUCTIONS = `# RecourseOS Safety Protocol

You have access to RecourseOS, a consequence-evaluation layer for AI agents. Use it as a preflight check before executing destructive operations.

## When to Call RecourseOS

BEFORE executing any of these, call the appropriate recourse_evaluate_* tool:

1. **Shell commands that modify state**:
   - File deletions: rm, rmdir, shred
   - Cloud CLI mutations: aws/gcloud/az ... delete/terminate/remove
   - Database commands: DROP, TRUNCATE, DELETE without WHERE
   - Container operations: docker rm, kubectl delete
   - Git destructive ops: push --force, reset --hard

   → Call: recourse_evaluate_shell

2. **Terraform applies**:
   - Any plan with deletions or replacements
   - Changes to stateful resources (databases, storage, IAM)

   → Call: recourse_evaluate_terraform

3. **Other MCP tool calls**:
   - Tools that mutate external state
   - Database writes, API mutations, file modifications

   → Call: recourse_evaluate_mcp_call

## How to Interpret Results

RecourseOS returns a \`riskAssessment\`:

- **allow**: Safe to proceed
- **warn**: Proceed with caution, inform user
- **escalate**: Stop and ask user for explicit approval
- **block**: Do not proceed without human review

## Attestation Protocol

Every RecourseOS response includes a cryptographically signed \`attestation\` field. This proves:
- What input was evaluated
- What verdict was returned
- When it was evaluated
- Which RecourseOS instance signed it

**When asking for human approval (escalate/block), include the attestation:**

\`\`\`
I evaluated this command with RecourseOS:
  Command: aws rds delete-db-instance --db-instance-identifier prod-db
  Risk Assessment: block
  Reason: No snapshot, deletion protection disabled
  Attestation: abc123def456...

The attestation can be verified with: recourse verify <attestation>

Should I proceed?
\`\`\`

The attestation ID is in \`attestation.attestation_uri\` (last path segment) or derive from the full attestation JSON.

## Evidence Protocol

If riskAssessment is escalate/block but the response includes \`verificationSuggestions\`:
1. Run the suggested verification commands
2. Call recourse_evaluate_with_evidence with the results
3. The assessment may upgrade if evidence confirms recovery paths

## Key Principle

RecourseOS is an oracle — it emits facts about recoverability, not decisions.
You (the agent) decide how to act on those facts. But when in doubt, ask the human.
The attestation lets humans verify you actually checked before acting.`;

function getPrompt(params: unknown): { description: string; messages: Array<{ role: string; content: { type: string; text: string } }> } {
  const p = params as { name?: string } | undefined;
  const name = p?.name;

  if (name === 'recourse_agent_instructions') {
    return {
      description: 'Instructions for AI agents on using RecourseOS as a safety layer',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: AGENT_INSTRUCTIONS,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
}

interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const mcpResources: ResourceDefinition[] = [
  {
    uri: 'recourse://instructions',
    name: 'RecourseOS Agent Instructions',
    description: 'Safety protocol for AI agents - read this before executing destructive operations',
    mimeType: 'text/markdown',
  },
];

function readResource(params: unknown): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  const p = params as { uri?: string } | undefined;
  const uri = p?.uri;

  if (uri === 'recourse://instructions') {
    return {
      contents: [
        {
          uri: 'recourse://instructions',
          mimeType: 'text/markdown',
          text: AGENT_INSTRUCTIONS,
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}

export interface McpServerOptions {
  verbose?: boolean;
  /** Base URL for attestation URIs (default: http://localhost:3001) */
  instanceBaseUrl?: string;
}

export async function runMcpServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  options: McpServerOptions = {}
): Promise<void> {
  verbose = options.verbose ?? false;

  // Attestation is always enabled - no reason to disable trust layer
  attestationService = getAttestationService({
    instanceBaseUrl: options.instanceBaseUrl ?? 'http://localhost:3001',
  });
  await attestationService.initialize();
  if (verbose) {
    process.stderr.write(`[attestation] Initialized with key: ${attestationService.getCurrentKeyId()}\n`);
  }

  if (verbose) {
    process.stderr.write('\n┌────────────────────────────────────────┐\n');
    process.stderr.write('│  RecourseOS MCP Server                 │\n');
    process.stderr.write('│  Verbose mode enabled                  │\n');
    process.stderr.write('│  Attestation signing enabled           │\n');
    process.stderr.write('│  Waiting for agent connections...      │\n');
    process.stderr.write('└────────────────────────────────────────┘\n\n');
  }

  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let useNewlineDelimited: boolean | null = null; // Auto-detect transport mode

  input.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    // Auto-detect transport mode from first byte
    if (useNewlineDelimited === null && buffer.length > 0) {
      const firstChar = String.fromCharCode(buffer[0]);
      useNewlineDelimited = firstChar === '{'; // JSON starts with {, Content-Length starts with C
      if (verbose) {
        process.stderr.write(`[transport] Auto-detected: ${useNewlineDelimited ? 'newline-delimited JSON' : 'Content-Length framing'}\n`);
      }
    }

    if (useNewlineDelimited) {
      // Newline-delimited JSON mode
      for (;;) {
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) break;
        const line = buffer.subarray(0, newlineIdx).toString('utf8').trim();
        buffer = buffer.subarray(newlineIdx + 1);
        if (line.length > 0) {
          void handleAndWriteNewline(line, output);
        }
      }
    } else {
      // Content-Length framing mode
      for (;;) {
        const parsed = readFrame(buffer);
        if (!parsed) break;
        buffer = parsed.remaining;
        void handleAndWriteFramed(parsed.body, output);
      }
    }
  });
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  // Handle notifications (no id means no response expected)
  if (request.id === undefined) {
    // Log notifications in verbose mode but don't respond
    if (verbose && request.method === 'notifications/initialized') {
      log('Client initialized');
    }
    return null;
  }

  try {
    switch (request.method) {
      case 'initialize': {
        // Support both 2024-11-05 and 2025-11-25 protocol versions
        const params = request.params as { protocolVersion?: string } | undefined;
        const clientVersion = params?.protocolVersion ?? '2024-11-05';
        const serverVersion = clientVersion === '2025-11-25' ? '2025-11-25' : '2024-11-05';
        log(`Client protocol version: ${clientVersion}, responding with: ${serverVersion}`);
        return result(request.id, {
          protocolVersion: serverVersion,
          capabilities: {
            tools: {
              listChanged: true,
            },
            prompts: {
              listChanged: true,
            },
            resources: {
              listChanged: true,
            },
          },
          serverInfo: {
            name: 'recourseos',
            version: '0.1.26',
          },
        });
      }
      case 'tools/list':
        return result(request.id, { tools });
      case 'tools/call':
        return result(request.id, await callTool(request.params));
      case 'prompts/list':
        return result(request.id, { prompts: mcpPrompts });
      case 'prompts/get':
        return result(request.id, getPrompt(request.params));
      case 'resources/list':
        return result(request.id, { resources: mcpResources });
      case 'resources/read':
        return result(request.id, readResource(request.params));
      case 'ping':
        return result(request.id, {});
      default:
        return error(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (caught) {
    return error(
      request.id,
      -32602,
      caught instanceof Error ? caught.message : String(caught)
    );
  }
}

async function handleAndWriteFramed(body: Buffer, output: Writable): Promise<void> {
  let response: Record<string, unknown> | null;
  const request = JSON.parse(body.toString('utf8')) as JsonRpcRequest;
  try {
    response = await handleMcpRequest(request);
  } catch (caught) {
    response = error(null, -32700, caught instanceof Error ? caught.message : String(caught));
  }

  if (response) {
    writeFrame(output, response);
  }
}

async function handleAndWriteNewline(line: string, output: Writable): Promise<void> {
  let response: Record<string, unknown> | null;
  const request = JSON.parse(line) as JsonRpcRequest;
  try {
    response = await handleMcpRequest(request);
  } catch (caught) {
    response = error(null, -32700, caught instanceof Error ? caught.message : String(caught));
  }

  if (response) {
    writeNewline(output, response);
  }
}

function writeNewline(output: Writable, response: Record<string, unknown>): void {
  output.write(JSON.stringify(response) + '\n');
}

async function callTool(params: unknown): Promise<Record<string, unknown>> {
  const call = requireObject(params, 'tools/call params');
  const name = requireString(call.name, 'Tool name is required');
  const args = isObject(call.arguments) ? call.arguments : {};

  switch (name) {
    case 'recourse_evaluate_terraform': {
      const report = evaluateTerraform(args);
      const mutation = report.mutations[0];
      const target = mutation?.intent.target.id || 'terraform plan';
      const tier = mutation?.recoverability?.label || 'unknown';
      logDecision('terraform', target, report.riskAssessment, tier);
      // Include input for attestation: source + original input
      const attestInput = { source: 'terraform', plan: args.plan, state: args.state };
      return toolResult(withSchemaVersion(report, attestInput));
    }
    case 'recourse_evaluate_shell': {
      const report = evaluateShell(args);
      let cmd = 'shell';
      if (typeof args.command === 'string') {
        cmd = args.command.length > 50 ? args.command.slice(0, 47) + '...' : args.command;
      }
      const tier = report.mutations[0]?.recoverability?.label || 'unknown';
      logDecision('shell', cmd, report.riskAssessment, tier);
      const attestInput = { source: 'shell', command: args.command, cwd: args.cwd };
      return toolResult(withSchemaVersion(report, attestInput));
    }
    case 'recourse_evaluate_mcp_call': {
      const report = evaluateMcpCall(args);
      const tool = typeof args.tool === 'string' ? args.tool : 'mcp';
      const tier = report.mutations[0]?.recoverability?.label || 'unknown';
      logDecision('mcp', tool, report.riskAssessment, tier);
      const attestInput = { source: 'mcp', tool: args.tool, server: args.server, arguments: args.arguments };
      return toolResult(withSchemaVersion(report, attestInput));
    }
    case 'recourse_supported_resources':
      log('Listed supported resources');
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        resources: getSupportedResourceTypes(),
        total: getSupportedResourceTypes().length,
      });
    case 'recourse_evaluate_with_evidence': {
      const report = evaluateWithEvidence(args);
      const mutation = report.mutations[0];
      const target = mutation?.intent.target.id || 'with-evidence';
      const tier = mutation?.recoverability?.label || 'unknown';
      logDecision('evidence', target, report.riskAssessment, tier);
      const attestInput = { source: args.source, original_input: args.original_input, evidence: args.evidence };
      return toolResult(withSchemaVersion(report, attestInput));
    }
    default:
      throw new Error(`Unknown RecourseOS MCP tool: ${name}`);
  }
}

function evaluateTerraform(args: Record<string, unknown>): ConsequenceReport {
  const plan = parseTerraformPlan(args.plan);
  const state = args.state === undefined ? null : parseTerraformState(args.state);

  return evaluateTerraformPlanConsequences(plan, state, {
    useClassifier: args.classifier === true,
    adapterContext: adapterContext(args),
  });
}

function evaluateShell(args: Record<string, unknown>): ConsequenceReport {
  const command = requireString(args.command, 'Shell command is required');
  const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;

  return evaluateShellCommandConsequences({ command, cwd }, {
    adapterContext: adapterContext(args),
  });
}

function evaluateMcpCall(args: Record<string, unknown>): ConsequenceReport {
  const tool = requireString(args.tool, 'MCP tool name is required');
  const call: McpToolCall = {
    tool,
    server: typeof args.server === 'string' ? args.server : undefined,
    arguments: isObject(args.arguments) ? args.arguments : undefined,
  };

  return evaluateMcpToolCallConsequences(call, {
    adapterContext: adapterContext(args),
  });
}

function evaluateWithEvidence(args: Record<string, unknown>): ConsequenceReport {
  const source = requireString(args.source, 'source is required (terraform, shell, or mcp)');
  const originalInput = requireObject(args.original_input, 'original_input');
  const evidenceArray = args.evidence;

  if (!Array.isArray(evidenceArray)) {
    throw new Error('evidence must be an array');
  }

  // Parse evidence submissions
  const submissions: EvidenceSubmission[] = evidenceArray.map((e: unknown) => {
    const item = requireObject(e, 'evidence item');

    // Parse command_executed with proper typing
    let commandExecuted: EvidenceSubmission['command_executed'] = { type: 'aws_cli' };
    if (isObject(item.command_executed)) {
      const cmd = item.command_executed;
      commandExecuted = {
        type: (typeof cmd.type === 'string' ? cmd.type : 'aws_cli') as EvidenceSubmission['command_executed']['type'],
        argv: Array.isArray(cmd.argv) ? cmd.argv as string[] : undefined,
        timeout_seconds: typeof cmd.timeout_seconds === 'number' ? cmd.timeout_seconds : undefined,
        requires_permissions: Array.isArray(cmd.requires_permissions) ? cmd.requires_permissions as string[] : undefined,
      };
    }

    return {
      evidence_key: requireString(item.evidence_key, 'evidence_key is required'),
      command_executed: commandExecuted,
      exit_code: typeof item.exit_code === 'number' ? item.exit_code : undefined,
      raw_output: typeof item.raw_output === 'string' ? item.raw_output : undefined,
      parsed_evidence: isObject(item.parsed_evidence) ? item.parsed_evidence : undefined,
      agent_interpretation: (item.agent_interpretation as EvidenceSubmission['agent_interpretation']) || 'ambiguous',
      agent_notes: typeof item.agent_notes === 'string' ? item.agent_notes : undefined,
    };
  });

  // Re-evaluate the original input
  let baseReport: ConsequenceReport;
  switch (source) {
    case 'terraform':
      baseReport = evaluateTerraform(originalInput);
      break;
    case 'shell':
      baseReport = evaluateShell(originalInput);
      break;
    case 'mcp':
      baseReport = evaluateMcpCall(originalInput);
      break;
    default:
      throw new Error(`Unsupported source: ${source}`);
  }

  // Check if any evidence confirms recovery paths
  const positiveEvidence = submissions.filter(s => s.agent_interpretation === 'matches_expected');

  if (positiveEvidence.length > 0) {
    // Evidence confirms recovery - upgrade the verdict
    return upgradeVerdictWithEvidence(baseReport, submissions);
  }

  // No positive evidence - return original with evidence noted
  return {
    ...baseReport,
    verificationProtocolVersion: 'v1',
    // Clear suggestions since verification was attempted
    verificationSuggestions: [],
  };
}

function upgradeVerdictWithEvidence(
  baseReport: ConsequenceReport,
  evidence: EvidenceSubmission[]
): ConsequenceReport {
  // Find evidence that matches expected signals
  const confirmedEvidence = evidence.filter(e => e.agent_interpretation === 'matches_expected');

  // Update mutations with the new evidence
  const updatedMutations = baseReport.mutations.map(mutation => {
    // Check if any evidence applies to this mutation
    const relevantEvidence = confirmedEvidence.filter(e =>
      e.evidence_key.includes('snapshot') ||
      e.evidence_key.includes('backup') ||
      e.evidence_key.includes('replication') ||
      e.evidence_key.includes('versioning')
    );

    if (relevantEvidence.length > 0 && mutation.recoverability.tier === 4) {
      // Upgrade from unrecoverable to recoverable-from-backup
      return {
        ...mutation,
        recoverability: {
          tier: 3,
          label: 'recoverable-from-backup',
          reasoning: `External backup verified: ${relevantEvidence.map(e => e.evidence_key).join(', ')}`,
        },
        evidence: [
          ...mutation.evidence,
          ...relevantEvidence.map(e => ({
            key: e.evidence_key,
            value: e.parsed_evidence,
            present: true,
            description: e.agent_notes || 'Verified by agent',
          })),
        ],
      };
    }

    return mutation;
  });

  // Determine new risk assessment based on updated recoverability
  const hasUnrecoverable = updatedMutations.some(m => m.recoverability.tier === 4);
  const newAssessment = hasUnrecoverable ? baseReport.riskAssessment : 'warn';
  const newReason = hasUnrecoverable
    ? baseReport.assessmentReason
    : 'External backup verified - proceed with caution';

  return {
    ...baseReport,
    mutations: updatedMutations,
    riskAssessment: newAssessment,
    assessmentReason: newReason,
    verificationProtocolVersion: 'v1',
    verificationSuggestions: [], // Clear since verification was completed
    summary: {
      ...baseReport.summary,
      hasUnrecoverable,
    },
  };
}

function parseTerraformPlan(value: unknown): TerraformPlan {
  if (typeof value === 'string') return parsePlanJson(value);
  if (isObject(value)) return parsePlanJson(JSON.stringify(value));
  throw new Error('Terraform plan must be an object or JSON string');
}

function parseTerraformState(value: unknown): TerraformState {
  if (typeof value === 'string') return parseStateJson(value);
  if (isObject(value)) return parseStateJson(JSON.stringify(value));
  throw new Error('Terraform state must be an object or JSON string');
}

function adapterContext(args: Record<string, unknown>): AdapterContext {
  return {
    actorId: typeof args.actor === 'string' ? args.actor : undefined,
    environment: typeof args.environment === 'string' ? args.environment : undefined,
    owner: typeof args.owner === 'string' ? args.owner : undefined,
  };
}

function withSchemaVersion(
  report: ConsequenceReport,
  input?: unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    ...toConsequenceJson(report),
  };

  // Add attestation
  if (attestationService && input !== undefined) {
    try {
      // Deep copy result to avoid circular reference when attestation.output references result
      const outputCopy = JSON.parse(JSON.stringify(result));
      const attestation = attestationService.createAttestation(input, outputCopy);
      result.attestation = attestation;
    } catch (err) {
      // Log but don't fail the evaluation
      if (verbose) {
        process.stderr.write(`[attestation] Failed to create attestation: ${err}\n`);
      }
    }
  }

  return result;
}

function toolResult(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function result(id: JsonRpcRequest['id'], value: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    result: value,
  };
}

function error(id: JsonRpcRequest['id'], code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

function readFrame(buffer: Buffer): { body: Buffer; remaining: Buffer } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const header = buffer.subarray(0, headerEnd).toString('ascii');
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) {
    throw new Error('MCP frame missing Content-Length header');
  }

  const contentLength = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const frameEnd = bodyStart + contentLength;
  if (buffer.length < frameEnd) return null;

  return {
    body: buffer.subarray(bodyStart, frameEnd),
    remaining: buffer.subarray(frameEnd),
  };
}

function writeFrame(output: Writable, response: Record<string, unknown>): void {
  const body = JSON.stringify(response);
  output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Get the attestation service instance (for HTTP endpoints)
 */
export function getMcpAttestationService(): AttestationService | null {
  return attestationService;
}
