import type { MutationAction, MutationIntent } from '../core/index.js';
import type { AdapterContext, ConsequenceAdapter } from './types.js';

export interface McpToolCall {
  tool: string;
  arguments?: Record<string, unknown>;
  server?: string;
}

interface McpPattern {
  pattern: RegExp;
  action: MutationAction;
  type: string;
  service?: string;
}

const MCP_PATTERNS: McpPattern[] = [
  {
    pattern: /(?:^|[._:/-])(delete|deletion|destroy|remove|drop|truncate|revoke|detach|disable)(?:$|[._:/-])/i,
    action: 'delete',
    type: 'tool_resource',
  },
  {
    pattern: /(?:^|[._:/-])(update|apply|patch|replace|rotate|scale|migrate|deploy)(?:$|[._:/-])/i,
    action: 'update',
    type: 'tool_resource',
  },
  {
    pattern: /(?:^|[._:/-])(create|provision|attach|enable|grant)(?:$|[._:/-])/i,
    action: 'create',
    type: 'tool_resource',
  },
];

const TARGET_KEYS = [
  'resource',
  'resource_id',
  'id',
  'name',
  'bucket',
  'dbInstanceIdentifier',
  'db_instance_identifier',
  'tableName',
  'table_name',
  'roleName',
  'role_name',
  'keyId',
  'key_id',
  'database',
  'table',
  'namespace',
  'path',
  'file',
  'url',
];

export class McpToolCallAdapter implements ConsequenceAdapter<McpToolCall> {
  source = 'mcp' as const;

  parse(input: McpToolCall, context: AdapterContext = {}): MutationIntent[] {
    return [mcpToolCallToMutation(input, context)];
  }
}

export function mcpToolCallToMutation(
  call: McpToolCall,
  context: AdapterContext = {}
): MutationIntent {
  const pattern = MCP_PATTERNS.find(candidate => candidate.pattern.test(call.tool));
  const action = pattern?.action ?? 'execute';
  const service = call.server ?? inferServiceFromTool(call.tool);
  const targetId = inferTargetId(call);
  const isS3Bucket = service === 'aws' && /\bs3\b/i.test(call.tool) && hasStringArg(call, 'bucket');
  const isRdsInstance = service === 'aws' && /\brds\b/i.test(call.tool) && (
    hasStringArg(call, 'dbInstanceIdentifier')
    || hasStringArg(call, 'db_instance_identifier')
    || hasStringArg(call, 'database')
  );
  const isDynamoDbTable = service === 'aws' && /dynamodb/i.test(call.tool) && (
    hasStringArg(call, 'tableName')
    || hasStringArg(call, 'table_name')
    || hasStringArg(call, 'table')
  );
  const isIamRole = service === 'aws' && /\biam\b/i.test(call.tool) && (
    hasStringArg(call, 'roleName')
    || hasStringArg(call, 'role_name')
    || hasStringArg(call, 'role')
  );
  const isKmsKey = service === 'aws' && /\bkms\b/i.test(call.tool) && (
    hasStringArg(call, 'keyId')
    || hasStringArg(call, 'key_id')
    || hasStringArg(call, 'key')
  );

  return {
    source: 'mcp',
    action,
    target: {
      provider: call.server,
      service: isS3Bucket ? 'aws-s3' : isRdsInstance ? 'aws-rds' : isDynamoDbTable ? 'aws-dynamodb' : isIamRole ? 'aws-iam' : isKmsKey ? 'aws-kms' : service,
      type: isS3Bucket ? 's3_bucket' : isRdsInstance ? 'rds_db_instance' : isDynamoDbTable ? 'dynamodb_table' : isIamRole ? 'iam_role' : isKmsKey ? 'kms_key' : pattern?.type ?? 'tool_call',
      id: targetId,
      environment: context.environment,
      owner: context.owner,
    },
    actor: context.actorId
      ? {
          id: context.actorId,
          kind: 'agent',
        }
      : undefined,
    raw: call,
    metadata: {
      ...context.metadata,
      tool: call.tool,
      arguments: call.arguments ?? {},
    },
  };
}

function hasStringArg(call: McpToolCall, key: string): boolean {
  const value = call.arguments?.[key];
  return typeof value === 'string' && value.length > 0;
}

function inferTargetId(call: McpToolCall): string {
  const args = call.arguments ?? {};
  for (const key of TARGET_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return call.tool;
}

function inferServiceFromTool(tool: string): string {
  const [prefix] = tool.split(/[.:/]/);
  return prefix || 'mcp-tool';
}
