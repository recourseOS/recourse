/**
 * Slack webhook notifications for RecourseOS escalations.
 */

export interface SlackNotificationConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

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

const RISK_COLORS: Record<string, string> = {
  allow: '#10b981', // green
  warn: '#f59e0b', // amber
  escalate: '#8b5cf6', // purple
  block: '#ef4444', // red
};

const RISK_EMOJI: Record<string, string> = {
  allow: ':white_check_mark:',
  warn: ':warning:',
  escalate: ':raised_hand:',
  block: ':no_entry:',
};

export function formatSlackMessage(alert: ConsequenceAlert): object {
  const color = RISK_COLORS[alert.riskAssessment] || '#6b7280';
  const emoji = RISK_EMOJI[alert.riskAssessment] || ':question:';
  const timestamp = alert.timestamp || new Date().toISOString();

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} RecourseOS: ${alert.riskAssessment.toUpperCase()}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Source:*\n${alert.source}`,
        },
        {
          type: 'mrkdwn',
          text: `*Action:*\n${alert.action}`,
        },
        {
          type: 'mrkdwn',
          text: `*Target:*\n\`${alert.target}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Recoverability:*\n${alert.tier}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reasoning:*\n${alert.reasoning}`,
      },
    },
  ];

  // Add context (actor, environment, timestamp)
  const contextElements = [];
  if (alert.actor) {
    contextElements.push({
      type: 'mrkdwn',
      text: `*Actor:* ${alert.actor}`,
    });
  }
  if (alert.environment) {
    contextElements.push({
      type: 'mrkdwn',
      text: `*Environment:* ${alert.environment}`,
    });
  }
  contextElements.push({
    type: 'mrkdwn',
    text: `*Time:* ${timestamp}`,
  });

  if (contextElements.length > 0) {
    blocks.push({
      type: 'context',
      elements: contextElements,
    } as any);
  }

  // Add action buttons for escalate/block
  if (alert.riskAssessment === 'escalate' || alert.riskAssessment === 'block') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':white_check_mark: Approve',
            emoji: true,
          },
          style: 'primary',
          action_id: 'recourse_approve',
          value: JSON.stringify({ target: alert.target, action: alert.action }),
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: ':x: Deny',
            emoji: true,
          },
          style: 'danger',
          action_id: 'recourse_deny',
          value: JSON.stringify({ target: alert.target, action: alert.action }),
        },
      ],
    } as any);
  }

  return {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

export async function sendSlackNotification(
  config: SlackNotificationConfig,
  alert: ConsequenceAlert
): Promise<{ success: boolean; error?: string }> {
  const message = formatSlackMessage(alert);

  // Add optional channel override
  const payload: any = { ...message };
  if (config.channel) payload.channel = config.channel;
  if (config.username) payload.username = config.username;
  if (config.iconEmoji) payload.icon_emoji = config.iconEmoji;

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack API error: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send Slack notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Create a notifier function from environment config.
 * Reads RECOURSE_SLACK_WEBHOOK from environment.
 */
export function createSlackNotifier(): ((alert: ConsequenceAlert) => Promise<void>) | null {
  const webhookUrl = process.env.RECOURSE_SLACK_WEBHOOK;
  if (!webhookUrl) return null;

  const config: SlackNotificationConfig = {
    webhookUrl,
    channel: process.env.RECOURSE_SLACK_CHANNEL,
    username: process.env.RECOURSE_SLACK_USERNAME || 'RecourseOS',
    iconEmoji: process.env.RECOURSE_SLACK_EMOJI || ':shield:',
  };

  return async (alert: ConsequenceAlert) => {
    const result = await sendSlackNotification(config, alert);
    if (!result.success) {
      console.error(`[RecourseOS] Slack notification failed: ${result.error}`);
    }
  };
}
