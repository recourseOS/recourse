# Golden Evaluation Fixtures

These fixtures are stable Terraform plan JSON inputs used to validate Recourse's public evaluator contract. They are intentionally small, provider-specific, and safe to share.

## Fixture Set

| Fixture | Purpose | Expected decision |
| --- | --- | --- |
| `tests/fixtures/plans/aws-golden.json` | AWS rule authority for RDS and S3 object recovery | `block` |
| `tests/fixtures/plans/gcp-golden.json` | First-class GCP storage, Cloud SQL, and IAM rules | `block` |
| `tests/fixtures/plans/azure-golden.json` | First-class Azure storage, database, and role assignment rules | `block` |
| `tests/fixtures/plans/unknown-semantic-golden.json` | Provider-neutral unknown-resource classifier behavior | `escalate` |

## Run Locally

```bash
npm run build
npx vitest --run tests/golden-plan-fixtures.test.ts
npx vitest --run tests/cli-scenarios.test.ts
```

To inspect a fixture through the CLI:

```bash
node dist/index.js evaluate terraform tests/fixtures/plans/gcp-golden.json --classifier
```

## Cloud Contract

These fixtures model the payload shape Recourse Cloud should ingest later: a local consequence report with deterministic recoverability tiers, evidence strings, policy decision, actor context, and mutation targets. Cloud can store, compare, and govern these reports without changing the local evaluator behavior.

Known resource handlers remain authoritative. The unknown semantic fixture verifies that low-evidence destructive resources become `needs-review` instead of being marked safe.
