#!/usr/bin/env npx tsx
/**
 * Test script for Slack webhook integration.
 *
 * Usage:
 *   RECOURSE_SLACK_WEBHOOK=https://hooks.slack.com/... npx tsx src/notifications/test-slack.ts
 */

import { sendSlackNotification, formatSlackMessage, type ConsequenceAlert, type SlackNotificationConfig } from './slack.js';

const webhookUrl = process.env.RECOURSE_SLACK_WEBHOOK;

if (!webhookUrl) {
  console.error('Error: RECOURSE_SLACK_WEBHOOK environment variable not set');
  console.error('');
  console.error('Usage:');
  console.error('  RECOURSE_SLACK_WEBHOOK=https://hooks.slack.com/services/... npx tsx src/notifications/test-slack.ts');
  console.error('');
  console.error('To create a webhook:');
  console.error('  1. Go to https://api.slack.com/apps');
  console.error('  2. Create an app or select existing');
  console.error('  3. Enable "Incoming Webhooks"');
  console.error('  4. Add a webhook to your workspace');
  process.exit(1);
}

const config: SlackNotificationConfig = {
  webhookUrl,
  username: 'RecourseOS',
  iconEmoji: ':shield:',
};

// Test cases
const testAlerts: ConsequenceAlert[] = [
  {
    riskAssessment: 'allow',
    source: 'terraform',
    target: 'aws_s3_bucket.logs',
    action: 'update',
    tier: 'reversible',
    reasoning: 'Tag update only, fully reversible',
    environment: 'staging',
    actor: 'test-script',
  },
  {
    riskAssessment: 'warn',
    source: 'shell',
    target: 's3://my-bucket/tmp/',
    action: 'aws s3 rm --recursive',
    tier: 'recoverable-with-effort',
    reasoning: 'S3 versioning enabled, objects can be restored',
    environment: 'staging',
    actor: 'test-script',
  },
  {
    riskAssessment: 'escalate',
    source: 'mcp',
    target: 'prod-database',
    action: 'rds.delete_db_instance',
    tier: 'recoverable-from-backup',
    reasoning: 'Final snapshot will be created, but restore requires manual intervention',
    environment: 'production',
    actor: 'test-script',
  },
  {
    riskAssessment: 'block',
    source: 'terraform',
    target: 'aws_db_instance.prod',
    action: 'delete',
    tier: 'unrecoverable',
    reasoning: 'skip_final_snapshot=true, backup_retention=0; ALL DATA WILL BE LOST',
    environment: 'production',
    actor: 'test-script',
  },
];

async function runTests() {
  console.log('🧪 Testing Slack webhook integration\n');
  console.log(`Webhook: ${webhookUrl!.slice(0, 50)}...`);
  console.log('');

  for (const alert of testAlerts) {
    console.log(`📤 Sending ${alert.riskAssessment.toUpperCase()} alert...`);

    const result = await sendSlackNotification(config, alert);

    if (result.success) {
      console.log(`   ✅ Sent successfully`);
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
    }

    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n✨ Test complete! Check your Slack channel.');
}

// Preview mode - just show the formatted messages
if (process.argv.includes('--preview')) {
  console.log('📋 Preview mode - showing formatted messages:\n');
  for (const alert of testAlerts) {
    console.log(`--- ${alert.riskAssessment.toUpperCase()} ---`);
    console.log(JSON.stringify(formatSlackMessage(alert), null, 2));
    console.log('');
  }
  process.exit(0);
}

runTests().catch(console.error);
