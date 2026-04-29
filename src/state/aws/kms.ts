import type { EvidenceItem, MissingEvidence } from '../../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
} from '../../resources/types.js';
import type { AwsSignedClient } from './client.js';

export interface KmsKeyEvidence {
  keyId: string;
  region?: string;
  exists?: boolean;
  arn?: string;
  keyState?: string;
  keyManager?: string;
  keyUsage?: string;
  origin?: string;
  multiRegion?: boolean;
  deletionDate?: string;
  validTo?: string;
  rotationEnabled?: boolean;
  tagCount?: number;
  missingEvidence?: string[];
}

export interface KmsEvidenceAnalysis {
  recoverability: RecoverabilityResult;
  evidence: EvidenceItem[];
  missingEvidence: MissingEvidence[];
}

export async function readKmsKeyEvidence(
  client: AwsSignedClient,
  keyId: string,
  region = 'us-east-1'
): Promise<KmsKeyEvidence> {
  const [keyResponse, rotationResponse, tagsResponse] = await Promise.all([
    requestKms(client, region, 'TrentService.DescribeKey', { KeyId: keyId }),
    requestKms(client, region, 'TrentService.GetKeyRotationStatus', { KeyId: keyId }),
    requestKms(client, region, 'TrentService.ListResourceTags', { KeyId: keyId }),
  ]);

  const keyMetadata = parseJsonObject(keyResponse.body)?.KeyMetadata as Record<string, unknown> | undefined;
  const tags = parseJsonObject(tagsResponse.body)?.Tags;

  return {
    keyId,
    region,
    exists: keyResponse.statusCode === 200 && Boolean(keyMetadata),
    arn: stringValue(keyMetadata?.Arn),
    keyState: stringValue(keyMetadata?.KeyState),
    keyManager: stringValue(keyMetadata?.KeyManager),
    keyUsage: stringValue(keyMetadata?.KeyUsage),
    origin: stringValue(keyMetadata?.Origin),
    multiRegion: booleanValue(keyMetadata?.MultiRegion),
    deletionDate: stringValue(keyMetadata?.DeletionDate),
    validTo: stringValue(keyMetadata?.ValidTo),
    rotationEnabled: booleanValue(parseJsonObject(rotationResponse.body)?.KeyRotationEnabled),
    tagCount: Array.isArray(tags) ? tags.length : undefined,
    missingEvidence: [
      isUnavailable(keyResponse.statusCode) ? 'kms.key' : '',
      isUnavailable(rotationResponse.statusCode) ? 'kms.rotation' : '',
      isUnavailable(tagsResponse.statusCode) ? 'kms.tags' : '',
    ].filter(Boolean),
  };
}

export function analyzeKmsKeyDeletionEvidence(
  evidence: KmsKeyEvidence
): KmsEvidenceAnalysis {
  const evidenceItems = toEvidenceItems(evidence);
  const missingEvidence = toMissingEvidence(evidence.missingEvidence ?? []);

  if (missingEvidence.length > 0 || evidence.exists !== true) {
    return {
      recoverability: {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'KMS key deletion cannot be classified safely without complete key metadata evidence',
        source: 'rules',
        confidence: 0.45,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (evidence.keyManager === 'AWS') {
    return {
      recoverability: {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'AWS-managed KMS keys cannot be scheduled for customer deletion',
        source: 'rules',
        confidence: 0.95,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  if (evidence.keyState === 'PendingDeletion' || evidence.deletionDate) {
    return {
      recoverability: {
        tier: RecoverabilityTier.NEEDS_REVIEW,
        label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
        reasoning: 'KMS key is pending deletion; cancellation may still be possible, but final deletion can make encrypted data unrecoverable',
        source: 'rules',
        confidence: 0.7,
      },
      evidence: evidenceItems,
      missingEvidence,
    };
  }

  return {
    recoverability: {
      tier: RecoverabilityTier.NEEDS_REVIEW,
      label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
      reasoning: 'Scheduling KMS key deletion has a cancellation window, but final key deletion can make encrypted data unrecoverable',
      source: 'rules',
      confidence: 0.75,
    },
    evidence: evidenceItems,
    missingEvidence,
  };
}

function requestKms(
  client: AwsSignedClient,
  region: string,
  target: string,
  body: Record<string, unknown>
) {
  return client.request({
    method: 'POST',
    service: 'kms',
    region,
    host: `kms.${region}.amazonaws.com`,
    path: '/',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': target,
    },
    body: JSON.stringify(body),
  }).catch(error => ({
    statusCode: 0,
    body: String(error instanceof Error ? error.message : error),
    headers: {},
  }));
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isUnavailable(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 403 || statusCode >= 500;
}

function toEvidenceItems(evidence: KmsKeyEvidence): EvidenceItem[] {
  return [
    {
      key: 'kms.key',
      value: evidence.keyId,
      present: true,
      description: 'KMS key targeted by the mutation',
    },
    {
      key: 'kms.key_state',
      value: evidence.keyState,
      present: Boolean(evidence.keyState),
      description: 'KMS key state',
    },
    {
      key: 'kms.key_manager',
      value: evidence.keyManager,
      present: Boolean(evidence.keyManager),
      description: 'Whether the key is customer-managed or AWS-managed',
    },
    {
      key: 'kms.deletion_date',
      value: evidence.deletionDate,
      present: Boolean(evidence.deletionDate),
      description: 'Scheduled KMS deletion date',
    },
    {
      key: 'kms.rotation_enabled',
      value: evidence.rotationEnabled,
      present: evidence.rotationEnabled === true,
      description: 'KMS automatic key rotation setting',
    },
    {
      key: 'kms.multi_region',
      value: evidence.multiRegion,
      present: evidence.multiRegion === true,
      description: 'KMS multi-region key setting',
    },
    {
      key: 'kms.tag_count',
      value: evidence.tagCount,
      present: (evidence.tagCount ?? 0) > 0,
      description: 'Tags associated with the KMS key',
    },
  ];
}

function toMissingEvidence(keys: string[]): MissingEvidence[] {
  return keys.map(key => ({
    key,
    description: `Unable to verify ${key} from live KMS state`,
    effect: 'requires-review',
  }));
}
