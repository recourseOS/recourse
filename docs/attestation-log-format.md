# Recourse Attestation Log Format

**Version:** 1.0.0
**Status:** Draft Specification

This document defines the standard format for Recourse attestations—cryptographic proofs that an agent's proposed action was evaluated before execution.

---

## Overview

A Recourse attestation is a signed JSON object that proves:
1. **What** action was proposed (input)
2. **What** the consequence analysis determined (output)
3. **When** the evaluation occurred (timestamp)
4. **Who** performed the evaluation (evaluator + key_id)
5. **Authenticity** via Ed25519 signature

Any system can verify an attestation without trusting the evaluator—only the cryptographic signature matters.

---

## Attestation Structure

### Full Attestation Object

```json
{
  "input": { ... },
  "output": { ... },
  "evaluator": "recourse:blast-radius:1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "key_id": "recourse-prod-1",
  "attestation_uri": "https://recourse.example.com/.well-known/attestations/a1b2c3d4e5f6g7h8.json",
  "signature": "base64url-encoded-ed25519-signature"
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | object | Yes | The evaluation request (shell command, terraform plan, MCP call) |
| `output` | object | Yes | The evaluation result (risk assessment, mutations, evidence) |
| `evaluator` | string | Yes | Evaluator identifier: `recourse:<evaluator-type>:<version>` |
| `timestamp` | string | Yes | ISO 8601 timestamp of evaluation |
| `key_id` | string | Yes | Identifier of the signing key |
| `attestation_uri` | string | Yes | Canonical URL where this attestation can be retrieved |
| `signature` | string | Yes | Base64url-encoded Ed25519 signature |

---

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://recourseos.dev/schemas/attestation/v1",
  "title": "Recourse Attestation",
  "description": "Cryptographic proof of consequence evaluation before agent action",
  "type": "object",
  "required": ["input", "output", "evaluator", "timestamp", "key_id", "attestation_uri", "signature"],
  "properties": {
    "input": {
      "type": "object",
      "description": "The evaluation request",
      "properties": {
        "source": {
          "type": "string",
          "enum": ["shell", "terraform", "mcp"],
          "description": "Type of action being evaluated"
        },
        "command": { "type": "string" },
        "plan": { "type": "object" },
        "tool": { "type": "string" },
        "arguments": { "type": "object" }
      }
    },
    "output": {
      "type": "object",
      "description": "The evaluation result",
      "required": ["riskAssessment"],
      "properties": {
        "riskAssessment": {
          "type": "string",
          "enum": ["allow", "warn", "escalate", "block"],
          "description": "Final risk verdict"
        },
        "assessmentReason": { "type": "string" },
        "mutations": {
          "type": "array",
          "items": { "$ref": "#/$defs/mutation" }
        },
        "summary": { "$ref": "#/$defs/summary" }
      }
    },
    "evaluator": {
      "type": "string",
      "pattern": "^recourse:[a-z-]+:[0-9]+\\.[0-9]+\\.[0-9]+$",
      "description": "Evaluator identifier in format recourse:<type>:<semver>"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of evaluation"
    },
    "key_id": {
      "type": "string",
      "description": "Identifier of the signing key"
    },
    "attestation_uri": {
      "type": "string",
      "format": "uri",
      "description": "Canonical URL for attestation retrieval"
    },
    "signature": {
      "type": "string",
      "description": "Base64url-encoded Ed25519 signature"
    }
  },
  "$defs": {
    "mutation": {
      "type": "object",
      "properties": {
        "intent": {
          "type": "object",
          "properties": {
            "action": { "type": "string" },
            "target": { "type": ["string", "object"] }
          }
        },
        "recoverability": {
          "type": "object",
          "properties": {
            "tier": { "type": "integer", "minimum": 1, "maximum": 5 },
            "label": { "type": "string" }
          }
        }
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "totalMutations": { "type": "integer" },
        "worstRecoverability": { "type": "object" }
      }
    }
  }
}
```

---

## Verification Protocol

### Step 1: Obtain the Attestation

Attestations can be obtained from:
- Inline in API responses (`attestation` field)
- Retrieved via `attestation_uri`
- Extracted from log entries (see Log Entry Format below)

### Step 2: Fetch the Public Key

```
GET {instance_base_url}/.well-known/recourse-keys.json
```

Response:
```json
{
  "instance_id": "recourse-prod",
  "keys": [
    {
      "key_id": "recourse-prod-1",
      "public_key": "base64url-encoded-32-byte-ed25519-public-key",
      "algorithm": "Ed25519",
      "state": "active",
      "created_at": "2024-01-01T00:00:00.000Z",
      "activated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Step 3: Verify the Signature

1. **Extract** all fields except `signature` from the attestation
2. **Canonicalize** using RFC 8785 (JCS - JSON Canonicalization Scheme)
3. **Decode** the signature from base64url
4. **Verify** using Ed25519 with the public key from Step 2

### Step 4: Check Key State

- `active`: Valid for signing and verification
- `rotated`: Valid for verification only (not signing)
- `pending`: Reject (key not yet activated)
- `compromised`: Reject (key revoked)

### Step 5: Validate Attestation ID

The attestation ID embedded in `attestation_uri` must match:
```
SHA-256(canonicalize({input, output, evaluator, timestamp, key_id}))[0:16].hex()
```

---

## Log Entry Format

For embedding attestations in CI/CD logs, agent traces, or audit systems:

### Compact Single-Line Format

```
RECOURSE_ATTESTATION: {"attestation_uri":"https://...","signature":"...","riskAssessment":"allow","key_id":"..."}
```

### Structured Log Format (JSON)

```json
{
  "level": "info",
  "message": "Action evaluated",
  "recourse": {
    "attestation_uri": "https://recourse.example.com/.well-known/attestations/a1b2c3d4.json",
    "signature": "base64url-signature",
    "risk_assessment": "allow",
    "key_id": "recourse-prod-1",
    "evaluator": "recourse:blast-radius:1.0.0",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### GitHub Actions Annotation

```
::notice title=Recourse Attestation::risk=allow attestation_uri=https://... signature=...
```

---

## Verification SDKs

### TypeScript/JavaScript

```typescript
import { verify } from '@recourse/verify';

const result = await verify(attestation, {
  fetchKeys: true,  // Auto-fetch from attestation_uri host
});

if (result.valid) {
  console.log('Attestation verified');
} else {
  console.error('Verification failed:', result.reason);
}
```

### Go

```go
import "github.com/recourseos/recourse-go/verify"

result, err := verify.Attestation(attestation, verify.Options{
    FetchKeys: true,
})
if err != nil {
    log.Fatal(err)
}
if !result.Valid {
    log.Fatal("Verification failed:", result.Reason)
}
```

### CLI

```bash
recourse verify --attestation attestation.json
recourse verify --attestation-uri https://recourse.example.com/.well-known/attestations/a1b2c3d4.json
```

---

## Security Considerations

### Signature Coverage

The signature covers all fields except itself:
- `input`, `output`, `evaluator`, `timestamp`, `key_id`, `attestation_uri`

This prevents tampering with any part of the evaluation record.

### Key Rotation

- Keys should be rotated periodically (recommended: 90 days)
- Rotated keys remain valid for verification but cannot sign new attestations
- Key registries should be fetched with caching but periodic refresh

### Timestamp Validation

Verifiers SHOULD reject attestations with:
- Timestamps more than 5 minutes in the future (clock skew tolerance)
- Timestamps older than the policy allows (e.g., 24 hours for real-time enforcement)

### Replay Protection

The attestation ID is derived from the content, so identical evaluations produce identical IDs. For replay protection:
- Include a nonce in the input
- Or track seen attestation IDs

---

## Badge Format

For visual indication that an action was Recourse-attested:

### Text Badge

```
[RECOURSE:ALLOW] Verified attestation a1b2c3d4
[RECOURSE:BLOCK] Action blocked - unrecoverable mutation detected
```

### Markdown Badge

```markdown
![Recourse Attested](https://img.shields.io/badge/Recourse-Attested-green)
```

### HTML Badge

```html
<span class="recourse-badge recourse-allow"
      data-attestation-uri="https://..."
      data-signature="...">
  Recourse Verified
</span>
```

---

## Examples

### Shell Command Attestation

```json
{
  "input": {
    "source": "shell",
    "command": "aws s3 rm s3://prod-logs --recursive"
  },
  "output": {
    "riskAssessment": "block",
    "assessmentReason": "Recursive deletion of production S3 bucket",
    "mutations": [{
      "intent": { "action": "delete", "target": "s3://prod-logs" },
      "recoverability": { "tier": 4, "label": "unrecoverable" }
    }]
  },
  "evaluator": "recourse:blast-radius:1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "key_id": "recourse-prod-1",
  "attestation_uri": "https://recourse.example.com/.well-known/attestations/a1b2c3d4e5f6g7h8.json",
  "signature": "MEUCIQDx..."
}
```

### Terraform Plan Attestation

```json
{
  "input": {
    "source": "terraform",
    "plan": {
      "resource_changes": [{
        "address": "aws_rds_instance.prod",
        "change": { "actions": ["delete"] }
      }]
    }
  },
  "output": {
    "riskAssessment": "escalate",
    "assessmentReason": "RDS deletion requires human approval",
    "mutations": [{
      "intent": { "action": "delete", "target": "aws_rds_instance.prod" },
      "recoverability": { "tier": 3, "label": "recoverable-from-backup" }
    }]
  },
  "evaluator": "recourse:blast-radius:1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "key_id": "recourse-prod-1",
  "attestation_uri": "https://recourse.example.com/.well-known/attestations/b2c3d4e5f6g7h8i9.json",
  "signature": "MEUCIQDy..."
}
```

---

## Appendix: Attestation ID Derivation

```
attestation_id = SHA256(JCS({input, output, evaluator, timestamp, key_id}))[0:16].hex()
```

Where JCS is JSON Canonicalization Scheme per RFC 8785.

This ensures:
- Deterministic IDs from content
- No collision with different content
- URL-safe format (32 hex characters)
