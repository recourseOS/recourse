/**
 * Notification system for RecourseOS escalations.
 *
 * Supports:
 * - Slack webhooks (RECOURSE_SLACK_WEBHOOK)
 * - Discord webhooks (RECOURSE_DISCORD_WEBHOOK)
 * - PagerDuty Events API (PAGERDUTY_ROUTING_KEY)
 * - Opsgenie Alerts API (OPSGENIE_API_KEY)
 *
 * Notifications are sent automatically when risk is 'escalate' or 'block'.
 */

export { sendSlackNotification, createSlackNotifier, formatSlackMessage } from './slack.js';
export { sendDiscordNotification, createDiscordNotifier, formatDiscordMessage } from './discord.js';
// PagerDuty and Opsgenie temporarily disabled - type fixes needed
// export { ... } from './pagerduty.js';
// export { ... } from './opsgenie.js';

export interface ConsequenceAlert {
  riskAssessment: 'allow' | 'warn' | 'escalate' | 'block';
  source: 'terraform' | 'shell' | 'mcp';
  target: string;
  action: string;
  tier: string;
  reasoning: string;
  actor?: string;
  environment?: string;
  timestamp?: string;
}

export type Notifier = (alert: ConsequenceAlert) => Promise<void>;

/**
 * Create a combined notifier that sends to all configured channels.
 * Reads from environment variables:
 * - RECOURSE_SLACK_WEBHOOK
 * - RECOURSE_DISCORD_WEBHOOK
 */
export function createNotifier(): Notifier | null {
  const notifiers: Notifier[] = [];

  // Slack
  const slackWebhook = process.env.RECOURSE_SLACK_WEBHOOK;
  if (slackWebhook) {
    const { createSlackNotifier } = require('./slack.js');
    const slackNotifier = createSlackNotifier();
    if (slackNotifier) notifiers.push(slackNotifier);
  }

  // Discord
  const discordWebhook = process.env.RECOURSE_DISCORD_WEBHOOK;
  if (discordWebhook) {
    const { createDiscordNotifier } = require('./discord.js');
    const discordNotifier = createDiscordNotifier();
    if (discordNotifier) notifiers.push(discordNotifier);
  }

  if (notifiers.length === 0) return null;

  return async (alert: ConsequenceAlert) => {
    await Promise.all(notifiers.map((n) => n(alert)));
  };
}

/**
 * Check if notifications are configured.
 */
export function hasNotifications(): boolean {
  return !!(
    process.env.RECOURSE_SLACK_WEBHOOK ||
    process.env.RECOURSE_DISCORD_WEBHOOK ||
    process.env.PAGERDUTY_ROUTING_KEY ||
    process.env.OPSGENIE_API_KEY
  );
}

/**
 * Notify if risk level warrants it (escalate or block).
 */
export async function notifyIfNeeded(alert: ConsequenceAlert): Promise<void> {
  if (alert.riskAssessment !== 'escalate' && alert.riskAssessment !== 'block') {
    return;
  }

  const notifier = createNotifier();
  if (notifier) {
    await notifier(alert);
  }
}
