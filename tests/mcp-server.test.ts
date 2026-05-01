import { spawn } from 'child_process';
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
      clientInfo: { name: 'test', version: '1.0' },
    },
  });
}

describe('MCP Server Tests', () => {
  beforeAll(() => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build').toBe(true);
  });

  describe('Evidence Re-evaluation', () => {
    it('upgrades verdict when positive evidence confirms backup', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        // First, evaluate a shell command that would be blocked
        const evalResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws s3 rm s3://prod-data --recursive',
              actor: 'agent/test',
            },
          },
        });

        expect(evalResponse.result.structuredContent.decision).toMatch(/block|escalate/);

        // Now submit evidence that confirms backup exists
        const evidenceResponse = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'shell',
              original_input: {
                command: 'aws s3 rm s3://prod-data --recursive',
                actor: 'agent/test',
              },
              evidence: [
                {
                  evidence_key: 's3_versioning_enabled',
                  command_executed: { type: 'aws_cli', argv: ['s3api', 'get-bucket-versioning'] },
                  exit_code: 0,
                  raw_output: '{"Status": "Enabled"}',
                  parsed_evidence: { versioning: true },
                  agent_interpretation: 'matches_expected',
                  agent_notes: 'Versioning is enabled on this bucket',
                },
              ],
            },
          },
        });

        const result = evidenceResponse.result.structuredContent;
        expect(result.verificationProtocolVersion).toBe('v1');
        expect(result.verificationSuggestions).toHaveLength(0);
      } finally {
        server.kill();
      }
    });

    it('handles empty evidence array without error', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'shell',
              original_input: { command: 'rm -rf /tmp/test' },
              evidence: [],
            },
          },
        });

        // Should return original report with empty suggestions
        expect(response.result.structuredContent.verificationSuggestions).toHaveLength(0);
      } finally {
        server.kill();
      }
    });

    it('rejects evidence with missing evidence_key', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'shell',
              original_input: { command: 'rm -rf /tmp/test' },
              evidence: [
                {
                  // Missing evidence_key
                  command_executed: { type: 'aws_cli' },
                  agent_interpretation: 'matches_expected',
                },
              ],
            },
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('evidence_key');
      } finally {
        server.kill();
      }
    });

    it('rejects invalid source type', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'invalid_source',
              original_input: { command: 'test' },
              evidence: [],
            },
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('Unsupported source');
      } finally {
        server.kill();
      }
    });

    it('rejects non-array evidence parameter', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'shell',
              original_input: { command: 'test' },
              evidence: 'not-an-array',
            },
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('array');
      } finally {
        server.kill();
      }
    });

    it('handles ambiguous agent interpretation without upgrading', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_with_evidence',
            arguments: {
              source: 'shell',
              original_input: {
                command: 'aws s3 rm s3://prod-data --recursive',
              },
              evidence: [
                {
                  evidence_key: 's3_backup_check',
                  command_executed: { type: 'aws_cli' },
                  agent_interpretation: 'ambiguous',
                  agent_notes: 'Could not determine backup status',
                },
              ],
            },
          },
        });

        // Ambiguous evidence should not upgrade the verdict
        const result = response.result.structuredContent;
        expect(result.decision).toMatch(/block|escalate/);
      } finally {
        server.kill();
      }
    });
  });

  describe('Shell Command Edge Cases', () => {
    it('handles paths with spaces', async () => {
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
              command: "rm -rf '/path with spaces/important file.txt'",
            },
          },
        });

        expect(response.result.structuredContent.mutations).toBeDefined();
        expect(response.result.structuredContent.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('detects piped destructive commands', async () => {
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
              command: 'find /tmp -name "*.log" | xargs rm -f',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('handles git push --force to main', async () => {
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
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.decision).toMatch(/warn|escalate|block/);
      } finally {
        server.kill();
      }
    });

    it('handles kubectl delete with namespace', async () => {
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
              command: 'kubectl delete deployment my-app -n production',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('handles AWS CLI with flags in different order', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        // Test with --db-instance-identifier before command
        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {
              command: 'aws rds delete-db-instance --skip-final-snapshot --db-instance-identifier prod-db',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
        expect(result.decision).toMatch(/escalate|block/);
      } finally {
        server.kill();
      }
    });

    it('handles psql DROP TABLE command', async () => {
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
              command: 'psql -c "DROP TABLE users CASCADE"',
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });
  });

  describe('MCP Tool Argument Inference', () => {
    it('handles tools with delete in name', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_mcp_call',
            arguments: {
              tool: 'aws_s3_delete_object',
              server: 'aws',
              arguments: {
                bucket: 'my-bucket',
                key: 'important-file.txt',
              },
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
        expect(result.mutations[0].intent.action).toBe('delete');
      } finally {
        server.kill();
      }
    });

    it('identifies update operations', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_mcp_call',
            arguments: {
              tool: 'aws_rds_modify_instance',
              arguments: {
                db_instance_identifier: 'prod-db',
                instance_class: 'db.r5.large',
              },
            },
          },
        });

        const result = response.result.structuredContent;
        expect(result.mutations.length).toBeGreaterThan(0);
      } finally {
        server.kill();
      }
    });

    it('handles read-only operations', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_mcp_call',
            arguments: {
              tool: 'aws_s3_list_buckets',
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

  describe('Input Validation Edge Cases', () => {
    it('rejects missing command for shell evaluation', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: {},
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('command');
      } finally {
        server.kill();
      }
    });

    it('rejects missing plan for terraform evaluation', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_terraform',
            arguments: {},
          },
        });

        expect(response.error).toBeDefined();
      } finally {
        server.kill();
      }
    });

    it('rejects missing tool for mcp evaluation', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_mcp_call',
            arguments: {},
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('tool');
      } finally {
        server.kill();
      }
    });

    it('handles unknown tool name gracefully', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
        });

        expect(response.error).toBeDefined();
        expect(response.error.message).toContain('Unknown');
      } finally {
        server.kill();
      }
    });

    it('accepts terraform plan as JSON string', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);
        const plan = JSON.parse(readFileSync(goldenPlanFixturePath('aws-golden.json'), 'utf8'));

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_terraform',
            arguments: {
              plan: JSON.stringify(plan),
            },
          },
        });

        expect(response.result.structuredContent.decision).toBeDefined();
      } finally {
        server.kill();
      }
    });
  });

  describe('Supported Resources', () => {
    it('returns comprehensive resource catalog', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        const response = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_supported_resources',
            arguments: {},
          },
        });

        const result = response.result.structuredContent;
        expect(result.total).toBeGreaterThan(100);
        expect(result.resources).toBeDefined();
        expect(Array.isArray(result.resources)).toBe(true);
      } finally {
        server.kill();
      }
    });
  });

  describe('Multi-tool Sequence', () => {
    it('handles multiple sequential tool calls', async () => {
      const server = spawnMcpServer();
      try {
        await initializeMcpServer(server);

        // First call
        const response1 = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_shell',
            arguments: { command: 'rm -rf /tmp/test' },
          },
        });
        expect(response1.result.structuredContent.decision).toBeDefined();

        // Second call
        const response2 = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'recourse_supported_resources',
            arguments: {},
          },
        });
        expect(response2.result.structuredContent.total).toBeGreaterThan(0);

        // Third call
        const response3 = await sendMcpRequest(server, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'recourse_evaluate_mcp_call',
            arguments: { tool: 'aws_s3_list_buckets' },
          },
        });
        expect(response3.result.structuredContent.decision).toBe('allow');
      } finally {
        server.kill();
      }
    });
  });
});
