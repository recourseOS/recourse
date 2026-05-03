import { spawn, spawnSync } from 'child_process';
import { createServer, type IncomingMessage } from 'http';
import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import type { ConsequenceReport } from '../src/core/index.js';
import {
  evidenceFixturePath,
  evidenceScenarios,
  type EvidenceKind,
  type EvidenceScenario,
} from './helpers/evidence-scenarios.js';
import {
  goldenPlanFixturePath,
  goldenPlanScenarios,
  type GoldenPlanScenario,
} from './helpers/golden-plan-scenarios.js';

const distCli = 'dist/index.js';

describe('compiled CLI scenario matrix', () => {
  it.each(evidenceScenarios)('$name', scenario => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const result = runCli(scenario, 'block');
    const shouldBlock = scenario.expectedDecision === 'block';
    expect(result.status).toBe(shouldBlock ? 1 : 0);
    expect(result.stderr).toBe('');

    const report = JSON.parse(result.stdout) as ConsequenceReport;
    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedTier);
    expect(report.riskAssessment).toBe(scenario.expectedDecision);

    const evidenceKeys = report.mutations.flatMap(mutation =>
      mutation.evidence.map(item => item.key)
    );
    for (const key of scenario.expectedEvidenceKeys) {
      expect(evidenceKeys).toContain(key);
    }
  });

  it('exits nonzero when fail-on threshold is reached', () => {
    const scenario = evidenceScenarios.find(candidate =>
      candidate.name === 'KMS customer key deletion escalates'
    );
    expect(scenario).toBeDefined();

    const result = runCli(scenario as EvidenceScenario, 'escalate');
    expect(result.status).toBe(1);
  });

  it('renders the terminal preflight view for shell mutations', () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const result = spawnSync(process.execPath, [
      distCli,
      'preflight',
      'shell',
      'aws s3 rm s3://prod-audit-logs --recursive',
      '--actor',
      'agent/deploy',
      '--environment',
      'production',
      '--fail-on',
      'block',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('RecourseOS Preflight');
    expect(result.stdout).toContain('REVIEW REQUIRED');
    expect(result.stdout).toContain('Evidence Found');
    expect(result.stdout).toContain('Evidence Needed');
    expect(result.stdout).toContain('Next Steps');
  });

  it('runs the installed TUI in scripted mode for shell mutations', () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const result = spawnSync(process.execPath, [
      distCli,
      'tui',
      '--source',
      'shell',
      '--input',
      'aws s3 rm s3://prod-audit-logs --recursive',
      '--actor',
      'agent/tui',
      '--environment',
      'production',
      '--no-color',
      '--json',
      '--fail-on',
      'block',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('____');
    expect(result.stdout).toContain('RecourseOS Preflight');
    expect(result.stdout).toContain('REVIEW REQUIRED');
    expect(result.stdout).toContain('"version": "0.1.0"');
    expect(result.stdout).toContain('"riskAssessment": "escalate"');
  });

  it.each(goldenPlanScenarios)('evaluates golden Terraform fixture: $name', scenario => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const result = runGoldenPlanCli(scenario);
    expect(result.status).toBe(scenario.expectedDecision === 'block' ? 1 : 0);
    expect(result.stderr).toBe('');

    const report = JSON.parse(result.stdout) as ConsequenceReport;
    expect(report.riskAssessment).toBe(scenario.expectedDecision);
    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedWorstTier);
    expect(report.summary.totalMutations).toBe(Object.keys(scenario.expectedByAddress).length);
    expect(tiersByAddress(report)).toEqual(scenario.expectedByAddress);
  });

  it('submits evaluate reports to Recourse Cloud when requested', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    let captured: {
      headers: IncomingMessage['headers'];
      body: any;
    } | undefined;
    const server = createServer(async (request, response) => {
      captured = {
        headers: request.headers,
        body: JSON.parse(await readRequestBody(request)),
      };
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'eval_cloud_123',
        policyResult: { action: 'require-approval' },
      }));
    });

    await listen(server);
    try {
      const result = await runCliAsync([
        distCli,
        'evaluate',
        'shell',
        'aws s3 rm s3://prod-audit-logs --recursive',
        '--actor',
        'agent/deploy',
        '--environment',
        'production',
        '--submit',
        '--cloud-url',
        `http://127.0.0.1:${server.address().port}`,
        '--fail-on',
        'block',
      ], {
        RECOURSE_ORGANIZATION_ID: 'org_123',
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).riskAssessment).toBeDefined();
      expect(result.stderr).toContain('Recourse Cloud: submitted evaluation eval_cloud_123 policy=require-approval');
      expect(captured?.headers['x-recourse-organization-id']).toBe('org_123');
      expect(captured?.headers['x-recourse-actor-id']).toBe('agent/deploy');
      expect(captured?.body.organizationId).toBe('org_123');
      expect(captured?.body.actor).toEqual({ id: 'agent/deploy', kind: 'agent' });
      expect(captured?.body.environment).toBe('production');
      expect(captured?.body.source).toBe('shell');
      expect(captured?.body.consequenceReport.riskAssessment).toBeDefined();
    } finally {
      server.close();
    }
  });

  it('keeps local evaluate output when cloud submission fails', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const server = createServer((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'boom' }));
    });

    await listen(server);
    try {
      const result = await runCliAsync([
        distCli,
        'evaluate',
        'shell',
        'aws s3 rm s3://prod-audit-logs --recursive',
        '--actor',
        'agent/deploy',
        '--submit',
        '--cloud-url',
        `http://127.0.0.1:${server.address().port}`,
        '--fail-on',
        'block',
      ], {
        RECOURSE_ORGANIZATION_ID: 'org_123',
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).riskAssessment).toBeDefined();
      expect(result.stderr).toContain('Recourse Cloud: submission failed: cloud returned HTTP 500: boom');
    } finally {
      server.close();
    }
  });

  it('serves the RecourseOS MCP tool list over stdio', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const server = spawnMcpServer();
    try {
      const response = await sendMcpRequest(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });

      const tools = response.result.tools.map((tool: { name: string }) => tool.name);
      expect(tools).toContain('recourse_evaluate_terraform');
      expect(tools).toContain('recourse_evaluate_shell');
      expect(tools).toContain('recourse_evaluate_mcp_call');
      expect(tools).toContain('recourse_supported_resources');
    } finally {
      server.kill();
    }
  });

  it('evaluates shell commands through the MCP server with schema-versioned output', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const server = spawnMcpServer();
    try {
      const response = await sendMcpRequest(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'recourse_evaluate_shell',
          arguments: {
            command: 'aws s3 rm s3://prod-audit-logs --recursive',
            actor: 'agent/deploy',
            environment: 'production',
          },
        },
      });

      const payload = response.result.structuredContent;
      expect(payload.schemaVersion).toBe('recourse.consequence.v1');
      expect(payload.version).toBe('0.1.0');
      expect(payload.riskAssessment).toBeDefined();
      expect(payload.mutations[0].intent.actor.id).toBe('agent/deploy');
      expect(response.result.content[0].type).toBe('text');
    } finally {
      server.kill();
    }
  });

  it('evaluates Terraform plan JSON through the MCP server', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const plan = JSON.parse(readFileSync(goldenPlanFixturePath('aws-golden.json'), 'utf8'));
    const server = spawnMcpServer();
    try {
      const response = await sendMcpRequest(server, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'recourse_evaluate_terraform',
          arguments: {
            plan,
            classifier: true,
            actor: 'agent/golden-fixture',
          },
        },
      });

      const payload = response.result.structuredContent;
      expect(payload.schemaVersion).toBe('recourse.consequence.v1');
      expect(payload.riskAssessment).toBe('block');
      expect(payload.summary.totalMutations).toBeGreaterThan(0);
    } finally {
      server.kill();
    }
  });

  it('fails closed on invalid MCP tool input', async () => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const server = spawnMcpServer();
    try {
      const response = await sendMcpRequest(server, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'recourse_evaluate_shell',
          arguments: {},
        },
      });

      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Shell command is required');
    } finally {
      server.kill();
    }
  });
});

function runCli(scenario: EvidenceScenario, failOn: 'warn' | 'escalate' | 'block') {
  const args = [
    distCli,
    'evaluate',
    scenario.source,
    scenario.source === 'shell'
      ? scenario.input as string
      : JSON.stringify(scenario.input),
    evidenceFlag(scenario.evidenceKind),
    evidenceFixturePath(scenario.fixture),
    '--fail-on',
    failOn,
  ];

  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runGoldenPlanCli(scenario: GoldenPlanScenario) {
  const args = [
    distCli,
    'evaluate',
    'terraform',
    goldenPlanFixturePath(scenario.fixture),
    '--classifier',
    '--actor',
    'agent/golden-fixture',
    '--environment',
    'test',
    '--fail-on',
    'block',
  ];

  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function tiersByAddress(report: ConsequenceReport): Record<string, number> {
  return Object.fromEntries(report.mutations.map(mutation => [
    mutation.intent.target.id,
    mutation.recoverability.tier,
  ]));
}

function evidenceFlag(kind: EvidenceKind): string {
  switch (kind) {
    case 's3':
      return '--aws-s3-evidence';
    case 'rds':
      return '--aws-rds-evidence';
    case 'dynamodb':
      return '--aws-dynamodb-evidence';
    case 'iam':
      return '--aws-iam-evidence';
    case 'kms':
      return '--aws-kms-evidence';
  }
}

function runCliAsync(args: string[], env: Record<string, string>) {
  return new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', status => {
      resolve({ status, stdout, stderr });
    });
  });
}

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
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for MCP response'));
    }, 2000);

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

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
