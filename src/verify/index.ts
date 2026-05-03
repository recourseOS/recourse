/**
 * RecourseOS Attestation Verification Library
 *
 * Standalone library for verifying attestations without RecourseOS dependency.
 * Implements verification procedure from §7.4 of the attestation protocol.
 *
 * @example
 * ```typescript
 * import { verifyAttestation } from 'recourse-verify';
 *
 * const result = await verifyAttestation(attestation, {
 *   trustedInstances: ['https://recourse.example'],
 * });
 *
 * if (result.valid) {
 *   console.log('Attestation verified');
 * } else {
 *   console.log('Verification failed:', result.reason);
 * }
 * ```
 *
 * @module verify
 */

import { createHash, verify } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Attestation structure as defined in the protocol
 */
export interface Attestation {
  input: unknown;
  output: unknown;
  evaluator: string;
  timestamp: string;
  key_id: string;
  attestation_uri: string;
  signature: string;
}

/**
 * Key entry in the registry
 */
export interface KeyEntry {
  key_id: string;
  algorithm: string;
  public_key: string;
  state: 'pending' | 'active' | 'deprecated' | 'retired' | 'compromised';
  valid_from?: string;
  valid_until?: string | null;
  deprecated_at?: string;
}

/**
 * Key registry structure
 */
export interface KeyRegistry {
  instance_id: string;
  keys: KeyEntry[];
  registry_version: number;
  updated_at: string;
}

/**
 * Verification options
 */
export interface VerifyOptions {
  /**
   * List of trusted instance base URLs. If non-empty, only attestations
   * from these instances will be accepted. Empty means accept any.
   */
  trustedInstances?: string[];

  /**
   * Cache TTL in milliseconds. Default: 86400000 (24 hours)
   */
  keyCacheTtlMs?: number;

  /**
   * Perform cross-check by fetching attestation from URI. Default: false
   */
  crossCheck?: boolean;

  /**
   * Custom fetch function for testing or environments without global fetch
   */
  fetch?: typeof fetch;
}

/**
 * Verification result
 */
export type VerifyResult =
  | { valid: true; keyId: string; keyState: string; timestamp: string }
  | { valid: false; reason: VerifyFailureReason; details?: string };

/**
 * Verification failure reasons per §7.6
 */
export type VerifyFailureReason =
  | 'attestation_absent'
  | 'instance_not_trusted'
  | 'signature_invalid'
  | 'key_not_found'
  | 'key_compromised'
  | 'key_pending'
  | 'cross_check_mismatch'
  | 'network_error'
  | 'registry_rollback'
  | 'invalid_attestation';

// ============================================================================
// Registry Cache (with rollback protection per §5.5)
// ============================================================================

interface CacheEntry {
  registry: KeyRegistry;
  fetchedAt: number;
}

const registryCache = new Map<string, CacheEntry>();

/**
 * Clear the registry cache. Useful for testing.
 */
export function clearRegistryCache(): void {
  registryCache.clear();
}

/**
 * Fetch key registry with caching and rollback protection
 */
async function fetchRegistry(
  instanceBaseUrl: string,
  options: VerifyOptions
): Promise<{ ok: true; registry: KeyRegistry } | { ok: false; reason: VerifyFailureReason; details?: string }> {
  const fetchFn = options.fetch ?? fetch;
  const ttl = options.keyCacheTtlMs ?? 86400000; // 24 hours

  const cached = registryCache.get(instanceBaseUrl);
  const now = Date.now();

  // Return cached if within TTL
  if (cached && now - cached.fetchedAt < ttl) {
    return { ok: true, registry: cached.registry };
  }

  // Fetch fresh registry
  const url = `${instanceBaseUrl}/.well-known/recourse-keys.json`;
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    return {
      ok: false,
      reason: 'network_error',
      details: `Failed to fetch key registry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'network_error',
      details: `Key registry returned ${response.status}`,
    };
  }

  let registry: KeyRegistry;
  try {
    registry = await response.json() as KeyRegistry;
  } catch {
    return {
      ok: false,
      reason: 'network_error',
      details: 'Failed to parse key registry JSON',
    };
  }

  // Rollback protection per §5.5
  if (cached && registry.registry_version < cached.registry.registry_version) {
    return {
      ok: false,
      reason: 'registry_rollback',
      details: `Registry version ${registry.registry_version} < cached version ${cached.registry.registry_version}`,
    };
  }

  // Update cache
  registryCache.set(instanceBaseUrl, { registry, fetchedAt: now });

  return { ok: true, registry };
}

// ============================================================================
// RFC 8785 Canonicalization (self-contained implementation)
// ============================================================================

/**
 * Canonicalize a value per RFC 8785 (JSON Canonicalization Scheme)
 */
export function canonicalize(value: unknown): string {
  return serializeValue(value, new WeakSet());
}

function serializeValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      return serializeNumber(value);

    case 'string':
      return serializeString(value);

    case 'object':
      if (seen.has(value as object)) {
        throw new Error('Circular reference detected');
      }
      seen.add(value as object);

      if (Array.isArray(value)) {
        const items = value.map(item => serializeValue(item, seen));
        return '[' + items.join(',') + ']';
      }

      // Object
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort((a, b) => {
        // Sort by UTF-16 code units
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const diff = a.charCodeAt(i) - b.charCodeAt(i);
          if (diff !== 0) return diff;
        }
        return a.length - b.length;
      });

      const pairs = keys.map(key => {
        const val = obj[key];
        if (val === undefined) return null;
        return serializeString(key) + ':' + serializeValue(val, seen);
      }).filter(Boolean);

      return '{' + pairs.join(',') + '}';

    default:
      throw new Error(`Cannot serialize ${typeof value}`);
  }
}

function serializeNumber(num: number): string {
  if (!Number.isFinite(num)) {
    throw new Error('Cannot serialize Infinity or NaN');
  }

  if (Object.is(num, -0)) {
    return '0';
  }

  // Use JavaScript's default number formatting, which matches RFC 8785
  const str = String(num);

  // Ensure no unnecessary positive exponent sign
  return str.replace('e+', 'e');
}

function serializeString(str: string): string {
  let result = '"';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);

    if (code < 0x20) {
      // Control characters must be escaped
      switch (char) {
        case '\b': result += '\\b'; break;
        case '\f': result += '\\f'; break;
        case '\n': result += '\\n'; break;
        case '\r': result += '\\r'; break;
        case '\t': result += '\\t'; break;
        default:
          result += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else if (char === '"') {
      result += '\\"';
    } else if (char === '\\') {
      result += '\\\\';
    } else {
      result += char;
    }
  }
  result += '"';
  return result;
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify Ed25519 signature
 */
function verifySignature(
  payload: string,
  signatureBase64url: string,
  publicKeyBase64url: string
): boolean {
  try {
    const signatureBuffer = Buffer.from(signatureBase64url, 'base64url');
    const publicKeyRaw = Buffer.from(publicKeyBase64url, 'base64url');

    if (publicKeyRaw.length !== 32) {
      return false;
    }

    // SPKI header for Ed25519 (12 bytes)
    const spkiHeader = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]);
    const spkiKey = Buffer.concat([spkiHeader, publicKeyRaw]);

    return verify(
      null,
      Buffer.from(payload),
      { key: spkiKey, format: 'der', type: 'spki' },
      signatureBuffer
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Main Verification Function
// ============================================================================

/**
 * Extract instance base URL from attestation URI
 */
function extractInstanceBaseUrl(attestationUri: string): string | null {
  try {
    const url = new URL(attestationUri);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Check if instance is trusted
 */
/**
 * Normalize a base URL for comparison
 * - Removes trailing slash
 * - Removes default ports (:443 for https, :80 for http)
 * - Lowercases scheme and host
 */
function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove default ports
    if (parsed.protocol === 'https:' && parsed.port === '443') {
      parsed.port = '';
    }
    if (parsed.protocol === 'http:' && parsed.port === '80') {
      parsed.port = '';
    }
    // Return normalized: scheme://host (no trailing slash, no path)
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    // Fallback: basic normalization
    return url.replace(/\/$/, '').toLowerCase();
  }
}

function isInstanceTrusted(instanceBaseUrl: string, trustedInstances: string[]): boolean {
  if (trustedInstances.length === 0) {
    return true; // Empty list means accept any
  }
  const normalizedInstance = normalizeBaseUrl(instanceBaseUrl);
  return trustedInstances.some(trusted => {
    const normalizedTrusted = normalizeBaseUrl(trusted);
    return normalizedInstance === normalizedTrusted;
  });
}

/**
 * Verify an attestation
 *
 * Implements the verification procedure from §7.4 of the attestation protocol.
 *
 * @param attestation - The attestation to verify
 * @param options - Verification options
 * @returns Verification result
 */
export async function verifyAttestation(
  attestation: Attestation,
  options: VerifyOptions = {}
): Promise<VerifyResult> {
  // Validate attestation structure
  if (
    !attestation ||
    typeof attestation.key_id !== 'string' ||
    typeof attestation.attestation_uri !== 'string' ||
    typeof attestation.signature !== 'string' ||
    typeof attestation.timestamp !== 'string' ||
    typeof attestation.evaluator !== 'string'
  ) {
    return { valid: false, reason: 'invalid_attestation', details: 'Missing required fields' };
  }

  // Step 2: Check trusted instance
  const instanceBaseUrl = extractInstanceBaseUrl(attestation.attestation_uri);
  if (!instanceBaseUrl) {
    return { valid: false, reason: 'invalid_attestation', details: 'Invalid attestation_uri' };
  }

  const trustedInstances = options.trustedInstances ?? [];
  if (!isInstanceTrusted(instanceBaseUrl, trustedInstances)) {
    return {
      valid: false,
      reason: 'instance_not_trusted',
      details: `Instance ${instanceBaseUrl} not in trusted list`,
    };
  }

  // Step 3: Fetch key registry
  const registryResult = await fetchRegistry(instanceBaseUrl, options);
  if (!registryResult.ok) {
    return { valid: false, reason: registryResult.reason, details: registryResult.details };
  }

  const registry = registryResult.registry;

  // Step 4: Locate public key
  const keyEntry = registry.keys.find(k => k.key_id === attestation.key_id);
  if (!keyEntry) {
    return {
      valid: false,
      reason: 'key_not_found',
      details: `Key ${attestation.key_id} not found in registry`,
    };
  }

  // Step 5: Check key state
  if (keyEntry.state === 'pending') {
    return { valid: false, reason: 'key_pending', details: `Key ${attestation.key_id} is pending` };
  }
  if (keyEntry.state === 'compromised') {
    return { valid: false, reason: 'key_compromised', details: `Key ${attestation.key_id} is compromised` };
  }

  // Step 6: Construct signed payload
  const { signature, ...unsigned } = attestation;
  const canonicalPayload = canonicalize(unsigned);

  // Step 7: Verify signature
  const isValid = verifySignature(canonicalPayload, signature, keyEntry.public_key);
  if (!isValid) {
    return { valid: false, reason: 'signature_invalid' };
  }

  // Optional: Cross-check
  if (options.crossCheck) {
    const fetchFn = options.fetch ?? fetch;
    try {
      const response = await fetchFn(attestation.attestation_uri);
      if (!response.ok) {
        return {
          valid: false,
          reason: 'cross_check_mismatch',
          details: `Attestation URI returned ${response.status}`,
        };
      }

      const fetched = await response.json();
      const fetchedCanonical = canonicalize(fetched);
      const embeddedCanonical = canonicalize(attestation);

      if (fetchedCanonical !== embeddedCanonical) {
        return { valid: false, reason: 'cross_check_mismatch' };
      }
    } catch (err) {
      return {
        valid: false,
        reason: 'network_error',
        details: `Cross-check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Step 8: Accept
  return {
    valid: true,
    keyId: keyEntry.key_id,
    keyState: keyEntry.state,
    timestamp: attestation.timestamp,
  };
}

/**
 * Verify multiple attestations
 *
 * Useful for batch verification. Pre-fetches all registries to ensure
 * consistency: all attestations are verified against the same registry
 * snapshot, preventing race conditions during registry rotation.
 *
 * @param attestations - Array of attestations to verify
 * @param options - Verification options
 * @returns Array of verification results
 */
export async function verifyAttestations(
  attestations: Attestation[],
  options: VerifyOptions = {}
): Promise<VerifyResult[]> {
  // Step 1: Extract unique instance URLs
  const instanceUrls = new Set<string>();
  for (const attestation of attestations) {
    const url = extractInstanceBaseUrl(attestation.attestation_uri);
    if (url) {
      instanceUrls.add(url);
    }
  }

  // Step 2: Pre-fetch all registries (populates cache with consistent snapshot)
  await Promise.all(
    Array.from(instanceUrls).map(url => fetchRegistry(url, options))
  );

  // Step 3: Verify all attestations (using cached registries)
  return Promise.all(attestations.map(a => verifyAttestation(a, options)));
}
