# recourse-verify

Standalone verification library for RecourseOS attestations. Zero external dependencies.

## Installation

```bash
npm install recourse-verify
```

## Quick Start

```typescript
import { verifyAttestation } from 'recourse-verify';

const result = await verifyAttestation(attestation, {
  trustedInstances: ['https://recourse.example'],
});

if (result.valid) {
  console.log(`Verified: key=${result.keyId}, state=${result.keyState}`);
} else {
  console.log(`Failed: ${result.reason}`);
}
```

## Overview

This library implements the verification procedure from §7.4 of the [RecourseOS Attestation Protocol](https://recourseos.dev/docs/attestation-protocol-design.html). It verifies attestations issued by any RecourseOS instance without requiring RecourseOS as a dependency.

Part of the [RecourseOS](https://github.com/recourseOS/recourse) project.

## API

### `verifyAttestation(attestation, options?)`

Verify a single attestation.

```typescript
import { verifyAttestation } from 'recourse-verify';

const result = await verifyAttestation(attestation, {
  trustedInstances: ['https://recourse.example'],
  keyCacheTtlMs: 86400000, // 24 hours (default)
  crossCheck: false,       // Fetch and compare URL copy
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
import { verifyAttestations } from 'recourse-verify';

const results = await verifyAttestations(attestations, {
  trustedInstances: ['https://recourse.example'],
});

const allValid = results.every(r => r.valid);
```

### `clearRegistryCache()`

Clear the in-memory key registry cache. Useful for testing or forced refresh.

```typescript
import { clearRegistryCache } from 'recourse-verify';

clearRegistryCache();
```

### `canonicalize(value)`

Canonicalize a value per RFC 8785 (JSON Canonicalization Scheme).

```typescript
import { canonicalize } from 'recourse-verify';

const canonical = canonicalize({ b: 1, a: 2 });
// '{"a":2,"b":1}'
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trustedInstances` | `string[]` | `[]` | Allow-list of instance base URLs. Empty = accept any. |
| `keyCacheTtlMs` | `number` | `86400000` | Cache TTL in milliseconds (24 hours). |
| `crossCheck` | `boolean` | `false` | Compare embedded and URL-fetched copies. |
| `fetch` | `typeof fetch` | global | Custom fetch for testing or non-browser environments. |

## Verification Result

**Success:**
```typescript
{
  valid: true,
  keyId: 'recourse-prod-1',
  keyState: 'active', // or 'deprecated' or 'retired'
  timestamp: '2026-05-01T14:30:00Z'
}
```

**Failure:**
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

### Rollback Protection (§5.5)

Rejects key registries with `registry_version` lower than cached version. Prevents downgrade attacks where an attacker serves old registry to bypass key compromise.

### Trusted Instances

The `trustedInstances` option is an **allow-list**, not trust-without-verification. Attestations from listed instances are still cryptographically verified; attestations from unlisted instances are rejected before verification.

URL matching normalizes:
- Trailing slashes: `https://example.com/` = `https://example.com`
- Default ports: `https://example.com:443` = `https://example.com`
- Case: `HTTPS://EXAMPLE.COM` = `https://example.com`

### Batch Verification Consistency

`verifyAttestations` pre-fetches all registries before verification, ensuring all attestations in a batch are verified against the same registry snapshot. Prevents inconsistent results during key rotation.

## Protocol Compliance

This library implements:
- §4 Canonicalization (RFC 8785)
- §5 Key Management (state checks, rollback protection)
- §6 Transport (cross-check)
- §7.4 Verification Procedure

## Requirements

- Node.js 18+ (uses native `fetch` and `crypto`)
- No external dependencies

## License

MIT
