/**
 * PagerDuty integration for RecourseOS
 *
 * Creates incidents for blocked/escalated changes using the Events API v2.
 */

import type { BlastRadiusReport } from '../analyzer/blast-radius.js';

interface PagerDutyConfig {
  routingKey: string;  // Integration key from PagerDuty service
  source?: string;
  component?: string;
}

interface PagerDutyPayload {
  routing_key: string;
  event_action: 'trigger' | 'acknowledge' | 'resolve';
  dedup_key?: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    timestamp?: string;
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, any>;
  };
  links?: Array<{ href: string; text: string }>;
  images?: Array<{ src: string; href?: string; alt?: string }>;
}

interface PagerDutyResponse {
  status: string;
  message: string;
  dedup_key: string;
}

type RiskLevel = 'allow' | 'warn' | 'escalate' | 'block';

/**
 * Map RecourseOS risk to PagerDuty severity
 */
function mapSeverity(risk: RiskLevel): 'critical' | 'error' | 'warning' | 'info' {
  switch (risk) {
    case 'block':
      return 'critical';
    case 'escalate':
      return 'error';
    case 'warn':
      return 'warning';
    default:
      return 'info';
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
 * Format PagerDuty message from report
 */
export function formatPagerDutyEvent(
  report: BlastRadiusReport,
  config: PagerDutyConfig,
  context?: {
    actor?: string;
    environment?: string;
    runId?: string;
  }
): PagerDutyPayload {
  const risk = getRiskLevel(report);
  const { summary, changes } = report;

  // Build summary
  let summaryText: string;
  if (risk === 'block') {
    summaryText = `RecourseOS BLOCKED: ${summary.unrecoverable} unrecoverable change(s) detected`;
  } else if (risk === 'escalate') {
    summaryText = `RecourseOS ESCALATE: ${summary.needsReview} change(s) need human review`;
  } else if (risk === 'warn') {
    summaryText = `RecourseOS WARN: ${summary.totalChanges} recoverable change(s)`;
  } else {
    summaryText = `RecourseOS: ${summary.totalChanges} safe change(s)`;
  }

  // Get concerning changes
  const concerningChanges = changes
    .filter(c => c.recoverability.tier >= 3)
    .slice(0, 5)
    .map(c => ({
      resource: c.address,
      action: c.action,
      tier: c.recoverability.label,
      reason: c.recoverability.reasoning,
    }));

  return {
    routing_key: config.routingKey,
    event_action: 'trigger',
    dedup_key: context?.runId,
    payload: {
      summary: summaryText,
      source: config.source || 'recourse-os',
      severity: mapSeverity(risk),
      timestamp: new Date().toISOString(),
      component: config.component || 'infrastructure',
      group: context?.environment,
      class: 'consequence-evaluation',
      custom_details: {
        risk_assessment: risk.toUpperCase(),
        total_changes: summary.totalChanges,
        unrecoverable: summary.unrecoverable,
        needs_review: summary.needsReview,
        reversible: summary.reversible,
        actor: context?.actor,
        environment: context?.environment,
        concerning_changes: concerningChanges,
      },
    },
    links: [
      {
        href: 'https://recourseos.dev/docs',
        text: 'RecourseOS Documentation',
      },
    ],
  };
}

/**
 * Send event to PagerDuty Events API v2
 */
export async function sendPagerDutyEvent(
  payload: PagerDutyPayload
): Promise<{ success: boolean; dedupKey?: string; error?: string }> {
  const url = 'https://events.pagerduty.com/v2/enqueue';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `PagerDuty API error: ${response.status} - ${error}` };
    }

    const data: PagerDutyResponse = await response.json();
    return { success: true, dedupKey: data.dedup_key };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Acknowledge an existing incident
 */
export async function acknowledgePagerDutyIncident(
  routingKey: string,
  dedupKey: string
): Promise<{ success: boolean; error?: string }> {
  const payload: PagerDutyPayload = {
    routing_key: routingKey,
    event_action: 'acknowledge',
    dedup_key: dedupKey,
    payload: {
      summary: 'Acknowledged by RecourseOS',
      source: 'recourse-os',
      severity: 'info',
    },
  };

  const result = await sendPagerDutyEvent(payload);
  return { success: result.success, error: result.error };
}

/**
 * Resolve an existing incident
 */
export async function resolvePagerDutyIncident(
  routingKey: string,
  dedupKey: string
): Promise<{ success: boolean; error?: string }> {
  const payload: PagerDutyPayload = {
    routing_key: routingKey,
    event_action: 'resolve',
    dedup_key: dedupKey,
    payload: {
      summary: 'Resolved by RecourseOS',
      source: 'recourse-os',
      severity: 'info',
    },
  };

  const result = await sendPagerDutyEvent(payload);
  return { success: result.success, error: result.error };
}

/**
 * Create a PagerDuty notifier from environment variables
 */
export function createPagerDutyNotifier(options?: {
  routingKey?: string;
  source?: string;
  component?: string;
}): ((
  report: BlastRadiusReport,
  context?: { actor?: string; environment?: string; runId?: string }
) => Promise<{ success: boolean; dedupKey?: string; error?: string }>) | null {
  const routingKey = options?.routingKey || process.env.PAGERDUTY_ROUTING_KEY;

  if (!routingKey) {
    return null;
  }

  const config: PagerDutyConfig = {
    routingKey,
    source: options?.source || process.env.RECOURSE_SOURCE || 'recourse-os',
    component: options?.component || process.env.RECOURSE_COMPONENT,
  };

  return async (report, context) => {
    const payload = formatPagerDutyEvent(report, config, context);
    return sendPagerDutyEvent(payload);
  };
}

/**
 * Notify PagerDuty only for escalate/block conditions
 */
export async function notifyPagerDutyIfNeeded(
  report: BlastRadiusReport,
  config: PagerDutyConfig,
  context?: {
    actor?: string;
    environment?: string;
    runId?: string;
  }
): Promise<{ notified: boolean; dedupKey?: string; error?: string }> {
  const risk = getRiskLevel(report);

  // Only notify for escalate or block
  if (risk !== 'escalate' && risk !== 'block') {
    return { notified: false };
  }

  const payload = formatPagerDutyEvent(report, config, context);
  const result = await sendPagerDutyEvent(payload);

  return {
    notified: true,
    dedupKey: result.dedupKey,
    error: result.error,
  };
}
