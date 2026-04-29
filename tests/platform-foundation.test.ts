import { describe, expect, it } from 'vitest';
import { terraformChangeToMutation } from '../src/adapters/terraform.js';
import { conservativeUnknownClassifier } from '../src/classifier/unknown-resource.js';
import { evaluateRecoverability } from '../src/policy/local.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type ResourceChange,
} from '../src/resources/types.js';

describe('platform foundation', () => {
  it('normalizes Terraform resource changes into mutation intents', () => {
    const change: ResourceChange = {
      address: 'aws_db_instance.main',
      type: 'aws_db_instance',
      name: 'main',
      providerName: 'registry.terraform.io/hashicorp/aws',
      actions: ['delete'],
      before: {
        identifier: 'prod-db',
        skip_final_snapshot: true,
      },
      after: null,
      afterUnknown: {},
    };

    const intent = terraformChangeToMutation(change, {
      actorId: 'ci/build-123',
      environment: 'production',
      owner: 'platform',
    });

    expect(intent.source).toBe('terraform');
    expect(intent.action).toBe('delete');
    expect(intent.target.id).toBe('aws_db_instance.main');
    expect(intent.target.provider).toBe('registry.terraform.io/hashicorp/aws');
    expect(intent.target.environment).toBe('production');
    expect(intent.actor?.id).toBe('ci/build-123');
    expect(intent.raw).toBe(change);
  });

  it('defaults unknown destructive semantics to needs-review', () => {
    const result = conservativeUnknownClassifier.classify({
      intent: {
        source: 'mcp',
        action: 'delete',
        target: {
          type: 'vendor_unknown_bucket',
          id: 'prod-audit-logs',
        },
      },
    });

    expect(result.tier).toBe(RecoverabilityTier.NEEDS_REVIEW);
    expect(result.label).toBe('needs-review');
    expect(result.abstain).toBe(true);
    expect(result.missingEvidence).toContain('resource-semantics');
  });

  it('maps recoverability tiers to local policy decisions', () => {
    expect(evaluateRecoverability({
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'Config-only update',
    }).decision).toBe('allow');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'Snapshot required',
    }).decision).toBe('warn');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.UNRECOVERABLE,
      label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
      reasoning: 'Data will be lost',
    }).decision).toBe('block');

    expect(evaluateRecoverability({
      tier: RecoverabilityTier.NEEDS_REVIEW,
      label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
      reasoning: 'Unknown semantics',
    }).decision).toBe('escalate');
  });
});
