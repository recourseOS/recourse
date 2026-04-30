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
import type { ConsequenceReport } from '../core/index.js';
import type { McpToolCall } from '../adapters/index.js';
import type { AdapterContext } from '../adapters/types.js';
import type { TerraformPlan, TerraformState } from '../resources/types.js';

const SCHEMA_VERSION = 'recourse.consequence.v1';

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
    description: 'Evaluate Terraform plan JSON before an agent applies infrastructure changes.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: ['object', 'string'], description: 'Terraform plan JSON object or JSON string from terraform show -json.' },
        state: { type: ['object', 'string'], description: 'Optional Terraform state JSON object or JSON string.' },
        classifier: { type: 'boolean', description: 'Use provider-neutral classifier for unknown resource types.' },
        actor: { type: 'string' },
        environment: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['plan'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_evaluate_shell',
    description: 'Evaluate a shell command before an agent executes it.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        actor: { type: 'string' },
        environment: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_evaluate_mcp_call',
    description: 'Evaluate another MCP tool call before an agent invokes it.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        tool: { type: 'string' },
        arguments: { type: 'object' },
        actor: { type: 'string' },
        environment: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'recourse_supported_resources',
    description: 'List deterministic resource types supported by RecourseOS.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function runMcpServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): void {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  input.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    for (;;) {
      const parsed = readFrame(buffer);
      if (!parsed) break;
      buffer = parsed.remaining;
      void handleAndWrite(parsed.body, output);
    }
  });
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.id === undefined) return null;

  try {
    switch (request.method) {
      case 'initialize':
        return result(request.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'recourseos',
            version: '0.1.4',
          },
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
  } catch (caught) {
    return error(
      request.id,
      -32602,
      caught instanceof Error ? caught.message : String(caught)
    );
  }
}

async function handleAndWrite(body: Buffer, output: Writable): Promise<void> {
  let response: Record<string, unknown> | null;
  try {
    response = await handleMcpRequest(JSON.parse(body.toString('utf8')) as JsonRpcRequest);
  } catch (caught) {
    response = error(null, -32700, caught instanceof Error ? caught.message : String(caught));
  }

  if (response) {
    writeFrame(output, response);
  }
}

async function callTool(params: unknown): Promise<Record<string, unknown>> {
  const call = requireObject(params, 'tools/call params');
  const name = requireString(call.name, 'Tool name is required');
  const args = isObject(call.arguments) ? call.arguments : {};

  switch (name) {
    case 'recourse_evaluate_terraform':
      return toolResult(withSchemaVersion(evaluateTerraform(args)));
    case 'recourse_evaluate_shell':
      return toolResult(withSchemaVersion(evaluateShell(args)));
    case 'recourse_evaluate_mcp_call':
      return toolResult(withSchemaVersion(evaluateMcpCall(args)));
    case 'recourse_supported_resources':
      return toolResult({
        schemaVersion: SCHEMA_VERSION,
        resources: getSupportedResourceTypes(),
        total: getSupportedResourceTypes().length,
      });
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

function withSchemaVersion(report: ConsequenceReport): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...toConsequenceJson(report),
  };
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
