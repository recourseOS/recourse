# Depth Advantage Strategy

RecourseOS competes on **consequence depth**, not gateway breadth. While competitors like hoop.dev offer shallow pattern matching ("block `rm -rf`"), RecourseOS explains *why* an action is dangerous, *what* the blast radius is, and provides *cryptographic proof* of the evaluation.

---

## Implementation Status

| Focus Area | Status | Commit |
|------------|--------|--------|
| Attestation Richness | ✅ Complete | Reasoning trace + verification instructions |
| Consequence Reasoning | ✅ Complete | Concrete metrics for S3/RDS |
| Cascade Analysis | ✅ Complete | Type grouping + depth tracking |
| Verification Loop | ✅ Complete | Structured pattern matching |
| Cross-Action Analysis | ✅ Exists | Patterns in cross-action-patterns.ts |

---

## Focus Areas

### 1. Consequence Reasoning Quality ✅

**Before:** "Bucket deletion is destructive"
**After:** "S3 bucket 'production-data' (12,847 objects, 50 GB, last modified 2 hours ago) has no versioning, object lock, or replication; deletion is UNRECOVERABLE"

**Implementation:**
- `src/state/aws/s3.ts`: Added `objectCount`, `totalSizeBytes`, `lastModified`, `sampleSize` metrics
- `src/state/aws/rds.ts`: Added `snapshotCount`, `latestSnapshotTime`, engine info to reasoning
- Helper functions: `formatBytes()`, `formatTimeAgo()`, `buildMetricsSummary()`

**Example output:**
```
RDS instance 'analytics-db' (postgres) is recoverable: 5 snapshots (latest: 4 hours ago), PITR available, 7-day automated backups
```

### 2. Cascade Analysis ✅

**Before:** "cascadeImpactCount: 7"
**After:** "3 subnets, 2 EC2 instances, 1 NAT gateway, 1 RDS instance (max depth: 2)"

**Implementation:**
- `src/analyzer/dependencies.ts`: Added `resourceTypes` map, `buildCascadeSummary()`
- `src/resources/types.ts`: Enhanced `CascadeImpact` with `resourceType`, `depth`, `dependencyType`
- `src/output/json.ts`: Added `cascadeByType`, `cascadeSummary`, `maxCascadeDepth` to output

**Example output:**
```json
{
  "cascadeSummary": "3 subnets, 2 EC2 instances, 1 NAT gateway, 1 RDS instance",
  "maxCascadeDepth": 2,
  "cascadeByType": {
    "aws_subnet": 3,
    "aws_instance": 2,
    "aws_nat_gateway": 1,
    "aws_db_instance": 1
  }
}
```

### 3. Verification Loop ✅

**Before:** Generic text suggestions
**After:** Copy-paste commands with structured patterns for automatic output interpretation

**Implementation:**
- `src/core/mutation.ts`: Added `OutputPattern` type with `json_array_not_empty`, `json_field_equals`, `json_field_exists`, `regex`, `exit_code`
- `src/verification/pattern-matcher.ts`: New file with `interpretVerificationOutput()`, `matchPattern()`
- `src/verification/templates.ts`: Enhanced with `expected_pattern`, `failure_pattern`, `example_output`
- `src/mcp/server.ts`: Improved evidence re-evaluation with pattern matching

**Workflow:**
1. RecourseOS returns verification suggestions with structured patterns
2. Agent runs command, captures output and exit code
3. Agent submits evidence with `raw_output`
4. Pattern matcher auto-interprets output
5. Verdict upgraded if evidence confirms recovery paths

**Example suggestion:**
```json
{
  "evidence_key": "manual_snapshots_exist",
  "verification": {
    "argv": ["aws", "rds", "describe-db-snapshots", "--db-instance-identifier", "prod-db", ...]
  },
  "expected_pattern": { "type": "json_array_not_empty" },
  "example_output": "[{\"Id\": \"prod-db-2024-01-15\", \"Status\": \"available\"}]"
}
```

### 4. Attestation Richness ✅

**Before:** Signed input/output pair
**After:** Full reasoning chain, independently verifiable

**Implementation:**
- `schemas/attestation.v1.json`: Added `reasoningTrace` and `verificationInstructions` definitions
- `src/evaluator/trace.ts`: New `TraceBuilder` class for capturing evaluation steps
- `src/core/consequence.ts`: Added `trace` and `verification` fields to `ConsequenceReport`

**Example trace:**
```json
{
  "trace": {
    "steps": [
      { "action": "parse_input", "result": "Parsed Terraform plan with 3 resource changes" },
      { "action": "analyze_blast_radius", "result": "Analyzed 3 changes" },
      { "action": "cross_action_analysis", "result": "Checked 8 cross-action patterns" },
      { "action": "policy_evaluation", "result": "Risk assessment: block" }
    ],
    "handlers_invoked": ["aws_db_instance", "aws_s3_bucket"],
    "state_sources": ["terraform-plan", "terraform-state"]
  }
}
```

### 5. Cross-Action Analysis ✅

**Status:** Already implemented in `src/analyzer/cross-action.ts` and `cross-action-patterns.ts`

**Patterns detected:**
- Delete security group while EC2 still references it
- Replace RDS instance while app still points to old endpoint
- Delete VPC while resources still depend on it
- And more...

---

## Competitive Positioning

| Capability | Hoop.dev | RecourseOS |
|------------|----------|------------|
| Pattern matching | `rm -rf` → block | ✓ |
| Consequence depth | ✗ | Full blast radius with concrete metrics |
| Recoverability tiers | Binary | 5-tier + detailed reasoning |
| Attestation | Audit logs | Cryptographic proof with reasoning trace |
| Evidence verification | ✗ | Structured pattern matching + re-evaluation |
| Cascade analysis | ✗ | Type-grouped dependency graph with depth |
| Cross-action detection | ✗ | Multi-change interaction patterns |

---

## Files Changed

### Consequence Reasoning
- `src/state/aws/s3.ts` - S3 metrics and enriched reasoning
- `src/state/aws/rds.ts` - RDS metrics and enriched reasoning

### Cascade Analysis
- `src/analyzer/dependencies.ts` - Type grouping, depth tracking
- `src/resources/types.ts` - Enhanced CascadeImpact type
- `src/analyzer/blast-radius.ts` - Cascade summary building
- `src/output/json.ts` - JSON output with cascade fields

### Verification Loop
- `src/core/mutation.ts` - OutputPattern type
- `src/verification/pattern-matcher.ts` - Auto-matching logic
- `src/verification/templates.ts` - Structured patterns
- `src/mcp/server.ts` - Improved evidence re-evaluation

### Attestation Richness
- `schemas/attestation.v1.json` - Schema definitions
- `src/evaluator/trace.ts` - TraceBuilder
- `src/core/consequence.ts` - Trace fields
- `src/evaluator/terraform.ts` - Trace capture

---

## Success Metrics ✅

- [x] Attestation includes full reasoning trace (not just verdict)
- [x] Third party can verify attestation without RecourseOS access
- [x] Consequence reports include live state metrics
- [x] Cascade impact shows affected resource count and types
- [x] Verification suggestions are copy-paste ready with expected outputs
- [x] Pattern matching enables automatic output interpretation
