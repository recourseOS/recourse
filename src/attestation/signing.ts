/**
 * Ed25519 Signing and Verification for Attestations
 *
 * Implements §4.2-4.4 of the RecourseOS Attestation Protocol.
 * Uses Node.js crypto module for Ed25519 operations.
 */

import { createHash, generateKeyPairSync, sign, verify, KeyObject } from 'crypto';
import { canonicalize } from './canonicalize.js';
import { KeyMetadata, canSign, canVerify } from './key-management.js';

/**
 * Error thrown when signing or verification fails
 */
export class AttestationSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationSigningError';
  }
}

/**
 * Base64url encode (RFC 4648 Section 5, no padding)
 */
export function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/**
 * Base64url decode (RFC 4648 Section 5)
 */
export function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

/**
 * Attestation content fields (signed payload excludes signature and attestation_uri for ID derivation)
 */
export interface AttestationContent {
  input: unknown;
  output: unknown;
  evaluator: string;
  timestamp: string;
  key_id: string;
}

/**
 * Full attestation structure
 */
export interface Attestation extends AttestationContent {
  attestation_uri: string;
  signature: string;
}

/**
 * Generate an Ed25519 keypair
 *
 * @returns Object containing private and public key in various formats
 */
export function generateKeyPair(): {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyBase64url: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' });
  // Ed25519 public key in SPKI format has a 12-byte header, raw key is last 32 bytes
  const rawPublicKey = publicKeyRaw.slice(-32);

  return {
    privateKey,
    publicKey,
    publicKeyBase64url: base64urlEncode(rawPublicKey),
  };
}

/**
 * Derive attestation ID from content fields per §6.3
 *
 * The attestation_id is derived from: input, output, evaluator, timestamp, key_id
 * Excludes: signature, attestation_uri (to avoid circularity)
 *
 * @param content - The attestation content fields
 * @returns 32-character lowercase hex string
 */
export function deriveAttestationId(content: AttestationContent): string {
  // Construct object with exactly these fields
  const idPayload = {
    input: content.input,
    output: content.output,
    evaluator: content.evaluator,
    timestamp: content.timestamp,
    key_id: content.key_id,
  };

  // Canonicalize per RFC 8785
  const canonical = canonicalize(idPayload);

  // SHA-256 hash
  const hash = createHash('sha256').update(canonical).digest();

  // First 16 bytes as lowercase hex (32 characters)
  return hash.slice(0, 16).toString('hex');
}

/**
 * Construct attestation URI from instance base URL and attestation ID
 */
export function constructAttestationUri(
  instanceBaseUrl: string,
  attestationId: string
): string {
  // Remove trailing slash if present
  const baseUrl = instanceBaseUrl.replace(/\/$/, '');
  return `${baseUrl}/.well-known/attestations/${attestationId}.json`;
}

/**
 * Construct the signed payload from an attestation (all fields except signature)
 *
 * Per §4.1: The signed payload consists of all attestation fields except signature.
 * The attestation_uri IS included in the signed payload.
 */
export function constructSignedPayload(
  attestation: Omit<Attestation, 'signature'>
): string {
  return canonicalize(attestation);
}

/**
 * Sign an attestation per §4.3
 *
 * @param content - The attestation content fields
 * @param privateKey - The Ed25519 private key
 * @param keyMetadata - Metadata about the signing key (must be active)
 * @param instanceBaseUrl - Base URL for constructing attestation_uri
 * @returns Complete signed attestation
 */
export function signAttestation(
  content: AttestationContent,
  privateKey: KeyObject,
  keyMetadata: KeyMetadata,
  instanceBaseUrl: string
): Attestation {
  // Verify key is in active state (§4.3, §5.2)
  if (!canSign(keyMetadata)) {
    throw new AttestationSigningError(
      `Key "${keyMetadata.key_id}" is in state "${keyMetadata.state}" and cannot sign. ` +
        'Only keys in "active" state may sign new attestations.'
    );
  }

  // Verify key_id matches
  if (content.key_id !== keyMetadata.key_id) {
    throw new AttestationSigningError(
      `Content key_id "${content.key_id}" does not match key metadata "${keyMetadata.key_id}"`
    );
  }

  // Step 1-2: Derive attestation_id from content fields
  const attestationId = deriveAttestationId(content);

  // Step 3: Construct attestation_uri
  const attestationUri = constructAttestationUri(instanceBaseUrl, attestationId);

  // Step 4: Build attestation without signature
  const unsignedAttestation: Omit<Attestation, 'signature'> = {
    ...content,
    attestation_uri: attestationUri,
  };

  // Step 5: Construct signed payload (canonicalized)
  const signedPayload = constructSignedPayload(unsignedAttestation);

  // Step 6: Sign with Ed25519
  const signatureBuffer = sign(null, Buffer.from(signedPayload), privateKey);

  // Step 7: Encode as base64url
  const signature = base64urlEncode(signatureBuffer);

  return {
    ...unsignedAttestation,
    signature,
  };
}

/**
 * Verification result
 */
export type VerificationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Verify an attestation signature per §4.4
 *
 * @param attestation - The attestation to verify
 * @param publicKeyBase64url - The base64url-encoded public key
 * @param keyMetadata - Metadata about the key (must be verifiable state)
 * @returns Verification result
 */
export function verifyAttestation(
  attestation: Attestation,
  publicKeyBase64url: string,
  keyMetadata: KeyMetadata
): VerificationResult {
  // Step 4: Check key state (§4.4)
  if (!canVerify(keyMetadata)) {
    return {
      valid: false,
      reason: `Key "${keyMetadata.key_id}" is in state "${keyMetadata.state}" and cannot be used for verification. ` +
        'Keys in "pending" or "compromised" state fail verification.',
    };
  }

  // Verify key_id matches
  if (attestation.key_id !== keyMetadata.key_id) {
    return {
      valid: false,
      reason: `Attestation key_id "${attestation.key_id}" does not match provided key "${keyMetadata.key_id}"`,
    };
  }

  try {
    // Step 1: Extract and decode signature
    const signatureBuffer = base64urlDecode(attestation.signature);

    // Step 2: Construct signed payload (remove signature, canonicalize)
    const { signature: _, ...unsignedAttestation } = attestation;
    const signedPayload = constructSignedPayload(unsignedAttestation);

    // Step 3: Decode public key
    // Node.js requires SPKI format for Ed25519 public keys
    // Raw Ed25519 public key is 32 bytes, we need to wrap it in SPKI
    const rawPublicKey = base64urlDecode(publicKeyBase64url);
    if (rawPublicKey.length !== 32) {
      return {
        valid: false,
        reason: `Invalid public key length: expected 32 bytes, got ${rawPublicKey.length}`,
      };
    }

    // SPKI header for Ed25519 (12 bytes)
    const spkiHeader = Buffer.from([
      0x30, 0x2a, // SEQUENCE, 42 bytes
      0x30, 0x05, // SEQUENCE, 5 bytes (AlgorithmIdentifier)
      0x06, 0x03, // OID, 3 bytes
      0x2b, 0x65, 0x70, // 1.3.101.112 (Ed25519)
      0x03, 0x21, // BIT STRING, 33 bytes
      0x00, // unused bits = 0
    ]);
    const spkiPublicKey = Buffer.concat([spkiHeader, rawPublicKey]);

    // Step 5: Verify Ed25519 signature
    const isValid = verify(
      null,
      Buffer.from(signedPayload),
      { key: spkiPublicKey, format: 'der', type: 'spki' },
      signatureBuffer
    );

    if (!isValid) {
      return {
        valid: false,
        reason: 'Ed25519 signature verification failed',
      };
    }

    // Step 6: Verification succeeded
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Verify attestation ID matches content
 *
 * Use this to check that an attestation_uri corresponds to the actual content.
 */
export function verifyAttestationId(attestation: Attestation): boolean {
  const derivedId = deriveAttestationId(attestation);
  // Extract ID from attestation_uri
  const match = attestation.attestation_uri.match(/\/([a-f0-9]{32})\.json$/);
  if (!match) {
    return false;
  }
  return match[1] === derivedId;
}

/**
 * Create a complete attestation (convenience function)
 *
 * This combines content creation, ID derivation, URI construction, and signing.
 */
export function createAttestation(
  input: unknown,
  output: unknown,
  evaluator: string,
  privateKey: KeyObject,
  keyMetadata: KeyMetadata,
  instanceBaseUrl: string
): Attestation {
  const content: AttestationContent = {
    input,
    output,
    evaluator,
    timestamp: new Date().toISOString(),
    key_id: keyMetadata.key_id,
  };

  return signAttestation(content, privateKey, keyMetadata, instanceBaseUrl);
}
