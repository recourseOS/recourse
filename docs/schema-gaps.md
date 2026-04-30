# Classifier Notes

RecourseOS is rules-first. Deterministic handlers decide known AWS, GCP, Azure, and Azure AD resource types. The unknown-resource classifier only runs when a resource type does not have a known handler and `--classifier` is enabled.

## Public Contract

Classifier output uses the same recoverability tiers as deterministic rules:

- `reversible`
- `recoverable-with-effort`
- `recoverable-from-backup`
- `unrecoverable`
- `needs-review`

Unknown-resource classification is conservative. When evidence is weak, ambiguous, or missing, RecourseOS should return `needs-review` instead of marking a destructive change safe.

## Semantic Signals

The classifier looks for provider-neutral safety signals that commonly affect recoverability:

- deletion protection
- versioning or soft delete
- backups, snapshots, and point-in-time recovery
- recovery or deletion windows
- config-only resources
- attachment or relationship resources
- credential material that cannot be recovered after deletion

These signals help RecourseOS generalize across long-tail provider resources without relying only on cloud-specific type names.

## Known Limits

Some resources require context that may not exist in a Terraform plan, shell command, or MCP tool call:

- DNS record recovery can depend on out-of-band zone backups, IP ownership, and target resource state.
- Secret, key, and certificate child resources may not include parent retention or purge-protection settings.
- Unknown provider resources can look similar while having very different recovery behavior.
- Live cloud state is only available when explicit evidence is supplied.

In these cases, RecourseOS should escalate or require review.

## Backup Topology vs Backup Existence

Recoverability depends not just on whether backups exist, but on whether backups **will survive the operation being evaluated**. This is the distinction between backup existence and backup topology.

### The Problem

A volume with a snapshot is typically `recoverable-from-backup`. But if the snapshot is co-located with the volume (same region, same account, no external copies), deleting the volume may also delete the snapshot in certain failure scenarios or as part of a multi-step operation.

RecourseOS currently checks:
- Whether snapshots exist in Terraform state
- Whether backup retention is configured
- Whether deletion protection is enabled

RecourseOS does NOT currently verify:
- Whether snapshots are cross-region replicated
- Whether backups exist in AWS Backup vaults (external to the plan)
- Whether snapshots are in different accounts
- Whether the backup will survive the specific operation being evaluated

### Documented in Traces

The EBS and RDS handlers include these limitations in their classification traces:
- `Cannot verify AWS Backup vault snapshots outside Terraform state`
- `Cannot check for cross-region snapshot copies`
- `Cannot verify AWS Backup vault configurations outside the plan`
- `Cannot check for cross-region or cross-account snapshots`

These trace limitations are visible to agents and can inform human review.

### Action-Sequence Limitation

RecourseOS evaluates each action in a plan individually. It does not currently model dangerous action sequences where individually-safe actions become dangerous in combination:

- "Delete snapshot" (recoverable if volume exists) + "Delete volume" (recoverable if snapshot exists) = **unrecoverable** together
- A multi-step plan where step 1 removes backups and step 2 removes the protected resource

This is a fundamental architecture limitation. To address it would require:
1. Cross-action dependency analysis within a plan
2. Modeling the state after each action, not just the current state
3. Graph-based reasoning about recovery paths being severed

For now, agents should:
- Review plans with multiple deletions affecting the same resource family
- Be especially cautious when both a resource and its backup are being deleted
- Consider that `recoverable-from-backup` assumes the backup survives

## BitNet Classifier

BitNet is a 1-bit quantized neural network classifier for unknown resource types. It handles the long tail of cloud providers (Scaleway, UpCloud, Exoscale, Hetzner, etc.) that don't have explicit handlers.

### Architecture

The classifier uses a three-layer routing system:

1. **Exact mappings** (confidence 1.0): Manually verified resource → category mappings for ~180 common resources across AWS, GCP, Azure, OCI. These fire first and short-circuit the model.

2. **BitNet model** (89% accuracy on resources not in exact mappings): 1-bit quantized neural network trained on 400+ labeled resource types. Handles unknown providers and edge cases.

3. **Pattern fallback** (variable confidence): Regex-based pattern matching for common suffixes like `_bucket`, `_volume`, `_policy`. Used when BitNet weights aren't loaded.

### Model Characteristics

- **Size**: ~217 KB (ships with binary)
- **Architecture**: Token embeddings → 64-dim hidden layer → 13 output categories
- **Training data**: 400+ resource types across 10+ cloud providers
- **Production accuracy**: 90.5% on held-out test (105/116)
  - Exact mappings: 100% (17/17 test cases covered)
  - BitNet alone: 89% (88/99 remaining cases)
  - Raw BitNet accuracy varies 2-3% between training runs due to random initialization

To reproduce: `npx tsx scripts/measure-production-accuracy.ts`

### Known Model Weaknesses

The BitNet model has consistent failure patterns that are covered by exact mappings:

| Pattern | Failure Mode | Fix |
|---------|--------------|-----|
| `_document` suffix | Over-demotes to no-verification | Exact mapping for `google_firestore_document` |
| `_container` suffix | Over-demotes to no-verification | Exact mapping for CosmosDB containers |
| `_attached` suffix | Over-demotes to no-verification | Exact mapping for `google_compute_attached_disk` |
| `serverless_cache` | Misclassifies as streaming | Exact mapping for `aws_elasticache_serverless_cache` |
| `ami` token | Not recognized as disk image | Exact mappings for `aws_ami`, `aws_ami_copy` |
| `_ciphertext` suffix | Over-demotes to no-verification | Exact mapping for `google_kms_secret_ciphertext` |

These weaknesses exist because the model learned strong demotion signals (`_policy`, `_configuration`) but over-applies them to legitimate data-bearing resources with similar suffixes.

The exact mappings close these gaps with 100% confidence. Resources covered include:
- Azure databases: `azurerm_mssql_managed_instance`, `azurerm_postgresql_server`, `azurerm_mysql_server`
- CosmosDB family: `azurerm_cosmosdb_sql_container`, `azurerm_cosmosdb_mongo_collection`, etc.
- GCP Firestore: `google_firestore_document`, `google_firestore_database`
- AWS AMIs: `aws_ami`, `aws_ami_copy`, `aws_ami_from_instance`
- Serverless cache: `aws_elasticache_serverless_cache`
- Secret ciphertext: `google_kms_secret_ciphertext`
- Azure Data Lake: `azurerm_storage_data_lake_gen2_filesystem`

These exact mappings exist because the BitNet model has known weaknesses on these specific patterns. They should not be removed during refactoring without verifying the model handles them correctly.

### Training Discipline

- **Held-out test set**: 116 examples never seen during training, used to measure generalization
- **No test contamination**: Failed test cases are not added to training data; instead, similar patterns are added that teach the same signal
- **Config/data boundary**: The hardest classification problem is distinguishing data-bearing resources from configuration metadata (e.g., `aws_s3_bucket` vs `aws_s3_bucket_lifecycle_configuration`)

### Remaining Weaknesses

The 11 failures not covered by exact mappings are mostly config/data boundary cases:

- Config resources over-promoted to parent category: `aws_s3_bucket_lifecycle_configuration`, `aws_s3_bucket_replication_configuration`, `google_storage_notification`, `aws_opensearch_outbound_connection`, `azurerm_mssql_database_extended_auditing_policy`
- Misc classification errors: `aws_eip` (networking), `oci_core_drg` (networking), `google_redis_cluster_node` (node vs cluster), `azurerm_redis_linked_server` (cache vs compute)
- Low-confidence guesses: `aws_launch_template`, `aws_ami_launch_permission`

These could be fixed with additional exact mappings if they prove problematic in production. The cost of adding an exact mapping is near-zero; the cost of a wrong verdict on a real user's resource is high.

### When BitNet is Used

BitNet only classifies resources that:
1. Have no exact mapping in the catalog
2. Have no explicit AWS/GCP/Azure handler

For known resources, deterministic handlers remain authoritative. BitNet handles the long tail where manual rules don't exist.

## Safety Requirements

- Rules win for known resources.
- Unknown destructive resources require evidence before they can be treated as safe.
- Classifier output must include confidence and evidence.
- Missing recovery evidence should be visible to users and agents.
- False-safe outcomes are more dangerous than false-review outcomes.
