# Cross-Action Analysis Design

**Status:** Implemented (v0.1.36)
**Author:** Claude
**Date:** May 2026

---

## Problem Statement

RecourseOS evaluates each resource change individually. This misses dangerous patterns where:
- Each action is safe in isolation
- The combination is unrecoverable

Example: Deleting an RDS snapshot returns `RECOVERABLE_WITH_EFFORT` (you can recreate it). Deleting the RDS instance with backups enabled returns `RECOVERABLE_FROM_BACKUP`. But if both are in the same plan, and the snapshot *was* the backup, the sequence is `UNRECOVERABLE`.

The engine needs cross-action awareness to catch these patterns.

---

## Architectural Placement

### Module: `src/analyzer/cross-action.ts`

**Why "cross-action" not "sequence-risk":**
- "Sequence risk" is one pattern type; cross-action analysis is the general concept
- Future patterns (cycle detection, ordering issues, partial-failure recovery) fit under the same umbrella
- Leaves room for extension without restructuring

**Where it sits:**
```
src/analyzer/
├── blast-radius.ts      # Orchestrates analysis, calls cross-action
├── dependencies.ts      # Resource dependency graph
├── cross-action.ts      # NEW: Cross-action pattern detection
└── recoverability.ts    # Per-resource tier classification
```

**Data flow:**
```
blast-radius.ts
  → evaluates each resource individually (existing)
  → builds dependency graph (existing)
  → calls cross-action analyzer with:
      - all resource changes
      - dependency graph
      - individual recoverability verdicts
  → cross-action analyzer returns matched patterns
  → blast-radius merges patterns into consequence report
```

---

## Pattern Catalog Design

Each pattern is self-describing, similar to how handlers declare `evidenceRequirements`.

### Pattern Interface

```typescript
interface CrossActionPattern {
  /** Unique identifier for telemetry and reporting */
  id: string;

  /** Human-readable name */
  name: string;

  /**
   * Predicate that examines the plan and returns matched resource groups.
   * Returns empty array if pattern doesn't match.
   */
  detect(context: CrossActionContext): PatternMatch[];

  /** Tier to upgrade to when pattern matches */
  upgradeTier: RecoverabilityTier;

  /** Minimum confidence level required to fire this pattern */
  minimumConfidence: RelationshipConfidence;

  /** Template for explanation (interpolated with match details) */
  explanationTemplate: string;
}

interface CrossActionContext {
  /** All resource changes in the plan */
  changes: ResourceChange[];

  /** Dependency graph between resources */
  dependencies: DependencyGraph;

  /** Individual recoverability verdicts (before cross-action analysis) */
  verdicts: Map<string, RecoverabilityResult>;

  /** Terraform state (if available) */
  state: TerraformState | null;
}

interface PatternMatch {
  /** Resources involved in this match */
  affectedResources: string[];

  /** The specific relationship that triggered the match */
  relationship: RelationshipMatch;

  /** Additional context for the explanation */
  context?: Record<string, unknown>;
}

/** Confidence levels for relationship detection */
type RelationshipConfidence = 'definite' | 'probable' | 'possible';

interface RelationshipMatch {
  type: 'backup' | 'replica' | 'protection' | 'dependency';
  source: string;  // e.g., the snapshot
  target: string;  // e.g., the database it backs up
  detectionMethod: 'explicit_reference' | 'state_lookup' | 'naming_convention';
  confidence: RelationshipConfidence;
}
```

**Confidence semantics:**
- `definite`: Structural proof (explicit attribute reference, e.g., snapshot's `db_instance_identifier`)
- `probable`: Strong inference from state (e.g., state lookup shows relationship)
- `possible`: Heuristic match (e.g., naming convention suggests relationship)

Patterns declare their `minimumConfidence`. The `backup_and_protected_both_deleted` pattern fires on `definite` and `probable` matches but not on `possible` matches alone — naming heuristics are too speculative for an UNRECOVERABLE verdict.

### Pattern Registry

```typescript
// src/analyzer/cross-action-patterns.ts

export const crossActionPatterns: CrossActionPattern[] = [
  backupAndProtectedDeleted,
  replicaAndPrimaryDeleted,
  protectionDisabledThenDeleted,
  // Future: cycleDetection, orderingIssues, etc.
];
```

Adding a new pattern = adding one entry to the array.

---

## Initial Pattern Catalog

### Pattern 1: Backup and Protected Resource Both Deleted

**ID:** `backup_and_protected_both_deleted`

**Minimum Confidence:** `probable`

**Detects:** A backup/snapshot is deleted in the same plan as the resource it backs up.

**Examples:**

| Scenario | Resources | Expected |
|----------|-----------|----------|
| **Dangerous** | Delete `aws_db_snapshot.final` + Delete `aws_db_instance.prod` where snapshot references instance | Match, upgrade to UNRECOVERABLE |
| **Benign** | Delete `aws_db_snapshot.old` + Modify `aws_db_instance.prod` | No match (instance not deleted) |
| **Edge case** | Delete `aws_db_snapshot.final` + Delete `aws_db_instance.prod` but instance has `skip_final_snapshot=false` | Match, but note new snapshot will be created |

**Relationship detection:**
- `definite`: Snapshot's `db_instance_identifier` matches instance's `identifier`
- `probable`: State lookup finds snapshot that references the instance being deleted
- `possible`: Snapshot name contains instance identifier (weak signal, does not fire pattern)

**Scope limitation:** Can only detect relationships visible in the plan or state. Cross-account/cross-region snapshots managed outside Terraform are not visible.

### Pattern 2: Replica and Primary Both Deleted

**ID:** `replica_and_primary_both_deleted`

**Minimum Confidence:** `probable`

**Detects:** A replica is deleted in the same plan as its primary.

**Examples:**

| Scenario | Resources | Expected |
|----------|-----------|----------|
| **Dangerous** | Delete `aws_db_instance.replica` + Delete `aws_db_instance.primary` where replica's `replicate_source_db` = primary | Match, upgrade to UNRECOVERABLE |
| **Benign** | Delete `aws_db_instance.replica` only | No match (primary survives) |
| **Edge case** | Delete `aws_db_instance.primary` + replica is in different Terraform state | No match (can't see cross-state), but emit warning about scope |

**Relationship detection:**
- `definite`: Replica's `replicate_source_db` or `replication_source` attribute
- `definite`: RDS `read_replica_source_db_instance_identifier`
- `probable`: Aurora cluster membership (state lookup)

### Pattern 3: Protection Disabled Then Resource Deleted

**ID:** `protection_disabled_then_deleted`

**Minimum Confidence:** `definite`

**Detects:** Deletion protection is removed AND the resource is deleted in the same plan.

**Scope:** Same-resource only. This pattern only fires when a single resource has both its protection disabled and is deleted in the same plan. Cross-resource protection changes (disabling protection on resource A while deleting resource B) are explicitly out of scope for v1.

**Examples:**

| Scenario | Resources | Expected |
|----------|-----------|----------|
| **Dangerous** | Update `aws_db_instance.prod` (deletion_protection: true→false) + Delete `aws_db_instance.prod` | Match, upgrade to UNRECOVERABLE |
| **Benign** | Update `aws_db_instance.prod` (deletion_protection: true→false) only | No match (resource not deleted) |
| **Edge case** | Delete `aws_db_instance.prod` where deletion_protection was already false | No match (protection wasn't changed in this plan) |

**Ordering guarantee:**
For same-resource modifications, Terraform guarantees the update happens before the delete. The dependency is implicit: you cannot delete a resource while simultaneously updating it. This pattern relies on that guarantee.

Cross-resource ordering (disabling protection on resource A, then deleting dependent resource B) is determined by the dependency graph, which may not match operator expectations. This is why cross-resource protection changes are out of scope for v1 — the ordering semantics are more complex.

**False positive risk:** Very low for same-resource case due to structural guarantee.

---

## Consequence Report Schema

### New Top-Level Field: `crossActionRisks`

```typescript
interface ConsequenceReport {
  // ... existing fields ...

  /**
   * Cross-action risks detected in the plan.
   * Empty array if no patterns matched.
   * Always present (explicit "we checked").
   */
  crossActionRisks: CrossActionRisk[];
}

interface CrossActionRisk {
  /** Pattern identifier */
  pattern: string;

  /** Human-readable pattern name */
  patternName: string;

  /** Resources involved */
  affectedResources: string[];

  /** The relationship that triggered the match */
  relationship: {
    type: 'backup' | 'replica' | 'protection' | 'dependency';
    source: string;
    target: string;
    detectionMethod: 'explicit_reference' | 'state_lookup' | 'naming_convention';
    confidence: 'definite' | 'probable' | 'possible';
  };

  /** Human-readable explanation */
  explanation: string;

  /** What the tier was upgraded to */
  upgradedTier: RecoverabilityTier;

  /** Scope limitations, if any */
  scopeWarning?: string;
}
```

### Example Output

```json
{
  "version": "0.1.0",
  "riskAssessment": "block",
  "mutations": [
    {
      "intent": { "action": "delete", "target": { "id": "aws_db_instance.production" } },
      "recoverability": {
        "tier": 3,
        "label": "recoverable-from-backup",
        "reasoning": "RDS automated backups retained for 7 days"
      }
    },
    {
      "intent": { "action": "delete", "target": { "id": "aws_db_snapshot.production_final" } },
      "recoverability": {
        "tier": 2,
        "label": "recoverable-with-effort",
        "reasoning": "Manual snapshot can be recreated if source data exists"
      }
    }
  ],
  "crossActionRisks": [
    {
      "pattern": "backup_and_protected_both_deleted",
      "patternName": "Backup and protected resource both deleted",
      "affectedResources": [
        "aws_db_instance.production",
        "aws_db_snapshot.production_final"
      ],
      "relationship": {
        "type": "backup",
        "source": "aws_db_snapshot.production_final",
        "target": "aws_db_instance.production",
        "detectionMethod": "explicit_reference",
        "confidence": "definite"
      },
      "explanation": "The snapshot 'production_final' is being deleted in the same plan as the database it backs up. Recovery from this snapshot would not be possible after this plan applies.",
      "upgradedTier": 4,
      "scopeWarning": "Analysis limited to resources in this plan. Cross-account or externally-managed backups not evaluated."
    }
  ],
  "summary": {
    "worstRecoverability": {
      "tier": 4,
      "label": "unrecoverable",
      "reasoning": "Cross-action analysis: backup and protected resource both deleted"
    }
  }
}
```

---

## Tier Upgrade Semantics

**Per-resource verdicts:** Unchanged. The snapshot deletion is still `RECOVERABLE_WITH_EFFORT` on its own. The instance deletion is still `RECOVERABLE_FROM_BACKUP` on its own. These are accurate statements about each individual change.

**Plan-level summary:** Upgraded. The `summary.worstRecoverability` reflects the cross-action risk. The `riskAssessment` ("allow", "warn", "escalate", "block") is computed from the upgraded tier.

**Rationale:** Consumers that only care about individual resources get accurate per-resource data. Consumers that care about the plan as a whole see the elevated risk in the summary. Both are correct; they answer different questions.

---

## Dependency Graph Requirements

The cross-action analyzer needs to walk relationships between resources. This requires:

### Existing: `dependencies.ts`
Currently builds implicit dependencies by scanning for ID references. This catches some cases but misses semantic relationships.

### Needed: Semantic relationship detection
For each resource type that has backup/replica relationships, the handler should declare:

```typescript
interface ResourceHandler {
  // ... existing ...

  /**
   * Declares semantic relationships this resource type can have.
   * Used by cross-action analyzer to detect dangerous patterns.
   */
  relationships?: {
    /** This resource can be a backup of another resource */
    canBeBackupOf?: {
      targetTypes: string[];  // e.g., ['aws_db_instance']
      detectRelationship: (
        backup: ResourceChange,
        candidates: ResourceChange[],
        state: TerraformState | null
      ) => RelationshipMatch | null;
    };

    /** This resource can be a replica of another resource */
    canBeReplicaOf?: {
      targetTypes: string[];
      detectRelationship: (
        replica: ResourceChange,
        candidates: ResourceChange[],
        state: TerraformState | null
      ) => RelationshipMatch | null;
    };
  };
}

interface RelationshipMatch {
  targetId: string;
  detectionMethod: 'explicit_reference' | 'state_lookup' | 'naming_convention';
  confidence: 'definite' | 'probable' | 'possible';
}
```

The refined `detectRelationship` signature returns a structured match with detection method and confidence as first-class data. This flows through to the consequence report, allowing consumers to distinguish "we're certain" from "we're guessing."

This is handler-level knowledge. The RDS handler knows that `aws_db_snapshot` can be a backup of `aws_db_instance` and how to detect that relationship. The cross-action analyzer is generic; it queries handlers for relationship information.

---

## Scope Limitations

**Explicit in every match:**

1. **Plan scope only:** Can only analyze resources in the current plan. Cross-state, cross-account, or externally-managed resources are invisible.

2. **Terraform state scope:** Relationship detection relies on Terraform state when available. If state is not provided, detection is limited to explicit references in the plan.

3. **Confidence levels:** Naming-convention-based detection produces `possible` confidence. Patterns can choose not to fire on low-confidence matches. The confidence level is always visible in the output.

Every `CrossActionRisk` in the output includes a `scopeWarning` when relevant. Consumers know what the engine couldn't see.

---

## Performance Considerations

Cross-action analysis adds compute time to every plan evaluation.

**Algorithmic shape:**
- Pattern 1 (backup + protected): O(N) pass through deletions, lookup against handler relationship declarations
- Pattern 2 (replica + primary): O(N) pass through deletions, lookup against handler relationship declarations
- Pattern 3 (protection disabled + deleted): O(N) pass through changes, same-resource check

All three patterns are O(N) where N is the number of resource changes. No pattern requires O(N²) comparisons across all resources.

**Implementation note:** The relationship detection delegates to handlers, which may perform state lookups. State lookups are O(1) hash lookups against the parsed state. The overall complexity remains O(N × M) where M is the number of relationship types declared by handlers — effectively O(N) for practical handler counts.

**Large plan performance:** For plans with hundreds of resources, cross-action analysis adds negligible overhead compared to per-resource evaluation (which is already O(N)). No special optimization needed for v1.

---

## Implementation Order

1. **Define types** (`src/analyzer/cross-action.ts`): Pattern interface, context interface, relationship match interface, risk output interface.

2. **Write test fixtures**: Create plan fixtures for each pattern's dangerous/benign/edge cases. Tests should fail because patterns aren't implemented yet. This is test-driven development — the fixtures define expected behavior before code exists.

3. **Add `crossActionRisks` field** to ConsequenceReport schema.

4. **Implement pattern 1** (backup + protected): Start with AWS RDS since it has clear snapshot→instance relationships.

5. **Wire into blast-radius.ts**: Call cross-action analyzer after individual evaluations, merge results.

6. **Add relationship declarations** to RDS handler.

7. **Implement patterns 2 and 3**.

8. **Extend to other resource types** (prioritized by harm potential):
   - **v1.0:** RDS snapshots, RDS replicas, RDS deletion protection
   - **v1.1:** Aurora cluster + replicas (high cascade risk)
   - **v1.2:** EBS snapshots + EC2 instances
   - **v1.3:** DynamoDB PITR + table deletions
   - **v2+:** KMS key dependencies, IAM role-policy relationships

---

## Design Decisions

### Decision 1: Cross-action risks affect attestation

**Answer: Yes.**

The attestation's job is to be a cryptographically signed record of what the engine determined. If the engine determined that a plan has a cross-action risk that upgrades the verdict to unrecoverable, the attestation must reflect that.

The signed payload includes:
- The upgraded `riskAssessment` (already accounts for cross-action risks via summary upgrade)
- The `crossActionRisks` array itself

A verifier reading the attestation later sees the full reasoning chain. An attestation that omits cross-action analysis would be misleading.

The attestation protocol design doc should be updated to reflect this schema addition when cross-action analysis ships.

### Decision 2: No disable flag

**Answer: No disable flag.**

The architectural commitment is that the engine emits structured facts. Cross-action analysis surfaces a fact about the plan ("these resources together form a dangerous combination"). A disable flag would let consumers turn off truth-telling.

Consumers who don't want cross-action information can ignore the `crossActionRisks` field. They still get accurate per-resource verdicts. The cost of including cross-action analysis is minimal (additional structured data); the cost of letting consumers disable it is real (they might disable without understanding what they lose).

**Architectural principle:** Cross-action analysis runs unconditionally. The field is always populated (empty array when nothing matches). Consumers choose what to do with the data.

### Decision 3: Confidence levels from day one

**Answer: Build confidence into v1.**

Naming-convention matches ("snapshot `prod-final-2026` is probably the backup of database `prod-final`") are fundamentally different from explicit-reference matches ("snapshot's `db_instance_identifier` is `prod-final`"). Treating them the same means consumers can't distinguish certainty from guessing.

Every `RelationshipMatch` includes:
- `detectionMethod`: How the relationship was discovered
- `confidence`: How certain the engine is (`definite`, `probable`, `possible`)

Patterns declare `minimumConfidence` — the `backup_and_protected_both_deleted` pattern requires `probable` or higher. This prevents over-eager firing on weak heuristics.

Consumers see confidence in the output and can make their own decisions. A bank making compliance decisions can require `definite`-level matches; a more permissive consumer might accept `probable` for warnings.

This also handles the future failure mode: when the engine flags a cross-action risk based on naming convention and the operator says "those aren't related, similar names are coincidence," the engine isn't producing false positives at the protocol level — it's producing matches at varying confidence, and the pattern's `minimumConfidence` determines whether to fire.

---

## Next Steps

1. ✅ Design doc reviewed and refined
2. Write test fixtures for each pattern (dangerous, benign, edge case)
3. Implement types
4. Implement patterns
5. Update attestation protocol doc to reflect schema addition
