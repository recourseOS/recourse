/**
 * Cloud IAM Session Broker
 *
 * Allows agents to request time-limited, scoped credentials instead of
 * long-lived broad access. This is "the right to act" paradigm - agents
 * must earn access per operation through RecourseOS evaluation.
 *
 * Flow:
 * 1. Agent requests credentials for a specific operation
 * 2. RecourseOS evaluates the intent
 * 3. If approved, broker issues scoped STS credentials
 * 4. Credentials auto-expire (default: 15 minutes)
 *
 * Supported Clouds:
 * - AWS (via STS AssumeRole with session policy)
 * - GCP (via Service Account impersonation) - planned
 * - Azure (via Managed Identity) - planned
 */

import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  type Credentials,
} from '@aws-sdk/client-sts';
import {
  evaluateShellCommandConsequences,
  evaluateMcpToolCallConsequences,
} from '../evaluator/index.js';
import { toConsequenceJson } from '../output/consequence-json.js';
import { getAttestationService, type AttestationService } from '../attestation/service.js';

// Session request
export interface SessionRequest {
  // What the agent wants to do (for evaluation)
  intent:
    | { type: 'shell'; command: string }
    | { type: 'mcp'; tool: string; arguments: Record<string, unknown> }
    | { type: 'terraform'; planJson: object };

  // Cloud to get credentials for
  cloud: 'aws' | 'gcp' | 'azure';

  // Role to assume (AWS ARN, GCP service account, Azure identity)
  roleArn?: string;

  // Session duration in seconds (default: 900 = 15 minutes)
  durationSeconds?: number;

  // Session name for audit trail
  sessionName?: string;

  // Actor identifier
  actor?: string;

  // Environment context
  environment?: string;
}

// Session response
export interface SessionResponse {
  // Whether credentials were granted
  granted: boolean;

  // Risk assessment from evaluation
  riskAssessment: 'allow' | 'warn' | 'escalate' | 'block';

  // Reason for decision
  reason: string;

  // Attestation for this session grant
  attestation?: {
    attestation_uri: string;
    key_id: string;
  };

  // Credentials (only if granted)
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
  };

  // Session metadata
  session?: {
    sessionId: string;
    roleArn: string;
    expiresAt: string;
    scopedPermissions: string[];
  };
}

// Broker configuration
export interface BrokerConfig {
  // Role ARN to assume for issuing credentials
  brokerRoleArn: string;

  // Risk levels that allow credential issuance
  allowedRiskLevels: ('allow' | 'warn' | 'escalate' | 'block')[];

  // Default session duration in seconds
  defaultDurationSeconds: number;

  // Maximum session duration
  maxDurationSeconds: number;

  // Enable attestation signing
  attestation: boolean;

  // AWS region
  region?: string;
}

/**
 * Cloud IAM Session Broker
 */
export class SessionBroker {
  private sts: STSClient;
  private config: BrokerConfig;
  private attestationService: AttestationService | null = null;

  constructor(config: BrokerConfig) {
    this.config = {
      brokerRoleArn: config.brokerRoleArn,
      allowedRiskLevels: config.allowedRiskLevels ?? ['allow', 'warn'],
      defaultDurationSeconds: config.defaultDurationSeconds ?? 900, // 15 minutes
      maxDurationSeconds: config.maxDurationSeconds ?? 3600, // 1 hour
      attestation: config.attestation ?? true,
      region: config.region,
    };

    this.sts = new STSClient({ region: config.region });
  }

  /**
   * Initialize the broker
   */
  async initialize(): Promise<void> {
    // Verify broker has STS access
    const identity = await this.sts.send(new GetCallerIdentityCommand({}));
    console.log(`[session-broker] Initialized as ${identity.Arn}`);

    // Initialize attestation
    if (this.config.attestation) {
      this.attestationService = getAttestationService();
      await this.attestationService.initialize();
      console.log(`[session-broker] Attestation enabled with key: ${this.attestationService.getCurrentKeyId()}`);
    }
  }

  /**
   * Request a scoped session
   */
  async requestSession(request: SessionRequest): Promise<SessionResponse> {
    // Step 1: Evaluate the intent
    const evaluation = await this.evaluateIntent(request);

    // Step 2: Check if risk level allows credential issuance
    const allowed = this.config.allowedRiskLevels.includes(evaluation.riskAssessment);

    if (!allowed) {
      // Create attestation for denial
      const attestation = this.attestationService?.createAttestation(
        { request, decision: 'denied' },
        { riskAssessment: evaluation.riskAssessment, reason: evaluation.reason }
      );

      return {
        granted: false,
        riskAssessment: evaluation.riskAssessment,
        reason: evaluation.reason,
        attestation: attestation
          ? { attestation_uri: attestation.attestation_uri, key_id: attestation.key_id }
          : undefined,
      };
    }

    // Step 3: Derive scoped policy from intent
    const scopedPolicy = this.deriveScopedPolicy(request);

    // Step 4: Assume role with session policy
    const duration = Math.min(
      request.durationSeconds ?? this.config.defaultDurationSeconds,
      this.config.maxDurationSeconds
    );

    const sessionName =
      request.sessionName ??
      `recourse-${request.actor ?? 'agent'}-${Date.now()}`;

    try {
      const roleArn = request.roleArn ?? this.config.brokerRoleArn;

      const assumeResponse = await this.sts.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: sessionName.slice(0, 64), // AWS limit
          DurationSeconds: duration,
          Policy: JSON.stringify(scopedPolicy),
          Tags: [
            { Key: 'RecourseActor', Value: request.actor?.slice(0, 256) ?? 'unknown' },
            { Key: 'RecourseEnvironment', Value: request.environment?.slice(0, 256) ?? 'unknown' },
            { Key: 'RecourseRiskLevel', Value: evaluation.riskAssessment },
          ],
        })
      );

      const credentials = assumeResponse.Credentials!;
      const expiration = credentials.Expiration!.toISOString();

      // Create attestation for grant
      const attestation = this.attestationService?.createAttestation(
        {
          request,
          decision: 'granted',
          sessionName,
          roleArn,
          scopedPermissions: scopedPolicy.Statement.map((s: any) => s.Action).flat(),
        },
        { riskAssessment: evaluation.riskAssessment, reason: evaluation.reason }
      );

      return {
        granted: true,
        riskAssessment: evaluation.riskAssessment,
        reason: evaluation.reason,
        attestation: attestation
          ? { attestation_uri: attestation.attestation_uri, key_id: attestation.key_id }
          : undefined,
        credentials: {
          accessKeyId: credentials.AccessKeyId!,
          secretAccessKey: credentials.SecretAccessKey!,
          sessionToken: credentials.SessionToken!,
          expiration,
        },
        session: {
          sessionId: sessionName,
          roleArn: roleArn,
          expiresAt: expiration,
          scopedPermissions: scopedPolicy.Statement.map((s: any) => s.Action).flat(),
        },
      };
    } catch (error: any) {
      return {
        granted: false,
        riskAssessment: evaluation.riskAssessment,
        reason: `STS error: ${error.message}`,
      };
    }
  }

  /**
   * Evaluate the agent's intent
   */
  private async evaluateIntent(
    request: SessionRequest
  ): Promise<{ riskAssessment: 'allow' | 'warn' | 'escalate' | 'block'; reason: string }> {
    const intent = request.intent;

    if (intent.type === 'shell') {
      const report = await evaluateShellCommandConsequences({ command: intent.command });
      const json = toConsequenceJson(report);
      return {
        riskAssessment: json.riskAssessment as 'allow' | 'warn' | 'escalate' | 'block',
        reason: json.assessmentReason,
      };
    }

    if (intent.type === 'mcp') {
      const report = await evaluateMcpToolCallConsequences({
        tool: intent.tool,
        arguments: intent.arguments,
      });
      const json = toConsequenceJson(report);
      return {
        riskAssessment: json.riskAssessment as 'allow' | 'warn' | 'escalate' | 'block',
        reason: json.assessmentReason,
      };
    }

    // For Terraform, we'd need the plan evaluator
    // For now, return conservative assessment
    return {
      riskAssessment: 'escalate',
      reason: 'Terraform intent evaluation not yet implemented',
    };
  }

  /**
   * Derive a scoped IAM policy from the intent
   *
   * This creates a session policy that only allows the specific
   * actions the agent wants to perform, nothing more.
   */
  private deriveScopedPolicy(request: SessionRequest): {
    Version: string;
    Statement: Array<{
      Effect: string;
      Action: string[];
      Resource: string[];
      Condition?: Record<string, any>;
    }>;
  } {
    const intent = request.intent;

    // Default: deny all (shouldn't reach here, but safety)
    const defaultPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Deny',
          Action: ['*'],
          Resource: ['*'],
        },
      ],
    };

    if (intent.type === 'shell') {
      // Parse AWS CLI command to derive permissions
      const permissions = this.parseAwsCliPermissions(intent.command);
      if (permissions.length === 0) {
        return defaultPolicy;
      }

      return {
        Version: '2012-10-17',
        Statement: permissions.map((p) => ({
          Effect: 'Allow',
          Action: [p.action],
          Resource: [p.resource ?? '*'],
          ...(p.condition ? { Condition: p.condition } : {}),
        })),
      };
    }

    if (intent.type === 'mcp') {
      // Map MCP tool to IAM permissions
      const permissions = this.mapMcpToolPermissions(intent.tool, intent.arguments);
      if (permissions.length === 0) {
        return defaultPolicy;
      }

      return {
        Version: '2012-10-17',
        Statement: permissions.map((p) => ({
          Effect: 'Allow',
          Action: [p.action],
          Resource: [p.resource ?? '*'],
        })),
      };
    }

    return defaultPolicy;
  }

  /**
   * Parse AWS CLI command to IAM permissions
   */
  private parseAwsCliPermissions(
    command: string
  ): Array<{ action: string; resource?: string; condition?: Record<string, any> }> {
    const permissions: Array<{ action: string; resource?: string; condition?: Record<string, any> }> = [];

    // Match aws <service> <operation> patterns
    const awsMatch = command.match(/aws\s+(\S+)\s+(\S+)/);
    if (!awsMatch) return permissions;

    const [, service, operation] = awsMatch;

    // Service to IAM service prefix mapping
    const serviceMap: Record<string, string> = {
      s3: 's3',
      s3api: 's3',
      ec2: 'ec2',
      rds: 'rds',
      iam: 'iam',
      lambda: 'lambda',
      dynamodb: 'dynamodb',
      sqs: 'sqs',
      sns: 'sns',
      sts: 'sts',
    };

    const iamService = serviceMap[service] ?? service;

    // Operation to IAM action mapping (CLI uses kebab-case, IAM uses CamelCase)
    const iamAction = operation
      .split('-')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');

    const fullAction = `${iamService}:${iamAction.charAt(0).toUpperCase() + iamAction.slice(1)}`;
    permissions.push({ action: fullAction });

    // Try to extract resource ARN from command
    // e.g., --bucket my-bucket → arn:aws:s3:::my-bucket
    const bucketMatch = command.match(/--bucket\s+(\S+)/);
    if (bucketMatch && service.startsWith('s3')) {
      permissions[0].resource = `arn:aws:s3:::${bucketMatch[1]}`;

      // Also need permissions on objects for most operations
      if (!operation.includes('bucket')) {
        permissions.push({
          action: fullAction,
          resource: `arn:aws:s3:::${bucketMatch[1]}/*`,
        });
      }
    }

    return permissions;
  }

  /**
   * Map MCP tool to IAM permissions
   */
  private mapMcpToolPermissions(
    tool: string,
    args: Record<string, unknown>
  ): Array<{ action: string; resource?: string }> {
    const permissions: Array<{ action: string; resource?: string }> = [];

    // Common MCP tool patterns
    const toolPatterns: Record<string, { action: string; resourceFn?: (args: Record<string, unknown>) => string }> = {
      // S3 operations
      's3_list_buckets': { action: 's3:ListAllMyBuckets' },
      's3_get_object': {
        action: 's3:GetObject',
        resourceFn: (a) => `arn:aws:s3:::${a.bucket}/${a.key}`,
      },
      's3_put_object': {
        action: 's3:PutObject',
        resourceFn: (a) => `arn:aws:s3:::${a.bucket}/${a.key}`,
      },
      's3_delete_object': {
        action: 's3:DeleteObject',
        resourceFn: (a) => `arn:aws:s3:::${a.bucket}/${a.key}`,
      },

      // EC2 operations
      'ec2_describe_instances': { action: 'ec2:DescribeInstances' },
      'ec2_start_instances': {
        action: 'ec2:StartInstances',
        resourceFn: (a) => {
          const ids = a.instance_ids as string[];
          return ids ? `arn:aws:ec2:*:*:instance/${ids[0]}` : '*';
        },
      },
      'ec2_stop_instances': {
        action: 'ec2:StopInstances',
        resourceFn: (a) => {
          const ids = a.instance_ids as string[];
          return ids ? `arn:aws:ec2:*:*:instance/${ids[0]}` : '*';
        },
      },

      // DynamoDB operations
      'dynamodb_get_item': {
        action: 'dynamodb:GetItem',
        resourceFn: (a) => `arn:aws:dynamodb:*:*:table/${a.table_name}`,
      },
      'dynamodb_put_item': {
        action: 'dynamodb:PutItem',
        resourceFn: (a) => `arn:aws:dynamodb:*:*:table/${a.table_name}`,
      },
      'dynamodb_query': {
        action: 'dynamodb:Query',
        resourceFn: (a) => `arn:aws:dynamodb:*:*:table/${a.table_name}`,
      },
    };

    const pattern = toolPatterns[tool];
    if (pattern) {
      permissions.push({
        action: pattern.action,
        resource: pattern.resourceFn ? pattern.resourceFn(args) : undefined,
      });
    }

    return permissions;
  }
}

/**
 * Create broker from environment
 */
export function createBrokerFromEnv(): SessionBroker {
  const roleArn = process.env.RECOURSE_BROKER_ROLE_ARN;
  if (!roleArn) {
    throw new Error('RECOURSE_BROKER_ROLE_ARN environment variable required');
  }

  return new SessionBroker({
    brokerRoleArn: roleArn,
    allowedRiskLevels: (process.env.RECOURSE_ALLOWED_LEVELS?.split(',') as any) ?? [
      'allow',
      'warn',
    ],
    defaultDurationSeconds: parseInt(process.env.RECOURSE_SESSION_DURATION ?? '900'),
    maxDurationSeconds: parseInt(process.env.RECOURSE_MAX_SESSION_DURATION ?? '3600'),
    attestation: process.env.RECOURSE_ATTESTATION !== 'false',
    region: process.env.AWS_REGION,
  });
}
