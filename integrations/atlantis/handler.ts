/**
 * Atlantis Webhook Handler for RecourseOS
 *
 * Receives Atlantis plan output and posts consequence analysis as PR comments.
 * Configure Atlantis to send webhooks to this handler.
 */

import { analyzeBlastRadius } from '../../src/analyzer/blast-radius.js';
import { parsePlanJson } from '../../src/parsers/plan.js';

// Atlantis webhook payload types
interface AtlantisWebhook {
  version: number;
  id: string;
  event_type: 'plan' | 'apply';
  status: 'success' | 'error';
  pull_request: {
    url: string;
    num: number;
    branch: string;
    author: string;
  };
  repo: {
    full_name: string;
    clone_url: string;
    vcs_type: 'github' | 'gitlab' | 'bitbucket' | 'azuredevops';
  };
  project: {
    name: string;
    dir: string;
    workspace: string;
  };
  plan_json?: string; // JSON plan output if available
  plan_log?: string;  // Raw plan output
}

interface CommentResult {
  success: boolean;
  comment_url?: string;
  error?: string;
}

type RecourseResult = 'allow' | 'warn' | 'escalate' | 'block';

/**
 * Build a markdown comment for the PR
 */
function buildComment(
  report: ReturnType<typeof analyzeBlastRadius>,
  project: AtlantisWebhook['project']
): string {
  const { summary, changes } = report;

  // Determine result
  let result: RecourseResult;
  let emoji: string;
  let title: string;

  if (summary.hasUnrecoverable) {
    result = 'block';
    emoji = '🛑';
    title = 'BLOCKED - Unrecoverable Changes Detected';
  } else if (summary.needsReview > 0) {
    result = 'escalate';
    emoji = '⚠️';
    title = 'ESCALATE - Human Review Required';
  } else if (summary.recoverableFromBackup > 0 || summary.recoverableWithEffort > 0) {
    result = 'warn';
    emoji = '⚡';
    title = 'WARNING - Recoverable Changes';
  } else {
    result = 'allow';
    emoji = '✅';
    title = 'SAFE - All Changes Recoverable';
  }

  const lines: string[] = [
    `## ${emoji} RecourseOS: ${title}`,
    '',
    `**Project:** \`${project.name}\` | **Dir:** \`${project.dir}\` | **Workspace:** \`${project.workspace}\``,
    '',
    '### Summary',
    '',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total Changes | ${summary.totalChanges} |`,
    `| Reversible | ${summary.reversible} |`,
    `| Recoverable (effort) | ${summary.recoverableWithEffort} |`,
    `| Recoverable (backup) | ${summary.recoverableFromBackup} |`,
    `| Needs Review | ${summary.needsReview} |`,
    `| Unrecoverable | ${summary.unrecoverable} |`,
    '',
  ];

  // Add details for concerning changes
  const concerningChanges = changes.filter(c => c.recoverability.tier >= 3);
  if (concerningChanges.length > 0) {
    lines.push('### Concerning Changes');
    lines.push('');
    lines.push('| Resource | Action | Risk | Reason |');
    lines.push('|----------|--------|------|--------|');

    for (const change of concerningChanges.slice(0, 10)) {
      const icon = change.recoverability.tier === 4 ? '🛑' : '⚠️';
      const action = change.action.replace('_', ' ');
      lines.push(
        `| \`${change.address}\` | ${action} | ${icon} ${change.recoverability.label} | ${change.recoverability.reasoning || '-'} |`
      );
    }

    if (concerningChanges.length > 10) {
      lines.push(`| ... | ... | ... | *${concerningChanges.length - 10} more* |`);
    }
    lines.push('');
  }

  // Add action guidance
  lines.push('### Recommended Action');
  lines.push('');

  switch (result) {
    case 'block':
      lines.push(
        '> **Do not apply this plan.** It contains changes that will cause permanent data loss.',
        '>',
        '> Review each flagged resource and ensure backups exist before proceeding.',
        '> Consider enabling deletion protection, final snapshots, or versioning.'
      );
      break;
    case 'escalate':
      lines.push(
        '> **Request explicit approval** before applying.',
        '>',
        '> These changes require human review to verify recovery procedures are in place.'
      );
      break;
    case 'warn':
      lines.push(
        '> **Proceed with caution.** All changes are recoverable, but may require effort.',
        '>',
        '> Ensure you have access to necessary backups or can recreate resources if needed.'
      );
      break;
    case 'allow':
      lines.push('> Safe to proceed. All changes are easily reversible or low-risk.');
      break;
  }

  lines.push('');
  lines.push('---');
  lines.push('*Analyzed by [RecourseOS](https://recourseos.dev)*');

  return lines.join('\n');
}

/**
 * Post a comment to GitHub PR
 */
async function postGitHubComment(
  repoFullName: string,
  prNumber: number,
  body: string,
  token: string
): Promise<CommentResult> {
  const url = `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `GitHub API error: ${response.status} - ${error}` };
  }

  const data = await response.json();
  return { success: true, comment_url: data.html_url };
}

/**
 * Post a comment to GitLab MR
 */
async function postGitLabComment(
  repoFullName: string,
  mrNumber: number,
  body: string,
  token: string
): Promise<CommentResult> {
  const encodedProject = encodeURIComponent(repoFullName);
  const url = `https://gitlab.com/api/v4/projects/${encodedProject}/merge_requests/${mrNumber}/notes`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `GitLab API error: ${response.status} - ${error}` };
  }

  const data = await response.json();
  return { success: true, comment_url: data.web_url };
}

/**
 * Post a comment to Bitbucket PR
 */
async function postBitbucketComment(
  repoFullName: string,
  prNumber: number,
  body: string,
  token: string
): Promise<CommentResult> {
  const url = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prNumber}/comments`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { raw: body } }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `Bitbucket API error: ${response.status} - ${error}` };
  }

  const data = await response.json();
  return { success: true, comment_url: data.links?.html?.href };
}

/**
 * Main handler for Atlantis webhooks
 */
export async function handleAtlantisWebhook(
  payload: AtlantisWebhook,
  tokens: {
    github?: string;
    gitlab?: string;
    bitbucket?: string;
  }
): Promise<{ success: boolean; result?: string; error?: string }> {
  // Only process successful plan events
  if (payload.event_type !== 'plan') {
    return { success: true, result: 'Skipped: not a plan event' };
  }

  if (payload.status !== 'success') {
    return { success: true, result: 'Skipped: plan was not successful' };
  }

  // Need plan JSON to analyze
  if (!payload.plan_json) {
    return { success: false, error: 'No plan JSON in webhook payload' };
  }

  try {
    // Parse and analyze
    const plan = parsePlanJson(payload.plan_json);
    const report = analyzeBlastRadius(plan, null);

    // Build comment
    const comment = buildComment(report, payload.project);

    // Post to appropriate VCS
    const { vcs_type, full_name } = payload.repo;
    const prNumber = payload.pull_request.num;

    let result: CommentResult;

    switch (vcs_type) {
      case 'github':
        if (!tokens.github) {
          return { success: false, error: 'GitHub token not configured' };
        }
        result = await postGitHubComment(full_name, prNumber, comment, tokens.github);
        break;

      case 'gitlab':
        if (!tokens.gitlab) {
          return { success: false, error: 'GitLab token not configured' };
        }
        result = await postGitLabComment(full_name, prNumber, comment, tokens.gitlab);
        break;

      case 'bitbucket':
        if (!tokens.bitbucket) {
          return { success: false, error: 'Bitbucket token not configured' };
        }
        result = await postBitbucketComment(full_name, prNumber, comment, tokens.bitbucket);
        break;

      default:
        return { success: false, error: `Unsupported VCS: ${vcs_type}` };
    }

    if (result.success) {
      return { success: true, result: `Comment posted: ${result.comment_url}` };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Express/Node.js HTTP handler
 */
export async function httpHandler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const payload: AtlantisWebhook = req.body;

  const tokens = {
    github: process.env.GITHUB_TOKEN,
    gitlab: process.env.GITLAB_TOKEN,
    bitbucket: process.env.BITBUCKET_TOKEN,
  };

  const result = await handleAtlantisWebhook(payload, tokens);

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(500).json(result);
  }
}

/**
 * AWS Lambda handler
 */
export async function lambdaHandler(event: any): Promise<any> {
  const payload: AtlantisWebhook = JSON.parse(event.body);

  const tokens = {
    github: process.env.GITHUB_TOKEN,
    gitlab: process.env.GITLAB_TOKEN,
    bitbucket: process.env.BITBUCKET_TOKEN,
  };

  const result = await handleAtlantisWebhook(payload, tokens);

  return {
    statusCode: result.success ? 200 : 500,
    body: JSON.stringify(result),
  };
}

/**
 * Cloudflare Workers handler
 */
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const payload: AtlantisWebhook = await request.json();

    const tokens = {
      github: env.GITHUB_TOKEN,
      gitlab: env.GITLAB_TOKEN,
      bitbucket: env.BITBUCKET_TOKEN,
    };

    const result = await handleAtlantisWebhook(payload, tokens);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
