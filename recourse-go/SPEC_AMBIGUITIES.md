# RecourseOS Spec Ambiguities

This document tracks divergences found between the TypeScript and Go implementations that require explicit spec clarification.

## Found via Differential Testing

### 1. Missing `before` State Handling

**Plan:** `s3/bucket-delete-no-before.json`

**Divergence:**
- TypeScript: Returns `unrecoverable` (tier 4)
- Go: Returns `needs-review` (tier 5)

**Context:** When a resource is being deleted but the Terraform plan doesn't include `before` values (the current state of the resource), we cannot determine protective mechanisms (versioning, backups, etc.).

**Options:**
1. **Return `needs-review`** (Go's approach): Conservative - we don't have enough information to make a determination. Requires human review.
2. **Return `unrecoverable`** (TS's approach): Assume worst case for data resources. Prevents accidental data loss by blocking.

**Recommendation:** For data-bearing resources (S3 buckets, databases, etc.), the TypeScript approach is safer. The spec should state:

> When evaluating a delete action and `before` values are unavailable, handlers for data-bearing resources SHOULD return the worst-case tier for that resource type (typically `unrecoverable`), not `needs-review`.

**Status:** Needs spec text

---

## Fixed Divergences

### S3 Bucket Versioning (FIXED)

**Original Issue:** Go implementation returned `recoverable-with-effort` for versioned buckets.

**Root Cause:** Misunderstanding of S3 versioning semantics.

**Correct Behavior:** Versioning does NOT protect against bucket deletion. When you delete an S3 bucket:
1. You must first empty all objects AND all versions
2. Once the bucket is deleted, all version history is gone
3. Versioning only protects objects within an existing bucket

**Fix:** Go implementation updated to always return `unrecoverable` for bucket deletion (unless bucket is confirmed empty).

---

## Process

When divergences are found:
1. Add entry to this document
2. Categorize: spec-ambiguity, ts-bug, go-bug, intended-difference
3. Fix implementation bugs immediately
4. Track spec ambiguities for protocol documentation
5. Once spec text is written, close the item

## Running the Harness

```bash
cd recourse-go
npx tsx tests/differential/runner.ts
```

Reports written to: `tests/differential/divergence-report.json`
