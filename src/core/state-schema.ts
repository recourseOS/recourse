/**
 * Unknown-State Schema
 *
 * Formalizes how RecourseOS handles incomplete, stale, or missing state
 * when classifying mutation consequences.
 *
 * Key concepts:
 * - StateCompleteness: How much required evidence is present
 * - EvidenceFreshness: Whether evidence is current enough to trust
 * - EvidenceRequirement: What evidence is needed per resource type
 * - StateAssessment: Combined evaluation of state quality
 */

import type { EvidenceItem, MissingEvidence } from './mutation.js';

// ─────────────────────────────────────────────────────────────────────────────
// State Completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State completeness levels determine how confident we can be in classification.
 *
 * complete:    All required evidence present; high-confidence verdict possible
 * partial:     Some required evidence missing; conservative verdict with lower confidence
 * minimal:     Only basic evidence present; NEEDS_REVIEW likely
 * none:        No state available; must use defaults or refuse classification
 */
export type StateCompletenessLevel = 'complete' | 'partial' | 'minimal' | 'none';

export interface StateCompleteness {
  level: StateCompletenessLevel;
  /** Percentage of required evidence present (0-100) */
  percentage: number;
  /** Evidence keys that are present */
  presentKeys: string[];
  /** Evidence keys that are required but missing */
  missingKeys: string[];
  /** Evidence keys that are optional and missing (informational) */
  optionalMissingKeys: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Freshness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Freshness levels indicate whether evidence can be trusted.
 *
 * fresh:    Gathered within acceptable window; safe to use
 * aging:    Approaching staleness; acceptable but note in reasoning
 * stale:    Outside acceptable window; treat as missing
 * unknown:  No timestamp available; treat as potentially stale
 */
export type EvidenceFreshnessLevel = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface EvidenceFreshness {
  level: EvidenceFreshnessLevel;
  /** When the evidence was gathered (ISO 8601) */
  gatheredAt?: string;
  /** Maximum acceptable age in seconds */
  maxAgeSeconds: number;
  /** Current age in seconds (if known) */
  ageSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Requirements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requirement levels determine how missing evidence affects classification.
 *
 * required:     Must be present for any verdict above NEEDS_REVIEW
 * recommended:  Should be present; lowers confidence if missing
 * optional:     Nice to have; no confidence penalty if missing
 */
export type EvidenceRequirementLevel = 'required' | 'recommended' | 'optional';

export interface EvidenceRequirement {
  key: string;
  level: EvidenceRequirementLevel;
  description: string;
  /** If true, absence of this evidence blocks any safe (tier < 4) verdict */
  blocksSafeVerdict: boolean;
  /** Default value to assume if evidence is missing (conservative default) */
  defaultAssumption?: unknown;
  /** Freshness requirement in seconds (default: 3600 = 1 hour) */
  maxFreshnessSeconds?: number;
}

export interface ResourceEvidenceRequirements {
  resourceType: string;
  /** Action this requirement set applies to (usually 'delete') */
  action: 'create' | 'update' | 'delete' | 'any';
  requirements: EvidenceRequirement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Source Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where evidence originated from.
 *
 * terraform_state:  From Terraform state file (prior_state or .tfstate)
 * terraform_plan:   From Terraform plan (before/after values)
 * live_api:         From live API call to cloud provider
 * agent_provided:   Agent submitted via verification protocol
 * cached:           From RecourseOS evidence cache
 * default:          Assumed default (no actual evidence)
 */
export type EvidenceSource =
  | 'terraform_state'
  | 'terraform_plan'
  | 'live_api'
  | 'agent_provided'
  | 'cached'
  | 'default';

export interface TrackedEvidence extends EvidenceItem {
  source: EvidenceSource;
  gatheredAt?: string;
  freshnessLevel?: EvidenceFreshnessLevel;
}

// ─────────────────────────────────────────────────────────────────────────────
// State Assessment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combined assessment of state quality for a mutation.
 */
export interface StateAssessment {
  completeness: StateCompleteness;
  freshness: EvidenceFreshness;
  /** Whether any conflicts exist between evidence sources */
  hasConflicts: boolean;
  conflicts?: EvidenceConflict[];
  /** Overall state quality score (0-1) */
  qualityScore: number;
  /** Whether state is sufficient for confident classification */
  sufficientForClassification: boolean;
  /** Evidence sufficiency assessment - a fact about evidence state */
  sufficiency: EvidenceSufficiency;
}

export interface EvidenceConflict {
  key: string;
  sources: Array<{
    source: EvidenceSource;
    value: unknown;
    gatheredAt?: string;
  }>;
  resolution: 'use_freshest' | 'use_most_conservative' | 'requires_review';
}

/**
 * Evidence sufficiency assessment - a fact about evidence state, not a directive.
 * Callers interpret this in their own context to decide what action to take.
 */
export type EvidenceSufficiency =
  | 'sufficient'           // All required evidence present; engine is confident
  | 'partial'              // Some evidence present; recommended evidence missing
  | 'insufficient'         // Required evidence missing; classification uncertain
  | 'blocking_gaps';       // Evidence gaps that prevent confident assessment

/** @deprecated Use EvidenceSufficiency instead */
export type StateRecommendation = EvidenceSufficiency;

// ─────────────────────────────────────────────────────────────────────────────
// Assessment Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assess state completeness against requirements.
 */
export function assessCompleteness(
  evidence: EvidenceItem[],
  requirements: EvidenceRequirement[]
): StateCompleteness {
  const presentKeys = evidence.filter(e => e.present).map(e => e.key);
  const presentSet = new Set(presentKeys);

  const required = requirements.filter(r => r.level === 'required');
  const recommended = requirements.filter(r => r.level === 'recommended');
  const optional = requirements.filter(r => r.level === 'optional');

  const missingRequired = required.filter(r => !presentSet.has(r.key)).map(r => r.key);
  const missingRecommended = recommended.filter(r => !presentSet.has(r.key)).map(r => r.key);
  const missingOptional = optional.filter(r => !presentSet.has(r.key)).map(r => r.key);

  // Calculate percentage based on required + recommended
  const totalTracked = required.length + recommended.length;
  const presentTracked = totalTracked - missingRequired.length - missingRecommended.length;
  const percentage = totalTracked > 0 ? Math.round((presentTracked / totalTracked) * 100) : 100;

  let level: StateCompletenessLevel;
  if (missingRequired.length === 0 && missingRecommended.length === 0) {
    level = 'complete';
  } else if (missingRequired.length === 0) {
    level = 'partial';
  } else if (presentKeys.length > 0) {
    level = 'minimal';
  } else {
    level = 'none';
  }

  return {
    level,
    percentage,
    presentKeys,
    missingKeys: [...missingRequired, ...missingRecommended],
    optionalMissingKeys: missingOptional,
  };
}

/**
 * Assess evidence freshness.
 */
export function assessFreshness(
  gatheredAt: string | undefined,
  maxAgeSeconds: number = 3600
): EvidenceFreshness {
  if (!gatheredAt) {
    return {
      level: 'unknown',
      maxAgeSeconds,
    };
  }

  const gathered = new Date(gatheredAt).getTime();
  const now = Date.now();
  const ageSeconds = Math.floor((now - gathered) / 1000);

  let level: EvidenceFreshnessLevel;
  if (ageSeconds < maxAgeSeconds * 0.5) {
    level = 'fresh';
  } else if (ageSeconds < maxAgeSeconds) {
    level = 'aging';
  } else {
    level = 'stale';
  }

  return {
    level,
    gatheredAt,
    maxAgeSeconds,
    ageSeconds,
  };
}

/**
 * Full state assessment combining completeness, freshness, and conflicts.
 */
export function assessState(
  evidence: TrackedEvidence[],
  requirements: EvidenceRequirement[],
  maxFreshnessSeconds: number = 3600
): StateAssessment {
  // Find the oldest evidence timestamp
  const timestamps = evidence
    .filter(e => e.gatheredAt)
    .map(e => new Date(e.gatheredAt!).getTime());
  const oldestTimestamp = timestamps.length > 0
    ? new Date(Math.min(...timestamps)).toISOString()
    : undefined;

  const completeness = assessCompleteness(evidence, requirements);
  const freshness = assessFreshness(oldestTimestamp, maxFreshnessSeconds);

  // Detect conflicts (same key from different sources with different values)
  const byKey = new Map<string, TrackedEvidence[]>();
  for (const e of evidence) {
    const existing = byKey.get(e.key) || [];
    existing.push(e);
    byKey.set(e.key, existing);
  }

  const conflicts: EvidenceConflict[] = [];
  for (const [key, items] of byKey) {
    if (items.length > 1) {
      const values = items.map(i => JSON.stringify(i.value));
      const uniqueValues = new Set(values);
      if (uniqueValues.size > 1) {
        conflicts.push({
          key,
          sources: items.map(i => ({
            source: i.source,
            value: i.value,
            gatheredAt: i.gatheredAt,
          })),
          resolution: 'use_most_conservative',
        });
      }
    }
  }

  // Calculate quality score
  let qualityScore = completeness.percentage / 100;
  if (freshness.level === 'aging') qualityScore *= 0.9;
  if (freshness.level === 'stale') qualityScore *= 0.5;
  if (freshness.level === 'unknown') qualityScore *= 0.7;
  if (conflicts.length > 0) qualityScore *= 0.8;

  // Determine if sufficient for classification
  const hasBlockingMissing = requirements
    .filter(r => r.blocksSafeVerdict)
    .some(r => !evidence.find(e => e.key === r.key && e.present));
  const sufficientForClassification =
    completeness.level !== 'none' &&
    freshness.level !== 'stale' &&
    !hasBlockingMissing;

  // Determine evidence sufficiency (a fact, not a directive)
  let sufficiency: EvidenceSufficiency;
  if (completeness.level === 'complete' && freshness.level === 'fresh' && conflicts.length === 0) {
    sufficiency = 'sufficient';
  } else if (hasBlockingMissing) {
    sufficiency = 'blocking_gaps';
  } else if (completeness.level === 'minimal' || freshness.level === 'stale') {
    sufficiency = 'insufficient';
  } else {
    sufficiency = 'partial';
  }

  return {
    completeness,
    freshness,
    hasConflicts: conflicts.length > 0,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    qualityScore: Math.round(qualityScore * 100) / 100,
    sufficientForClassification,
    sufficiency,
  };
}

/**
 * Convert assessment to MissingEvidence array for ConsequenceReport.
 */
export function assessmentToMissingEvidence(
  assessment: StateAssessment,
  requirements: EvidenceRequirement[]
): MissingEvidence[] {
  const result: MissingEvidence[] = [];

  for (const key of assessment.completeness.missingKeys) {
    const req = requirements.find(r => r.key === key);
    if (!req) continue;

    let effect: MissingEvidence['effect'];
    if (req.blocksSafeVerdict) {
      effect = 'blocks-safe-verdict';
    } else if (req.level === 'required') {
      effect = 'requires-review';
    } else {
      effect = 'lowers-confidence';
    }

    result.push({
      key,
      description: req.description,
      effect,
    });
  }

  if (assessment.freshness.level === 'stale') {
    result.push({
      key: 'evidence_freshness',
      description: `Evidence is ${assessment.freshness.ageSeconds} seconds old (max: ${assessment.freshness.maxAgeSeconds})`,
      effect: 'requires-review',
    });
  }

  if (assessment.hasConflicts) {
    for (const conflict of assessment.conflicts || []) {
      result.push({
        key: `conflict_${conflict.key}`,
        description: `Conflicting values for ${conflict.key} from different sources`,
        effect: 'requires-review',
      });
    }
  }

  return result;
}

/**
 * Calculate confidence modifier based on state assessment.
 * Returns a multiplier (0-1) to apply to base confidence.
 */
export function confidenceModifier(assessment: StateAssessment): number {
  let modifier = 1.0;

  // Completeness impact
  switch (assessment.completeness.level) {
    case 'complete': modifier *= 1.0; break;
    case 'partial': modifier *= 0.8; break;
    case 'minimal': modifier *= 0.5; break;
    case 'none': modifier *= 0.2; break;
  }

  // Freshness impact
  switch (assessment.freshness.level) {
    case 'fresh': modifier *= 1.0; break;
    case 'aging': modifier *= 0.9; break;
    case 'stale': modifier *= 0.5; break;
    case 'unknown': modifier *= 0.7; break;
  }

  // Conflict impact
  if (assessment.hasConflicts) {
    modifier *= 0.8;
  }

  return Math.round(modifier * 100) / 100;
}

// Import for buildRequiredEvidence
import type { EvidenceRequirementStatus, RequiredEvidence } from './consequence.js';

/**
 * Build RequiredEvidence object for a ConsequenceReport.
 *
 * This is the interface between the state schema and the consequence report.
 * It tells agents exactly what evidence is needed and what's present.
 */
export function buildRequiredEvidence(
  resourceType: string,
  action: 'create' | 'update' | 'delete',
  evidence: EvidenceItem[],
  requirements: EvidenceRequirement[]
): RequiredEvidence {
  const presentSet = new Set(evidence.filter(e => e.present).map(e => e.key));
  const evidenceMap = new Map(evidence.map(e => [e.key, e.value]));

  const requirementStatuses: EvidenceRequirementStatus[] = requirements.map(req => ({
    key: req.key,
    description: req.description,
    level: req.level,
    present: presentSet.has(req.key),
    value: evidenceMap.get(req.key),
    blocksConfidentVerdict: req.blocksSafeVerdict,
  }));

  const required = requirements.filter(r => r.level === 'required');
  const missingRequired = required.filter(r => !presentSet.has(r.key));
  const missingBlocking = requirements.filter(r => r.blocksSafeVerdict && !presentSet.has(r.key));

  const sufficient = missingBlocking.length === 0;

  // Determine evidence sufficiency (a fact, not a directive)
  let sufficiency: EvidenceSufficiency;
  if (missingBlocking.length > 0) {
    sufficiency = 'blocking_gaps';
  } else if (missingRequired.length > 0) {
    sufficiency = 'insufficient';
  } else if (requirements.filter(r => r.level === 'recommended').some(r => !presentSet.has(r.key))) {
    sufficiency = 'partial';
  } else {
    sufficiency = 'sufficient';
  }

  return {
    resourceType,
    action,
    requirementsDefined: requirements.length > 0,
    requirements: requirementStatuses,
    summary: {
      total: requirements.length,
      satisfied: requirements.filter(r => presentSet.has(r.key)).length,
      missingRequired: missingRequired.length,
      missingBlocking: missingBlocking.length,
    },
    sufficient,
    sufficiency,
  };
}
