# Public Boundaries

This repository is public. Keep it useful for contributors and agent builders without exposing sensitive strategy, credentials, proprietary datasets, model artifacts, or hosted-service internals.

## Safe to Publish

- Public CLI behavior and commands.
- Deterministic resource handler coverage.
- Public Terraform fixture plans with fake names, fake IDs, and redacted values.
- Consequence report schemas and MCP tool contracts.
- Conservative classifier behavior and BitNet-compatible interfaces.
- Security guidance that tells users not to paste secrets.
- Generated docs and website assets.

## Keep Private

- Real cloud account IDs, customer names, tenant IDs, regions tied to customers, or production resource names.
- API keys, cloud credentials, access tokens, session tokens, private keys, and secret values.
- Hosted Recourse Cloud implementation details that are not needed to run the public CLI.
- Proprietary telemetry, customer reports, usage data, or incident examples.
- Private whitepapers, fundraising material, pricing strategy, and partnership plans.
- BitNet weights, private training corpora, evaluation datasets, and model-selection notes until intentionally released.
- Any exploit details that would help bypass policy decisions.

## Redaction Rules

Use obviously fake values in public fixtures and docs:

```text
prod-db-password
00000000-0000-0000-0000-000000000001
123456789012
example.com
```

Do not use copied customer output, cloud console output, or CI logs unless every sensitive value has been reviewed and redacted.

## Agent-Specific Guidance

Agent-facing docs should describe stable contracts, not private implementation plans. Public docs may say that RecourseOS is rules-first and BitNet-ready. They should not disclose private model weights, training data, hosted telemetry design, or non-public roadmap details.

## Review Checklist

Before committing public docs or fixtures:

- Search for credentials and tokens.
- Search for real account, tenant, subscription, and project IDs.
- Verify all resource names are fake or generic.
- Keep private architecture and whitepaper content out of this repo.
- Prefer schema examples over screenshots of real systems.
- Run `npm run docs:all` after changing Markdown-backed docs.
