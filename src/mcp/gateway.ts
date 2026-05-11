/**
 * RecourseOS MCP Gateway Mode
 *
 * Proxies MCP tool calls through RecourseOS evaluation.
 * Agents connect to this gateway instead of directly to MCP servers.
 * Dangerous tool calls are blocked before reaching the underlying server.
 *
 * Architecture:
 *   Agent → RecourseOS Gateway → [Evaluate] → Upstream MCP Server
 *                                    ↓
 *                              Block if dangerous
 */

import { spawn, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import { createInterface } from 'readline';
import {
  evaluateMcpToolCallConsequences,
} from '../evaluator/index.js';
import { toConsequenceJson } from '../output/consequence-json.js';
import { getAttestationService, type AttestationService } from '../attestation/service.js';

// Valid risk level values
export type RiskLevel = 'allow' | 'warn' | 'escalate' | 'block';
const VALID_RISK_LEVELS: RiskLevel[] = ['allow', 'warn', 'escalate', 'block'];

/**
 * Parse and validate risk levels from a comma-separated string.
 * Invalid values are filtered out with a warning.
 */
export function parseRiskLevels(input: string): RiskLevel[] {
  const levels = input.split(',').map(s => s.trim().toLowerCase());
  const valid: RiskLevel[] = [];
  const invalid: string[] = [];

  for (const level of levels) {
    if (VALID_RISK_LEVELS.includes(level as RiskLevel)) {
      valid.push(level as RiskLevel);
    } else if (level.length > 0) {
      invalid.push(level);
    }
  }

  if (invalid.length > 0) {
    console.warn(`[WARN] Invalid risk levels ignored: ${invalid.join(', ')}. Valid: ${VALID_RISK_LEVELS.join(', ')}`);
  }

  return valid.length > 0 ? valid : ['allow', 'warn']; // Default if all invalid
}

// Gateway configuration
export interface GatewayConfig {
  // Upstream MCP servers to proxy
  upstreams: UpstreamServer[];

  // Risk levels that are allowed to proceed
  allowedRiskLevels: ('allow' | 'warn' | 'escalate' | 'block')[];

  // Enable verbose logging
  verbose?: boolean;

  // Enable attestation
  attestation?: boolean;
}

interface UpstreamServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface UpstreamConnection {
  name: string;
  process: ChildProcess;
  tools: ToolDefinition[];
  pending: Map<string | number, (response: JsonRpcResponse) => void>;
  nextId: number;
}

let verbose = false;
let attestationService: AttestationService | null = null;

function log(message: string): void {
  if (verbose) {
    const timestamp = new Date().toISOString().slice(11, 19);
    process.stderr.write(`[gateway ${timestamp}] ${message}\n`);
  }
}

/**
 * Connect to an upstream MCP server
 */
async function connectUpstream(server: UpstreamServer): Promise<UpstreamConnection> {
  log(`Connecting to upstream: ${server.name} (${server.command})`);

  const proc = spawn(server.command, server.args || [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...server.env },
  });

  const connection: UpstreamConnection = {
    name: server.name,
    process: proc,
    tools: [],
    pending: new Map(),
    nextId: 1,
  };

  // Handle responses from upstream
  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  rl.on('line', (line) => {
    try {
      const response: JsonRpcResponse = JSON.parse(line);
      if (response.id !== undefined && response.id !== null) {
        const callback = connection.pending.get(response.id);
        if (callback) {
          connection.pending.delete(response.id);
          callback(response);
        }
      }
    } catch (e) {
      log(`Error parsing upstream response: ${e}`);
    }
  });

  proc.stderr?.on('data', (data) => {
    log(`[${server.name}] ${data.toString().trim()}`);
  });

  // Initialize the connection
  await sendToUpstream(connection, { jsonrpc: '2.0', method: 'initialize', params: {} });

  // Get available tools
  const toolsResponse = await sendToUpstream(connection, {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
  });

  if (toolsResponse.result && (toolsResponse.result as any).tools) {
    connection.tools = (toolsResponse.result as any).tools;
    log(`Discovered ${connection.tools.length} tools from ${server.name}`);
  }

  return connection;
}

/**
 * Send a request to an upstream server and wait for response
 */
function sendToUpstream(
  connection: UpstreamConnection,
  request: Omit<JsonRpcRequest, 'id'> & { id?: string | number }
): Promise<JsonRpcResponse> {
  return new Promise((resolve) => {
    const id = request.id ?? connection.nextId++;
    const fullRequest = { ...request, id };

    connection.pending.set(id, resolve);
    connection.process.stdin!.write(JSON.stringify(fullRequest) + '\n');
  });
}

/**
 * Find which upstream owns a tool
 */
function findToolOwner(
  toolName: string,
  upstreams: UpstreamConnection[]
): UpstreamConnection | null {
  for (const upstream of upstreams) {
    if (upstream.tools.some((t) => t.name === toolName)) {
      return upstream;
    }
  }
  return null;
}

/**
 * Evaluate a tool call with RecourseOS
 */
async function evaluateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: GatewayConfig
): Promise<{ allowed: boolean; report: any; attestation?: any }> {
  const report = await evaluateMcpToolCallConsequences({
    tool: toolName,
    arguments: args,
  });

  const jsonReport = toConsequenceJson(report);
  const riskAssessment = jsonReport.riskAssessment as string;

  // Create attestation if enabled
  let attestation = undefined;
  if (attestationService) {
    const input = { tool: toolName, arguments: args };
    attestation = attestationService.createAttestation(input, jsonReport);
  }

  // Validate risk assessment is a known level before checking policy
  const isValidLevel = VALID_RISK_LEVELS.includes(riskAssessment as RiskLevel);
  const allowed = isValidLevel && config.allowedRiskLevels.includes(riskAssessment as RiskLevel);

  return { allowed, report: jsonReport, attestation };
}

/**
 * Handle incoming JSON-RPC request from agent
 */
async function handleRequest(
  request: JsonRpcRequest,
  upstreams: UpstreamConnection[],
  config: GatewayConfig,
  sendResponse: (response: JsonRpcResponse) => void
): Promise<void> {
  log(`Request: ${request.method}`);

  // Handle initialization
  if (request.method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'recourse-gateway',
          version: '0.1.0',
        },
        capabilities: {
          tools: {},
        },
      },
    });
    return;
  }

  // Handle tools/list - aggregate from all upstreams + add RecourseOS tools
  if (request.method === 'tools/list') {
    const allTools: ToolDefinition[] = [];

    // Add tools from all upstreams (prefixed with upstream name for clarity)
    for (const upstream of upstreams) {
      for (const tool of upstream.tools) {
        allTools.push({
          ...tool,
          // Optionally prefix: name: `${upstream.name}__${tool.name}`,
          description: `[via ${upstream.name}] ${tool.description}`,
        });
      }
    }

    // Add RecourseOS metadata tool
    allTools.push({
      name: 'recourse_gateway_status',
      description: 'Get RecourseOS gateway status and policy',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });

    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: { tools: allTools },
    });
    return;
  }

  // Handle tools/call - evaluate before forwarding
  if (request.method === 'tools/call') {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    const toolName = params.name;
    const toolArgs = params.arguments || {};

    // Handle gateway status tool
    if (toolName === 'recourse_gateway_status') {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              gateway: 'recourse',
              version: '0.1.0',
              upstreams: upstreams.map((u) => ({
                name: u.name,
                tools: u.tools.length,
              })),
              policy: {
                allowedRiskLevels: config.allowedRiskLevels,
              },
            }, null, 2),
          }],
        },
      });
      return;
    }

    // Find which upstream owns this tool
    const owner = findToolOwner(toolName, upstreams);
    if (!owner) {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      });
      return;
    }

    // Evaluate the tool call
    log(`Evaluating: ${toolName}`);
    const evaluation = await evaluateToolCall(toolName, toolArgs, config);

    if (!evaluation.allowed) {
      // BLOCKED - return error with explanation
      log(`BLOCKED: ${toolName} - ${evaluation.report.riskAssessment}`);
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: `RecourseOS BLOCKED: ${evaluation.report.assessmentReason}`,
          data: {
            riskAssessment: evaluation.report.riskAssessment,
            attestation: evaluation.attestation?.attestation_uri,
            mutations: evaluation.report.mutations,
          },
        },
      });
      return;
    }

    // ALLOWED - forward to upstream
    log(`ALLOWED: ${toolName} - forwarding to ${owner.name}`);
    const response = await sendToUpstream(owner, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    });

    // Add attestation to response metadata
    if (evaluation.attestation && response.result) {
      (response.result as any)._recourse = {
        attestation_uri: evaluation.attestation.attestation_uri,
        risk_assessment: evaluation.report.riskAssessment,
      };
    }

    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: response.result,
      error: response.error,
    });
    return;
  }

  // Forward other requests to first upstream (or handle specially)
  if (upstreams.length > 0) {
    const response = await sendToUpstream(upstreams[0], {
      jsonrpc: '2.0',
      method: request.method,
      params: request.params,
      id: request.id ?? undefined,
    });
    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: response.result,
      error: response.error,
    });
  } else {
    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    });
  }
}

/**
 * Start the MCP Gateway
 */
export async function startGateway(
  config: GatewayConfig,
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<void> {
  verbose = config.verbose ?? false;
  log('Starting RecourseOS MCP Gateway');

  // Initialize attestation service
  if (config.attestation !== false) {
    attestationService = getAttestationService();
    await attestationService.initialize();
    log(`Attestation enabled with key: ${attestationService.getCurrentKeyId()}`);
  }

  // Connect to all upstream servers
  const upstreams: UpstreamConnection[] = [];
  for (const server of config.upstreams) {
    try {
      const conn = await connectUpstream(server);
      upstreams.push(conn);
    } catch (e) {
      log(`Failed to connect to ${server.name}: ${e}`);
    }
  }

  log(`Connected to ${upstreams.length} upstream servers`);
  log(`Policy: allow ${config.allowedRiskLevels.join(', ')}`);

  // Process incoming requests from agent
  const rl = createInterface({ input, crlfDelay: Infinity });

  const sendResponse = (response: JsonRpcResponse) => {
    output.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', async (line) => {
    try {
      const request: JsonRpcRequest = JSON.parse(line);
      await handleRequest(request, upstreams, config, sendResponse);
    } catch (e) {
      log(`Error handling request: ${e}`);
    }
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    log('Shutting down gateway');
    for (const upstream of upstreams) {
      upstream.process.kill();
    }
    process.exit(0);
  });
}

/**
 * Load gateway config from file or environment
 */
export function loadGatewayConfig(configPath?: string): GatewayConfig {
  // Default config with common MCP servers
  const defaultConfig: GatewayConfig = {
    upstreams: [],
    allowedRiskLevels: ['allow', 'warn'],
    verbose: process.env.RECOURSE_VERBOSE === 'true',
    attestation: true,
  };

  // Load from file if provided
  if (configPath) {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...defaultConfig, ...config };
  }

  // Load from environment
  if (process.env.RECOURSE_UPSTREAMS) {
    try {
      defaultConfig.upstreams = JSON.parse(process.env.RECOURSE_UPSTREAMS);
    } catch {
      log('Failed to parse RECOURSE_UPSTREAMS');
    }
  }

  if (process.env.RECOURSE_ALLOWED_LEVELS) {
    defaultConfig.allowedRiskLevels = parseRiskLevels(process.env.RECOURSE_ALLOWED_LEVELS);
  }

  return defaultConfig;
}
