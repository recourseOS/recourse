# Test Enhancement Plan

## Goal
Enhance test coverage across MCP server, core analysis logic, and end-to-end flows.

## Current State
- **14 test files**, ~3,163 lines of test code
- **Vitest** for unit/integration, **Playwright** for visual QA
- **175 supported resources**, **5 MCP tools**

---

## Phase 1: MCP Server Tests

### New: `tests/mcp-server.test.ts`

**Evidence Re-evaluation**
- `recourse_evaluate_with_evidence` end-to-end
- Empty evidence array handling
- Evidence with mismatched `evidence_key`
- Mixed verdict upgrade scenarios
- `matches_failure` interpretation behavior

**Input Validation Edge Cases**
- Malformed JSON string in plan parameter
- Invalid source type in evidence evaluation
- Non-object items in evidence array
- Classifier flag behavior on shell/mcp calls

**Shell Command Patterns**
- Paths with spaces: `rm '/path with spaces/file'`
- Command substitution: `rm $(find . -name "*.tmp")`
- AWS CLI flag ordering variations
- Multi-command pipes: `aws s3 ls | xargs rm`

**MCP Tool Argument Inference**
- Non-standard argument naming
- Tools with ambiguous target identifiers
- Multi-word tool names with 'delete' substring

---

## Phase 2: Dependency Graph Tests

### New: `tests/dependency-graph.test.ts`

- Circular dependency handling
- Diamond dependencies (A→B, A→C, B→D, C→D)
- Deep nesting (5+ levels)
- Fan-out (one resource → many dependents)
- Mixed explicit + implicit dependencies
- Empty state / no resources

---

## Phase 3: Recoverability Tier Tests

### New: `tests/recoverability-tiers.test.ts`

- Boundary conditions for all tier transitions
- Conflicting signals (versioning + no deletion_protection)
- Null state parameter handling per handler
- All protective mechanism combinations:
  - S3: versioning, replication, lifecycle
  - RDS: snapshots, PITR, deletion_protection
  - DynamoDB: PITR, deletion_protection, backups

---

## Phase 4: Cascade Impact Tests

### New: `tests/cascade-impact.test.ts`

- Multi-level cascade chains
- Cascade with mixed recoverability tiers
- Deletion with no dependents
- Large dependency graphs (performance)

---

## Phase 5: E2E Flow Tests

### New: `tests/e2e-flows.test.ts`

**CLI Workflows**
- `terraform plan → blast plan → decision output`
- With and without `--state` flag
- `--fail-on` threshold combinations (exit codes)
- `--classifier` flag enabling/disabling

**MCP Integration**
- Initialize → tools/list → tools/call → response cycle
- Error recovery (invalid tool → valid tool)
- Evidence submission workflow

**Real-World Scenarios**
- Production database deletion with backups
- S3 bucket with replication + versioning
- IAM role with attached policies
- VPC deletion with full cascade
- Mixed create/update/delete in single plan

---

## New Test Files Summary

```
tests/
├── mcp-server.test.ts          # NEW
├── dependency-graph.test.ts    # NEW
├── recoverability-tiers.test.ts # NEW
├── cascade-impact.test.ts      # NEW
├── e2e-flows.test.ts           # NEW
└── ... (existing files)
```

---

## Estimated Coverage

| Area | New Tests | Priority |
|------|-----------|----------|
| MCP evidence handling | ~10 | High |
| Shell command edge cases | ~8 | High |
| Dependency graph | ~12 | High |
| Handler edge cases | ~15 | High |
| E2E CLI workflows | ~8 | Medium |
| Cascade analysis | ~6 | Medium |

**Total: ~60 new tests**

---

## Verification

1. `npm test` - all new unit tests pass
2. `npm run mcp:smoke` - MCP smoke test passes
3. Coverage report shows improvement in:
   - `src/mcp/server.ts` (target: 90%+)
   - `src/analyzer/dependencies.ts` (target: 95%+)
   - `src/resources/aws/*.ts` (target: 85%+ per handler)
