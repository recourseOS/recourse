/**
 * Tests for MCP Gateway Mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable, Writable } from 'stream';
import { startGateway, loadGatewayConfig, GatewayConfig } from './gateway.js';

// Mock the evaluator to avoid actual evaluation
vi.mock('../evaluator/index.js', () => ({
  evaluateMcpToolCallConsequences: vi.fn().mockResolvedValue({
    riskAssessment: 'allow',
    assessmentReason: 'Test evaluation',
    mutations: [],
  }),
}));

// Mock attestation service
vi.mock('../attestation/service.js', () => ({
  getAttestationService: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCurrentKeyId: vi.fn().mockReturnValue('test-key-id'),
    createAttestation: vi.fn().mockReturnValue({
      attestation_uri: 'https://example.com/attestations/test123.json',
    }),
  }),
}));

describe('MCP Gateway', () => {
  describe('loadGatewayConfig', () => {
    it('returns default config when no file or env provided', () => {
      const config = loadGatewayConfig();

      expect(config.upstreams).toEqual([]);
      expect(config.allowedRiskLevels).toEqual(['allow', 'warn']);
      expect(config.attestation).toBe(true);
    });

    it('loads config from environment variables', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        RECOURSE_UPSTREAMS: JSON.stringify([{ name: 'test', command: 'echo' }]),
        RECOURSE_ALLOWED_LEVELS: 'allow,warn,escalate',
      };

      const config = loadGatewayConfig();

      expect(config.upstreams).toEqual([{ name: 'test', command: 'echo' }]);
      expect(config.allowedRiskLevels).toEqual(['allow', 'warn', 'escalate']);

      process.env = originalEnv;
    });
  });

  describe('Gateway JSON-RPC handling', () => {
    let outputData: string[];
    let mockOutput: Writable;
    let mockInput: Readable;

    function createMockStreams() {
      outputData = [];
      mockOutput = new Writable({
        write(chunk, encoding, callback) {
          outputData.push(chunk.toString());
          callback();
        },
      });
      mockInput = new Readable({ read() {} });
      return { mockInput, mockOutput };
    }

    function sendRequest(input: Readable, request: object) {
      input.push(JSON.stringify(request) + '\n');
    }

    function getResponses(): object[] {
      return outputData.map((line) => JSON.parse(line.trim()));
    }

    it('responds to initialize request', async () => {
      const { mockInput, mockOutput } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      // Start gateway (don't await - it runs until input closes)
      const gatewayPromise = startGateway(config, mockInput, mockOutput);

      // Send initialize request
      sendRequest(mockInput, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Close input to stop gateway
      mockInput.push(null);
      await gatewayPromise.catch(() => {}); // Ignore errors from stdin closing

      const responses = getResponses();
      expect(responses.length).toBeGreaterThanOrEqual(1);

      const initResponse = responses[0] as any;
      expect(initResponse.jsonrpc).toBe('2.0');
      expect(initResponse.id).toBe(1);
      expect(initResponse.result.serverInfo.name).toBe('recourse-gateway');
      expect(initResponse.result.capabilities.tools).toBeDefined();
    });

    it('lists tools with recourse_gateway_status', async () => {
      const { mockInput, mockOutput } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      const gatewayPromise = startGateway(config, mockInput, mockOutput);

      // Send tools/list request
      sendRequest(mockInput, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      mockInput.push(null);
      await gatewayPromise.catch(() => {});

      const responses = getResponses();
      const toolsResponse = responses[0] as any;

      expect(toolsResponse.result.tools).toBeDefined();
      expect(toolsResponse.result.tools.some((t: any) => t.name === 'recourse_gateway_status')).toBe(true);
    });

    it('returns gateway status via tool call', async () => {
      const { mockInput, mockOutput } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      const gatewayPromise = startGateway(config, mockInput, mockOutput);

      // Call recourse_gateway_status
      sendRequest(mockInput, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'recourse_gateway_status', arguments: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      mockInput.push(null);
      await gatewayPromise.catch(() => {});

      const responses = getResponses();
      const statusResponse = responses[0] as any;

      expect(statusResponse.result.content).toBeDefined();
      expect(statusResponse.result.content[0].type).toBe('text');

      const statusData = JSON.parse(statusResponse.result.content[0].text);
      expect(statusData.gateway).toBe('recourse');
      expect(statusData.policy.allowedRiskLevels).toEqual(['allow', 'warn']);
    });

    it('returns error for unknown tool', async () => {
      const { mockInput, mockOutput } = createMockStreams();

      const config: GatewayConfig = {
        upstreams: [],
        allowedRiskLevels: ['allow', 'warn'],
        attestation: false,
      };

      const gatewayPromise = startGateway(config, mockInput, mockOutput);

      // Call unknown tool
      sendRequest(mockInput, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      mockInput.push(null);
      await gatewayPromise.catch(() => {});

      const responses = getResponses();
      const errorResponse = responses[0] as any;

      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.error.code).toBe(-32601);
      expect(errorResponse.error.message).toContain('Unknown tool');
    });
  });
});
