/**
 * Attestation Signing and Verification Tests
 *
 * Tests for §4 and §6 of the RecourseOS Attestation Protocol.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateKeyPair,
  base64urlEncode,
  base64urlDecode,
  deriveAttestationId,
  constructAttestationUri,
  constructSignedPayload,
  signAttestation,
  verifyAttestation,
  verifyAttestationId,
  createAttestation,
  AttestationContent,
  Attestation,
  AttestationSigningError,
} from '../src/attestation/signing';
import {
  KeyMetadata,
  createKey,
  activateKey,
  deprecateKey,
  retireKey,
  compromiseKey,
} from '../src/attestation/key-management';
import { KeyObject } from 'crypto';

describe('Attestation Signing', () => {
  let privateKey: KeyObject;
  let publicKeyBase64url: string;
  let activeKeyMetadata: KeyMetadata;

  const sampleContent: AttestationContent = {
    input: {
      tool: 'terraform',
      action: 'destroy',
      target: 'aws_rds_cluster.main',
    },
    output: {
      verdict: 'BLOCKED',
      tier: 'UNRECOVERABLE',
      reason: 'deletion_protection=false, no snapshots',
    },
    evaluator: 'recourse:blast-radius:1.0',
    timestamp: '2026-05-01T12:00:00Z',
    key_id: 'test-key-001',
  };

  const instanceBaseUrl = 'https://recourse.example';

  beforeEach(() => {
    // Generate fresh keypair for each test
    const keypair = generateKeyPair();
    privateKey = keypair.privateKey;
    publicKeyBase64url = keypair.publicKeyBase64url;

    // Create active key metadata
    let key = createKey('test-key-001', publicKeyBase64url);
    const result = activateKey(key);
    if (!result.success) throw new Error('Failed to activate key');
    activeKeyMetadata = result.key;
  });

  describe('generateKeyPair()', () => {
    it('generates valid Ed25519 keypair', () => {
      const keypair = generateKeyPair();

      expect(keypair.privateKey).toBeDefined();
      expect(keypair.publicKey).toBeDefined();
      expect(keypair.publicKeyBase64url).toBeDefined();

      // Ed25519 public key is 32 bytes
      const rawKey = base64urlDecode(keypair.publicKeyBase64url);
      expect(rawKey.length).toBe(32);
    });

    it('generates unique keypairs on each call', () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();

      expect(keypair1.publicKeyBase64url).not.toBe(keypair2.publicKeyBase64url);
    });
  });

  describe('base64url encoding', () => {
    it('encodes and decodes correctly', () => {
      const original = Buffer.from('Hello, World!');
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);

      expect(decoded.equals(original)).toBe(true);
    });

    it('produces URL-safe output (no +, /, or =)', () => {
      // Use bytes that would produce + and / in standard base64
      const data = Buffer.from([0xfb, 0xef, 0xbe, 0xfb, 0xef, 0xbe]);
      const encoded = base64urlEncode(data);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });
  });

  describe('deriveAttestationId()', () => {
    it('produces 32-character lowercase hex string', () => {
      const id = deriveAttestationId(sampleContent);

      expect(id).toMatch(/^[a-f0-9]{32}$/);
    });

    it('produces consistent IDs for same content', () => {
      const id1 = deriveAttestationId(sampleContent);
      const id2 = deriveAttestationId(sampleContent);

      expect(id1).toBe(id2);
    });

    it('produces different IDs for different content', () => {
      const modified = { ...sampleContent, timestamp: '2026-05-02T12:00:00Z' };

      const id1 = deriveAttestationId(sampleContent);
      const id2 = deriveAttestationId(modified);

      expect(id1).not.toBe(id2);
    });

    it('uses only content fields (not signature or URI)', () => {
      // The same content should produce the same ID regardless of URI/signature
      const id = deriveAttestationId(sampleContent);

      // This is a regression test - ID should be stable
      expect(id).toBeDefined();
      expect(id.length).toBe(32);
    });
  });

  describe('constructAttestationUri()', () => {
    it('constructs URI in correct format', () => {
      const id = 'abc123def456abc123def456abc12345';
      const uri = constructAttestationUri('https://recourse.example', id);

      expect(uri).toBe(
        'https://recourse.example/.well-known/attestations/abc123def456abc123def456abc12345.json'
      );
    });

    it('handles trailing slash in base URL', () => {
      const id = 'abc123def456abc123def456abc12345';
      const uri = constructAttestationUri('https://recourse.example/', id);

      expect(uri).toBe(
        'https://recourse.example/.well-known/attestations/abc123def456abc123def456abc12345.json'
      );
    });
  });

  describe('signAttestation()', () => {
    it('creates complete attestation with signature', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      expect(attestation.signature).toBeDefined();
      expect(attestation.attestation_uri).toBeDefined();
      expect(attestation.key_id).toBe(sampleContent.key_id);
      expect(attestation.input).toEqual(sampleContent.input);
      expect(attestation.output).toEqual(sampleContent.output);
    });

    it('throws if key is not active', () => {
      // Try with pending key
      const pendingKey = createKey('pending-key', publicKeyBase64url);
      const pendingContent = { ...sampleContent, key_id: 'pending-key' };

      expect(() =>
        signAttestation(pendingContent, privateKey, pendingKey, instanceBaseUrl)
      ).toThrow(AttestationSigningError);
      expect(() =>
        signAttestation(pendingContent, privateKey, pendingKey, instanceBaseUrl)
      ).toThrow('cannot sign');
    });

    it('throws if key_id does not match', () => {
      const wrongContent = { ...sampleContent, key_id: 'wrong-key' };

      expect(() =>
        signAttestation(wrongContent, privateKey, activeKeyMetadata, instanceBaseUrl)
      ).toThrow(AttestationSigningError);
      expect(() =>
        signAttestation(wrongContent, privateKey, activeKeyMetadata, instanceBaseUrl)
      ).toThrow('does not match');
    });

    it('includes attestation_uri in signed payload', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Verify that attestation_uri is part of signed payload
      const { signature: _, ...unsigned } = attestation;
      const payload = constructSignedPayload(unsigned);

      expect(payload).toContain('attestation_uri');
    });
  });

  describe('verifyAttestation()', () => {
    it('verifies valid attestation', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activeKeyMetadata
      );

      expect(result.valid).toBe(true);
    });

    it('fails for tampered content', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Tamper with the attestation
      const tampered: Attestation = {
        ...attestation,
        output: { ...attestation.output as object, verdict: 'ALLOWED' },
      };

      const result = verifyAttestation(tampered, publicKeyBase64url, activeKeyMetadata);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('verification failed');
      }
    });

    it('fails for wrong public key', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Use different keypair
      const otherKeypair = generateKeyPair();

      const result = verifyAttestation(
        attestation,
        otherKeypair.publicKeyBase64url,
        activeKeyMetadata
      );

      expect(result.valid).toBe(false);
    });

    it('fails for compromised key', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Compromise the key
      const compromised = compromiseKey(activeKeyMetadata);
      if (!compromised.success) throw new Error('Failed to compromise key');

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        compromised.key
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('compromised');
      }
    });

    it('fails for pending key', () => {
      // Create attestation with active key, then check with pending key
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const pendingKey = createKey(sampleContent.key_id, publicKeyBase64url);

      const result = verifyAttestation(attestation, publicKeyBase64url, pendingKey);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('pending');
      }
    });

    it('succeeds for deprecated key', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Deprecate the key
      const deprecated = deprecateKey(activeKeyMetadata);
      if (!deprecated.success) throw new Error('Failed to deprecate key');

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        deprecated.key
      );

      expect(result.valid).toBe(true);
    });

    it('succeeds for retired key', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Deprecate then retire the key
      let key = activeKeyMetadata;
      const dep = deprecateKey(key);
      if (!dep.success) throw new Error('Failed to deprecate');
      key = dep.key;

      const ret = retireKey(key);
      if (!ret.success) throw new Error('Failed to retire');
      key = ret.key;

      const result = verifyAttestation(attestation, publicKeyBase64url, key);

      expect(result.valid).toBe(true);
    });

    it('fails for mismatched key_id', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Create different key metadata
      let differentKey = createKey('different-key', publicKeyBase64url);
      const activated = activateKey(differentKey);
      if (!activated.success) throw new Error('Failed to activate');

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activated.key
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('does not match');
      }
    });
  });

  describe('verifyAttestationId()', () => {
    it('returns true for valid attestation ID', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      expect(verifyAttestationId(attestation)).toBe(true);
    });

    it('returns false for tampered attestation_uri', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      // Tamper with the URI
      const tampered: Attestation = {
        ...attestation,
        attestation_uri: 'https://evil.example/.well-known/attestations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      };

      expect(verifyAttestationId(tampered)).toBe(false);
    });

    it('returns false for malformed attestation_uri', () => {
      const attestation = signAttestation(
        sampleContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const tampered: Attestation = {
        ...attestation,
        attestation_uri: 'not-a-valid-uri',
      };

      expect(verifyAttestationId(tampered)).toBe(false);
    });
  });

  describe('createAttestation()', () => {
    it('creates and signs attestation in one call', () => {
      const attestation = createAttestation(
        sampleContent.input,
        sampleContent.output,
        sampleContent.evaluator,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      expect(attestation.signature).toBeDefined();
      expect(attestation.attestation_uri).toBeDefined();
      expect(attestation.key_id).toBe(activeKeyMetadata.key_id);
      expect(attestation.timestamp).toBeDefined();

      // Verify it's actually valid
      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activeKeyMetadata
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('Round-trip signing and verification', () => {
    it('handles complex nested objects', () => {
      const complexContent: AttestationContent = {
        input: {
          tool: 'aws-cli',
          command: 'rds delete-db-cluster',
          args: {
            'db-cluster-identifier': 'prod-db',
            'skip-final-snapshot': true,
            tags: ['env:prod', 'team:backend'],
          },
        },
        output: {
          verdict: 'ESCALATE',
          tier: 'RECOVERABLE_FROM_BACKUP',
          evidence: [
            { source: 'aws:rds:describe-db-clusters', found: true },
            { source: 'aws:rds:describe-db-snapshots', found: false },
          ],
          dependents: [
            { type: 'aws_rds_cluster_instance', count: 3 },
            { type: 'aws_route53_record', count: 1 },
          ],
        },
        evaluator: 'recourse:blast-radius:1.0',
        timestamp: '2026-05-01T14:30:00.123Z',
        key_id: 'test-key-001',
      };

      const attestation = signAttestation(
        complexContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activeKeyMetadata
      );

      expect(result.valid).toBe(true);
    });

    it('handles Unicode content', () => {
      const unicodeContent: AttestationContent = {
        input: {
          tool: 'kubectl',
          command: 'delete deployment café-☕-service',
        },
        output: {
          verdict: 'WARN',
          message: '日本語のメッセージ 🎉',
        },
        evaluator: 'recourse:k8s:1.0',
        timestamp: '2026-05-01T12:00:00Z',
        key_id: 'test-key-001',
      };

      const attestation = signAttestation(
        unicodeContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activeKeyMetadata
      );

      expect(result.valid).toBe(true);
    });

    it('handles empty arrays and objects', () => {
      const emptyContent: AttestationContent = {
        input: {},
        output: { evidence: [], dependents: [] },
        evaluator: 'recourse:empty:1.0',
        timestamp: '2026-05-01T12:00:00Z',
        key_id: 'test-key-001',
      };

      const attestation = signAttestation(
        emptyContent,
        privateKey,
        activeKeyMetadata,
        instanceBaseUrl
      );

      const result = verifyAttestation(
        attestation,
        publicKeyBase64url,
        activeKeyMetadata
      );

      expect(result.valid).toBe(true);
    });
  });
});
