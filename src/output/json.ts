import type { BlastRadiusReport } from '../resources/types.js';
import { RecoverabilityTier, RecoverabilityLabels } from '../resources/types.js';

export interface JsonOutput {
  version: string;
  summary: {
    totalChanges: number;
    unrecoverable: number;
    recoverableFromBackup: number;
    recoverableWithEffort: number;
    reversible: number;
    cascadeImpactCount: number;
    hasUnrecoverable: boolean;
    worstTier: string;
  };
  changes: Array<{
    address: string;
    type: string;
    actions: string[];
    recoverability: {
      tier: number;
      label: string;
      reasoning: string;
    };
    cascadeImpact: Array<{
      affectedResource: string;
      reason: string;
    }>;
  }>;
}

export function formatJson(report: BlastRadiusReport): string {
  const output = toJsonOutput(report);
  return JSON.stringify(output, null, 2);
}

export function toJsonOutput(report: BlastRadiusReport): JsonOutput {
  const { summary, changes } = report;

  // Find worst tier
  let worstTier = RecoverabilityTier.REVERSIBLE;
  for (const change of changes) {
    if (change.recoverability.tier > worstTier) {
      worstTier = change.recoverability.tier;
    }
  }

  return {
    version: '0.1.0',
    summary: {
      totalChanges: summary.totalChanges,
      unrecoverable: summary.byTier[RecoverabilityTier.UNRECOVERABLE],
      recoverableFromBackup: summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      recoverableWithEffort: summary.byTier[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
      reversible: summary.byTier[RecoverabilityTier.REVERSIBLE],
      cascadeImpactCount: summary.cascadeImpactCount,
      hasUnrecoverable: summary.hasUnrecoverable,
      worstTier: RecoverabilityLabels[worstTier],
    },
    changes: changes.map(change => ({
      address: change.resource.address,
      type: change.resource.type,
      actions: change.resource.actions,
      recoverability: {
        tier: change.recoverability.tier,
        label: change.recoverability.label,
        reasoning: change.recoverability.reasoning,
      },
      cascadeImpact: change.cascadeImpact,
    })),
  };
}
