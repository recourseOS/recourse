# RecourseOS Attestation Verification Library

Standalone library for verifying RecourseOS attestations. Zero dependencies on RecourseOS internals.

## Overview

This library implements the verification procedure from §7.4 of the [RecourseOS Attestation Protocol](../../docs/attestation-protocol-design.html). It can verify attestations issued by any RecourseOS instance without requiring RecourseOS as a dependency.

## Installation

The library is currently bundled with RecourseOS. To use it standalone:

```typescript
import { verifyAttestation } from 'recourse-cli/dist/verify';
```

Future: Will be published as a separate `recourse-verify` npm package.

## API

### `verifyAttestation(attestation, options?)`

Verify a single attestation.

```typescript
import { verifyAttestation } from 'recourse-cli/dist/verify';

const result = await verifyAttestation(attestation, {
  trustedInstances: ['https://recourse.example'],
  keyCacheTtlMs: 86400000, // 24 hours
  crossCheck: false,
});

if (result.valid) {
  console.log(`Verified by key ${result.keyId} (${result.keyState})`);
} else {
  console.log(`Verification failed: ${result.reason}`);
}
```

### `verifyAttestations(attestations, options?)`

Verify multiple attestations with shared cache. Pre-fetches all registries before verification to ensure consistency during key rotation.

```typescript
import { verifyAttestations } from 'recourse-cli/dist/verify';

const results = await verifyAttestations(attestations, {
  trustedInstances: ['https://recourse.example'],
});

const allValid = results.every(r => r.valid);
```

### `clearRegistryCache()`

Clear the in-memory key registry cache. Useful for testing or when you need to force a fresh fetch.

```typescript
import { clearRegistryCache } from 'recourse-cli/dist/verify';

clearRegistryCache();
```

### `canonicalize(value)`

Canonicalize a value per RFC 8785 (JSON Canonicalization Scheme). Exposed for advanced use cases.

```typescript
import { canonicalize } from 'recourse-cli/dist/verify';

const canonical = canonicalize({ b: 1, a: 2 });
// '{"a":2,"b":1}'
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trustedInstances` | `string[]` | `[]` | Allow-list of instance base URLs. Empty means accept any. |
| `keyCacheTtlMs` | `number` | `86400000` | Cache TTL in milliseconds (default 24 hours). |
| `crossCheck` | `boolean` | `false` | Fetch attestation from URI and compare with embedded copy. |
| `fetch` | `typeof fetch` | global `fetch` | Custom fetch function for testing or non-browser environments. |

## Verification Result

Success:
```typescript
{
  valid: true,
  keyId: 'recourse-prod-1',
  keyState: 'active', // or 'deprecated' or 'retired'
  timestamp: '2026-05-01T14:30:00Z'
}
```

Failure:
```typescript
{
  valid: false,
  reason: 'signature_invalid', // see failure reasons below
  details: 'Optional error details'
}
```

### Failure Reasons

| Reason | Description |
|--------|-------------|
| `invalid_attestation` | Missing required fields or malformed attestation |
| `instance_not_trusted` | Attestation from instance not in `trustedInstances` |
| `key_not_found` | Key ID not found in registry |
| `key_pending` | Key is in pending state (not yet activated) |
| `key_compromised` | Key has been marked compromised |
| `signature_invalid` | Ed25519 signature verification failed |
| `cross_check_mismatch` | Embedded and URL-fetched attestations differ |
| `network_error` | Failed to fetch registry or attestation |
| `registry_rollback` | Fetched registry version < cached version (security) |

## Security Features

### Rollback Protection

Per §5.5 of the protocol, the library rejects key registries with a `registry_version` lower than a previously cached version. This prevents downgrade attacks where an attacker serves an old registry to bypass key compromise.

### Trusted Instances

The `trustedInstances` option is an **allow-list**, not a trust-without-verification list. Attestations from listed instances are still cryptographically verified; attestations from unlisted instances are rejected before verification.

URL matching normalizes:
- Trailing slashes (`https://example.com/` = `https://example.com`)
- Default ports (`https://example.com:443` = `https://example.com`)
- Case (`HTTPS://EXAMPLE.COM` = `https://example.com`)

### Batch Verification Consistency

`verifyAttestations` pre-fetches all registries before verification, ensuring all attestations in a batch are verified against the same registry snapshot. This prevents inconsistent results during key rotation.

## Protocol Compliance

This library implements:
- §4 Canonicalization (RFC 8785)
- §5 Key Management (state checks, rollback protection)
- §6 Transport (cross-check)
- §7.4 Verification Procedure

## Testing

Run the verification library tests:

```bash
npm test -- tests/verify.test.ts
npm test -- tests/verify-interop.test.ts
```

## License

MIT
