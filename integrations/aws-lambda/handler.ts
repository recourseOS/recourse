/**
 * RecourseOS AWS Lambda Handler
 *
 * Serverless deployment for RecourseOS API.
 * Supports evaluation of Terraform plans, shell commands, and MCP tool calls.
 */

import { analyzeBlastRadius } from '../../src/analyzer/blast-radius.js';
import { parsePlanJson } from '../../src/parsers/plan.js';
import { parseStateJson } from '../../src/parsers/state.js';
import { evaluateShellCommandConsequences } from '../../src/evaluator/shell.js';
import { evaluateMcpToolCallConsequences } from '../../src/evaluator/mcp.js';
import { RecoverabilityTier } from '../../src/resources/types.js';

// API Gateway event types
interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  queryStringParameters: Record<string, string | undefined> | null;
}

interface APIGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// Request types
interface EvaluateTerraformRequest {
  plan: string | object;
  state?: string | object;
  actor?: string;
  environment?: string;
  owner?: string;
}

interface EvaluateShellRequest {
  command: string;
  cwd?: string;
  actor?: string;
  environment?: string;
  owner?: string;
}

interface EvaluateMcpRequest {
  server: string;
  tool: string;
  arguments: Record<string, any>;
  actor?: string;
  environment?: string;
  owner?: string;
}

// Response types
type RiskAssessment = 'allow' | 'warn' | 'escalate' | 'block';

interface EvaluationResponse {
  riskAssessment: RiskAssessment;
  summary: {
    totalChanges: number;
    reversible: number;
    recoverableWithEffort: number;
    recoverableFromBackup: number;
    needsReview: number;
    unrecoverable: number;
    hasUnrecoverable: boolean;
    worstTier: string;
  };
  changes: Array<{
    address: string;
    action: string;
    resourceType: string;
    recoverability: {
      tier: number;
      label: string;
      reasoning?: string;
    };
  }>;
  metadata: {
    evaluatedAt: string;
    actor?: string;
    environment?: string;
    owner?: string;
  };
}

/**
 * Evaluate a Terraform plan
 */
function evaluateTerraform(req: EvaluateTerraformRequest): EvaluationResponse {
  const planJson = typeof req.plan === 'string' ? req.plan : JSON.stringify(req.plan);
  const stateJson = req.state
    ? typeof req.state === 'string'
      ? req.state
      : JSON.stringify(req.state)
    : null;

  const plan = parsePlanJson(planJson);
  const state = stateJson ? parseStateJson(stateJson) : null;
  const report = analyzeBlastRadius(plan, state);

  // Determine risk assessment
  let riskAssessment: RiskAssessment;
  if (report.summary.hasUnrecoverable) {
    riskAssessment = 'block';
  } else if (report.summary.needsReview > 0) {
    riskAssessment = 'escalate';
  } else if (report.summary.recoverableFromBackup > 0 || report.summary.recoverableWithEffort > 0) {
    riskAssessment = 'warn';
  } else {
    riskAssessment = 'allow';
  }

  return {
    riskAssessment,
    summary: report.summary,
    changes: report.changes.map(c => ({
      address: c.address,
      action: c.action,
      resourceType: c.resourceType,
      recoverability: c.recoverability,
    })),
    metadata: {
      evaluatedAt: new Date().toISOString(),
      actor: req.actor,
      environment: req.environment,
      owner: req.owner,
    },
  };
}

/**
 * Evaluate a shell command using core evaluator
 */
function evaluateShell(req: EvaluateShellRequest): EvaluationResponse {
  const report = evaluateShellCommandConsequences(
    { command: req.command, cwd: req.cwd },
    {
      adapterContext: {
        actorId: req.actor,
        environment: req.environment,
        owner: req.owner,
      },
    }
  );

  const worstTier = report.summary.worstRecoverability.tier;
  const tierLabel = report.summary.worstRecoverability.label;

  return {
    riskAssessment: report.riskAssessment,
    summary: {
      totalChanges: report.summary.totalMutations,
      reversible: worstTier === RecoverabilityTier.REVERSIBLE ? 1 : 0,
      recoverableWithEffort: worstTier === RecoverabilityTier.RECOVERABLE_WITH_EFFORT ? 1 : 0,
      recoverableFromBackup: worstTier === RecoverabilityTier.RECOVERABLE_FROM_BACKUP ? 1 : 0,
      needsReview: report.summary.needsReview ? 1 : 0,
      unrecoverable: report.summary.hasUnrecoverable ? 1 : 0,
      hasUnrecoverable: report.summary.hasUnrecoverable,
      worstTier: tierLabel,
    },
    changes: report.mutations.map(m => ({
      address: m.intent.target.id || req.command,
      action: m.intent.action,
      resourceType: m.intent.target.type,
      recoverability: {
        tier: m.recoverability.tier,
        label: m.recoverability.label,
        reasoning: m.recoverability.reason,
      },
    })),
    metadata: {
      evaluatedAt: new Date().toISOString(),
      actor: req.actor,
      environment: req.environment,
      owner: req.owner,
    },
  };
}

/**
 * Evaluate an MCP tool call using core evaluator
 */
function evaluateMcp(req: EvaluateMcpRequest): EvaluationResponse {
  const report = evaluateMcpToolCallConsequences(
    {
      server: req.server,
      tool: req.tool,
      arguments: req.arguments,
    },
    {
      adapterContext: {
        actorId: req.actor,
        environment: req.environment,
        owner: req.owner,
      },
    }
  );

  const worstTier = report.summary.worstRecoverability.tier;
  const tierLabel = report.summary.worstRecoverability.label;

  const target =
    req.arguments.bucket ||
    req.arguments.name ||
    req.arguments.identifier ||
    JSON.stringify(req.arguments);

  return {
    riskAssessment: report.riskAssessment,
    summary: {
      totalChanges: report.summary.totalMutations,
      reversible: worstTier === RecoverabilityTier.REVERSIBLE ? 1 : 0,
      recoverableWithEffort: worstTier === RecoverabilityTier.RECOVERABLE_WITH_EFFORT ? 1 : 0,
      recoverableFromBackup: worstTier === RecoverabilityTier.RECOVERABLE_FROM_BACKUP ? 1 : 0,
      needsReview: report.summary.needsReview ? 1 : 0,
      unrecoverable: report.summary.hasUnrecoverable ? 1 : 0,
      hasUnrecoverable: report.summary.hasUnrecoverable,
      worstTier: tierLabel,
    },
    changes: report.mutations.map(m => ({
      address: m.intent.target.id || `${req.server}:${req.tool}(${target})`,
      action: m.intent.action,
      resourceType: m.intent.target.type,
      recoverability: {
        tier: m.recoverability.tier,
        label: m.recoverability.label,
        reasoning: m.recoverability.reason,
      },
    })),
    metadata: {
      evaluatedAt: new Date().toISOString(),
      actor: req.actor,
      environment: req.environment,
      owner: req.owner,
    },
  };
}

/**
 * Create response helper
 */
function response(statusCode: number, body: object): APIGatewayResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // Parse body
  if (!event.body) {
    return response(400, { error: 'Request body required' });
  }

  let body: any;
  try {
    body = JSON.parse(event.body);
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  // Route by path
  const path = event.path;

  try {
    switch (path) {
      case '/evaluate/terraform':
        if (!body.plan) {
          return response(400, { error: 'plan is required' });
        }
        return response(200, evaluateTerraform(body));

      case '/evaluate/shell':
        if (!body.command) {
          return response(400, { error: 'command is required' });
        }
        return response(200, evaluateShell(body));

      case '/evaluate/mcp':
        if (!body.tool) {
          return response(400, { error: 'tool is required' });
        }
        return response(200, evaluateMcp(body));

      case '/health':
        return response(200, { status: 'healthy', version: '0.1.0' });

      default:
        return response(404, { error: `Unknown path: ${path}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return response(500, { error: message });
  }
}

// Export for different Lambda configurations
export { handler as lambdaHandler };
