import type {
  TerraformPlan,
  TerraformState,
  ResourceChange,
  BlastRadiusReport,
  BlastRadiusChange,
  BlastRadiusSummary,
  CascadeImpact,
} from '../resources/types.js';
import { RecoverabilityTier } from '../resources/types.js';
import { getRecoverability } from '../resources/index.js';
import { buildDependencyGraph, findDependents } from './dependencies.js';
import { filterAllChanges } from '../parsers/plan.js';

export interface AnalyzeOptions {
  includeNonDestructive?: boolean;  // Include creates and updates, not just deletes
}

export function analyzeBlastRadius(
  plan: TerraformPlan,
  state: TerraformState | null,
  options: AnalyzeOptions = {}
): BlastRadiusReport {
  const { includeNonDestructive = true } = options;

  // Get changes to analyze
  let changes: ResourceChange[];
  if (includeNonDestructive) {
    changes = filterAllChanges(plan);
  } else {
    changes = plan.resourceChanges.filter(c =>
      c.actions.includes('delete') ||
      (c.actions.includes('delete') && c.actions.includes('create'))
    );
  }

  // Use prior state from plan if no separate state provided
  const effectiveState = state || plan.priorState || null;

  // Build dependency graph from state
  const graph = effectiveState ? buildDependencyGraph(effectiveState) : null;

  // Analyze each change
  const analyzedChanges: BlastRadiusChange[] = changes.map(change => {
    const recoverability = getRecoverability(change, effectiveState);

    // Find cascade impact for destructive changes
    let cascadeImpact: CascadeImpact[] = [];
    if (graph && change.actions.includes('delete')) {
      const dependents = findDependents(graph, change.address);
      cascadeImpact = dependents.map(dep => ({
        affectedResource: dep.address,
        reason: dep.referenceAttribute
          ? `References ${dep.referenceAttribute}`
          : `Depends on deleted resource`,
      }));
    }

    return {
      resource: change,
      recoverability,
      cascadeImpact,
    };
  });

  // Build summary
  const summary = buildSummary(analyzedChanges);

  return {
    changes: analyzedChanges,
    summary,
  };
}

function buildSummary(changes: BlastRadiusChange[]): BlastRadiusSummary {
  const byTier: Record<RecoverabilityTier, number> = {
    [RecoverabilityTier.REVERSIBLE]: 0,
    [RecoverabilityTier.RECOVERABLE_WITH_EFFORT]: 0,
    [RecoverabilityTier.RECOVERABLE_FROM_BACKUP]: 0,
    [RecoverabilityTier.UNRECOVERABLE]: 0,
  };

  let cascadeImpactCount = 0;
  const seenCascade = new Set<string>();

  for (const change of changes) {
    byTier[change.recoverability.tier]++;

    for (const impact of change.cascadeImpact) {
      if (!seenCascade.has(impact.affectedResource)) {
        seenCascade.add(impact.affectedResource);
        cascadeImpactCount++;
      }
    }
  }

  return {
    totalChanges: changes.length,
    byTier,
    cascadeImpactCount,
    hasUnrecoverable: byTier[RecoverabilityTier.UNRECOVERABLE] > 0,
  };
}

export function getWorstTier(report: BlastRadiusReport): RecoverabilityTier {
  let worst = RecoverabilityTier.REVERSIBLE;

  for (const change of report.changes) {
    if (change.recoverability.tier > worst) {
      worst = change.recoverability.tier;
    }
  }

  return worst;
}

export function shouldBlock(
  report: BlastRadiusReport,
  threshold: RecoverabilityTier = RecoverabilityTier.UNRECOVERABLE
): boolean {
  return getWorstTier(report) >= threshold;
}
