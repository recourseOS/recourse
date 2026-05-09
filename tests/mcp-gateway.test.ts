import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Readable, Writable, PassThrough } from 'stream';
import { loadGatewayConfig, startGateway, type GatewayConfig } from '../src/mcp/gateway.js';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Mock the evaluator to control test outcomes
vi.mock('../src/evaluator/index.js', () => ({
  evaluateMcpToolCallConsequences: vi.fn(),
}));

// Mock attestation service
vi.mock('../src/attestation/service.js', () => ({
  getAttestationService: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCurrentKeyId: vi.fn().mockReturnValue('test-key-id'),
    createAttestation: vi.fn().mockReturnValue({
      attestation_uri: 'recourse://attestation/test-123',
    }),
  })),
}));

// Store the original spawn
const originalSpawn = vi.fn();

// Mock child_process.spawn to simulate upstream MCP servers
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;

      // Create mock stdin/stdout/stderr
      mockProcess.stdin = new PassThrough();
      mockProcess.stdout = new PassThrough();
      mockProcess.stderr = new PassThrough();
      mockProcess.kill = vi.fn();
      mockProcess.pid = 12345;

      // Simulate the upstream server responding
      mockProcess.stdin.on('data', (data: Buffer) => {
        const request = JSON.parse(data.toString().trim());

        // Respond to initialize
        if (request.method === 'initialize') {
          setTimeout(() => {
            mockProcess.stdout.push(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: { protocolVersion: '2024-11-05' },
              }) + '\n'
            );
          }, 10);
        }

        // Respond to tools/list
        if (request.method === 'tools/list') {
          setTimeout(() => {
            mockProcess.stdout.push(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  tools: [
                    {
                      name: 'test_delete_bucket',
                      description: 'Delete an S3 bucket',
                      inputSchema: { type: 'object', properties: { bucket: { type: 'string' } } },
                    },
                    {
                      name: 'test_list_files',
                      description: 'List files in a directory',
                      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
                    },
                  ],
                },
              }) + '\n'
            );
          }, 10);
        }

        // Respond to tools/call
        if (request.method === 'tools/call') {
          setTimeout(() => {
            mockProcess.stdout.push(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  content: [{ type: 'text', text: 'Tool executed successfully' }],
                },
              }) + '\n'
            );
          }, 10);
        }
      });

      return mockProcess;
    }),
  };
});

import { evaluateMcpToolCallConsequences } from '../src/evaluator/index.js';
import { spawn } from 'child_process';

describe('MCP Gateway', () => {
  describe('loadGatewayConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns default config when no file or env vars', () => {
      delete process.env.RECOURSE_UPSTREAMS;
      delete process.env.RECOURSE_ALLOWED_LEVELS;
      delete process.env.RECOURSE_VERBOSE;

      const config = loadGatewayConfig();

      expect(config.upstreams).toEqual([]);
      expect(config.allowedRiskLevels).toEqual(['allow', 'warn']);
      expect(config.attestation).toBe(true);
    });

    it('loads upstreams from environment variable', () => {
      const upstreams = [
        { name: 'test-server', command: 'node', args: ['server.js'] },
      ];
      process.env.RECOURSE_UPSTREAMS = JSON.stringify(upstreams);

      const config = loadGatewayConfig();

      expect(config.upstreams).toEqual(upstreams);
    });

    it('loads allowed risk levels from environment variable', () => {
      process.env.RECOURSE_ALLOWED_LEVELS = 'allow,warn,escalate';

      const config = loadGatewayConfig();

      expect(config.allowedRiskLevels).toEqual(['allow', 'warn', 'escalate']);
    });

    it('enables verbose mode from environment variable', () => {
      process.env.RECOURSE_VERBOSE = 'true';

      const config = loadGatewayConfig();

      expect(config.verbose).toBe(true);
    });

    it('handles invalid RECOURSE_UPSTREAMS JSON gracefully', () => {
      process.env.RECOURSE_UPSTREAMS = 'not valid json';

      const config = loadGatewayConfig();

      // Should fall back to empty array
      expect(config.upstreams).toEqual([]);
    });

    it('loads config from file when path provided', () => {
      const tempDir = path.join(__dirname, '../.test-tmp');
      const configPath = path.join(tempDir, 'gateway-config.json');

      // Create temp directory and config file
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileConfig = {
        upstreams: [{ name: 'file-server', command: 'python', args: ['-m', 'mcp'] }],
        allowedRiskLevels: ['allow'],
        verbose: true,
      };
      fs.writeFileSync(configPath, JSON.stringify(fileConfig));

      try {
        const config = loadGatewayConfig(configPath);

        expect(config.upstreams).toEqual(fileConfig.upstreams);
        expect(config.allowedRiskLevels).toEqual(['allow']);
        expect(config.verbose).toBe(true);
      } finally {
        // Cleanup
        fs.unlinkSync(configPath);
        fs.rmdirSync(tempDir);
      }
    });

    it('merges file config with defaults', () => {
      const tempDir = path.join(__dirname, '../.test-tmp');
      const configPath = path.join(tempDir, 'partial-config.json');

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Only specify upstreams, should get default allowedRiskLevels
      const fileConfig = {
        upstreams: [{ name: 'partial-server', command: 'node' }],
      };
      fs.writeFileSync(configPath, JSON.stringify(fileConfig));

      try {
        const config = loadGatewayConfig(configPath);

        expect(config.upstreams).toEqual(fileConfig.upstreams);
        expect(config.allowedRiskLevels).toEqual(['allow', 'warn']); // default
        expect(config.attestation).toBe(true); // default
      } finally {
        fs.unlinkSync(configPath);
        fs.rmdirSync(tempDir);
      }
    });
  });

  describe('Gateway JSON-RPC Handling', () => {
    // Helper to create mock input/output streams
    function createMockStreams() {
      const inputLines: string[] = [];
      const outputLines: string[] = [];

      const input = new Readable({
        read() {},
      });

      const output = new Writable({
        write(chunk, encoding, callback) {
          const line = chunk.toString().trim();
          if (line) {
            outputLines.push(line);
          }
          callback();
        },
      });

      const sendRequest = (request: object) => {
        input.push(JSON.stringify(request) + '\n');
      };

      const getResponses = () => outputLines.map((line) => JSON.parse(line));

      return { input, output, sendRequest, getResponses, outputLines };
    }

    it('responds to initialize request', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      // Start gateway (don't await - it runs continuously)
      const gatewayPromise = startGateway(config, input, output);

      // Give it time to initialize
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send initialize request
      sendRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 50));

      const responses = getResponses();
      expect(responses.length).toBeGreaterThan(0);

      const initResponse = responses.find((r) => r.id === 1);
      expect(initResponse).toBeDefined();
      expect(initResponse?.result?.serverInfo?.name).toBe('recourse-gateway');
      expect(initResponse?.result?.capabilities?.tools).toBeDefined();

      // Close input to stop gateway
      input.push(null);
    });

    it('responds to tools/list with gateway status tool', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 50));

      sendRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const responses = getResponses();
      const toolsResponse = responses.find((r) => r.id === 2);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.result?.tools).toBeDefined();

      // Should include the gateway status tool
      const tools = toolsResponse?.result?.tools as any[];
      const statusTool = tools?.find((t) => t.name === 'recourse_gateway_status');
      expect(statusTool).toBeDefined();
      expect(statusTool?.description).toContain('gateway status');

      input.push(null);
    });

    it('handles recourse_gateway_status tool call', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 50));

      sendRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'recourse_gateway_status',
          arguments: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 3);

      expect(callResponse).toBeDefined();
      expect(callResponse?.result?.content).toBeDefined();

      const content = callResponse?.result?.content[0];
      expect(content?.type).toBe('text');

      const status = JSON.parse(content?.text);
      expect(status.gateway).toBe('recourse');
      expect(status.policy.allowedRiskLevels).toEqual(['allow', 'warn']);

      input.push(null);
    });

    it('returns error for unknown tool', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 50));

      sendRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const responses = getResponses();
      const errorResponse = responses.find((r) => r.id === 4);

      expect(errorResponse).toBeDefined();
      expect(errorResponse?.error).toBeDefined();
      expect(errorResponse?.error?.code).toBe(-32601);
      expect(errorResponse?.error?.message).toContain('Unknown tool');

      input.push(null);
    });

    it('returns error for unknown method when no upstreams', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 50));

      sendRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'some/unknown/method',
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const responses = getResponses();
      const errorResponse = responses.find((r) => r.id === 5);

      expect(errorResponse).toBeDefined();
      expect(errorResponse?.error).toBeDefined();
      expect(errorResponse?.error?.message).toContain('Method not found');

      input.push(null);
    });
  });

  describe('GatewayConfig Interface', () => {
    it('accepts valid config with all options', () => {
      const config: GatewayConfig = {
        upstreams: [
          {
            name: 'aws-mcp',
            command: 'npx',
            args: ['-y', '@aws/mcp-server'],
            env: { AWS_REGION: 'us-east-1' },
          },
          {
            name: 'kubernetes-mcp',
            command: 'kubectl-mcp',
          },
        ],
        allowedRiskLevels: ['allow', 'warn', 'escalate'],
        verbose: true,
        attestation: true,
      };

      expect(config.upstreams.length).toBe(2);
      expect(config.allowedRiskLevels).toContain('escalate');
      expect(config.verbose).toBe(true);
    });

    it('allows minimal config with just upstreams and risk levels', () => {
      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow'],
      };

      expect(config.upstreams).toEqual([]);
      expect(config.verbose).toBeUndefined();
      expect(config.attestation).toBeUndefined();
    });
  });

  describe('Risk Level Policy', () => {
    it('policy allows configuring which risk levels pass through', () => {
      // Strict policy - only allow "allow" level
      const strictConfig: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow'],
      };
      expect(strictConfig.allowedRiskLevels).toEqual(['allow']);

      // Permissive policy - allow everything except block
      const permissiveConfig: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn', 'escalate'],
      };
      expect(permissiveConfig.allowedRiskLevels).toContain('escalate');
      expect(permissiveConfig.allowedRiskLevels).not.toContain('block');

      // Very permissive - even allow "block" level (not recommended)
      const veryPermissiveConfig: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn', 'escalate', 'block'],
      };
      expect(veryPermissiveConfig.allowedRiskLevels).toContain('block');
    });
  });

  describe('Upstream Server Configuration', () => {
    it('supports various upstream configurations', () => {
      const config: GatewayConfig = {
        upstreams: [
          // Simple command
          { name: 'simple', command: 'mcp-server' },

          // With args
          { name: 'with-args', command: 'node', args: ['server.js', '--port', '3000'] },

          // With env vars
          {
            name: 'with-env',
            command: 'python',
            args: ['-m', 'mcp_server'],
            env: {
              PYTHONPATH: '/custom/path',
              DEBUG: 'true',
            },
          },
        ],
        allowedRiskLevels: ['allow', 'warn'],
      };

      expect(config.upstreams[0].args).toBeUndefined();
      expect(config.upstreams[1].args).toEqual(['server.js', '--port', '3000']);
      expect(config.upstreams[2].env?.DEBUG).toBe('true');
    });
  });

  describe('Gateway with Upstream Servers', () => {
    // Helper to create mock input/output streams
    function createMockStreams() {
      const outputLines: string[] = [];

      const input = new Readable({
        read() {},
      });

      const output = new Writable({
        write(chunk, encoding, callback) {
          const line = chunk.toString().trim();
          if (line) {
            outputLines.push(line);
          }
          callback();
        },
      });

      const sendRequest = (request: object) => {
        input.push(JSON.stringify(request) + '\n');
      };

      const getResponses = () => outputLines.map((line) => JSON.parse(line));

      return { input, output, sendRequest, getResponses, outputLines };
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('connects to upstream servers and discovers tools', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);

      // Wait for upstream connection
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Request tools list
      sendRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const toolsResponse = responses.find((r) => r.id === 10);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.result?.tools).toBeDefined();

      const tools = toolsResponse?.result?.tools as any[];
      // Should include tools from upstream + gateway status tool
      expect(tools.length).toBeGreaterThanOrEqual(2);

      // Upstream tools should have "[via upstream-name]" in description
      const upstreamTool = tools.find((t) => t.name === 'test_delete_bucket');
      expect(upstreamTool).toBeDefined();
      expect(upstreamTool?.description).toContain('[via test-mcp]');

      input.push(null);
    });

    it('blocks tool calls with "block" risk assessment', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      // Mock evaluator to return "block"
      vi.mocked(evaluateMcpToolCallConsequences).mockResolvedValue({
        mutations: [{
          resource: 's3://my-bucket',
          action: 'delete',
          recoverability: {
            tier: 4, // UNRECOVERABLE
            reasoning: 'Bucket deletion is permanent',
          },
        }],
        riskAssessment: 'block',
        assessmentReason: 'Deleting production bucket with data',
        verificationSuggestions: [],
      } as any);

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'], // 'block' not included
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Call a tool that will be blocked
      sendRequest({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'test_delete_bucket',
          arguments: { bucket: 'production-data' },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 11);

      expect(callResponse).toBeDefined();
      expect(callResponse?.error).toBeDefined();
      expect(callResponse?.error?.code).toBe(-32000);
      expect(callResponse?.error?.message).toContain('BLOCKED');
      expect(callResponse?.error?.data?.riskAssessment).toBe('block');

      input.push(null);
    });

    it('allows and forwards tool calls with "allow" risk assessment', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      // Mock evaluator to return "allow"
      vi.mocked(evaluateMcpToolCallConsequences).mockResolvedValue({
        mutations: [{
          resource: 'filesystem:///tmp',
          action: 'read',
          recoverability: {
            tier: 1, // REVERSIBLE
            reasoning: 'Read-only operation',
          },
        }],
        riskAssessment: 'allow',
        assessmentReason: 'Safe read-only operation',
        verificationSuggestions: [],
      } as any);

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Call a safe tool
      sendRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'test_list_files',
          arguments: { path: '/tmp' },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 12);

      expect(callResponse).toBeDefined();
      expect(callResponse?.error).toBeUndefined();
      expect(callResponse?.result?.content).toBeDefined();
      expect(callResponse?.result?.content[0]?.text).toContain('successfully');

      input.push(null);
    });

    it('allows "warn" level when included in allowedRiskLevels', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      // Mock evaluator to return "warn"
      vi.mocked(evaluateMcpToolCallConsequences).mockResolvedValue({
        mutations: [{
          resource: 's3://staging-bucket',
          action: 'delete',
          recoverability: {
            tier: 2, // RECOVERABLE_WITH_EFFORT
            reasoning: 'Staging bucket, can be recreated',
          },
        }],
        riskAssessment: 'warn',
        assessmentReason: 'Destructive but recoverable operation',
        verificationSuggestions: [],
      } as any);

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'], // warn is included
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 150));

      sendRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'test_delete_bucket',
          arguments: { bucket: 'staging-data' },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 13);

      // Should be allowed (not blocked)
      expect(callResponse).toBeDefined();
      expect(callResponse?.error).toBeUndefined();
      expect(callResponse?.result).toBeDefined();

      input.push(null);
    });

    it('blocks "escalate" level when not in allowedRiskLevels', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      // Mock evaluator to return "escalate"
      vi.mocked(evaluateMcpToolCallConsequences).mockResolvedValue({
        mutations: [{
          resource: 'rds://prod-database',
          action: 'delete',
          recoverability: {
            tier: 3, // RECOVERABLE_FROM_BACKUP
            reasoning: 'Database has backups but requires manual restore',
          },
        }],
        riskAssessment: 'escalate',
        assessmentReason: 'Production database deletion requires human approval',
        verificationSuggestions: [],
      } as any);

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'], // escalate NOT included
        attestation: false,
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 150));

      sendRequest({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'test_delete_bucket',
          arguments: { database: 'prod-db' },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 14);

      expect(callResponse).toBeDefined();
      expect(callResponse?.error).toBeDefined();
      expect(callResponse?.error?.message).toContain('BLOCKED');

      input.push(null);
    });

    it('enables attestation when configured', async () => {
      const { input, output, sendRequest, getResponses } = createMockStreams();

      // Mock evaluator to return "allow"
      vi.mocked(evaluateMcpToolCallConsequences).mockResolvedValue({
        mutations: [],
        riskAssessment: 'allow',
        assessmentReason: 'Safe operation',
        verificationSuggestions: [],
      } as any);

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: true, // Enable attestation
      };

      startGateway(config, input, output);
      await new Promise((resolve) => setTimeout(resolve, 150));

      sendRequest({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'test_list_files',
          arguments: { path: '/home' },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = getResponses();
      const callResponse = responses.find((r) => r.id === 15);

      expect(callResponse).toBeDefined();
      expect(callResponse?.error).toBeUndefined();
      // Attestation metadata should be added to result
      expect(callResponse?.result?._recourse).toBeDefined();
      expect(callResponse?.result?._recourse?.attestation_uri).toContain('recourse://');

      input.push(null);
    });

    it('handles verbose logging mode', async () => {
      const { input, output, sendRequest } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [
          { name: 'test-mcp', command: 'node', args: ['mcp-server.js'] },
        ],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
        verbose: true, // Enable verbose logging
      };

      // Capture stderr
      const stderrOutput: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: any) => {
        stderrOutput.push(chunk.toString());
        return true;
      };

      try {
        startGateway(config, input, output);
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Check that verbose logging is working
        const hasGatewayLogs = stderrOutput.some((line) => line.includes('[gateway'));
        expect(hasGatewayLogs).toBe(true);
      } finally {
        process.stderr.write = originalStderrWrite;
        input.push(null);
      }
    });
  });
});
