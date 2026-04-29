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

## BitNet Path

BitNet is planned for unknown-resource classification, not for replacing deterministic handlers. Known rules remain authoritative because they encode provider-specific recovery behavior.

The public contract should not change when BitNet is introduced: agents and CI systems should continue to receive the same tiers, decisions, confidence, evidence, and missing-evidence fields.

## Safety Requirements

- Rules win for known resources.
- Unknown destructive resources require evidence before they can be treated as safe.
- Classifier output must include confidence and evidence.
- Missing recovery evidence should be visible to users and agents.
- False-safe outcomes are more dangerous than false-review outcomes.
