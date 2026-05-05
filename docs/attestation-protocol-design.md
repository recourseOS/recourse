# RecourseOS Attestation Protocol

**Status:** Design draft. Not committed for v0.x. Implementation timeline pending capacity review.

**Date:** May 2026

**Related documents:**
- [Agent Interface](./agent-interface.html) - Consequence evaluation API
- [MCP Setup](./mcp-setup.html) - MCP server integration
- [Schema Gaps](./schema-gaps.html) - Verification protocol v1

---

## Problem Statement

RecourseOS evaluates consequences of actions before execution. But there's no way to *prove* that evaluation happened.

Today, an agent can claim "I checked with RecourseOS and it said allow" without verification. The agent might have:
- Lied about checking
- Hallucinated the response
- Skipped evaluation entirely
- Received a different verdict than claimed

This makes consequence evaluation **advisory**. The agent can ignore it with no evidence trail.

## Solution: Cryptographic Attestation

Attestations provide cryptographic proof that:
1. A specific input was evaluated
2. By a specific RecourseOS instance
3. At a specific time
4. Producing a specific verdict

With attestations, third parties (CI systems, approval workflows, audit logs, agent platforms) can **require proof of evaluation** before allowing execution. The advisory tool becomes a **gating** tool.

The killer feature is **non-repudiation**: agents cannot claim they checked without producing a signed artifact from RecourseOS.

---

## Attestation Schema

```typescript
interface ConsequenceAttestation {
  // Protocol version
  version: 'recourse.attestation.v1';

  // What was evaluated
  input: {
    hash: string;                    // SHA-256 of canonical input
    source: 'terraform' | 'shell' | 'mcp';
    timestamp: string;               // ISO 8601, evaluation time
  };

  // Replay/freshness protection
  nonce: string;                     // Random 128-bit value, hex-encoded
  expires_at: string;                // ISO 8601, attestation validity window

  // Chain to related attestations
  chain_id?: string;                 // Links approval attestations to evaluation attestations
  parent_attestation?: string;       // Hash of attestation this one references

  // The evaluation result
  evaluation: {
    riskAssessment: 'allow' | 'warn' | 'escalate' | 'block';
    worstTier: 1 | 2 | 3 | 4 | 5;
    reportHash: string;              // SHA-256 of full ConsequenceReport
    mutationCount: number;
    hasUnrecoverable: boolean;
  };

  // Who evaluated
  evaluator: {
    instanceId: string;              // Unique RecourseOS instance identifier
    version: string;                 // RecourseOS version (e.g., "0.1.14")
    publicKey: string;               // PEM-encoded public key for verification
    keyAttestation?: string;         // Optional: hardware-backed key provenance (HSM/TPM)
  };

  // Cryptographic binding
  signature: string;                 // Ed25519 signature over all fields above
  signatureAlgorithm: 'Ed25519';
}
```

### Schema Design Notes

**`nonce`**: Prevents replay attacks. An attacker cannot reuse an old "allow" attestation for a new action. Each evaluation generates a fresh nonce.

**`expires_at`**: Verdicts have a shelf life. A consequence evaluation from an hour ago may not apply to infrastructure state that has changed since. Default expiry: 15 minutes. Configurable per-deployment.

**`chain_id` / `parent_attestation`**: Enables attestation chains. When a human approves an escalated action, their approval attestation references the original evaluation attestation. This creates a complete audit trail: *evaluation happened → human approved → action executed*.

**`keyAttestation`**: Future-proofing for high-trust deployments. When the signing key is hardware-backed (HSM/TPM), this field contains evidence of the key's provenance. Not required for v1.

---

## Verification Model

Four verification models exist. v1 targets **opt-in inline by the agent**.

### 1. Inline (execution boundary)
The target system (AWS, kubectl, terraform) refuses to execute without valid attestation.

**Pros:** Strongest guarantee.
**Cons:** Requires changes to every executing system. Not realistic for v1.

### 2. Async (audit later)
Actions execute normally. Attestations are logged. Audit happens after the fact.

**Pros:** No changes to executing systems.
**Cons:** Violations detected late, not prevented.

### 3. Hybrid
Inline for high-stakes operations, async for everything else. Configurable per-organization.

**Pros:** Balances security and friction.
**Cons:** Requires execution-side cooperation that doesn't exist yet.

### 4. Opt-in inline by agent (v1 target)
The agent receives the attestation. The agent decides whether to verify before proceeding. Agent behavior is configurable by the operator.

**Pros:** Works today without ecosystem changes. Gating happens in the agent's decision loop, not at execution boundary.
**Cons:** Relies on agent cooperation. Malicious agents can still skip verification.

**Why this is right for v1:** RecourseOS doesn't control terraform, kubectl, or AWS CLI. It *does* influence agent behavior through the MCP protocol. The agent's decision loop is the boundary where RecourseOS has leverage. Start there.

Most agents will treat attestations as advisory in v1 (same as consequence reports today). Some operators will configure agents to require valid attestations before execution. The protocol supports both. Eventually, execution-side cooperation may enable true inline verification—but v1 doesn't wait for that.

---

## Trust Anchor

### v1: Self-signed, published keys

Each RecourseOS instance:
1. Generates an Ed25519 keypair on first run
2. Persists the keypair in a config directory
3. Exposes the public key via API endpoint (`GET /attestation/public-key`)
4. Signs all attestations with the private key

Verifiers:
1. Fetch the public key from the RecourseOS instance they trust
2. Verify attestation signatures against that key
3. Cache keys with appropriate TTL

**Trust model:** Agent operators choose which RecourseOS instances to trust and fetch those public keys. Similar to SSH host key verification—pragmatic, low-friction, no central authority required.

### v2 (future): Organizational CAs

For enterprise deployments:
- Organization runs an intermediate CA
- All RecourseOS instances get certificates signed by the CA
- Verifiers trust the CA, transitively trust all instances

This requires PKI infrastructure but follows established patterns.

### v3+ (future): Advanced trust models

- Transparency logs (Certificate Transparency-style)
- Federation between organizations
- Cross-organizational trust agreements

The schema accommodates these through the `keyAttestation` field, but implementation is deferred.

---

## Non-Goals (v1)

The following are explicitly **out of scope** for v1:

### Execution attestation
Attestation that an action was actually performed and produced a specific outcome. This requires cooperation from executing systems (AWS, kubectl, etc.) that RecourseOS doesn't control.

Evaluation attestation is what RecourseOS uniquely provides. Execution attestation is a future extension.

### Distributed witnesses
Multi-party signatures, threshold signatures, MPC-based attestation. Real cryptographic primitives, but premature complexity for v1. Reserve the schema slot, defer implementation.

### Credit systems / agent economy
The original framing considered attestations as economic units for agent transactions. This leads toward payment models and credit networks—interesting but orthogonal to the core value proposition.

Attestation-as-proof-of-evaluation is a cleaner framing. It connects to existing security patterns (audit, compliance, non-repudiation) without requiring economic infrastructure.

### Centralized attestation service
A cloud service that all attestations route through. This creates a critical-path dependency and conflicts with RecourseOS's offline/local-first architecture. Self-signed local keys are the right default.

---

## Threat Model

### What the protocol protects against

- **Fabricated consequence reports**: Agents that hallucinate or lie about evaluation results
- **Bypassed evaluation**: Compromised agents that skip evaluation entirely
- **Audit trail tampering**: Modification of logs to hide that evaluation was skipped
- **Repudiation**: Agent operators claiming "we didn't do that, prove it"

### What the protocol does NOT protect against

- **Compromised RecourseOS instances**: An attacker who controls RecourseOS can sign anything
- **Compromised signing keys**: Key theft enables forgery
- **Coercion**: Operators can always configure RecourseOS to produce specific verdicts
- **Out-of-band actions**: Actions that don't go through evaluation aren't attested

**Honest framing:** The protocol provides *integrity* of the evaluation chain, not *correctness* of the evaluation itself. A signed attestation proves RecourseOS said "allow"—it doesn't prove the action was actually safe.

---

## Verification Procedure

### Signing (RecourseOS)

1. **Canonicalize the input**
   - Parse the input (Terraform plan JSON, shell command, MCP call)
   - Serialize to canonical JSON (sorted keys, no whitespace, UTF-8 NFC normalization)
   - Compute SHA-256 hash → `input.hash`

2. **Build the attestation object**
   - Set `version` to `'recourse.attestation.v1'`
   - Set `input.source`, `input.timestamp`
   - Generate cryptographically secure 128-bit `nonce` (hex-encoded)
   - Set `expires_at` to `timestamp + TTL` (default: 15 minutes)
   - Populate `evaluation` fields from ConsequenceReport
   - Compute SHA-256 of full ConsequenceReport → `evaluation.reportHash`
   - Populate `evaluator` with instance metadata

3. **Compute signature**
   - Serialize the attestation object (excluding `signature` and `signatureAlgorithm`) to canonical JSON
   - Sign with Ed25519 private key
   - Base64-encode the signature → `signature`
   - Set `signatureAlgorithm` to `'Ed25519'`

4. **Return attestation**
   - Include in ConsequenceReport response if requested
   - Store locally if attestation persistence is enabled

### Verification (Consumer)

1. **Parse attestation**
   - Decode the attestation JSON
   - Extract the `evaluator.publicKey` field

2. **Validate structure**
   - Confirm `version` is `'recourse.attestation.v1'`
   - Confirm all required fields are present
   - Confirm `signatureAlgorithm` is `'Ed25519'`

3. **Check freshness**
   - Parse `input.timestamp` and `expires_at` as ISO 8601
   - Verify current time is between `input.timestamp` and `expires_at`
   - Apply clock skew tolerance (default: 30 seconds)

4. **Validate signature**
   - Extract the `signature` field and Base64-decode
   - Reconstruct the canonical JSON of all fields *except* `signature` and `signatureAlgorithm`
   - Verify signature using the public key
   - If verification fails, reject attestation

5. **Trust the public key**
   - If the verifier has a trusted key list, confirm `evaluator.publicKey` is in the list
   - If using key discovery, fetch from `GET /attestation/public-key` at the trusted instance
   - Optionally verify `evaluator.instanceId` matches expected instance

6. **Verify input binding**
   - Canonicalize the original input (same procedure as signing step 1)
   - Compute SHA-256 hash
   - Confirm it matches `input.hash`
   - If mismatch, reject—the attestation was issued for different input

7. **Interpret result**
   - If all checks pass, attestation is valid
   - Read `evaluation.riskAssessment` for the verdict
   - Optionally verify `evaluation.reportHash` against a stored ConsequenceReport

### Chained Attestation Verification

For attestation chains (e.g., human approval of an escalated action):

1. Verify the approval attestation using the procedure above
2. Extract `parent_attestation` hash
3. Locate the parent attestation by hash
4. Verify the parent attestation
5. Confirm `chain_id` values match between linked attestations
6. Confirm the approval attestation's `input.timestamp` is after the parent's

---

## Failure Modes

### Signature Verification Failures

| Error | Cause | Response |
|-------|-------|----------|
| `SIGNATURE_INVALID` | Signature doesn't verify against public key | Reject attestation. Possible tampering or wrong key. |
| `SIGNATURE_MALFORMED` | Cannot decode Base64 signature | Reject attestation. Corrupted data. |
| `KEY_UNKNOWN` | Public key not in trusted set | Reject or prompt operator for trust decision. |
| `KEY_EXPIRED` | Key has been rotated and is past validity window | Reject. Require fresh attestation from current key. |

### Freshness Failures

| Error | Cause | Response |
|-------|-------|----------|
| `ATTESTATION_EXPIRED` | Current time is past `expires_at` | Reject. Request new evaluation. |
| `ATTESTATION_FUTURE` | `input.timestamp` is in the future (beyond clock skew) | Reject. Possible clock manipulation. |
| `NONCE_REUSED` | Same nonce appears in multiple attestations | Reject. Replay attack detected. |

### Input Binding Failures

| Error | Cause | Response |
|-------|-------|----------|
| `INPUT_HASH_MISMATCH` | Computed hash doesn't match `input.hash` | Reject. Attestation was for different input. |
| `INPUT_NOT_CANONICALIZABLE` | Input cannot be serialized to canonical form | Reject. Invalid input format. |

### Chain Failures

| Error | Cause | Response |
|-------|-------|----------|
| `PARENT_NOT_FOUND` | Cannot locate attestation referenced by `parent_attestation` | Incomplete chain. May require manual verification. |
| `CHAIN_ID_MISMATCH` | `chain_id` differs between linked attestations | Reject. Attestations are not part of same evaluation flow. |
| `CHAIN_ORDER_INVALID` | Child attestation predates parent | Reject. Temporal paradox indicates tampering. |

### Recovery Guidance

**Transient failures (retry may help):**
- Network errors fetching public key
- Clock synchronization issues (minor)

**Permanent failures (requires new evaluation):**
- Expired attestations
- Input hash mismatches
- Signature failures

**Configuration issues (requires operator action):**
- Unknown public keys
- Missing trusted key list
- Key rotation needed

---

## Wire Format

### Transport

Attestations are transported as JSON objects within ConsequenceReport responses. No separate transport protocol is required.

**Within ConsequenceReport:**
```json
{
  "riskAssessment": "warn",
  "worstTier": 3,
  "mutations": [...],
  "attestation": {
    "version": "recourse.attestation.v1",
    "input": {...},
    "nonce": "a1b2c3d4e5f6...",
    ...
  }
}
```

**Standalone (for storage or transmission):**
```json
{
  "version": "recourse.attestation.v1",
  "input": {
    "hash": "sha256:abcd1234...",
    "source": "terraform",
    "timestamp": "2026-05-04T12:00:00Z"
  },
  ...
}
```

### Canonical JSON Serialization

For hashing and signing, JSON must be serialized canonically:

1. **Key ordering:** Object keys sorted lexicographically (Unicode code point order)
2. **Whitespace:** No whitespace between tokens
3. **Numbers:** No leading zeros, no trailing zeros after decimal, no positive sign
4. **Strings:** UTF-8 NFC normalization, minimal escaping (only `\n`, `\r`, `\t`, `\\`, `\"`)
5. **No trailing commas**
6. **Unicode:** Use actual characters, not `\uXXXX` escapes (except control characters)

**Example canonical form:**
```
{"evaluation":{"hasUnrecoverable":false,"mutationCount":3,"reportHash":"sha256:...","riskAssessment":"warn","worstTier":3},"evaluator":{"instanceId":"local-dev-1","publicKey":"-----BEGIN PUBLIC KEY-----\n...","version":"0.1.34"},"expires_at":"2026-05-04T12:15:00Z","input":{"hash":"sha256:...","source":"terraform","timestamp":"2026-05-04T12:00:00Z"},"nonce":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4","signature":"...","signatureAlgorithm":"Ed25519","version":"recourse.attestation.v1"}
```

### Hash Encoding

All hashes use the format `sha256:<hex>` where `<hex>` is the lowercase hexadecimal encoding of the SHA-256 digest.

**Example:**
```
sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

### Signature Encoding

Ed25519 signatures are 64 bytes. Encode as standard Base64 (RFC 4648).

**Example:**
```
"signature": "dGhpcyBpcyBhbiBleGFtcGxlIHNpZ25hdHVyZSBmb3IgZG9jdW1lbnRhdGlvbiBwdXJwb3Nlcw=="
```

### Public Key Encoding

Public keys use PEM encoding (RFC 7468) with the `PUBLIC KEY` label.

**Example:**
```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAG1X3Iu+kMNNKr7yt3x/kUVQ7OZGJn5gLMzVHkO8Xqfk=
-----END PUBLIC KEY-----
```

### Size Limits

| Field | Max Size |
|-------|----------|
| Full attestation JSON | 64 KB |
| `input.hash` | 71 characters (`sha256:` + 64 hex digits) |
| `nonce` | 32 characters (128 bits, hex-encoded) |
| `signature` | 88 characters (64 bytes, Base64) |
| `evaluator.publicKey` | 256 characters (PEM-encoded Ed25519) |
| `evaluator.instanceId` | 128 characters |

### Content-Type

When served via HTTP endpoints:
- `Content-Type: application/json; charset=utf-8`
- For the public key endpoint: `Content-Type: application/x-pem-file`

### Versioning

The `version` field enables protocol evolution:

- `recourse.attestation.v1` — Current version, as specified in this document
- Future versions increment the version string
- Verifiers should reject unknown versions rather than attempting best-effort parsing
- RecourseOS may support multiple versions simultaneously during migration periods

---

## v1 Implementation Scope

### Deliverables

1. **Specification document** (this document, expanded)
   - Complete schema with field semantics
   - Signing and verification procedures
   - Error handling and edge cases
   - Versioning strategy

2. **RecourseOS integration**
   - Every ConsequenceReport includes optional attestation
   - Keypair generation on first run
   - Public key exposed via API
   - New MCP tool: `recourse_verify_attestation`

3. **Standalone verification library**
   - TypeScript library for attestation verification
   - No RecourseOS dependency
   - Portable to any tool that consumes attestations

4. **Documentation**
   - How agents request attestations
   - How third parties verify them
   - Chained attestation flow for human approval

5. **One partner integration**
   - Find one MCP server or agent platform that benefits from attestations
   - Build integration end-to-end
   - Document publicly

### Estimated effort

8-12 weeks of focused work for complete v1 with documentation and partner integration.

---

## Open Questions (for implementation phase)

1. **Key rotation**: How do instances rotate keys without breaking verification of old attestations? Probably: include key ID in attestation, maintain key history.

2. **Attestation storage**: Should RecourseOS store issued attestations? Or are they purely handed to agents? Storage enables audit queries but adds persistence requirements.

3. **Bulk attestation**: For Terraform plans with many resources, one attestation per resource or one per plan? Probably per-plan with resource hashes included.

4. **Revocation**: Can attestations be revoked? (e.g., "that evaluation was based on stale state"). Probably not in v1—attestations simply expire.

---

## Appendix: Why Attestation > Advisory

The shift from advisory to verifiable changes RecourseOS's security posture fundamentally.

**Advisory (today):**
```
Agent → RecourseOS: "Should I delete this bucket?"
RecourseOS → Agent: "Block: unrecoverable data loss"
Agent: *deletes bucket anyway*
Audit log: *nothing*
```

**Verifiable (with attestation):**
```
Agent → RecourseOS: "Should I delete this bucket?"
RecourseOS → Agent: ConsequenceReport + Attestation(block)
Agent: *attempts to delete bucket*
CI/Approval system: "Show attestation"
Agent: *presents block attestation*
CI/Approval system: "Attestation says block. Execution denied."
```

Or if the agent skips evaluation:
```
Agent: *attempts to delete bucket without evaluation*
CI/Approval system: "Show attestation"
Agent: *has nothing*
CI/Approval system: "No attestation. Execution denied."
```

The attestation protocol doesn't change how evaluation works. It changes whether evaluation *matters*.
