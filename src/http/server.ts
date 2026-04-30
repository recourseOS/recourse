import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { parsePlanJson } from '../parsers/plan.js';
import {
  evaluateMcpToolCallConsequences,
  evaluateShellCommandConsequences,
  evaluateTerraformPlanConsequences,
} from '../evaluator/index.js';
import { toConsequenceJson } from '../output/consequence-json.js';
import type { McpToolCall } from '../adapters/index.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface EvaluateRequest {
  source: 'terraform' | 'shell' | 'mcp';
  input: unknown;
  options?: {
    classifier?: boolean;
    actor?: string;
    environment?: string;
    owner?: string;
  };
}

export function runHttpServer(port: number = 3001): void {
  const server = createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', version: '0.1.5' });
      return;
    }

    // Evaluate endpoint
    if (req.method === 'POST' && req.url === '/evaluate') {
      try {
        const body = await readBody(req);
        const request = JSON.parse(body) as EvaluateRequest;
        const result = evaluate(request);
        sendJson(res, 200, {
          schemaVersion: 'recourse.consequence.v1',
          ...toConsequenceJson(result),
        });
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // 404
    sendJson(res, 404, { error: 'Not found' });
  });

  server.listen(port, () => {
    console.log(`RecourseOS HTTP server running at http://localhost:${port}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  /health    - Health check`);
    console.log(`  POST /evaluate  - Evaluate a proposed action`);
    console.log('');
    console.log('The console at http://localhost:8080 will auto-connect to this server.');
    console.log('Press Ctrl+C to stop.');
  });
}

function evaluate(request: EvaluateRequest) {
  const adapterContext = {
    actorId: request.options?.actor,
    environment: request.options?.environment,
    owner: request.options?.owner,
  };

  switch (request.source) {
    case 'terraform': {
      const planJson = typeof request.input === 'string'
        ? request.input
        : JSON.stringify(request.input);
      const plan = parsePlanJson(planJson);
      return evaluateTerraformPlanConsequences(plan, null, {
        useClassifier: request.options?.classifier ?? false,
        adapterContext,
      });
    }

    case 'shell': {
      if (typeof request.input !== 'string') {
        throw new Error('Shell input must be a command string');
      }
      return evaluateShellCommandConsequences(request.input, { adapterContext });
    }

    case 'mcp': {
      const call = request.input as McpToolCall;
      if (!call || typeof call.tool !== 'string') {
        throw new Error('MCP input must have a "tool" field');
      }
      return evaluateMcpToolCallConsequences(call, { adapterContext });
    }

    default:
      throw new Error(`Unsupported source: ${request.source}`);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(data, null, 2));
}
