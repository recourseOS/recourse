import type { MutationAction, MutationIntent } from '../core/index.js';
import type { AdapterContext, ConsequenceAdapter } from './types.js';

export interface ShellCommandInput {
  command: string;
  cwd?: string;
}

interface ShellPattern {
  pattern: RegExp;
  action: MutationAction;
  type: string;
  id: (match: RegExpMatchArray, command: string) => string;
  service?: string;
}

const SHELL_PATTERNS: ShellPattern[] = [
  {
    pattern: /^\s*rm\s+(?:-[^\s]*r[^\s]*\s+|-[^\s]*f[^\s]*\s+|-[^\s]*rf[^\s]*\s+|-[^\s]*fr[^\s]*\s+)?(.+)$/,
    action: 'delete',
    type: 'filesystem_path',
    service: 'filesystem',
    id: match => match[1].trim(),
  },
  {
    pattern: /^\s*kubectl\s+delete\s+([^\s]+)\s+([^\s]+)/,
    action: 'delete',
    type: 'kubernetes_resource',
    service: 'kubernetes',
    id: match => `${match[1]}/${match[2]}`,
  },
  {
    pattern: /^\s*aws\s+s3\s+rm\s+([^\s]+)(?:\s+--recursive)?/,
    action: 'delete',
    type: 's3_object_or_prefix',
    service: 'aws-s3',
    id: match => match[1],
  },
  {
    pattern: /^\s*aws\s+s3\s+rb\s+([^\s]+)(?:\s+--force)?/,
    action: 'delete',
    type: 's3_bucket',
    service: 'aws-s3',
    id: match => match[1],
  },
  {
    pattern: /^\s*aws\s+rds\s+delete-db-instance\b(?=.*--db-instance-identifier\s+([^\s]+)).*/,
    action: 'delete',
    type: 'rds_db_instance',
    service: 'aws-rds',
    id: match => match[1],
  },
  {
    pattern: /^\s*aws\s+dynamodb\s+delete-table\b(?=.*--table-name\s+([^\s]+)).*/,
    action: 'delete',
    type: 'dynamodb_table',
    service: 'aws-dynamodb',
    id: match => match[1],
  },
  {
    pattern: /^\s*aws\s+iam\s+delete-role\b(?=.*--role-name\s+([^\s]+)).*/,
    action: 'delete',
    type: 'iam_role',
    service: 'aws-iam',
    id: match => match[1],
  },
  {
    pattern: /^\s*aws\s+kms\s+schedule-key-deletion\b(?=.*--key-id\s+([^\s]+)).*/,
    action: 'delete',
    type: 'kms_key',
    service: 'aws-kms',
    id: match => match[1],
  },
  {
    pattern: /^\s*git\s+push\s+(?:[^\s]+\s+)?(?:--force|-f|--delete)\s*(.*)$/,
    action: 'update',
    type: 'git_ref',
    service: 'git',
    id: match => match[1].trim() || 'remote-ref',
  },
  {
    pattern: /^\s*psql\b.*\s-c\s+["']?(drop|delete|truncate|alter)\b/i,
    action: 'execute',
    type: 'sql_statement',
    service: 'postgres',
    id: (_match, command) => command,
  },
];

export class ShellCommandAdapter implements ConsequenceAdapter<ShellCommandInput | string> {
  source = 'shell' as const;

  parse(input: ShellCommandInput | string, context: AdapterContext = {}): MutationIntent[] {
    const command = typeof input === 'string' ? input : input.command;
    const cwd = typeof input === 'string' ? undefined : input.cwd;
    return [shellCommandToMutation(command, { ...context, metadata: { ...context.metadata, cwd } })];
  }
}

export function shellCommandToMutation(
  command: string,
  context: AdapterContext = {}
): MutationIntent {
  const matched = SHELL_PATTERNS
    .map(pattern => ({ pattern, match: command.match(pattern.pattern) }))
    .find(result => result.match);

  if (!matched || !matched.match) {
    return baseShellIntent(command, context, {
      action: 'execute',
      type: 'shell_command',
      id: command,
    });
  }

  return baseShellIntent(command, context, {
    action: matched.pattern.action,
    type: matched.pattern.type,
    id: matched.pattern.id(matched.match, command),
    service: matched.pattern.service,
  });
}

function baseShellIntent(
  command: string,
  context: AdapterContext,
  target: {
    action: MutationAction;
    type: string;
    id: string;
    service?: string;
  }
): MutationIntent {
  return {
    source: 'shell',
    action: target.action,
    target: {
      service: target.service,
      type: target.type,
      id: target.id,
      environment: context.environment,
      owner: context.owner,
    },
    actor: context.actorId
      ? {
          id: context.actorId,
          kind: 'unknown',
        }
      : undefined,
    raw: command,
    metadata: context.metadata,
  };
}
