# State Schema Migration Guide

How to migrate a resource analyzer to use the unknown-state schema.

## Overview

The state schema formalizes how RecourseOS handles incomplete evidence. Before this schema, analyzers could produce confident verdicts from partial evidence. After migration, analyzers explicitly declare what evidence they need and the engine blocks confident verdicts when blocking evidence is missing.

## Migration Steps

### 1. Identify the resource type and action

Most migrations are for `delete` actions on AWS resources. The resource type should match Terraform's naming (e.g., `aws_s3_bucket`, `aws_db_instance`).

### 2. List all evidence the analyzer checks

Read the existing analyzer code. For each piece of state it examines, ask:
- What is the evidence key? (e.g., `s3.versioning`, `rds.deletion_protection`)
- What values does it check for?
- Does absent evidence change the verdict?

Example from S3:
```typescript
// Checks versioning status
if (evidence.versioning === 'Enabled' || evidence.hasReplication) {
  return tier 3; // recoverable from backup
}
```

### 3. Classify each evidence item

For each evidence item, determine:

| Field | Question |
|-------|----------|
| `level` | Is this `required`, `recommended`, or `optional`? |
| `blocksSafeVerdict` | If missing, should the engine refuse to produce a confident verdict? |
| `defaultAssumption` | What's the conservative assumption if evidence is absent? |
| `maxFreshnessSeconds` | How quickly can this evidence become stale? |

**Rule of thumb for `blocksSafeVerdict`:**
- If the analyzer branches on this evidence to produce different tiers → `true`
- If the evidence only affects confidence or reasoning text → `false`

### 4. Add requirements to the registry

Edit `src/core/evidence-requirements.ts`:

```typescript
const MY_RESOURCE_DELETE: ResourceEvidenceRequirements = {
  resourceType: 'aws_my_resource',
  action: 'delete',
  requirements: [
    {
      key: 'my_resource.protection_enabled',
      level: 'required',
      description: 'Whether deletion protection is enabled',
      blocksSafeVerdict: true,  // Can't classify without this
      defaultAssumption: false,
      maxFreshnessSeconds: 3600,
    },
    {
      key: 'my_resource.backup_exists',
      level: 'required',
      description: 'Whether backups exist for this resource',
      blocksSafeVerdict: true,
      defaultAssumption: false,
      maxFreshnessSeconds: 3600,
    },
    {
      key: 'my_resource.tags',
      level: 'optional',
      description: 'Resource tags',
      blocksSafeVerdict: false,
      maxFreshnessSeconds: 3600,
    },
  ],
};
```

Add to `ALL_REQUIREMENTS` array at the bottom of the file.

### 5. Update the evidence analyzer

The evidence analyzer (e.g., `src/state/aws/my_resource.ts`) should:

1. Set `present` to mean "evidence was gathered" not "feature is enabled"
2. Track missing evidence explicitly

Before:
```typescript
{
  key: 'my_resource.protection_enabled',
  value: evidence.protectionEnabled,
  present: evidence.protectionEnabled === true,  // WRONG: means "enabled"
  description: '...',
}
```

After:
```typescript
{
  key: 'my_resource.protection_enabled',
  value: evidence.protectionEnabled,
  present: evidence.protectionEnabled !== undefined,  // RIGHT: means "gathered"
  description: '...',
}
```

### 6. Update the evaluator integration

If the evaluator (e.g., `src/evaluator/mcp.ts`) needs to match this resource type, update the service matching logic:

```typescript
function getMyResourceAnalysis(intent, myResources) {
  if (!myResources || intent.action !== 'delete') return null;

  const service = intent.target.service?.toLowerCase() ?? '';
  const isMatch = service.includes('my_resource')
    || service.includes('myresource')
    || intent.target.provider === 'aws';
  if (!isMatch) return null;

  const evidence = myResources[intent.target.id];
  return evidence ? analyzeMyResourceDeletionEvidence(evidence) : null;
}
```

### 7. Add tests

Add to `tests/state-schema.test.ts`:

```typescript
describe('MyResource Evidence Requirements', () => {
  const requirements = getEvidenceRequirements('aws_my_resource', 'delete')!;

  it('blocks safe verdict for critical evidence', () => {
    const protection = requirements.find(r => r.key === 'my_resource.protection_enabled');
    expect(protection!.blocksSafeVerdict).toBe(true);
  });
});
```

### 8. Verify integration

Run the test script pattern:

```typescript
const result = evaluateMcpToolCallConsequences(call, {
  awsEvidence: {
    myResources: {
      'resource-id': {
        // partial evidence - missing protection_enabled
        backupExists: true,
      },
    },
  },
});

// Should show:
// requiredEvidence.sufficient = false
// requiredEvidence.recommendation = 'block_until_verified'
// requiredEvidence.summary.missingBlocking = 1
```

## Checklist

- [ ] Requirements added to `src/core/evidence-requirements.ts`
- [ ] Requirements added to `ALL_REQUIREMENTS` array
- [ ] Evidence analyzer `present` field means "gathered" not "enabled"
- [ ] Evaluator service matching handles tool name variations
- [ ] Tests added for `blocksSafeVerdict` on critical evidence
- [ ] Integration verified: partial evidence → `sufficient: false`

## Examples

### S3 (reference implementation)
- File: `src/core/evidence-requirements.ts` (S3_BUCKET_DELETE)
- Evidence: `src/state/aws/s3.ts`
- Tests: `tests/state-schema.test.ts`

### RDS
- File: `src/core/evidence-requirements.ts` (RDS_INSTANCE_DELETE)
- Critical evidence: `deletion_protection`, `automated_backups`, `skip_final_snapshot`

## Common Mistakes

1. **Setting `present` based on value, not presence**
   - Wrong: `present: value === true`
   - Right: `present: value !== undefined`

2. **Forgetting to add to ALL_REQUIREMENTS**
   - The registry lookup won't find your requirements

3. **Not matching tool name variations**
   - `aws_s3_delete_bucket` vs `s3-delete-bucket` vs `deleteBucket`

4. **Making recommended evidence block verdicts**
   - `blocksSafeVerdict` should only be `true` for evidence that actually changes the tier
