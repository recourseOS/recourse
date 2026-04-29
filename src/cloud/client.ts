import type { ConsequenceReport } from '../core/index.js';

export interface CloudSubmitConfig {
  cloudUrl: string;
  organizationId: string;
  actorId: string;
  actorKind?: 'human' | 'agent' | 'ci' | 'service' | 'unknown';
  environment?: string;
  source: string;
  timeoutMs?: number;
}

export interface CloudSubmitResult {
  id: string;
  policyResult?: {
    action?: string;
    reason?: string;
    requiresApproval?: boolean;
  };
}

export function resolveCloudSubmitConfig(input: {
  cloudUrl?: string;
  organizationId?: string;
  actorId?: string;
  actorKind?: CloudSubmitConfig['actorKind'];
  environment?: string;
  source: string;
  timeoutMs?: number;
}): CloudSubmitConfig {
  const cloudUrl = input.cloudUrl ?? process.env.RECOURSE_CLOUD_URL;
  const organizationId = input.organizationId ?? process.env.RECOURSE_ORGANIZATION_ID;
  const actorId = input.actorId ?? process.env.RECOURSE_ACTOR_ID;

  if (!cloudUrl) {
    throw new Error('RECOURSE_CLOUD_URL is required when --submit is used');
  }
  if (!organizationId) {
    throw new Error('RECOURSE_ORGANIZATION_ID is required when --submit is used');
  }
  if (!actorId) {
    throw new Error('RECOURSE_ACTOR_ID or --actor is required when --submit is used');
  }

  return {
    cloudUrl,
    organizationId,
    actorId,
    actorKind: input.actorKind ?? inferActorKind(actorId),
    environment: input.environment ?? process.env.RECOURSE_ENVIRONMENT,
    source: input.source,
    timeoutMs: normalizeTimeoutMs(input.timeoutMs),
  };
}

export async function submitConsequenceReport(
  report: ConsequenceReport,
  config: CloudSubmitConfig,
): Promise<CloudSubmitResult> {
  const endpoint = new URL('/v1/evaluations', normalizeCloudUrl(config.cloudUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-recourse-organization-id': config.organizationId,
        'x-recourse-actor-id': config.actorId,
      },
      body: JSON.stringify({
        organizationId: config.organizationId,
        actor: {
          id: config.actorId,
          kind: config.actorKind ?? 'unknown',
        },
        environment: config.environment ?? 'unknown',
        source: config.source,
        consequenceReport: report,
        metadata: {
          submittedBy: 'recourse-cli',
        },
      }),
      signal: controller.signal,
    });

    const body = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`cloud returned HTTP ${response.status}: ${getResponseMessage(body, response.statusText)}`);
    }

    return body as CloudSubmitResult;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('cloud submission timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCloudUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function inferActorKind(actorId: string): CloudSubmitConfig['actorKind'] {
  if (actorId.startsWith('human/')) return 'human';
  if (actorId.startsWith('agent/')) return 'agent';
  if (actorId.startsWith('ci/')) return 'ci';
  if (actorId.startsWith('service/')) return 'service';
  return 'unknown';
}

function getResponseMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }

  return fallback;
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
