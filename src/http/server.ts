import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { parsePlanJson } from '../parsers/plan.js';
import {
  evaluateMcpToolCallConsequences,
  evaluateShellCommandConsequences,
  evaluateTerraformPlanConsequences,
} from '../evaluator/index.js';
import { toConsequenceJson } from '../output/consequence-json.js';
import type { McpToolCall } from '../adapters/index.js';
import { getAttestationService, type AttestationService } from '../attestation/service.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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

export interface HttpServerOptions {
  port?: number;
  openBrowser?: boolean;
}

export async function runHttpServer(options: HttpServerOptions = {}): Promise<void> {
  const port = options.port ?? 3001;
  const openBrowser = options.openBrowser ?? true;

  // Attestation is always enabled - no reason to disable trust layer
  const attestationService = getAttestationService({
    instanceBaseUrl: `http://localhost:${port}`,
  });
  await attestationService.initialize();
  console.log(`Attestation enabled with key: ${attestationService.getCurrentKeyId()}`);

  // Find the docs directory relative to this file
  const currentFile = fileURLToPath(import.meta.url);
  // Go up from dist/http/server.js to project root, then to docs
  const docsDir = join(currentFile, '..', '..', '..', 'docs');

  const server = createServer(async (req, res) => {
    const url = req.url || '/';

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // Well-known: Key Registry (§5.3)
    if (req.method === 'GET' && url === '/.well-known/recourse-keys.json') {
      const registry = attestationService.getKeyRegistry();
      sendJson(res, 200, registry);
      return;
    }

    // Well-known: Attestation retrieval (§6.3)
    const attestationMatch = url.match(/^\/.well-known\/attestations\/([a-f0-9]{32})\.json$/);
    if (req.method === 'GET' && attestationMatch) {
      const attestationId = attestationMatch[1];
      const attestation = attestationService.getAttestation(attestationId);
      if (!attestation) {
        sendJson(res, 404, { error: 'Attestation not found' });
        return;
      }
      sendJson(res, 200, attestation);
      return;
    }

    // API: Health check
    if (req.method === 'GET' && url === '/api/health') {
      sendJson(res, 200, { status: 'ok', version: '0.1.33' });
      return;
    }

    // API: Evaluate endpoint
    if (req.method === 'POST' && url === '/api/evaluate') {
      try {
        const body = await readBody(req);
        const request = JSON.parse(body) as EvaluateRequest;
        const result = evaluate(request);
        const response: Record<string, unknown> = {
          schemaVersion: 'recourse.consequence.v1',
          ...toConsequenceJson(result),
        };

        // Add attestation to response
        try {
          const attestInput = {
            source: request.source,
            input: request.input,
          };
          // Deep copy response to avoid circular reference when attestation.output references response
          const outputCopy = JSON.parse(JSON.stringify(response));
          const attestation = attestationService.createAttestation(attestInput, outputCopy);
          response.attestation = attestation;
        } catch (err) {
          // Don't fail evaluation if attestation fails
          console.error('Attestation error:', err);
        }

        sendJson(res, 200, response);
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // Static files: Serve from docs directory
    if (req.method === 'GET') {
      let filePath = url === '/' ? '/index.html' : url;

      // Remove query string
      filePath = filePath.split('?')[0];

      const fullPath = join(docsDir, filePath);

      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath);
          const ext = extname(fullPath);
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';

          res.writeHead(200, {
            ...CORS_HEADERS,
            'Content-Type': contentType,
          });
          res.end(content);
          return;
        } catch {
          // Fall through to 404
        }
      }
    }

    // 404
    sendJson(res, 404, { error: 'Not found' });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already in use.`);
      console.error(`\nOptions:`);
      console.error(`  1. Stop the other process using port ${port}`);
      console.error(`  2. Use a different port: recourse serve --port 3002\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    const attestLines = `
│   Attestation Endpoints:                            │
│     GET  /.well-known/recourse-keys.json            │
│     GET  /.well-known/attestations/{id}.json        │
│                                                     │`;
    console.log(`
┌─────────────────────────────────────────────────────┐
│                                                     │
│   RecourseOS Playground                             │
│   ${url.padEnd(45)}│
│                                                     │
│   API Endpoints:                                    │
│     POST /api/evaluate  - Evaluate an action        │
│     GET  /api/health    - Health check              │
│                                                     │${attestLines}
│   Press Ctrl+C to stop                              │
│                                                     │
└─────────────────────────────────────────────────────┘
`);

    if (openBrowser) {
      openUrl(url);
    }
  });
}

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`);
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
      const raw = request.input as Record<string, unknown>;
      // Accept both 'tool' and 'name' for MCP compatibility
      const toolName = raw?.tool ?? raw?.name;
      if (!toolName || typeof toolName !== 'string') {
        throw new Error('MCP input must have a "tool" field (e.g., { "tool": "s3.delete_bucket", "arguments": {...} })');
      }
      const call: McpToolCall = {
        tool: toolName,
        server: typeof raw.server === 'string' ? raw.server : undefined,
        arguments: raw.arguments as Record<string, unknown> | undefined,
      };
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
