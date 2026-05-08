#!/usr/bin/env npx tsx
/**
 * Smoke test for MCP Gateway Mode
 *
 * Tests the gateway without actual upstream servers by simulating
 * the agent side of the conversation.
 */

import { Readable, Writable } from 'stream';
import { startGateway, GatewayConfig } from './gateway.js';

// Collect output
const outputLines: string[] = [];
const mockOutput = new Writable({
  write(chunk, encoding, callback) {
    const line = chunk.toString().trim();
    if (line) {
      outputLines.push(line);
      console.log('[Gateway →]', line);
    }
    callback();
  },
});

// Create input stream
const mockInput = new Readable({ read() {} });

function sendRequest(request: object) {
  const json = JSON.stringify(request);
  console.log('[Agent →]', json);
  mockInput.push(json + '\n');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  console.log('=== MCP Gateway Smoke Test ===\n');

  // Start gateway with no upstreams (will only have built-in tools)
  const config: GatewayConfig = {
    upstreams: [],
    allowedRiskLevels: ['allow', 'warn'],
    verbose: true,
    attestation: true,
  };

  console.log('Starting gateway with config:', JSON.stringify(config, null, 2));
  console.log('');

  // Start gateway (runs in background)
  const gatewayPromise = startGateway(config, mockInput, mockOutput);

  // Test 1: Initialize
  console.log('\n--- Test 1: Initialize ---');
  sendRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });
  await sleep(200);

  // Test 2: List tools
  console.log('\n--- Test 2: List Tools ---');
  sendRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  await sleep(200);

  // Test 3: Call gateway status tool
  console.log('\n--- Test 3: Gateway Status ---');
  sendRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'recourse_gateway_status', arguments: {} },
  });
  await sleep(200);

  // Test 4: Call unknown tool (should error)
  console.log('\n--- Test 4: Unknown Tool ---');
  sendRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'aws_s3_delete_bucket', arguments: { bucket: 'prod-data' } },
  });
  await sleep(200);

  // Close input
  mockInput.push(null);
  await gatewayPromise.catch(() => {});

  // Analyze results
  console.log('\n=== Results ===');
  console.log(`Received ${outputLines.length} responses`);

  const responses = outputLines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });

  // Check initialize response
  const initResp = responses.find((r: any) => r.id === 1);
  if (initResp?.result?.serverInfo?.name === 'recourse-gateway') {
    console.log('✓ Initialize: OK');
  } else {
    console.log('✗ Initialize: FAILED');
  }

  // Check tools list response
  const toolsResp = responses.find((r: any) => r.id === 2);
  if (toolsResp?.result?.tools?.some((t: any) => t.name === 'recourse_gateway_status')) {
    console.log('✓ Tools list: OK (includes recourse_gateway_status)');
  } else {
    console.log('✗ Tools list: FAILED');
  }

  // Check gateway status response
  const statusResp = responses.find((r: any) => r.id === 3);
  if (statusResp?.result?.content?.[0]?.text) {
    const status = JSON.parse(statusResp.result.content[0].text);
    if (status.gateway === 'recourse') {
      console.log('✓ Gateway status: OK');
    } else {
      console.log('✗ Gateway status: FAILED');
    }
  } else {
    console.log('✗ Gateway status: FAILED');
  }

  // Check unknown tool error
  const unknownResp = responses.find((r: any) => r.id === 4);
  if (unknownResp?.error?.code === -32601) {
    console.log('✓ Unknown tool: OK (returned error)');
  } else {
    console.log('✗ Unknown tool: FAILED');
  }

  console.log('\n=== Smoke Test Complete ===');
}

runSmokeTest().catch(console.error);
