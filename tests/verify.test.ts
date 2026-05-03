/**
 * Standalone Verification Library Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sign, generateKeyPairSync } from 'crypto';
import {
  verifyAttestation,
  verifyAttestations,
  clearRegistryCache,
  canonicalize,
  type Attestation,
  type KeyRegistry,
  type VerifyOptions,
} from '../src/verify/index';

// Generate a test keypair
function generateTestKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  return {
    privateKey,
    publicKeyBase64url: Buffer.from(publicKeyRaw).toString('base64url'),
  };
}

// Create a signed attestation
function createTestAttestation(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  keyId: string,
  instanceBaseUrl: string,
  overrides: Partial<Attestation> = {}
): Attestation {
  const attestationId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const base: Omit<Attestation, 'signature'> = {
    input: { source: 'shell', command: 'test' },
    output: { decision: 'allow' },
    evaluator: 'recourse:blast-radius:1.0.0',
    timestamp: new Date().toISOString(),
    key_id: keyId,
    attestation_uri: `${instanceBaseUrl}/.well-known/attestations/${attestationId}.json`,
    ...overrides,
  };

  // Remove signature if present in overrides (we'll compute it)
  const { signature: _, ...unsigned } = base as Attestation;

  const payload = canonicalize(unsigned);
  const signatureBuffer = sign(null, Buffer.from(payload), privateKey);

  return {
    ...unsigned,
    signature: signatureBuffer.toString('base64url'),
  };
}

// Create mock fetch that returns registry and attestations
function createMockFetch(
  registry: KeyRegistry,
  attestations: Map<string, Attestation> = new Map()
): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/.well-known/recourse-keys.json')) {
      return new Response(JSON.stringify(registry), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const attestMatch = url.match(/\/\.well-known\/attestations\/([a-f0-9]+)\.json$/);
    if (attestMatch) {
      const id = attestMatch[1];
      const attest = attestations.get(id);
      if (attest) {
        return new Response(JSON.stringify(attest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };
}

describe('verifyAttestation', () => {
  const instanceBaseUrl = 'https://recourse.example';
  let keypair: ReturnType<typeof generateTestKeypair>;
  let registry: KeyRegistry;
  let mockFetch: typeof fetch;

  beforeEach(() => {
    clearRegistryCache();
    keypair = generateTestKeypair();
    registry = {
      instance_id: 'test-instance',
      keys: [
        {
          key_id: 'test-key-1',
          algorithm: 'Ed25519',
          public_key: keypair.publicKeyBase64url,
          state: 'active',
          valid_from: '2026-01-01T00:00:00Z',
        },
      ],
      registry_version: 1,
      updated_at: new Date().toISOString(),
    };
    mockFetch = createMockFetch(registry);
  });

  afterEach(() => {
    clearRegistryCache();
  });

  describe('valid attestations', () => {
    it('verifies a valid attestation', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.keyId).toBe('test-key-1');
        expect(result.keyState).toBe('active');
      }
    });

    it('verifies attestation with deprecated key', async () => {
      registry.keys[0].state = 'deprecated';
      mockFetch = createMockFetch(registry);

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.keyState).toBe('deprecated');
      }
    });

    it('verifies attestation with retired key', async () => {
      registry.keys[0].state = 'retired';
      mockFetch = createMockFetch(registry);

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.keyState).toBe('retired');
      }
    });
  });

  describe('invalid signatures', () => {
    it('rejects tampered attestation', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      // Tamper with output
      (attestation.output as Record<string, unknown>).riskAssessment = 'block';

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('signature_invalid');
      }
    });

    it('rejects garbage signature', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      attestation.signature = 'not-a-valid-signature';

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('signature_invalid');
      }
    });

    it('rejects empty signature', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      attestation.signature = '';

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('signature_invalid');
      }
    });

    it('rejects signature from different key', async () => {
      const otherKeypair = generateTestKeypair();
      const attestation = createTestAttestation(otherKeypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('signature_invalid');
      }
    });
  });

  describe('key state checks', () => {
    it('rejects pending key', async () => {
      registry.keys[0].state = 'pending';
      mockFetch = createMockFetch(registry);

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('key_pending');
      }
    });

    it('rejects compromised key', async () => {
      registry.keys[0].state = 'compromised';
      mockFetch = createMockFetch(registry);

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('key_compromised');
      }
    });

    it('rejects unknown key_id', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'unknown-key', instanceBaseUrl);

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('key_not_found');
      }
    });
  });

  describe('trusted instances', () => {
    it('accepts attestation from trusted instance', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: ['https://recourse.example'],
      });

      expect(result.valid).toBe(true);
    });

    it('rejects attestation from untrusted instance', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: ['https://other.example'],
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('instance_not_trusted');
      }
    });

    it('accepts any instance when trustedInstances is empty', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: [],
      });

      expect(result.valid).toBe(true);
    });

    it('normalizes trailing slashes in trusted instances', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: ['https://recourse.example/'],
      });

      expect(result.valid).toBe(true);
    });

    it('normalizes default ports in trusted instances', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      // https default port :443 should match without port
      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: ['https://recourse.example:443'],
      });

      expect(result.valid).toBe(true);
    });

    it('is case-insensitive for trusted instance matching', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      const result = await verifyAttestation(attestation, {
        fetch: mockFetch,
        trustedInstances: ['HTTPS://RECOURSE.EXAMPLE'],
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('registry caching', () => {
    it('caches registry between calls', async () => {
      let fetchCount = 0;
      const countingFetch: typeof fetch = async (input) => {
        fetchCount++;
        return mockFetch(input);
      };

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      await verifyAttestation(attestation, { fetch: countingFetch });
      await verifyAttestation(attestation, { fetch: countingFetch });
      await verifyAttestation(attestation, { fetch: countingFetch });

      // Should only fetch once (cached)
      expect(fetchCount).toBe(1);
    });

    it('refreshes cache after TTL', async () => {
      let fetchCount = 0;
      const countingFetch: typeof fetch = async (input) => {
        fetchCount++;
        return mockFetch(input);
      };

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      // Use 0ms TTL to force refresh
      await verifyAttestation(attestation, { fetch: countingFetch, keyCacheTtlMs: 0 });
      await verifyAttestation(attestation, { fetch: countingFetch, keyCacheTtlMs: 0 });

      // Should fetch twice (cache expired immediately)
      expect(fetchCount).toBe(2);
    });
  });

  describe('rollback protection', () => {
    it('rejects registry with lower version', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      // First call populates cache with version 1
      registry.registry_version = 5;
      mockFetch = createMockFetch(registry);
      await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      // Second call with lower version should fail
      registry.registry_version = 3;
      mockFetch = createMockFetch(registry);
      const result = await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('registry_rollback');
      }
    });

    it('accepts registry with same version', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      registry.registry_version = 5;
      mockFetch = createMockFetch(registry);
      await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      // Same version should be accepted
      const result = await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      expect(result.valid).toBe(true);
    });

    it('accepts registry with higher version', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);

      registry.registry_version = 5;
      mockFetch = createMockFetch(registry);
      await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      // Higher version should be accepted
      registry.registry_version = 7;
      mockFetch = createMockFetch(registry);
      const result = await verifyAttestation(attestation, { fetch: mockFetch, keyCacheTtlMs: 0 });

      expect(result.valid).toBe(true);
    });
  });

  describe('cross-check', () => {
    it('passes cross-check when attestations match', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const attestations = new Map([['a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', attestation]]);
      mockFetch = createMockFetch(registry, attestations);

      const result = await verifyAttestation(attestation, { fetch: mockFetch, crossCheck: true });

      expect(result.valid).toBe(true);
    });

    it('fails cross-check when attestations differ', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const tampered = { ...attestation, timestamp: '2099-01-01T00:00:00Z' };
      const attestations = new Map([['a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', tampered]]);
      mockFetch = createMockFetch(registry, attestations);

      const result = await verifyAttestation(attestation, { fetch: mockFetch, crossCheck: true });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('cross_check_mismatch');
      }
    });

    it('fails cross-check when attestation URL returns 404', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      // No attestations in map = 404
      mockFetch = createMockFetch(registry);

      const result = await verifyAttestation(attestation, { fetch: mockFetch, crossCheck: true });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('cross_check_mismatch');
      }
    });
  });

  describe('network errors', () => {
    it('handles registry fetch failure', async () => {
      const failingFetch: typeof fetch = async () => {
        throw new Error('Network error');
      };

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: failingFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('network_error');
      }
    });

    it('handles registry 500 response', async () => {
      const errorFetch: typeof fetch = async () => {
        return new Response('Internal Server Error', { status: 500 });
      };

      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      const result = await verifyAttestation(attestation, { fetch: errorFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('network_error');
      }
    });
  });

  describe('invalid attestation structure', () => {
    it('rejects missing key_id', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      delete (attestation as Record<string, unknown>).key_id;

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_attestation');
      }
    });

    it('rejects invalid attestation_uri', async () => {
      const attestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
      attestation.attestation_uri = 'not-a-valid-url';

      const result = await verifyAttestation(attestation, { fetch: mockFetch });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_attestation');
      }
    });
  });
});

describe('verifyAttestations', () => {
  let keypair: ReturnType<typeof generateTestKeypair>;
  let registry: KeyRegistry;
  let mockFetch: typeof fetch;
  const instanceBaseUrl = 'https://recourse.example';

  beforeEach(() => {
    clearRegistryCache();
    keypair = generateTestKeypair();
    registry = {
      instance_id: 'test-instance',
      keys: [
        {
          key_id: 'test-key-1',
          algorithm: 'Ed25519',
          public_key: keypair.publicKeyBase64url,
          state: 'active',
          valid_from: '2026-01-01T00:00:00Z',
        },
      ],
      registry_version: 1,
      updated_at: new Date().toISOString(),
    };
    mockFetch = createMockFetch(registry);
  });

  afterEach(() => {
    clearRegistryCache();
  });

  it('verifies multiple attestations', async () => {
    const attestations = [
      createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl, { timestamp: '2026-01-01T00:00:00Z' }),
      createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl, { timestamp: '2026-01-02T00:00:00Z' }),
      createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl, { timestamp: '2026-01-03T00:00:00Z' }),
    ];

    const results = await verifyAttestations(attestations, { fetch: mockFetch });

    expect(results).toHaveLength(3);
    expect(results.every(r => r.valid)).toBe(true);
  });

  it('returns mixed results for mixed validity', async () => {
    const validAttestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
    const invalidAttestation = createTestAttestation(keypair.privateKey, 'test-key-1', instanceBaseUrl);
    invalidAttestation.signature = 'invalid';

    const results = await verifyAttestations([validAttestation, invalidAttestation], { fetch: mockFetch });

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });
});

describe('canonicalize', () => {
  it('sorts object keys', () => {
    const result = canonicalize({ b: 1, a: 2 });
    expect(result).toBe('{"a":2,"b":1}');
  });

  it('handles nested objects', () => {
    const result = canonicalize({ outer: { b: 1, a: 2 } });
    expect(result).toBe('{"outer":{"a":2,"b":1}}');
  });

  it('handles arrays', () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('handles null', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('handles booleans', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
  });

  it('handles negative zero', () => {
    expect(canonicalize(-0)).toBe('0');
  });

  it('escapes control characters', () => {
    expect(canonicalize('\n')).toBe('"\\n"');
    expect(canonicalize('\t')).toBe('"\\t"');
  });

  it('throws on circular reference', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => canonicalize(obj)).toThrow('Circular reference');
  });
});
