/**
 * Terraform Cloud Run Task Handler for RecourseOS
 *
 * Evaluates Terraform plans via RecourseOS API and sends results back to TFC.
 * Deploy as a serverless function (AWS Lambda, Cloudflare Workers, etc.)
 */

// TFC Run Task request types
interface RunTaskRequest {
  payload_version: number;
  access_token: string;
  stage: 'pre_plan' | 'post_plan' | 'pre_apply';
  run_id: string;
  workspace_id: string;
  workspace_name: string;
  organization_name: string;
  plan_json_api_url?: string;
  configuration_version_id: string;
  run_message: string;
  run_created_at: string;
  run_created_by: string;
}

interface RunTaskCallback {
  status: 'passed' | 'failed' | 'running';
  message?: string;
  url?: string;
}

// RecourseOS API response
interface RecourseEvaluateResponse {
  riskAssessment: 'allow' | 'warn' | 'escalate' | 'block';
  assessmentReason: string;
  mutations: Array<{
    intent: { action: string; target: unknown };
    recoverability: { tier: number; label: string; reasoning: string };
  }>;
  summary: {
    totalMutations: number;
    worstRecoverability: { tier: number; label: string };
    hasUnrecoverable: boolean;
    needsReview: boolean;
  };
  attestation?: {
    attestation_uri: string;
    signature: string;
    key_id: string;
  };
}

// Environment configuration
interface Env {
  RECOURSE_API_URL?: string;
  RECOURSE_SLACK_WEBHOOK?: string;
  RECOURSE_DISCORD_WEBHOOK?: string;
}

/**
 * Map RecourseOS risk assessment to TFC status
 */
function mapToTfcStatus(risk: string): 'passed' | 'failed' {
  switch (risk) {
    case 'allow':
    case 'warn':
      return 'passed';
    case 'escalate':
    case 'block':
    default:
      return 'failed';
  }
}

/**
 * Get emoji for recoverability tier
 */
function getTierEmoji(tier: number): string {
  switch (tier) {
    case 1: return '✅';
    case 2: return '🔧';
    case 3: return '⚠️';
    case 4: return '⛔';
    case 5: return '🖐️';
    default: return '❓';
  }
}

/**
 * Get target display string from mutation
 */
function getTargetDisplay(target: unknown): string {
  if (typeof target === 'string') return target;
  if (typeof target === 'object' && target !== null) {
    const t = target as Record<string, string>;
    return t.id || t.address || `${t.service}/${t.type}` || JSON.stringify(target);
  }
  return String(target);
}

/**
 * Fetch the plan JSON from Terraform Cloud API
 */
async function fetchPlanJson(url: string, token: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch plan: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Send evaluation request to RecourseOS API
 */
async function evaluateWithRecourse(
  planJson: string,
  apiUrl: string
): Promise<RecourseEvaluateResponse> {
  const response = await fetch(`${apiUrl}/api/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'terraform',
      input: JSON.parse(planJson),
    }),
  });

  if (!response.ok) {
    throw new Error(`RecourseOS API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Send callback to Terraform Cloud with results
 */
async function sendCallback(
  callbackUrl: string,
  token: string,
  result: RunTaskCallback
): Promise<void> {
  const response = await fetch(callbackUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'task-results',
        attributes: {
          status: result.status,
          message: result.message,
          url: result.url,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send callback: ${response.status}`);
  }
}

/**
 * Send notification to Slack
 */
async function notifySlack(webhookUrl: string, message: string, result: RecourseEvaluateResponse, workspace: string, org: string): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Terraform Cloud: ${org}/${workspace}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `RecourseOS: ${result.riskAssessment.toUpperCase()}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: message },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `*Workspace:* ${org}/${workspace}` },
            { type: 'mrkdwn', text: `*Mutations:* ${result.summary.totalMutations}` },
          ],
        },
      ],
    }),
  });
}

/**
 * Main handler for Terraform Cloud run tasks
 */
export async function handleRunTask(
  request: RunTaskRequest,
  callbackUrl: string,
  env: Env = {}
): Promise<RunTaskCallback> {
  const apiUrl = env.RECOURSE_API_URL || 'http://localhost:3001';

  // Only process post_plan stage
  if (request.stage !== 'post_plan') {
    return {
      status: 'passed',
      message: 'RecourseOS only evaluates post_plan stage',
    };
  }

  // Fetch the plan JSON
  if (!request.plan_json_api_url) {
    return {
      status: 'failed',
      message: 'No plan JSON URL provided',
    };
  }

  try {
    // Fetch plan from TFC
    const planJson = await fetchPlanJson(
      request.plan_json_api_url,
      request.access_token
    );

    // Evaluate with RecourseOS
    const result = await evaluateWithRecourse(planJson, apiUrl);

    // Build message
    const statusEmoji = result.riskAssessment === 'allow' ? '✅' :
                        result.riskAssessment === 'warn' ? '⚠️' :
                        result.riskAssessment === 'escalate' ? '🖐️' : '⛔';

    const lines: string[] = [
      `${statusEmoji} ${result.riskAssessment.toUpperCase()}: ${result.assessmentReason}`,
      '',
    ];

    // Add mutation details (first 5)
    for (const mutation of result.mutations.slice(0, 5)) {
      const emoji = getTierEmoji(mutation.recoverability.tier);
      const target = getTargetDisplay(mutation.intent.target);
      lines.push(`${emoji} ${target}: ${mutation.recoverability.label}`);
    }

    if (result.mutations.length > 5) {
      lines.push(`... and ${result.mutations.length - 5} more`);
    }

    // Add attestation info if present
    if (result.attestation) {
      lines.push('');
      lines.push(`📜 Attestation: ${result.attestation.attestation_uri}`);
    }

    const message = lines.join('\n');

    const callback: RunTaskCallback = {
      status: mapToTfcStatus(result.riskAssessment),
      message,
      url: result.attestation?.attestation_uri || 'https://recourseos.dev/docs',
    };

    // Send callback to TFC
    if (callbackUrl) {
      await sendCallback(callbackUrl, request.access_token, callback);
    }

    // Send notifications
    if (env.RECOURSE_SLACK_WEBHOOK && (result.riskAssessment === 'escalate' || result.riskAssessment === 'block')) {
      await notifySlack(env.RECOURSE_SLACK_WEBHOOK, message, result, request.workspace_name, request.organization_name);
    }

    return callback;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      status: 'failed',
      message: `RecourseOS evaluation failed: ${errorMessage}`,
    };
  }
}

/**
 * Express/Node.js compatible handler
 */
export async function httpHandler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const request: RunTaskRequest = req.body;
  const callbackUrl = req.headers['x-tfc-task-callback-url'] as string;

  // Acknowledge immediately (TFC expects fast response)
  res.status(200).json({ status: 'processing' });

  // Process asynchronously
  try {
    await handleRunTask(request, callbackUrl, process.env as Env);
  } catch (error) {
    console.error('Run task failed:', error);
  }
}

/**
 * AWS Lambda handler
 */
export async function lambdaHandler(event: any): Promise<any> {
  const request: RunTaskRequest = JSON.parse(event.body);
  const callbackUrl = event.headers['x-tfc-task-callback-url'];

  const result = await handleRunTask(request, callbackUrl, process.env as Env);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

/**
 * Cloudflare Workers handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-tfc-task-callback-url',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body: RunTaskRequest = await request.json();
    const callbackUrl = request.headers.get('x-tfc-task-callback-url') || '';

    const result = await handleRunTask(body, callbackUrl, env);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
