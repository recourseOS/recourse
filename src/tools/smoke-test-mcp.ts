import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFile } from 'fs/promises';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ['dist/index.js', 'mcp', 'serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', chunk => {
    stderr += chunk;
  });

  try {
    const initialize = await sendMcpRequest(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'recourseos-smoke-test',
          version: '0.1.0',
        },
      },
    });
    assertNoError(initialize, 'initialize');

    const toolList = await sendMcpRequest(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    assertNoError(toolList, 'tools/list');
    const tools = toolList.result.tools.map((tool: { name: string }) => tool.name);
    for (const expected of [
      'recourse_evaluate_terraform',
      'recourse_evaluate_shell',
      'recourse_evaluate_mcp_call',
      'recourse_supported_resources',
    ]) {
      if (!tools.includes(expected)) {
        throw new Error(`Missing MCP tool: ${expected}`);
      }
    }

    const resources = await callTool(server, 3, 'recourse_supported_resources', {});
    if (resources.structuredContent.total <= 0) {
      throw new Error('Expected at least one supported resource type');
    }

    const shell = await callTool(server, 4, 'recourse_evaluate_shell', {
      command: 'aws s3 rm s3://prod-audit-logs --recursive',
      actor: 'agent/smoke-test',
      environment: 'test',
    });
    assertSchemaVersion(shell.structuredContent);
    if (!['warn', 'block', 'escalate', 'allow'].includes(shell.structuredContent.riskAssessment)) {
      throw new Error(`Unexpected shell decision: ${String(shell.structuredContent.riskAssessment)}`);
    }

    const plan = JSON.parse(await readFile('tests/fixtures/plans/aws-golden.json', 'utf8')) as Record<string, unknown>;
    const terraform = await callTool(server, 5, 'recourse_evaluate_terraform', {
      plan,
      classifier: true,
      actor: 'agent/smoke-test',
      environment: 'test',
    });
    assertSchemaVersion(terraform.structuredContent);
    if (terraform.structuredContent.riskAssessment !== 'block') {
      throw new Error(`Expected Terraform fixture to block, got ${String(terraform.structuredContent.riskAssessment)}`);
    }

    console.log('MCP smoke test passed');
    console.log(`tools=${tools.length}`);
    console.log(`resources=${String(resources.structuredContent.total)}`);
    console.log(`shellRiskAssessment=${String(shell.structuredContent.riskAssessment)}`);
    console.log(`terraformRiskAssessment=${String(terraform.structuredContent.riskAssessment)}`);
  } finally {
    server.kill();
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

async function callTool(
  server: ChildProcessWithoutNullStreams,
  id: number,
  name: string,
  args: Record<string, unknown>
): Promise<any> {
  const response = await sendMcpRequest(server, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  });
  assertNoError(response, name);
  return response.result;
}

function sendMcpRequest(
  child: ChildProcessWithoutNullStreams,
  request: JsonRpcRequest
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response to ${request.method}`));
    }, 3000);

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
    writeMcpFrame(child, request);
  });
}

function writeMcpFrame(child: ChildProcessWithoutNullStreams, request: JsonRpcRequest): void {
  const body = JSON.stringify(request);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function readMcpFrame(buffer: Buffer<ArrayBufferLike>): { body: Buffer<ArrayBufferLike> } | null {
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

function assertNoError(response: any, label: string): void {
  if (response.error) {
    throw new Error(`${label} failed: ${response.error.message}`);
  }
}

function assertSchemaVersion(payload: Record<string, unknown>): void {
  if (payload.schemaVersion !== 'recourse.consequence.v1') {
    throw new Error(`Unexpected schemaVersion: ${String(payload.schemaVersion)}`);
  }
}

await main();
