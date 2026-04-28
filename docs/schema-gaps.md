# Feature Schema Gap Analysis

## Summary

Testing the classifier against edge-case resource types revealed gaps in the feature schema and rule handlers. This validation found **6 fixable bugs** and **4 documented limits**.

### What Was Fixed (v0.1)

| Fix | Category | Description |
|-----|----------|-------------|
| IAM attachment handler | Rule bug | Handler returned `recoverable-with-effort` for attachment resources; now `reversible` |
| Config-only detection | Schema addition | Resources ending in `_policy`, `_config`, `_rule` etc. now detected as `reversible` |
| Attachment detection | Schema addition | Resources ending in `_attachment`, `_membership` now detected as `reversible` |
| snapshot_retention_limit | Training gap | Added to backup attribute recognition (ElastiCache) |
| recovery_window_in_days | Training gap | Added to retention/window detection (Secrets Manager) |
| Secrets Manager window | Rule bug | recovery_window now detected via existing feature infrastructure |

### What Remains as Known Limits

| Limit | Why It's Hard | Mitigation |
|-------|---------------|------------|
| Route53 record classification | Recoverability depends on out-of-band state (zone backups, IP ownership) | Document as limit; future: ask user for context |
| Multi-cloud suffix detection | AWS naming conventions don't transfer to GCP/Azure | Document; future: structural detection |
| Classifier confidence on unknown types | 72-100% confidence but sometimes wrong | Dual-verdict surfaces disagreements |

---

## Test Results

| Resource Type | Expected | Actual | Confidence | Root Cause |
|---------------|----------|--------|------------|------------|
| aws_lambda_function_event_invoke_config | reversible | recoverable-with-effort | 100% | No signal for config-only resources |
| aws_iam_role_policy_attachment | reversible | recoverable-with-effort | 100% | No signal for attachment resources |
| aws_s3_bucket_policy | reversible | recoverable-with-effort | 100% | No signal for config-only resources |
| aws_route53_record | recoverable-with-effort | unrecoverable | 72.7% | Training data bias + no reference signal |
| aws_secretsmanager_secret (with recovery) | reversible | recoverable-with-effort | 100% | Missing recovery_window feature |
| aws_secretsmanager_secret (immediate) | unrecoverable | recoverable-with-effort | 100% | Missing recovery_window feature |
| aws_elasticache_cluster (no snapshots) | unrecoverable | recoverable-with-effort | 100% | snapshot_retention_limit not recognized |
| aws_elasticache_cluster (with snapshots) | recoverable-from-backup | recoverable-with-effort | 100% | snapshot_retention_limit not recognized |
| **aws_neptune_cluster (protected)** | **reversible** | **reversible** | **100%** | **deletion_protection correctly detected** |

## Gap Categories

### Gap 1: No distinction between data and config resources

**Problem**: The schema treats all resources equally, but many AWS resources are pure configuration:

- `aws_s3_bucket_policy` - JSON policy attached to bucket
- `aws_s3_bucket_lifecycle_configuration` - Rules for object lifecycle
- `aws_lambda_function_event_invoke_config` - Async invocation settings
- `aws_iam_role_policy` - Inline policy on a role
- `aws_security_group_rule` - Single rule in a security group
- `aws_vpc_endpoint` - VPC endpoint configuration

**Impact**: These should all be `reversible` (you can recreate the exact config), but they're classified as `recoverable-with-effort` because they have unknown resource type and no safety features.

**Proposed feature**: `is_config_only` or `stores_data`

### Gap 2: No distinction for attachment/relationship resources

**Problem**: Some resources represent relationships between other resources:

- `aws_iam_role_policy_attachment` - Links policy to role
- `aws_iam_user_policy_attachment` - Links policy to user
- `aws_iam_group_membership` - Links user to group
- `aws_lb_target_group_attachment` - Links target to target group
- `aws_security_group` → `aws_network_interface_sg_attachment`

**Impact**: Deleting these doesn't destroy data - both parent resources still exist. Should be `reversible`.

**Proposed feature**: `is_attachment` or `is_relationship`

### Gap 3: Missing recovery window semantics

**Problem**: Some resources have "soft delete" with configurable recovery:

- `aws_secretsmanager_secret` - `recovery_window_in_days` (7-30 days, or 0 for immediate)
- `aws_kms_key` - `deletion_window_in_days` (7-30 days)
- `aws_rds_cluster` - `delete_automated_backups` affects retention

We handle `deletion_window_in_days` for KMS but not `recovery_window_in_days` for Secrets Manager.

**Proposed feature**: `has_recovery_window` and/or unify these under a common pattern

### Gap 4: Snapshot retention limit not recognized

**Problem**: ElastiCache uses `snapshot_retention_limit` (0-35 days), not the standard snapshot attributes.

```
snapshot_retention_limit: 0  -> no snapshots -> unrecoverable
snapshot_retention_limit: 7  -> has snapshots -> recoverable-from-backup
```

**Fix**: Add `snapshot_retention_limit` to BACKUP_ATTRS or SNAPSHOT_ATTRS

## Proposed Schema v2

Add these features:

```typescript
interface ClassifierFeaturesV2 extends ClassifierFeatures {
  // Resource category signals
  is_config_only: number;      // 1 = pure config, 0 = stores data, -1 = unknown
  is_attachment: number;       // 1 = relationship resource, 0 = standalone, -1 = unknown

  // Recovery window (unified)
  has_recovery_window: number; // 1 = has soft delete, 0 = immediate delete, -1 = unknown
  recovery_window_days: number; // Normalized 0-1 (0-30 days)
}
```

## Derivation Rules

How to determine these features:

### is_config_only
- Resource type ends with `_policy`, `_configuration`, `_config`, `_rule`, `_setting` → likely config
- Resource has only `arn`, `id`, and config fields (no `size`, `count`, `instances`) → likely config
- Known config resource types from documentation

### is_attachment
- Resource type ends with `_attachment`, `_membership`, `_association` → attachment
- Resource has exactly 2 foreign key references (e.g., `role`, `policy_arn`) → attachment

### has_recovery_window
- Check for `recovery_window_in_days`, `deletion_window_in_days` attributes
- Value > 0 means soft delete is enabled

## Implications

1. **Cannot fix with training data alone** - These are conceptual categories, not patterns in attributes
2. **Need resource metadata** - May need to consult Terraform provider schema
3. **Heuristics vs lookup** - Can use naming conventions as heuristics, but false positives exist

## Recommended Next Steps

1. **Quick fix**: Add `snapshot_retention_limit` to feature extractor (5 min)
2. **Medium fix**: Add name-based heuristics for config/attachment resources (1 hour)
3. **Proper fix**: Build resource metadata lookup from provider schemas (half day)

## Known Limits

### Route53 Record Classification

The classifier returns `unrecoverable` for Route53 record deletions at 72.7% confidence. This is arguably wrong — you can recreate a DNS record if you know the values — but the *actual* recoverability depends on factors outside the plan:

- Do you have a zone backup or the record values documented?
- For A records: is the IP address still assigned to you?
- For ALIAS records: does the target resource still exist?

We've chosen to leave this as a documented limit rather than force a verdict. Future versions may ask the user for context.

### Multi-Cloud Suffix Detection

The current `is_config_only` and `is_attachment` detection uses AWS Terraform naming conventions:

```
_policy, _config, _rule, _setting      → config-only
_attachment, _membership, _association → attachment
```

These suffixes are reliable for AWS but won't transfer to other clouds:

- **GCP**: `google_project_iam_binding`, `google_compute_instance_group_membership`
- **Azure**: `azurerm_role_assignment`, `azurerm_subnet_network_security_group_association`

For multi-cloud support, suffix detection needs to be either:
1. Rebuilt per cloud with cloud-specific patterns, or
2. Replaced with structural detection (does this resource type represent a relationship between two other resources, vs. owning data of its own)

The abstract features (`is_config_only`, `is_attachment`) are the right concepts. The suffix-based implementation is an AWS-specific heuristic that works for v0.1.

## Files

- Test file: `tests/schema-validation.test.ts`
- Feature extractor: `src/classifier/feature-extractor.ts`
- Dual-verdict (config/attachment detection): `src/classifier/dual-verdict.ts`
