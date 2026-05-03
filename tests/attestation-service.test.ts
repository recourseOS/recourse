/**
 * Attestation Service Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AttestationService,
  resetAttestationService,
  verifyAttestation,
  canonicalize,
  deriveAttestationId,
} from '../src/attestation/index';

describe('AttestationService', () => {
  let tempDir: string;
  let service: AttestationService;

  beforeEach(() => {
    // Create temp directory for test keys
    tempDir = mkdtempSync(join(tmpdir(), 'recourse-test-'));
    resetAttestationService();

    service = new AttestationService({
      configDir: tempDir,
      instanceId: 'test-instance',
      instanceBaseUrl: 'http://localhost:3001',
      evaluatorVersion: '1.0.0-test',
    });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    resetAttestationService();
  });

  describe('initialization', () => {
    it('generates new key on first run', async () => {
      await service.initialize();

      expect(service.isInitialized()).toBe(true);
      expect(service.getCurrentKeyId()).toBe('test-instance-1');

      // Key file should exist
      const keyPath = join(tempDir, 'signing-key.json');
      expect(existsSync(keyPath)).toBe(true);
    });

    it('loads existing key on subsequent runs', async () => {
      // First run - generate key
      await service.initialize();
      const firstKeyId = service.getCurrentKeyId();

      // Create new service instance pointing to same directory
      const service2 = new AttestationService({
        configDir: tempDir,
        instanceId: 'test-instance',
        instanceBaseUrl: 'http://localhost:3001',
      });
      await service2.initialize();

      // Should load the same key
      expect(service2.getCurrentKeyId()).toBe(firstKeyId);
    });

    it('creates key file with secure permissions (0600)', async () => {
      await service.initialize();

      const keyPath = join(tempDir, 'signing-key.json');
      const stats = statSync(keyPath);

      // Check file permissions: 0600 = owner read/write only
      // mode & 0o777 masks out file type bits to get permission bits
      const permissions = stats.mode & 0o777;
      expect(permissions).toBe(0o600);
    });
  });

  describe('createAttestation', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('creates valid attestation', () => {
      const input = {
        source: 'shell',
        command: 'rm -rf /data',
      };
      const output = {
        decision: 'block',
        tier: 4,
        reasoning: 'Destructive command detected',
      };

      const attestation = service.createAttestation(input, output);

      expect(attestation.signature).toBeDefined();
      expect(attestation.attestation_uri).toContain('/.well-known/attestations/');
      expect(attestation.key_id).toBe('test-instance-1');
      expect(attestation.evaluator).toContain('recourse:blast-radius');
      expect(attestation.input).toEqual(input);
      expect(attestation.output).toEqual(output);
    });

    it('stores attestation for retrieval', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      // Extract ID from URI
      const match = attestation.attestation_uri.match(/\/([a-f0-9]{32})\.json$/);
      expect(match).not.toBeNull();
      const id = match![1];

      // Should be retrievable
      const retrieved = service.getAttestation(id);
      expect(retrieved).toEqual(attestation);
    });

    it('attestation is verifiable', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const result = service.verifyAttestation(attestation);
      expect(result.valid).toBe(true);
    });
  });

  describe('getKeyRegistry', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('returns valid registry structure', () => {
      const registry = service.getKeyRegistry();

      expect(registry.instance_id).toBe('test-instance');
      expect(registry.version).toBe(1);
      expect(registry.keys).toHaveLength(1);
      expect(registry.keys[0].key_id).toBe('test-instance-1');
      expect(registry.keys[0].state).toBe('active');
      expect(registry.keys[0].algorithm).toBe('Ed25519');
    });
  });

  describe('error handling', () => {
    it('throws if not initialized', () => {
      expect(() =>
        service.createAttestation({ test: 1 }, { result: 2 })
      ).toThrow('not initialized');
    });
  });

  describe('attestation verification', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('detects tampered attestation', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      // Tamper with the output
      const tampered = {
        ...attestation,
        output: { result: 'tampered' },
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects unknown key_id', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      // Change key_id to unknown
      const unknown = {
        ...attestation,
        key_id: 'unknown-key',
      };

      const result = service.verifyAttestation(unknown);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('Unknown key_id');
      }
    });
  });
});

describe('AttestationService key persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'recourse-key-test-'));
    resetAttestationService();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    resetAttestationService();
  });

  it('persists key material across restarts', async () => {
    // First service creates attestation
    const service1 = new AttestationService({
      configDir: tempDir,
      instanceId: 'persist-test',
      instanceBaseUrl: 'http://localhost:3001',
    });
    await service1.initialize();

    const attestation = service1.createAttestation(
      { command: 'test' },
      { result: 'ok' }
    );

    // Second service (simulating restart) should verify it
    resetAttestationService();
    const service2 = new AttestationService({
      configDir: tempDir,
      instanceId: 'persist-test',
      instanceBaseUrl: 'http://localhost:3001',
    });
    await service2.initialize();

    const result = service2.verifyAttestation(attestation);
    expect(result.valid).toBe(true);
  });
});

describe('Attestation cross-check (§6.4)', () => {
  let tempDir: string;
  let service: AttestationService;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'recourse-crosscheck-'));
    resetAttestationService();
    service = new AttestationService({
      configDir: tempDir,
      instanceId: 'crosscheck-test',
      instanceBaseUrl: 'http://localhost:3001',
    });
    await service.initialize();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    resetAttestationService();
  });

  it('embedded and URL-retrieved attestations are byte-for-byte identical when canonicalized', () => {
    // Create attestation (this is the "embedded" copy returned in MCP response)
    const embeddedAttestation = service.createAttestation(
      { source: 'shell', command: 'rm -rf /data' },
      { decision: 'block', tier: 4, reasoning: 'Destructive command' }
    );

    // Extract attestation ID from URI
    const match = embeddedAttestation.attestation_uri.match(/\/([a-f0-9]{32})\.json$/);
    expect(match).not.toBeNull();
    const attestationId = match![1];

    // Retrieve via URL (this is the "URL-retrieved" copy)
    const urlAttestation = service.getAttestation(attestationId);
    expect(urlAttestation).not.toBeNull();

    // Canonicalize both copies
    const embeddedCanonical = canonicalize(embeddedAttestation);
    const urlCanonical = canonicalize(urlAttestation);

    // Per §6.4: "The cross-check is performed by parsing both attestation copies
    // as JSON, canonicalizing each independently per RFC 8785, and comparing
    // the resulting byte sequences."
    expect(embeddedCanonical).toBe(urlCanonical);
  });

  it('attestation ID derivation is consistent', () => {
    const attestation = service.createAttestation(
      { tool: 'terraform', action: 'destroy' },
      { verdict: 'BLOCKED', tier: 'UNRECOVERABLE' }
    );

    // Derive ID from content fields
    const derivedId = deriveAttestationId(attestation);

    // ID in URI should match
    const match = attestation.attestation_uri.match(/\/([a-f0-9]{32})\.json$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(derivedId);

    // Stored attestation should be retrievable by derived ID
    const retrieved = service.getAttestation(derivedId);
    expect(retrieved).toEqual(attestation);
  });
});

describe('Negative-path security tests', () => {
  let tempDir: string;
  let service: AttestationService;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'recourse-negative-'));
    resetAttestationService();
    service = new AttestationService({
      configDir: tempDir,
      instanceId: 'negative-test',
      instanceBaseUrl: 'http://localhost:3001',
    });
    await service.initialize();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    resetAttestationService();
  });

  describe('tampered attestations', () => {
    it('rejects attestation with modified input', () => {
      const attestation = service.createAttestation(
        { command: 'safe-command' },
        { result: 'allow' }
      );

      const tampered = {
        ...attestation,
        input: { command: 'rm -rf /' },
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with modified output', () => {
      const attestation = service.createAttestation(
        { command: 'dangerous' },
        { result: 'block', tier: 4 }
      );

      const tampered = {
        ...attestation,
        output: { result: 'allow', tier: 1 },
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with modified timestamp', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const tampered = {
        ...attestation,
        timestamp: '2099-01-01T00:00:00.000Z',
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with modified evaluator', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const tampered = {
        ...attestation,
        evaluator: 'malicious:evaluator:1.0',
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with modified attestation_uri', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const tampered = {
        ...attestation,
        attestation_uri: 'https://evil.com/.well-known/attestations/fake.json',
      };

      const result = service.verifyAttestation(tampered);
      expect(result.valid).toBe(false);
    });
  });

  describe('invalid signatures', () => {
    it('rejects attestation with truncated signature', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const invalid = {
        ...attestation,
        signature: attestation.signature.slice(0, 20),
      };

      const result = service.verifyAttestation(invalid);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with garbage signature', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const invalid = {
        ...attestation,
        signature: 'not-a-valid-base64url-signature',
      };

      const result = service.verifyAttestation(invalid);
      expect(result.valid).toBe(false);
    });

    it('rejects attestation with empty signature', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const invalid = {
        ...attestation,
        signature: '',
      };

      const result = service.verifyAttestation(invalid);
      expect(result.valid).toBe(false);
    });
  });

  describe('unknown or invalid keys', () => {
    it('rejects attestation with unknown key_id', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const invalid = {
        ...attestation,
        key_id: 'nonexistent-key-999',
      };

      const result = service.verifyAttestation(invalid);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('Unknown key_id');
      }
    });

    it('rejects attestation with empty key_id', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const invalid = {
        ...attestation,
        key_id: '',
      };

      const result = service.verifyAttestation(invalid);
      expect(result.valid).toBe(false);
    });
  });

  describe('missing fields', () => {
    it('handles attestation missing signature gracefully', () => {
      const attestation = service.createAttestation(
        { command: 'test' },
        { result: 'ok' }
      );

      const { signature, ...noSignature } = attestation;

      // Should either fail gracefully or throw - not crash
      expect(() => {
        const result = service.verifyAttestation(noSignature as any);
        // If it returns, it should indicate invalid
        expect(result.valid).toBe(false);
      }).not.toThrow();
    });
  });
});
