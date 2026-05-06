/**
 * Discord webhook notifications for RecourseOS escalations.
 */

export interface DiscordNotificationConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
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

const RISK_COLORS: Record<string, number> = {
  allow: 0x10b981, // green
  warn: 0xf59e0b, // amber
  escalate: 0x8b5cf6, // purple
  block: 0xef4444, // red
};

const RISK_EMOJI: Record<string, string> = {
  allow: '✅',
  warn: '⚠️',
  escalate: '🖐️',
  block: '⛔',
};

export function formatDiscordMessage(alert: ConsequenceAlert): object {
  const color = RISK_COLORS[alert.riskAssessment] || 0x6b7280;
  const emoji = RISK_EMOJI[alert.riskAssessment] || '❓';
  const timestamp = alert.timestamp || new Date().toISOString();

  const fields = [
    { name: 'Source', value: alert.source, inline: true },
    { name: 'Action', value: alert.action, inline: true },
    { name: 'Target', value: `\`${alert.target}\``, inline: false },
    { name: 'Recoverability', value: alert.tier, inline: true },
  ];

  if (alert.actor) {
    fields.push({ name: 'Actor', value: alert.actor, inline: true });
  }
  if (alert.environment) {
    fields.push({ name: 'Environment', value: alert.environment, inline: true });
  }

  return {
    embeds: [
      {
        title: `${emoji} RecourseOS: ${alert.riskAssessment.toUpperCase()}`,
        description: `**Reasoning:**\n${alert.reasoning}`,
        color,
        fields,
        timestamp,
        footer: {
          text: 'RecourseOS Consequence Evaluation',
        },
      },
    ],
  };
}

export async function sendDiscordNotification(
  config: DiscordNotificationConfig,
  alert: ConsequenceAlert
): Promise<{ success: boolean; error?: string }> {
  const message = formatDiscordMessage(alert);

  const payload: any = { ...message };
  if (config.username) payload.username = config.username;
  if (config.avatarUrl) payload.avatar_url = config.avatarUrl;

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Discord API error: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send Discord notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Create a notifier function from environment config.
 * Reads RECOURSE_DISCORD_WEBHOOK from environment.
 */
export function createDiscordNotifier(): ((alert: ConsequenceAlert) => Promise<void>) | null {
  const webhookUrl = process.env.RECOURSE_DISCORD_WEBHOOK;
  if (!webhookUrl) return null;

  const config: DiscordNotificationConfig = {
    webhookUrl,
    username: process.env.RECOURSE_DISCORD_USERNAME || 'RecourseOS',
    avatarUrl: process.env.RECOURSE_DISCORD_AVATAR,
  };

  return async (alert: ConsequenceAlert) => {
    const result = await sendDiscordNotification(config, alert);
    if (!result.success) {
      console.error(`[RecourseOS] Discord notification failed: ${result.error}`);
    }
  };
}
