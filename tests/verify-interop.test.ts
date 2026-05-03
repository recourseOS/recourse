/**
 * Cross-Implementation Interoperability Tests
 *
 * Verifies that attestations created by RecourseOS can be verified
 * by the standalone verification library, and vice versa.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// RecourseOS attestation service (issuer)
import {
  AttestationService,
  resetAttestationService,
  canonicalize as issuerCanonicalize,
} from '../src/attestation/index';

// Standalone verification library (verifier)
import {
  verifyAttestation,
  canonicalize as verifierCanonicalize,
  clearRegistryCache,
  type Attestation,
  type KeyRegistry,
} from '../src/verify/index';

describe('Cross-implementation interoperability', () => {
  let tempDir: string;
  let service: AttestationService;
  let instanceBaseUrl: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'recourse-interop-'));
    instanceBaseUrl = 'http://localhost:3099';

    resetAttestationService();
    clearRegistryCache();

    service = new AttestationService({
      configDir: tempDir,
      instanceId: 'interop-test',
      instanceBaseUrl,
      evaluatorVersion: '1.0.0-interop',
    });
    await service.initialize();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    resetAttestationService();
    clearRegistryCache();
  });

  describe('canonicalization consistency', () => {
    it('issuer and verifier produce identical canonical output for objects', () => {
      const input = { z: 1, a: 2, m: { b: 3, a: 4 } };

      const issuerCanonical = issuerCanonicalize(input);
      const verifierCanonical = verifierCanonicalize(input);

      expect(issuerCanonical).toBe(verifierCanonical);
    });

    it('issuer and verifier produce identical canonical output for arrays', () => {
      const input = [{ z: 1, a: 2 }, null, true, 'test', 123];

      const issuerCanonical = issuerCanonicalize(input);
      const verifierCanonical = verifierCanonicalize(input);

      expect(issuerCanonical).toBe(verifierCanonical);
    });

    it('issuer and verifier produce identical canonical output for attestation', () => {
      const attestation = service.createAttestation(
        { source: 'shell', command: 'rm -rf /data' },
        { decision: 'block', tier: 4 }
      );

      // Remove signature for canonical comparison (signed payload)
      const { signature: _, ...unsigned } = attestation;

      const issuerCanonical = issuerCanonicalize(unsigned);
      const verifierCanonical = verifierCanonicalize(unsigned);

      expect(issuerCanonical).toBe(verifierCanonical);
    });
  });

  // Create mock fetch that returns the service's registry and attestations
  function createServiceMockFetch(): typeof fetch {
    return async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();

      // Key registry endpoint
      if (url.includes('/.well-known/recourse-keys.json')) {
        const registry = service.getKeyRegistry();
        return new Response(JSON.stringify(registry), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Attestation retrieval endpoint
      const attestMatch = url.match(/\/\.well-known\/attestations\/([a-f0-9]{32})\.json$/);
      if (attestMatch) {
        const id = attestMatch[1];
        const attestation = service.getAttestation(id);
        if (attestation) {
          return new Response(JSON.stringify(attestation), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    };
  }

  describe('end-to-end verification', () => {
    it('attestation created by RecourseOS verifies with standalone library', async () => {
      // Issue attestation using RecourseOS service
      const attestation = service.createAttestation(
        { source: 'shell', command: 'rm -rf /production' },
        { decision: 'block', tier: 4, reasoning: 'Destructive command' }
      );

      // Verify using standalone library
      const result = await verifyAttestation(attestation, {
        fetch: createServiceMockFetch(),
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.keyId).toBe('interop-test-1');
        expect(result.keyState).toBe('active');
      }
    });

    it('tampered attestation fails verification in both implementations', async () => {
      const attestation = service.createAttestation(
        { source: 'shell', command: 'safe-command' },
        { decision: 'allow', tier: 1 }
      );

      // Tamper with output
      const tampered = {
        ...attestation,
        output: { decision: 'block', tier: 4 },
      };

      // RecourseOS service rejects it
      const serviceResult = service.verifyAttestation(tampered);
      expect(serviceResult.valid).toBe(false);

      // Standalone library also rejects it
      const libraryResult = await verifyAttestation(tampered, {
        fetch: createServiceMockFetch(),
      });
      expect(libraryResult.valid).toBe(false);
      if (!libraryResult.valid) {
        expect(libraryResult.reason).toBe('signature_invalid');
      }
    });

    it('attestation passes cross-check between embedded and URL copy', async () => {
      const attestation = service.createAttestation(
        { source: 'mcp', tool: 'aws_s3_delete_bucket', args: { bucket: 'prod-data' } },
        { decision: 'escalate', tier: 3 }
      );

      // Verify with cross-check enabled
      const result = await verifyAttestation(attestation, {
        fetch: createServiceMockFetch(),
        crossCheck: true,
      });

      expect(result.valid).toBe(true);
    });

    it('attestation from deprecated key still verifies', async () => {
      // Create attestation while key is active
      const attestation = service.createAttestation(
        { source: 'shell', command: 'echo test' },
        { decision: 'allow' }
      );

      // Simulate key deprecation by modifying the registry response
      const deprecatedFetch: typeof fetch = async (input) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/.well-known/recourse-keys.json')) {
          const registry = service.getKeyRegistry();
          // Mark key as deprecated
          registry.keys[0].state = 'deprecated';
          return new Response(JSON.stringify(registry), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return createServiceMockFetch()(input);
      };

      const result = await verifyAttestation(attestation, {
        fetch: deprecatedFetch,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.keyState).toBe('deprecated');
      }
    });

    it('attestation from compromised key fails verification', async () => {
      const attestation = service.createAttestation(
        { source: 'shell', command: 'echo test' },
        { decision: 'allow' }
      );

      // Simulate key compromise
      const compromisedFetch: typeof fetch = async (input) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/.well-known/recourse-keys.json')) {
          const registry = service.getKeyRegistry();
          registry.keys[0].state = 'compromised';
          return new Response(JSON.stringify(registry), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return createServiceMockFetch()(input);
      };

      const result = await verifyAttestation(attestation, {
        fetch: compromisedFetch,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('key_compromised');
      }
    });
  });

  describe('key registry compatibility', () => {
    it('service registry has all required fields for verification', () => {
      const registry = service.getKeyRegistry();

      expect(registry.instance_id).toBe('interop-test');
      expect(registry.keys).toHaveLength(1);

      const key = registry.keys[0];
      expect(key.key_id).toBe('interop-test-1');
      expect(key.algorithm).toBe('Ed25519');
      expect(key.public_key).toBeDefined();
      expect(key.state).toBe('active');
    });

    it('public key format is compatible with verification library', () => {
      const registry = service.getKeyRegistry();
      const publicKey = registry.keys[0].public_key;

      // Should be base64url encoded, 32 bytes when decoded
      const decoded = Buffer.from(publicKey, 'base64url');
      expect(decoded.length).toBe(32);
    });
  });

  describe('multiple attestations', () => {
    it('batch verification works for attestations from same issuer', async () => {
      const attestations = [
        service.createAttestation({ cmd: 'test1' }, { result: 'ok' }),
        service.createAttestation({ cmd: 'test2' }, { result: 'ok' }),
        service.createAttestation({ cmd: 'test3' }, { result: 'ok' }),
      ];

      // Import batch verification
      const { verifyAttestations } = await import('../src/verify/index');

      const results = await verifyAttestations(attestations, {
        fetch: createServiceMockFetch(),
      });

      expect(results).toHaveLength(3);
      expect(results.every(r => r.valid)).toBe(true);
    });
  });
});
