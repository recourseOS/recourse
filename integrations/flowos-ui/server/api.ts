/**
 * FlowOS + RecourseOS Live API Server
 *
 * Receives mutation intents, evaluates via RecourseOS with:
 * - Live AWS evidence fetching
 * - Cross-action analysis
 * - Reasoning traces
 * - Attestation protocol
 */

import http from 'http';
import {
  evaluateShellCommandConsequences,
  evaluateMcpToolCallConsequences,
} from '../../../src/evaluator/index.js';
import { sinkRegistry } from '../src/runtime/event-sink.js';
import type { ApprovalDecision } from '../src/runtime/types.js';
import {
  loadAwsCredentials,
  AwsSignedClient,
  readS3BucketEvidence,
  readRdsInstanceEvidence,
  readDynamoDbTableEvidence,
  readIamRoleEvidence,
  readKmsKeyEvidence,
  type S3BucketEvidence,
  type RdsInstanceEvidence,
  type DynamoDbTableEvidence,
  type IamRoleEvidence,
  type KmsKeyEvidence,
} from '../../../src/state/index.js';
import type { ConsequenceReport } from '../../../src/core/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MutationIntent {
  source: 'shell' | 'mcp' | 'terraform';
  command?: string;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

interface PendingEvaluation {
  id: string;
  intent: MutationIntent;
  result: {
    decision: string;
    reason: string;
    permitted: boolean;
    approvalRequested: boolean;
    summary: {
      totalMutations: number;
      worstRecoverability: { tier: number; label: string };
      needsReview: boolean;
      hasUnrecoverable: boolean;
    };
    mutations: Array<{
      target: { service?: string; type: string; id?: string };
      action: string;
      recoverability: { tier: number; label: string; reasoning?: string };
    }>;
    costEstimate?: { monthlyCost: number; currency: string };
    timing?: { totalMs: number; evaluationMs: number };
    // Advanced features
    crossActionRisks?: Array<{
      patternName: string;
      severity: string;
      description: string;
    }>;
    trace?: {
      steps: Array<{
        name: string;
        description: string;
        data?: Record<string, unknown>;
      }>;
    };
    evidenceFetched?: {
      source: string;
      resources: string[];
      fetchedAt: string;
    };
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const pendingEvaluations: Map<string, PendingEvaluation> = new Map();
const sseClients: Set<http.ServerResponse> = new Set();

// AWS client (initialized if credentials available)
let awsClient: AwsSignedClient | null = null;
let awsRegion = process.env.AWS_REGION || 'us-east-1';

try {
  const creds = loadAwsCredentials();
  awsClient = new AwsSignedClient(creds);
  console.log('[AWS] Credentials loaded - live evidence fetching enabled');
} catch (e) {
  console.log('[AWS] No credentials found - using pattern-based evaluation only');
  console.log('[AWS] Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for live evidence');
}

function broadcastUpdate(evaluation: PendingEvaluation) {
  const data = JSON.stringify(evaluation);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Detection from Shell Commands
// ─────────────────────────────────────────────────────────────────────────────

interface DetectedResource {
  type: 's3' | 'rds' | 'dynamodb' | 'iam' | 'kms';
  identifier: string;
}

function detectResourcesFromCommand(command: string): DetectedResource[] {
  const resources: DetectedResource[] = [];

  // S3 bucket detection
  const s3Patterns = [
    /aws\s+s3\s+(?:rb|rm)\s+s3:\/\/([a-z0-9][a-z0-9.-]*)/i,
    /aws\s+s3api\s+delete-bucket\s+--bucket\s+([a-z0-9][a-z0-9.-]*)/i,
    /--bucket[=\s]+([a-z0-9][a-z0-9.-]*)/i,
  ];
  for (const pattern of s3Patterns) {
    const match = command.match(pattern);
    if (match) resources.push({ type: 's3', identifier: match[1] });
  }

  // RDS instance detection
  const rdsPatterns = [
    /aws\s+rds\s+delete-db-instance\s+--db-instance-identifier\s+([a-zA-Z0-9-]+)/i,
    /--db-instance-identifier[=\s]+([a-zA-Z0-9-]+)/i,
  ];
  for (const pattern of rdsPatterns) {
    const match = command.match(pattern);
    if (match) resources.push({ type: 'rds', identifier: match[1] });
  }

  // DynamoDB table detection
  const dynamoPatterns = [
    /aws\s+dynamodb\s+delete-table\s+--table-name\s+([a-zA-Z0-9_.-]+)/i,
    /--table-name[=\s]+([a-zA-Z0-9_.-]+)/i,
  ];
  for (const pattern of dynamoPatterns) {
    const match = command.match(pattern);
    if (match) resources.push({ type: 'dynamodb', identifier: match[1] });
  }

  // IAM role detection
  const iamPatterns = [
    /aws\s+iam\s+delete-role\s+--role-name\s+([a-zA-Z0-9_+=,.@-]+)/i,
    /--role-name[=\s]+([a-zA-Z0-9_+=,.@-]+)/i,
  ];
  for (const pattern of iamPatterns) {
    const match = command.match(pattern);
    if (match) resources.push({ type: 'iam', identifier: match[1] });
  }

  // KMS key detection
  const kmsPatterns = [
    /aws\s+kms\s+(?:schedule-key-deletion|disable-key)\s+--key-id\s+([a-zA-Z0-9-]+)/i,
    /--key-id[=\s]+([a-zA-Z0-9-]+)/i,
  ];
  for (const pattern of kmsPatterns) {
    const match = command.match(pattern);
    if (match) resources.push({ type: 'kms', identifier: match[1] });
  }

  return resources;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Evidence Fetching
// ─────────────────────────────────────────────────────────────────────────────

interface AwsEvidence {
  s3Buckets?: Record<string, S3BucketEvidence>;
  rdsInstances?: Record<string, RdsInstanceEvidence>;
  dynamoDbTables?: Record<string, DynamoDbTableEvidence>;
  iamRoles?: Record<string, IamRoleEvidence>;
  kmsKeys?: Record<string, KmsKeyEvidence>;
}

async function fetchLiveEvidence(resources: DetectedResource[]): Promise<{
  evidence: AwsEvidence;
  fetched: string[];
  errors: string[];
}> {
  const evidence: AwsEvidence = {};
  const fetched: string[] = [];
  const errors: string[] = [];

  if (!awsClient) {
    return { evidence, fetched, errors: ['No AWS credentials'] };
  }

  for (const resource of resources) {
    try {
      switch (resource.type) {
        case 's3': {
          console.log(`[AWS] Fetching S3 evidence for: ${resource.identifier}`);
          const s3Evidence = await readS3BucketEvidence(awsClient, resource.identifier, awsRegion);
          evidence.s3Buckets = evidence.s3Buckets || {};
          evidence.s3Buckets[resource.identifier] = s3Evidence;
          fetched.push(`s3:${resource.identifier}`);
          break;
        }
        case 'rds': {
          console.log(`[AWS] Fetching RDS evidence for: ${resource.identifier}`);
          const rdsEvidence = await readRdsInstanceEvidence(awsClient, resource.identifier, awsRegion);
          evidence.rdsInstances = evidence.rdsInstances || {};
          evidence.rdsInstances[resource.identifier] = rdsEvidence;
          fetched.push(`rds:${resource.identifier}`);
          break;
        }
        case 'dynamodb': {
          console.log(`[AWS] Fetching DynamoDB evidence for: ${resource.identifier}`);
          const dynamoEvidence = await readDynamoDbTableEvidence(awsClient, resource.identifier, awsRegion);
          evidence.dynamoDbTables = evidence.dynamoDbTables || {};
          evidence.dynamoDbTables[resource.identifier] = dynamoEvidence;
          fetched.push(`dynamodb:${resource.identifier}`);
          break;
        }
        case 'iam': {
          console.log(`[AWS] Fetching IAM evidence for: ${resource.identifier}`);
          const iamEvidence = await readIamRoleEvidence(awsClient, resource.identifier);
          evidence.iamRoles = evidence.iamRoles || {};
          evidence.iamRoles[resource.identifier] = iamEvidence;
          fetched.push(`iam:${resource.identifier}`);
          break;
        }
        case 'kms': {
          console.log(`[AWS] Fetching KMS evidence for: ${resource.identifier}`);
          const kmsEvidence = await readKmsKeyEvidence(awsClient, resource.identifier, awsRegion);
          evidence.kmsKeys = evidence.kmsKeys || {};
          evidence.kmsKeys[resource.identifier] = kmsEvidence;
          fetched.push(`kms:${resource.identifier}`);
          break;
        }
      }
    } catch (e) {
      const errorMsg = `Failed to fetch ${resource.type}:${resource.identifier}: ${e}`;
      console.log(`[AWS] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  return { evidence, fetched, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleEvaluate(body: {
  intent: MutationIntent;
  description?: string;
  fetchEvidence?: boolean;
}): Promise<PendingEvaluation> {
  const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startTime = Date.now();

  console.log(`\n[RecourseOS] ═══════════════════════════════════════════════════`);
  console.log(`[RecourseOS] Evaluating: ${body.description || JSON.stringify(body.intent)}`);

  // Detect resources for evidence fetching
  let awsEvidence: AwsEvidence = {};
  let evidenceFetched: PendingEvaluation['result']['evidenceFetched'] | undefined;

  if (body.fetchEvidence !== false && body.intent.source === 'shell' && body.intent.command) {
    const detectedResources = detectResourcesFromCommand(body.intent.command);
    if (detectedResources.length > 0) {
      console.log(`[RecourseOS] Detected resources: ${detectedResources.map(r => `${r.type}:${r.identifier}`).join(', ')}`);

      const { evidence, fetched, errors } = await fetchLiveEvidence(detectedResources);
      awsEvidence = evidence;

      if (fetched.length > 0) {
        evidenceFetched = {
          source: 'aws-live',
          resources: fetched,
          fetchedAt: new Date().toISOString(),
        };
        console.log(`[RecourseOS] Live evidence fetched: ${fetched.join(', ')}`);
      }
      if (errors.length > 0) {
        console.log(`[RecourseOS] Evidence errors: ${errors.join('; ')}`);
      }
    }
  }

  // Evaluate via RecourseOS
  let report: ConsequenceReport;
  const adapterContext = {
    actorId: 'claude-code',
    environment: 'flowos-demo',
  };

  if (body.intent.source === 'shell' && body.intent.command) {
    report = evaluateShellCommandConsequences(
      { command: body.intent.command },
      { adapterContext, awsEvidence }
    );
  } else if (body.intent.source === 'mcp' && body.intent.tool) {
    report = evaluateMcpToolCallConsequences(
      {
        server: body.intent.server || 'unknown',
        tool: body.intent.tool,
        arguments: body.intent.arguments || {},
      },
      { adapterContext }
    );
  } else {
    throw new Error(`Unsupported intent source: ${body.intent.source}`);
  }

  const evaluationMs = Date.now() - startTime;

  console.log(`[RecourseOS] Decision: ${report.riskAssessment}`);
  console.log(`[RecourseOS] Reason: ${report.assessmentReason}`);
  if (report.crossActionRisks && report.crossActionRisks.length > 0) {
    console.log(`[RecourseOS] Cross-action risks: ${report.crossActionRisks.map(r => r.patternName).join(', ')}`);
  }
  if (report.trace) {
    console.log(`[RecourseOS] Trace steps: ${report.trace.steps.length}`);
  }
  console.log(`[RecourseOS] ═══════════════════════════════════════════════════`);

  // Map to API response
  const evaluation: PendingEvaluation = {
    id,
    intent: body.intent,
    result: {
      decision: report.riskAssessment,
      reason: report.assessmentReason,
      permitted: report.riskAssessment === 'allow',
      approvalRequested: report.riskAssessment === 'escalate' || report.riskAssessment === 'warn',
      summary: {
        totalMutations: report.summary.totalMutations,
        worstRecoverability: {
          tier: report.summary.worstRecoverability.tier,
          label: report.summary.worstRecoverability.label,
        },
        needsReview: report.summary.needsReview,
        hasUnrecoverable: report.summary.hasUnrecoverable,
      },
      mutations: report.mutations.map(m => ({
        target: {
          service: m.intent.target.service,
          type: m.intent.target.type,
          id: m.intent.target.id,
        },
        action: m.intent.action,
        recoverability: {
          tier: m.recoverability.tier,
          label: m.recoverability.label,
          reasoning: m.recoverability.reasoning,
        },
      })),
      costEstimate: report.costEstimate ? {
        monthlyCost: report.costEstimate.monthlyCost,
        currency: 'USD',
      } : undefined,
      timing: {
        totalMs: evaluationMs,
        evaluationMs,
      },
      // Advanced features
      crossActionRisks: report.crossActionRisks?.map(r => ({
        patternName: r.patternName,
        severity: r.severity,
        description: r.description,
      })),
      trace: report.trace ? {
        steps: report.trace.steps.map(s => ({
          name: s.name,
          description: s.description,
          data: s.data,
        })),
      } : undefined,
      evidenceFetched,
    },
    status: report.riskAssessment === 'allow' ? 'approved' : 'pending',
    createdAt: new Date().toISOString(),
  };

  pendingEvaluations.set(id, evaluation);
  broadcastUpdate(evaluation);

  return evaluation;
}

function handleApprove(id: string): PendingEvaluation | null {
  const evaluation = pendingEvaluations.get(id);
  if (!evaluation) return null;

  evaluation.status = 'approved';
  evaluation.resolvedAt = new Date().toISOString();
  console.log(`[FlowOS] Approved: ${id}`);
  broadcastUpdate(evaluation);

  return evaluation;
}

function handleReject(id: string): PendingEvaluation | null {
  const evaluation = pendingEvaluations.get(id);
  if (!evaluation) return null;

  evaluation.status = 'rejected';
  evaluation.resolvedAt = new Date().toISOString();
  console.log(`[FlowOS] Rejected: ${id}`);
  broadcastUpdate(evaluation);

  return evaluation;
}

function getPending(): PendingEvaluation[] {
  return Array.from(pendingEvaluations.values())
    .filter(e => e.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function getAll(): PendingEvaluation[] {
  return Array.from(pendingEvaluations.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // SSE endpoint for real-time updates
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      sseClients.add(res);
      res.write(`data: {"type":"connected","awsEnabled":${!!awsClient}}\n\n`);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // Submit mutation for evaluation
    if (path === '/evaluate' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const result = await handleEvaluate(body);
      return json(res, 200, result);
    }

    // Approve a pending evaluation
    if (path.startsWith('/approve/') && method === 'POST') {
      const id = path.split('/')[2];
      const result = handleApprove(id);
      if (!result) return json(res, 404, { error: 'Not found' });
      return json(res, 200, result);
    }

    // Reject a pending evaluation
    if (path.startsWith('/reject/') && method === 'POST') {
      const id = path.split('/')[2];
      const result = handleReject(id);
      if (!result) return json(res, 404, { error: 'Not found' });
      return json(res, 200, result);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RecourseNode Approval Routes (unblock waiting executors)
    // ─────────────────────────────────────────────────────────────────────────

    // Approve a mutation in a recourse_node execution
    // POST /node/:nodeId/approve/:mutationId
    const nodeApproveMatch = path.match(/^\/node\/([^/]+)\/approve\/([^/]+)$/);
    if (nodeApproveMatch && method === 'POST') {
      const [, nodeId, mutationId] = nodeApproveMatch;
      const body = JSON.parse(await readBody(req));
      const approver = body.approver || 'unknown';

      const decision: ApprovalDecision = { approved: true, approver };
      const success = sinkRegistry.resolveApproval(nodeId, mutationId, decision);

      if (!success) {
        return json(res, 404, {
          error: 'No pending approval found',
          nodeId,
          mutationId,
        });
      }

      console.log(`[FlowOS] Node approval: ${nodeId}/${mutationId} approved by ${approver}`);
      return json(res, 200, { success: true, nodeId, mutationId, decision });
    }

    // Reject a mutation in a recourse_node execution
    // POST /node/:nodeId/reject/:mutationId
    const nodeRejectMatch = path.match(/^\/node\/([^/]+)\/reject\/([^/]+)$/);
    if (nodeRejectMatch && method === 'POST') {
      const [, nodeId, mutationId] = nodeRejectMatch;
      const body = JSON.parse(await readBody(req));
      const reason = body.reason || 'Rejected by user';

      const decision: ApprovalDecision = { approved: false, reason };
      const success = sinkRegistry.resolveApproval(nodeId, mutationId, decision);

      if (!success) {
        return json(res, 404, {
          error: 'No pending approval found',
          nodeId,
          mutationId,
        });
      }

      console.log(`[FlowOS] Node rejection: ${nodeId}/${mutationId} - ${reason}`);
      return json(res, 200, { success: true, nodeId, mutationId, decision });
    }

    // Get pending approvals for a node
    // GET /node/:nodeId/pending
    const nodePendingMatch = path.match(/^\/node\/([^/]+)\/pending$/);
    if (nodePendingMatch && method === 'GET') {
      const [, nodeId] = nodePendingMatch;
      const sink = sinkRegistry.get(nodeId);

      if (!sink) {
        return json(res, 404, { error: 'Node not found or not executing', nodeId });
      }

      const pendingIds = sink.getPendingMutationIds();
      return json(res, 200, { nodeId, pending: pendingIds });
    }

    // Get pending evaluations
    if (path === '/pending' && method === 'GET') {
      return json(res, 200, getPending());
    }

    // Get all evaluations
    if (path === '/evaluations' && method === 'GET') {
      return json(res, 200, getAll());
    }

    // Clear all
    if (path === '/clear' && method === 'POST') {
      pendingEvaluations.clear();
      broadcastUpdate({ id: 'clear', intent: {} as any, result: {} as any, status: 'approved', createdAt: '' });
      return json(res, 200, { cleared: true });
    }

    // Health check
    if (path === '/health') {
      return json(res, 200, {
        status: 'ok',
        pending: getPending().length,
        awsEnabled: !!awsClient,
        features: {
          liveEvidence: !!awsClient,
          crossActionAnalysis: true,
          reasoningTraces: true,
          attestationProtocol: true,
        },
      });
    }

    return json(res, 404, { error: 'Not found' });

  } catch (error) {
    console.error('Error:', error);
    return json(res, 500, { error: String(error) });
  }
});

const PORT = process.env.PORT || 3099;

server.listen(PORT, () => {
  console.log(`
┌──────────────────────────────────────────────────────────────────────────────┐
│  FlowOS + RecourseOS API Server                                              │
│                                                                              │
│  Features:                                                                   │
│    ✓ Live AWS evidence fetching    ${awsClient ? '(enabled)' : '(no credentials)'}
│    ✓ Cross-action analysis                                                   │
│    ✓ Reasoning traces                                                        │
│    ✓ Attestation protocol                                                    │
│    ✓ RecourseNode execution with approval gates                              │
│                                                                              │
│  Evaluation Endpoints:                                                       │
│    POST /evaluate              Submit mutation for evaluation                │
│    POST /approve/:id           Approve a pending evaluation                  │
│    POST /reject/:id            Reject a pending evaluation                   │
│    GET  /pending               List pending evaluations                      │
│    GET  /events                SSE stream for real-time updates              │
│                                                                              │
│  RecourseNode Endpoints (unblock waiting executors):                         │
│    POST /node/:nodeId/approve/:mutationId   Approve mutation in node         │
│    POST /node/:nodeId/reject/:mutationId    Reject mutation in node          │
│    GET  /node/:nodeId/pending               List pending mutations for node  │
│                                                                              │
│  Listening on http://localhost:${PORT}                                          │
└──────────────────────────────────────────────────────────────────────────────┘
`);
});

export { server };
