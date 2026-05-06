/**
 * Terraform Cloud Run Task Handler for RecourseOS
 *
 * Evaluates Terraform plans and sends results back to TFC.
 * Deploy as a serverless function (AWS Lambda, Cloudflare Workers, etc.)
 */

import { analyzeBlastRadius } from '../../src/analyzer/blast-radius.js';
import { parsePlanJson } from '../../src/parsers/plan.js';

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

// Result status mapping
type RecourseResult = 'allow' | 'warn' | 'escalate' | 'block';

function mapToTfcStatus(result: RecourseResult): 'passed' | 'failed' {
  switch (result) {
    case 'allow':
    case 'warn':
      return 'passed';
    case 'escalate':
    case 'block':
      return 'failed';
  }
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
    throw new Error(`Failed to fetch plan: ${response.status}`);
  }

  return response.text();
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
 * Main handler for Terraform Cloud run tasks
 */
export async function handleRunTask(
  request: RunTaskRequest,
  callbackUrl: string
): Promise<RunTaskCallback> {
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
    const planJsonStr = await fetchPlanJson(
      request.plan_json_api_url,
      request.access_token
    );

    // Parse and analyze
    const plan = parsePlanJson(planJsonStr);
    const report = analyzeBlastRadius(plan, null);

    // Determine result
    let result: RecourseResult;
    let message: string;

    if (report.summary.hasUnrecoverable) {
      result = 'block';
      message = `⛔ BLOCKED: ${report.summary.unrecoverable} unrecoverable change(s) detected`;
    } else if (report.summary.needsReview > 0) {
      result = 'escalate';
      message = `🖐️ ESCALATE: ${report.summary.needsReview} change(s) need review`;
    } else if (report.summary.recoverableFromBackup > 0 || report.summary.recoverableWithEffort > 0) {
      result = 'warn';
      message = `⚠️ WARN: ${report.summary.totalChanges} change(s), all recoverable`;
    } else {
      result = 'allow';
      message = `✅ ALLOW: ${report.summary.totalChanges} change(s), all safe`;
    }

    // Build detailed message
    const details: string[] = [message, ''];

    for (const change of report.changes.slice(0, 5)) {
      const icon = change.recoverability.tier === 4 ? '⛔' :
                   change.recoverability.tier === 3 ? '⚠️' :
                   change.recoverability.tier === 2 ? '🔧' : '✅';
      details.push(`${icon} ${change.address}: ${change.recoverability.label}`);
    }

    if (report.changes.length > 5) {
      details.push(`... and ${report.changes.length - 5} more`);
    }

    const callback: RunTaskCallback = {
      status: mapToTfcStatus(result),
      message: details.join('\n'),
      url: 'https://recourseos.dev/docs',
    };

    // Send callback if URL provided
    if (callbackUrl) {
      await sendCallback(callbackUrl, request.access_token, callback);
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

  // Acknowledge immediately
  res.status(200).json({ status: 'processing' });

  // Process asynchronously
  try {
    await handleRunTask(request, callbackUrl);
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

  // Process and respond
  const result = await handleRunTask(request, callbackUrl);

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

/**
 * Cloudflare Workers handler
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body: RunTaskRequest = await request.json();
    const callbackUrl = request.headers.get('x-tfc-task-callback-url') || '';

    const result = await handleRunTask(body, callbackUrl);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
