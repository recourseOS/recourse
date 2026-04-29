import type { EvidenceItem, MissingEvidence } from '../../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../../resources/types.js';
import type { AwsSignedClient } from './client.js';

export interface IamRoleEvidence {
  roleName: string;
  exists?: boolean;
  arn?: string;
  path?: string;
  attachedPolicyCount?: number;
  inlinePolicyCount?: number;
  instanceProfileCount?: number;
  permissionsBoundaryArn?: string;
  missingEvidence?: string[];
}

export interface IamEvidenceAnalysis {
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
}

export async function readIamRoleEvidence(
  client: AwsSignedClient,
  roleName: string
): Promise<IamRoleEvidence> {
  const [roleResponse, attachedPoliciesResponse, inlinePoliciesResponse, instanceProfilesResponse] = await Promise.all([
    requestIam(client, {
      Action: 'GetRole',
      RoleName: roleName,
      Version: '2010-05-08',
    }),
    requestIam(client, {
      Action: 'ListAttachedRolePolicies',
      RoleName: roleName,
      Version: '2010-05-08',
    }),
    requestIam(client, {
      Action: 'ListRolePolicies',
      RoleName: roleName,
      Version: '2010-05-08',
    }),
    requestIam(client, {
      Action: 'ListInstanceProfilesForRole',
      RoleName: roleName,
      Version: '2010-05-08',
    }),
  ]);

  return {
    roleName,
    exists: roleResponse.statusCode === 200 && roleResponse.body.includes('<Role>'),
    arn: xmlValue(roleResponse.body, 'Arn'),
    path: xmlValue(roleResponse.body, 'Path'),
    permissionsBoundaryArn: xmlValue(roleResponse.body, 'PermissionsBoundaryArn'),
    attachedPolicyCount: attachedPoliciesResponse.statusCode === 200
      ? xmlValues(attachedPoliciesResponse.body, 'PolicyArn').length
      : undefined,
    inlinePolicyCount: inlinePoliciesResponse.statusCode === 200
      ? xmlValues(inlinePoliciesResponse.body, 'member').length
      : undefined,
    instanceProfileCount: instanceProfilesResponse.statusCode === 200
      ? xmlValues(instanceProfilesResponse.body, 'InstanceProfileName').length
      : undefined,
    missingEvidence: [
      isUnavailable(roleResponse.statusCode) ? 'iam.role' : '',
      isUnavailable(attachedPoliciesResponse.statusCode) ? 'iam.attached_policies' : '',
      isUnavailable(inlinePoliciesResponse.statusCode) ? 'iam.inline_policies' : '',
      isUnavailable(instanceProfilesResponse.statusCode) ? 'iam.instance_profiles' : '',
    ].filter(Boolean),
  };
}

export function analyzeIamRoleDeletionEvidence(
  evidence: IamRoleEvidence
): IamEvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);

  if (missingEvidence.length > 0 || evidence.exists !== true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'IAM role deletion cannot be classified safely without complete role, policy, and attachment evidence',
        source: 'rules',
        confidence: 0.45,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if ((evidence.instanceProfileCount ?? 0) > 0) {
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'IAM role is attached to instance profiles; deletion can break workloads and requires coordinated recreation',
        source: 'rules',
        confidence: 0.85,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if ((evidence.attachedPolicyCount ?? 0) > 0 || (evidence.inlinePolicyCount ?? 0) > 0) {
    return {
      recoverability: {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'IAM role has policies that can be recreated but may break access while absent',
        source: 'rules',
        confidence: 0.8,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  return {
    recoverability: {
      tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reasoning: 'IAM role can be recreated, but trust relationships and external references may require manual restoration',
      source: 'rules',
      confidence: 0.75,
    },
    evidence: evidenceItems,
    missingEvidence,
  };
}

function requestIam(
  client: AwsSignedClient,
  params: Record<string, string>
) {
  return client.request({
    method: 'GET',
    service: 'iam',
    region: 'us-east-1',
    host: 'iam.amazonaws.com',
    path: '/',
    query: canonicalQuery(params),
  }).catch(error => ({
    statusCode: 0,
    body: String(error instanceof Error ? error.message : error),
    headers: {},
  }));
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1];
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g'))]
    .map(match => match[1]);
}

function isUnavailable(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 403 || statusCode >= 500;
}

function toEvidenceItems(evidence: IamRoleEvidence): EvidenceItem[] {
  return [
    {
      key: 'iam.role',
      value: evidence.roleName,
      present: true,
      description: 'IAM role targeted by the mutation',
    },
    {
      key: 'iam.attached_policy_count',
      value: evidence.attachedPolicyCount,
      present: (evidence.attachedPolicyCount ?? 0) > 0,
      description: 'Managed policies attached to the role',
    },
    {
      key: 'iam.inline_policy_count',
      value: evidence.inlinePolicyCount,
      present: (evidence.inlinePolicyCount ?? 0) > 0,
      description: 'Inline policies embedded in the role',
    },
    {
      key: 'iam.instance_profile_count',
      value: evidence.instanceProfileCount,
      present: (evidence.instanceProfileCount ?? 0) > 0,
      description: 'Instance profiles that reference the role',
    },
    {
      key: 'iam.permissions_boundary',
      value: evidence.permissionsBoundaryArn,
      present: Boolean(evidence.permissionsBoundaryArn),
      description: 'Permissions boundary attached to the role',
    },
  ];
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live IAM state`,
    effect: 'requires-review',
  }));
}
