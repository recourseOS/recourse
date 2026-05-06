/**
 * Opsgenie integration for RecourseOS
 *
 * Creates alerts for blocked/escalated changes using the Opsgenie Alert API.
 */

import type { BlastRadiusReport } from '../analyzer/blast-radius.js';

interface OpsgenieConfig {
  apiKey: string;       // Opsgenie API key
  region?: 'us' | 'eu'; // API region
  responders?: Array<{
    type: 'team' | 'user' | 'escalation' | 'schedule';
    name?: string;
    id?: string;
  }>;
  tags?: string[];
}

interface OpsgenieAlert {
  message: string;
  alias?: string;
  description?: string;
  responders?: OpsgenieConfig['responders'];
  visibleTo?: OpsgenieConfig['responders'];
  actions?: string[];
  tags?: string[];
  details?: Record<string, string>;
  entity?: string;
  source?: string;
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  user?: string;
  note?: string;
}

interface OpsgenieResponse {
  result: string;
  took: number;
  requestId: string;
}

type RiskLevel = 'allow' | 'warn' | 'escalate' | 'block';

/**
 * Map RecourseOS risk to Opsgenie priority
 */
function mapPriority(risk: RiskLevel): 'P1' | 'P2' | 'P3' | 'P4' | 'P5' {
  switch (risk) {
    case 'block':
      return 'P1';
    case 'escalate':
      return 'P2';
    case 'warn':
      return 'P3';
    default:
      return 'P5';
  }
}

/**
 * Determine risk level from report
 */
function getRiskLevel(report: BlastRadiusReport): RiskLevel {
  if (report.summary.hasUnrecoverable) return 'block';
  if (report.summary.needsReview > 0) return 'escalate';
  if (report.summary.recoverableFromBackup > 0 || report.summary.recoverableWithEffort > 0)
    return 'warn';
  return 'allow';
}

/**
 * Format Opsgenie alert from report
 */
export function formatOpsgenieAlert(
  report: BlastRadiusReport,
  config: OpsgenieConfig,
  context?: {
    actor?: string;
    environment?: string;
    runId?: string;
  }
): OpsgenieAlert {
  const risk = getRiskLevel(report);
  const { summary, changes } = report;

  // Build message
  let message: string;
  if (risk === 'block') {
    message = `[RecourseOS] BLOCKED: ${summary.unrecoverable} unrecoverable change(s)`;
  } else if (risk === 'escalate') {
    message = `[RecourseOS] ESCALATE: ${summary.needsReview} change(s) need review`;
  } else if (risk === 'warn') {
    message = `[RecourseOS] WARNING: ${summary.totalChanges} recoverable change(s)`;
  } else {
    message = `[RecourseOS] ${summary.totalChanges} safe change(s)`;
  }

  // Build description
  const descriptionLines: string[] = [
    `Risk Assessment: ${risk.toUpperCase()}`,
    '',
    '## Summary',
    `- Total Changes: ${summary.totalChanges}`,
    `- Unrecoverable: ${summary.unrecoverable}`,
    `- Needs Review: ${summary.needsReview}`,
    `- Recoverable (backup): ${summary.recoverableFromBackup}`,
    `- Recoverable (effort): ${summary.recoverableWithEffort}`,
    `- Reversible: ${summary.reversible}`,
    '',
  ];

  // Add concerning changes
  const concerningChanges = changes.filter(c => c.recoverability.tier >= 3);
  if (concerningChanges.length > 0) {
    descriptionLines.push('## Concerning Changes');
    for (const change of concerningChanges.slice(0, 5)) {
      descriptionLines.push(
        `- ${change.address}: ${change.recoverability.label}`,
        `  ${change.recoverability.reasoning || ''}`
      );
    }
    if (concerningChanges.length > 5) {
      descriptionLines.push(`- ... and ${concerningChanges.length - 5} more`);
    }
  }

  // Build details
  const details: Record<string, string> = {
    risk_assessment: risk.toUpperCase(),
    total_changes: String(summary.totalChanges),
    unrecoverable: String(summary.unrecoverable),
    needs_review: String(summary.needsReview),
    worst_tier: summary.worstTier,
  };

  if (context?.actor) details.actor = context.actor;
  if (context?.environment) details.environment = context.environment;
  if (context?.runId) details.run_id = context.runId;

  // Build tags
  const tags = [
    'recourse-os',
    `risk:${risk}`,
    ...(config.tags || []),
  ];

  if (context?.environment) tags.push(`env:${context.environment}`);

  return {
    message,
    alias: context?.runId || `recourse-${Date.now()}`,
    description: descriptionLines.join('\n'),
    responders: config.responders,
    tags,
    details,
    entity: context?.environment,
    source: 'RecourseOS',
    priority: mapPriority(risk),
    user: context?.actor,
  };
}

/**
 * Get Opsgenie API URL based on region
 */
function getApiUrl(region: 'us' | 'eu' = 'us'): string {
  return region === 'eu'
    ? 'https://api.eu.opsgenie.com/v2/alerts'
    : 'https://api.opsgenie.com/v2/alerts';
}

/**
 * Send alert to Opsgenie
 */
export async function sendOpsgenieAlert(
  alert: OpsgenieAlert,
  config: OpsgenieConfig
): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const url = getApiUrl(config.region);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `GenieKey ${config.apiKey}`,
      },
      body: JSON.stringify(alert),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Opsgenie API error: ${response.status} - ${error}` };
    }

    const data: OpsgenieResponse = await response.json();
    return { success: true, requestId: data.requestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Close an existing alert
 */
export async function closeOpsgenieAlert(
  alias: string,
  config: OpsgenieConfig,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${getApiUrl(config.region)}/${alias}/close?identifierType=alias`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `GenieKey ${config.apiKey}`,
      },
      body: JSON.stringify({
        source: 'RecourseOS',
        note: note || 'Closed by RecourseOS',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Opsgenie API error: ${response.status} - ${error}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Acknowledge an existing alert
 */
export async function acknowledgeOpsgenieAlert(
  alias: string,
  config: OpsgenieConfig,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${getApiUrl(config.region)}/${alias}/acknowledge?identifierType=alias`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `GenieKey ${config.apiKey}`,
      },
      body: JSON.stringify({
        source: 'RecourseOS',
        note: note || 'Acknowledged by RecourseOS',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Opsgenie API error: ${response.status} - ${error}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Create an Opsgenie notifier from environment variables
 */
export function createOpsgenieNotifier(options?: {
  apiKey?: string;
  region?: 'us' | 'eu';
  responders?: OpsgenieConfig['responders'];
  tags?: string[];
}): ((
  report: BlastRadiusReport,
  context?: { actor?: string; environment?: string; runId?: string }
) => Promise<{ success: boolean; requestId?: string; error?: string }>) | null {
  const apiKey = options?.apiKey || process.env.OPSGENIE_API_KEY;

  if (!apiKey) {
    return null;
  }

  const config: OpsgenieConfig = {
    apiKey,
    region: (options?.region || process.env.OPSGENIE_REGION || 'us') as 'us' | 'eu',
    responders: options?.responders,
    tags: options?.tags,
  };

  return async (report, context) => {
    const alert = formatOpsgenieAlert(report, config, context);
    return sendOpsgenieAlert(alert, config);
  };
}

/**
 * Notify Opsgenie only for escalate/block conditions
 */
export async function notifyOpsgenieIfNeeded(
  report: BlastRadiusReport,
  config: OpsgenieConfig,
  context?: {
    actor?: string;
    environment?: string;
    runId?: string;
  }
): Promise<{ notified: boolean; requestId?: string; error?: string }> {
  const risk = getRiskLevel(report);

  // Only notify for escalate or block
  if (risk !== 'escalate' && risk !== 'block') {
    return { notified: false };
  }

  const alert = formatOpsgenieAlert(report, config, context);
  const result = await sendOpsgenieAlert(alert, config);

  return {
    notified: true,
    requestId: result.requestId,
    error: result.error,
  };
}
