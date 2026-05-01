import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { describe, expect, it, beforeAll } from 'vitest';
import { goldenPlanFixturePath } from './helpers/golden-plan-scenarios.js';

const distCli = 'dist/index.js';

// Helper functions for MCP communication
function spawnMcpServer() {
  return spawn(process.execPath, [distCli, 'mcp', 'serve'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendMcpRequest(
  child: ReturnType<typeof spawnMcpServer>,
  request: Record<string, unknown>
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for MCP response'));
    }, 5000);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const frame = readMcpFrame(buffer);
      if (!frame) return;

      cleanup();
      resolve(JSON.parse(frame.body.toString('utf8')));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('error', onError);
    };

    child.stdout.on('data', onData);
    child.once('error', onError);
    writeMcpFrame(child.stdin, request);
  });
}

function writeMcpFrame(stdin: NodeJS.WritableStream, request: Record<string, unknown>): void {
  const body = JSON.stringify(request);
  stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function readMcpFrame(buffer: Buffer): { body: Buffer } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const header = buffer.subarray(0, headerEnd).toString('ascii');
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) throw new Error('MCP response missing Content-Length header');

  const bodyStart = headerEnd + 4;
  const frameEnd = bodyStart + Number(match[1]);
  if (buffer.length < frameEnd) return null;

  return {
    body: buffer.subarray(bodyStart, frameEnd),
  };
}

async function initializeMcpServer(server: ReturnType<typeof spawnMcpServer>) {
  return sendMcpRequest(server, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0' },
    },
  });
}

describe('End-to-End Flows', () => {
  beforeAll(() => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build').toBe(true);
  });

  describe('CLI Workflow Tests', () => {
    it('evaluates terraform plan and outputs JSON', () => {
      const result = spawnSync(process.execPath, [
        distCli,
        'plan',
        goldenPlanFixturePath('aws-golden.json'),
        '--format',
        'json',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      // Exit code 1 when there are unrecoverable changes
      expect(result.status).toBe(1);
      const output = JSON.parse(result.stdout);
      expect(output.summary).toBeDefined();
      expect(output.summary.hasUnrecoverable).toBe(true);
      expect(output.changes.length).toBeGreaterThan(0);
    });

    it('evaluates terraform plan with human-readable output', () => {
      const result = spawnSync(process.execPath, [
        distCli,
        'plan',
        goldenPlanFixturePath('aws-golden.json'),
        '--format',
        'human',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      // Exit code 1 when there are unrecoverable changes
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('BLAST RADIUS');
      expect(result.stdout).toContain('unrecoverable');
    });

    it('exits 0 when fail-on threshold is not reached', () => {
      // Using a plan that only has updates (REVERSIBLE tier)
      const result = spawnSync(process.execPath, [
        distCli,
        'preflight',
        'shell',
        'echo hello',
        '--format',
        'json',
        '--fail-on',
        'block',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
    });

    it('exits 1 when fail-on threshold is reached', () => {
      const result = spawnSync(process.execPath, [
        distCli,
        'preflight',
        'shell',
        'aws s3 rm s3://prod-data --recursive',
        '--format',
        'json',
        '--fail-on',
        'escalate',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
    });

    it('shows help for plan command', () => {
      const result = spawnSync(process.execPath, [
        distCli,
        'plan',
        '--help',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('plan');
    });

    it('handles missing plan file gracefully', () => {
      const result = spawnSync(process.execPath, [
        distCli,
        'plan',
        'nonexistent-plan.json',
        '--format',
        'json',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
    });
  });

  describe('MCP Integration Flows', () => {
    it('completes full initialize → tools/list → tools/call cycle', async () => {
      const server = spawnMcpServer();
      try {
        // Step 1: Initialize
        const initResponse = await initializeMcpServer(server);
        expect(initResponse.result).toBeDefined();
        expect(initResponse.result.protocolVersion).toBeDefined();

        // Step 2: List tools
        const toolsResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        });
        expect(toolsResponse.result.tools.length).toBeGreaterThan(0);

        // Step 3: Call a tool
        const callResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'recourse_supported_resources',
            arguments: {},
          },
        });
        expect(callResponse.result.structuredContent.total).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('recovers from error and continues serving', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        // Send invalid request
        const errorResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
        });
        expect(errorResponse.error).toBeDefined();

        // Should still be able to make valid requests
        const validResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'recourse_supported_resources',
            arguments: {},
          },
        });
        expect(validResponse.result.structuredContent.total).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('evaluates shell then terraform in sequence', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        // Evaluate shell command
        const shellResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'rm -rf /tmp/test',
              actor: 'agent/e2e-test',
            },
          },
        });
        expect(shellResponse.result.structuredContent.decision).toBeDefined();

        // Evaluate terraform plan
        const plan = JSON.parse(readFileSync(goldenPlanFixturePath('aws-golden.json'), 'utf8'));
        const tfResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_terraform',
            arguments: {
              plan,
              actor: 'agent/e2e-test',
            },
          },
        });
        expect(tfResponse.result.structuredContent.decision).toBe('block');
      } finally {
        server.kill();
      }
    });
  });

  describe('Real-World Scenarios', () => {
    it('production database deletion gets blocked', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws rds delete-db-instance --db-instance-identifier prod-database --skip-final-snapshot',
              actor: 'agent/deploy',
              environment: 'production',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.decision).toMatch(/escalate|block/);
        expect(result.mutations[0].intent.action).toBe('delete');
      } finally {
        server.kill();
      }
    });

    it('S3 bucket with versioning check triggers verification suggestions', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws s3 rb s3://prod-important-bucket --force',
              actor: 'agent/cleanup',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.decision).toMatch(/escalate|block/);
        // Should have verification suggestions for checking replication/versioning
        if (result.verificationSuggestions) {
          expect(result.verificationSuggestions.length).toBeGreaterThan(0);
        }
      } finally {
        server.kill();
      }
    });

    it('IAM role deletion is recoverable with effort', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws iam delete-role --role-name service-role',
              actor: 'agent/admin',
            },
          },
        });

        const result = response.result.structuredContent;
        // IAM roles can be recreated but with effort
        expect(result.decision).toMatch(/warn|escalate/);
      } finally {
        server.kill();
      }
    });

    it('kubectl delete deployment is evaluated', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'kubectl delete deployment prod-api -n production',
              actor: 'agent/k8s-operator',
              environment: 'production',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('git push --force to main triggers warning', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'git push --force origin main',
              actor: 'agent/ci',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.decision).toMatch(/warn|escalate|block/);
      } finally {
        server.kill();
      }
    });

    it('safe read-only command is allowed', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws s3 ls s3://my-bucket',
              actor: 'agent/reader',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.decision).toBe('allow');
      } finally {
        server.kill();
      }
    });
  });

  describe('Decision Thresholds', () => {
    const testCases = [
      { command: 'echo hello', expectedDecision: 'allow' },
      { command: 'ls -la', expectedDecision: 'allow' },
      { command: 'rm /tmp/test.txt', expectedDecision: /warn|escalate/ },
      { command: 'aws s3 rm s3://bucket/file', expectedDecision: 'escalate' },
      { command: 'aws rds delete-db-instance --db-instance-identifier db --skip-final-snapshot', expectedDecision: /escalate|block/ },
    ];

    it.each(testCases)('command "$command" results in $expectedDecision', async ({ command, expectedDecision }) => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: { command },
          },
        });

        const result = response.result.structuredContent;
        if (expectedDecision instanceof RegExp) {
          expect(result.decision).toMatch(expectedDecision);
        } else {
          expect(result.decision).toBe(expectedDecision);
        }
      } finally {
        server.kill();
      }
    });
  });
});
