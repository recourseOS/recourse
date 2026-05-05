/**
 * Cross-Action Analysis
 *
 * Detects dangerous patterns where individual actions are safe but
 * their combination is unrecoverable.
 *
 * Design doc: docs/design/cross-action-analysis.md
 */

import type {
  ResourceChange,
  TerraformState,
  RecoverabilityResult,
} from '../resources/types.js';
import { RecoverabilityTier } from '../resources/types.js';
import type { DependencyGraph } from './dependencies.js';

// -----------------------------------------------------------------------------
// Confidence Levels
// -----------------------------------------------------------------------------

/**
 * Confidence levels for relationship detection.
 *
 * - definite: Structural proof (explicit attribute reference)
 * - probable: Strong inference from state lookup
 * - possible: Heuristic match (naming convention)
 */
export type RelationshipConfidence = 'definite' | 'probable' | 'possible';

/**
 * How a relationship was discovered.
 */
export type RelationshipDetectionMethod =
  | 'explicit_reference'  // Direct attribute reference in plan
  | 'state_lookup'        // Found via state traversal
  | 'naming_convention';  // Inferred from naming patterns (weak)

/**
 * Types of semantic relationships between resources.
 */
export type RelationshipType = 'backup' | 'replica' | 'protection' | 'dependency';

// -----------------------------------------------------------------------------
// Relationship Detection
// -----------------------------------------------------------------------------

/**
 * Result of detecting a relationship between resources.
 * Returned by handler relationship detection functions.
 */
export interface RelationshipMatch {
  /** The resource ID this resource relates to */
  targetId: string;

  /** How the relationship was discovered */
  detectionMethod: RelationshipDetectionMethod;

  /** Confidence level of the match */
  confidence: RelationshipConfidence;
}

/**
 * Full relationship information including type, for pattern matching.
 */
export interface CrossActionRelationship {
  type: RelationshipType;
  source: string;  // e.g., the snapshot
  target: string;  // e.g., the database it backs up
  detectionMethod: RelationshipDetectionMethod;
  confidence: RelationshipConfidence;
}

// -----------------------------------------------------------------------------
// Pattern Definition
// -----------------------------------------------------------------------------

/**
 * Context passed to pattern detection functions.
 */
export interface CrossActionContext {
  /** All resource changes in the plan */
  changes: ResourceChange[];

  /** Dependency graph between resources */
  dependencies: DependencyGraph | null;

  /** Individual recoverability verdicts (before cross-action analysis) */
  verdicts: Map<string, RecoverabilityResult>;

  /**
   * Terraform state (if available).
   *
   * Implementation note: State should be pre-indexed by resource address
   * for O(1) lookups. The stateIndex field provides this.
   */
  state: TerraformState | null;

  /**
   * Pre-indexed state for O(1) resource lookups.
   * Built once at analysis start, used by relationship detection.
   */
  stateIndex: Map<string, Record<string, unknown>> | null;
}

/**
 * A single match from a pattern detection function.
 */
export interface PatternMatch {
  /** Resources involved in this match */
  affectedResources: string[];

  /** The specific relationship that triggered the match */
  relationship: CrossActionRelationship;

  /** Additional context for the explanation */
  context?: Record<string, unknown>;
}

/**
 * A cross-action pattern definition.
 *
 * Patterns are self-describing and registered in a catalog.
 * Each pattern declares what it detects, when it fires, and
 * how confident it needs to be to fire.
 */
export interface CrossActionPattern {
  /** Unique identifier for telemetry and reporting */
  id: string;

  /** Human-readable name */
  name: string;

  /**
   * Predicate that examines the plan and returns matched resource groups.
   * Returns empty array if pattern doesn't match.
   *
   * Multiple-match behavior: If a single plan has multiple matches at
   * different confidence levels, the function should return ALL matches
   * that meet the minimumConfidence threshold. The caller will include
   * all matches in the output array.
   */
  detect(context: CrossActionContext): PatternMatch[];

  /** Tier to upgrade the plan-level summary to when pattern matches */
  upgradeTier: RecoverabilityTier;

  /**
   * Minimum confidence level required to fire this pattern.
   *
   * Matches below this confidence are not returned by detect().
   * For example, backup_and_protected_both_deleted requires 'probable'
   * because naming-convention matches are too speculative for UNRECOVERABLE.
   */
  minimumConfidence: RelationshipConfidence;

  /** Template for explanation (interpolated with match details) */
  explanationTemplate: string;
}

// -----------------------------------------------------------------------------
// Output Types (for ConsequenceReport)
// -----------------------------------------------------------------------------

/**
 * A cross-action risk detected in a plan.
 * Included in ConsequenceReport.crossActionRisks array.
 */
export interface CrossActionRisk {
  /** Pattern identifier */
  pattern: string;

  /** Human-readable pattern name */
  patternName: string;

  /** Resources involved */
  affectedResources: string[];

  /** The relationship that triggered the match */
  relationship: CrossActionRelationship;

  /** Human-readable explanation */
  explanation: string;

  /** What the tier was upgraded to */
  upgradedTier: RecoverabilityTier;

  /** Scope limitations, if any */
  scopeWarning?: string;
}

// -----------------------------------------------------------------------------
// Handler Relationship Declarations
// -----------------------------------------------------------------------------

/**
 * Relationship detection function signature.
 *
 * Handlers implement this to declare how their resource types
 * relate to other resources (backup, replica, etc.).
 *
 * @param resource - The resource to check (e.g., a snapshot)
 * @param candidates - All deletions of target types in the plan
 * @param stateIndex - Pre-indexed state for O(1) lookups
 * @returns Match info if relationship found, null otherwise
 */
export type DetectRelationshipFn = (
  resource: ResourceChange,
  candidates: ResourceChange[],
  stateIndex: Map<string, Record<string, unknown>> | null
) => RelationshipMatch | null;

/**
 * Relationship declaration for a handler.
 * Added to ResourceHandler interface.
 */
export interface HandlerRelationships {
  /** This resource can be a backup of another resource */
  canBeBackupOf?: {
    targetTypes: string[];  // e.g., ['aws_db_instance']
    detectRelationship: DetectRelationshipFn;
  };

  /** This resource can be a replica of another resource */
  canBeReplicaOf?: {
    targetTypes: string[];
    detectRelationship: DetectRelationshipFn;
  };
}

// -----------------------------------------------------------------------------
// Analysis Functions
// -----------------------------------------------------------------------------

/**
 * Builds a pre-indexed state map for O(1) resource lookups.
 *
 * Called once at the start of analysis. Handlers use this
 * for state-based relationship detection without O(N) scans.
 */
export function buildStateIndex(
  state: TerraformState | null
): Map<string, Record<string, unknown>> | null {
  if (!state) return null;

  const index = new Map<string, Record<string, unknown>>();
  for (const resource of state.resources) {
    index.set(resource.address, resource.values);
  }
  return index;
}

/**
 * Checks if a confidence level meets a minimum threshold.
 */
export function meetsConfidenceThreshold(
  actual: RelationshipConfidence,
  minimum: RelationshipConfidence
): boolean {
  const levels: RelationshipConfidence[] = ['definite', 'probable', 'possible'];
  const actualIndex = levels.indexOf(actual);
  const minimumIndex = levels.indexOf(minimum);
  // Lower index = higher confidence
  return actualIndex <= minimumIndex;
}

/**
 * Builds CrossActionContext from analysis inputs.
 */
export function buildCrossActionContext(
  changes: ResourceChange[],
  dependencies: DependencyGraph | null,
  verdicts: Map<string, RecoverabilityResult>,
  state: TerraformState | null
): CrossActionContext {
  return {
    changes,
    dependencies,
    verdicts,
    state,
    stateIndex: buildStateIndex(state),
  };
}

/**
 * Runs all patterns against the context and returns matches.
 *
 * This is the main entry point for cross-action analysis.
 * Called by blast-radius.ts after individual evaluations.
 */
export function detectCrossActionRisks(
  context: CrossActionContext,
  patterns: CrossActionPattern[]
): CrossActionRisk[] {
  const risks: CrossActionRisk[] = [];

  for (const pattern of patterns) {
    const matches = pattern.detect(context);

    for (const match of matches) {
      // Verify match meets minimum confidence (defense in depth)
      if (!meetsConfidenceThreshold(match.relationship.confidence, pattern.minimumConfidence)) {
        continue;
      }

      risks.push({
        pattern: pattern.id,
        patternName: pattern.name,
        affectedResources: match.affectedResources,
        relationship: match.relationship,
        explanation: interpolateExplanation(pattern.explanationTemplate, match),
        upgradedTier: pattern.upgradeTier,
        scopeWarning: buildScopeWarning(match, context),
      });
    }
  }

  return risks;
}

/**
 * Interpolates a pattern explanation template with match details.
 */
function interpolateExplanation(template: string, match: PatternMatch): string {
  return template
    .replace('{source}', match.relationship.source)
    .replace('{target}', match.relationship.target)
    .replace('{type}', match.relationship.type)
    .replace('{confidence}', match.relationship.confidence);
}

/**
 * Builds scope warning based on match and context.
 */
function buildScopeWarning(
  match: PatternMatch,
  context: CrossActionContext
): string | undefined {
  const warnings: string[] = [];

  // Always warn about plan scope
  warnings.push('Analysis limited to resources in this plan.');

  // Warn if no state was provided
  if (!context.state) {
    warnings.push('No Terraform state provided; relationship detection limited to plan references.');
  }

  // Warn about cross-account/region limitations
  if (match.relationship.type === 'backup') {
    warnings.push('Cross-account or externally-managed backups not evaluated.');
  }

  // Warn about naming convention detection
  if (match.relationship.detectionMethod === 'naming_convention') {
    warnings.push('Relationship inferred from naming convention; may be coincidental.');
  }

  return warnings.join(' ');
}

/**
 * Computes the worst tier from cross-action risks.
 * Returns null if no risks detected.
 */
export function getWorstCrossActionTier(
  risks: CrossActionRisk[]
): RecoverabilityTier | null {
  if (risks.length === 0) return null;

  let worst = RecoverabilityTier.REVERSIBLE;
  for (const risk of risks) {
    if (risk.upgradedTier > worst) {
      worst = risk.upgradedTier;
    }
  }
  return worst;
}
