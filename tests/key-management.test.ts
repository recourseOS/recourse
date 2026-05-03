/**
 * Key Management State Machine Tests
 *
 * Tests for §5 of the RecourseOS Attestation Protocol.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  KeyMetadata,
  KeyState,
  KeyRegistry,
  createKey,
  isValidTransition,
  transitionKey,
  activateKey,
  deprecateKey,
  retireKey,
  compromiseKey,
  canSign,
  canVerify,
  getActiveKey,
  getKeyById,
  createRegistry,
  addKeyToRegistry,
  updateKeyInRegistry,
  RegistryCache,
  rotateKey,
  completeRotation,
} from '../src/attestation/key-management';

describe('Key Management State Machine', () => {
  describe('createKey()', () => {
    it('creates a key in pending state', () => {
      const key = createKey('test-key-001', 'base64url-public-key');

      expect(key.key_id).toBe('test-key-001');
      expect(key.public_key).toBe('base64url-public-key');
      expect(key.state).toBe('pending');
      expect(key.algorithm).toBe('Ed25519');
      expect(key.created_at).toBeDefined();
      expect(key.activated_at).toBeUndefined();
      expect(key.deprecated_at).toBeUndefined();
      expect(key.terminated_at).toBeUndefined();
    });
  });

  describe('State Transitions', () => {
    describe('Valid transitions', () => {
      it('pending → active is valid', () => {
        expect(isValidTransition('pending', 'active')).toBe(true);
      });

      it('active → deprecated is valid', () => {
        expect(isValidTransition('active', 'deprecated')).toBe(true);
      });

      it('deprecated → retired is valid', () => {
        expect(isValidTransition('deprecated', 'retired')).toBe(true);
      });

      it('any state → compromised is valid', () => {
        const states: KeyState[] = ['pending', 'active', 'deprecated', 'retired'];
        for (const state of states) {
          expect(isValidTransition(state, 'compromised')).toBe(true);
        }
      });
    });

    describe('Invalid transitions', () => {
      it('pending → deprecated is invalid (must activate first)', () => {
        expect(isValidTransition('pending', 'deprecated')).toBe(false);
      });

      it('pending → retired is invalid', () => {
        expect(isValidTransition('pending', 'retired')).toBe(false);
      });

      it('active → retired is invalid (must deprecate first)', () => {
        expect(isValidTransition('active', 'retired')).toBe(false);
      });

      it('active → pending is invalid (no going back)', () => {
        expect(isValidTransition('active', 'pending')).toBe(false);
      });

      it('deprecated → active is invalid (no going back)', () => {
        expect(isValidTransition('deprecated', 'active')).toBe(false);
      });

      it('retired → deprecated is invalid (no going back)', () => {
        expect(isValidTransition('retired', 'deprecated')).toBe(false);
      });

      it('compromised → anything is invalid (terminal state)', () => {
        const states: KeyState[] = ['pending', 'active', 'deprecated', 'retired'];
        for (const state of states) {
          expect(isValidTransition('compromised', state)).toBe(false);
        }
      });
    });
  });

  describe('transitionKey()', () => {
    it('returns success with updated key for valid transition', () => {
      const key = createKey('test-key', 'pubkey');
      const result = transitionKey(key, 'active');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.state).toBe('active');
        expect(result.key.activated_at).toBeDefined();
      }
    });

    it('returns error for invalid transition', () => {
      const key = createKey('test-key', 'pubkey');
      const result = transitionKey(key, 'retired'); // Can't go pending → retired

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid state transition');
        expect(result.error).toContain('pending → retired');
      }
    });

    it('sets deprecated_at timestamp when deprecating', () => {
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      const result = deprecateKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.deprecated_at).toBeDefined();
      }
    });

    it('sets terminated_at timestamp when retiring', () => {
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      key = (deprecateKey(key) as { success: true; key: KeyMetadata }).key;
      const result = retireKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.terminated_at).toBeDefined();
      }
    });

    it('sets terminated_at timestamp when compromising', () => {
      const key = createKey('test-key', 'pubkey');
      const result = compromiseKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.terminated_at).toBeDefined();
      }
    });
  });

  describe('Convenience transition functions', () => {
    it('activateKey() activates a pending key', () => {
      const key = createKey('test-key', 'pubkey');
      const result = activateKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.state).toBe('active');
      }
    });

    it('deprecateKey() deprecates an active key', () => {
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      const result = deprecateKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.state).toBe('deprecated');
      }
    });

    it('retireKey() retires a deprecated key', () => {
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      key = (deprecateKey(key) as { success: true; key: KeyMetadata }).key;
      const result = retireKey(key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.key.state).toBe('retired');
      }
    });

    it('compromiseKey() can compromise any state', () => {
      const states: KeyState[] = ['pending', 'active', 'deprecated', 'retired'];
      for (const state of states) {
        const key: KeyMetadata = {
          key_id: 'test',
          public_key: 'pubkey',
          state,
          created_at: new Date().toISOString(),
          algorithm: 'Ed25519',
        };
        const result = compromiseKey(key);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.key.state).toBe('compromised');
        }
      }
    });

    it('compromiseKey() fails if already compromised', () => {
      const key: KeyMetadata = {
        key_id: 'test',
        public_key: 'pubkey',
        state: 'compromised',
        created_at: new Date().toISOString(),
        algorithm: 'Ed25519',
      };
      const result = compromiseKey(key);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('already compromised');
      }
    });
  });

  describe('Signing and verification permissions', () => {
    it('only active keys can sign', () => {
      const states: KeyState[] = ['pending', 'active', 'deprecated', 'retired', 'compromised'];
      const expected = [false, true, false, false, false];

      for (let i = 0; i < states.length; i++) {
        const key: KeyMetadata = {
          key_id: 'test',
          public_key: 'pubkey',
          state: states[i],
          created_at: new Date().toISOString(),
          algorithm: 'Ed25519',
        };
        expect(canSign(key)).toBe(expected[i]);
      }
    });

    it('only active, deprecated, and retired keys can verify (per §4.4)', () => {
      const states: KeyState[] = ['pending', 'active', 'deprecated', 'retired', 'compromised'];
      // Per §4.4: pending and compromised fail verification
      const expected = [false, true, true, true, false];

      for (let i = 0; i < states.length; i++) {
        const key: KeyMetadata = {
          key_id: 'test',
          public_key: 'pubkey',
          state: states[i],
          created_at: new Date().toISOString(),
          algorithm: 'Ed25519',
        };
        expect(canVerify(key)).toBe(expected[i]);
      }
    });
  });

  describe('Key Registry', () => {
    it('createRegistry() creates empty registry with sequence 0', () => {
      const registry = createRegistry();

      expect(registry.version).toBe(1);
      expect(registry.sequence).toBe(0);
      expect(registry.keys).toHaveLength(0);
      expect(registry.updated_at).toBeDefined();
    });

    it('addKeyToRegistry() adds key and increments sequence', () => {
      let registry = createRegistry();
      const key = createKey('test-key', 'pubkey');

      registry = addKeyToRegistry(registry, key);

      expect(registry.sequence).toBe(1);
      expect(registry.keys).toHaveLength(1);
      expect(registry.keys[0].key_id).toBe('test-key');
    });

    it('addKeyToRegistry() throws on duplicate key_id', () => {
      let registry = createRegistry();
      const key1 = createKey('test-key', 'pubkey1');
      const key2 = createKey('test-key', 'pubkey2'); // Same key_id

      registry = addKeyToRegistry(registry, key1);

      expect(() => addKeyToRegistry(registry, key2)).toThrow('already exists');
    });

    it('updateKeyInRegistry() updates key and increments sequence', () => {
      let registry = createRegistry();
      let key = createKey('test-key', 'pubkey');
      registry = addKeyToRegistry(registry, key);

      const activateResult = activateKey(key);
      expect(activateResult.success).toBe(true);
      if (activateResult.success) {
        registry = updateKeyInRegistry(registry, activateResult.key);
      }

      expect(registry.sequence).toBe(2);
      expect(registry.keys[0].state).toBe('active');
    });

    it('updateKeyInRegistry() throws for unknown key', () => {
      const registry = createRegistry();
      const key = createKey('unknown-key', 'pubkey');

      expect(() => updateKeyInRegistry(registry, key)).toThrow('not found');
    });

    it('getActiveKey() returns active key', () => {
      let registry = createRegistry();
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      registry = addKeyToRegistry(registry, key);

      const activeKey = getActiveKey(registry);

      expect(activeKey).toBeDefined();
      expect(activeKey?.key_id).toBe('test-key');
    });

    it('getActiveKey() returns undefined when no active key', () => {
      const registry = createRegistry();
      expect(getActiveKey(registry)).toBeUndefined();
    });

    it('getKeyById() finds key by ID', () => {
      let registry = createRegistry();
      const key = createKey('test-key', 'pubkey');
      registry = addKeyToRegistry(registry, key);

      const found = getKeyById(registry, 'test-key');

      expect(found).toBeDefined();
      expect(found?.key_id).toBe('test-key');
    });

    it('getKeyById() returns undefined for unknown ID', () => {
      const registry = createRegistry();
      expect(getKeyById(registry, 'unknown')).toBeUndefined();
    });
  });

  describe('Registry Cache', () => {
    let cache: RegistryCache;

    beforeEach(() => {
      cache = new RegistryCache();
    });

    it('stores and retrieves registry entries', () => {
      const registry = createRegistry();
      cache.update('example.com', registry);

      const entry = cache.get('example.com');

      expect(entry).toBeDefined();
      expect(entry?.registry.sequence).toBe(0);
    });

    it('accepts updates with higher sequence number', () => {
      const registry1: KeyRegistry = { ...createRegistry(), sequence: 1 };
      const registry2: KeyRegistry = { ...createRegistry(), sequence: 2 };

      cache.update('example.com', registry1);
      const result = cache.update('example.com', registry2);

      expect(result).toBe(true);
      expect(cache.get('example.com')?.registry.sequence).toBe(2);
    });

    it('rejects updates with lower sequence number (rollback protection)', () => {
      const registry1: KeyRegistry = { ...createRegistry(), sequence: 5 };
      const registry2: KeyRegistry = { ...createRegistry(), sequence: 3 };

      cache.update('example.com', registry1);
      const result = cache.update('example.com', registry2);

      expect(result).toBe(false);
      expect(cache.get('example.com')?.registry.sequence).toBe(5);
    });

    it('accepts same sequence number (idempotent refresh)', () => {
      const registry1: KeyRegistry = { ...createRegistry(), sequence: 5 };
      const registry2: KeyRegistry = { ...createRegistry(), sequence: 5 };

      cache.update('example.com', registry1);
      const result = cache.update('example.com', registry2);

      expect(result).toBe(true);
    });

    it('forceRefresh() bypasses rollback protection', () => {
      const registry1: KeyRegistry = { ...createRegistry(), sequence: 10 };
      const registry2: KeyRegistry = { ...createRegistry(), sequence: 1 };

      cache.update('example.com', registry1);
      cache.forceRefresh('example.com', registry2);

      expect(cache.get('example.com')?.registry.sequence).toBe(1);
    });

    it('update with forceRefresh flag bypasses rollback protection', () => {
      const registry1: KeyRegistry = { ...createRegistry(), sequence: 10 };
      const registry2: KeyRegistry = { ...createRegistry(), sequence: 1 };

      cache.update('example.com', registry1);
      const result = cache.update('example.com', registry2, undefined, true);

      expect(result).toBe(true);
      expect(cache.get('example.com')?.registry.sequence).toBe(1);
    });

    it('clear() removes specific host', () => {
      const registry = createRegistry();
      cache.update('example.com', registry);
      cache.update('other.com', registry);

      cache.clear('example.com');

      expect(cache.get('example.com')).toBeUndefined();
      expect(cache.get('other.com')).toBeDefined();
    });

    it('clearAll() removes all entries', () => {
      const registry = createRegistry();
      cache.update('example.com', registry);
      cache.update('other.com', registry);

      cache.clearAll();

      expect(cache.get('example.com')).toBeUndefined();
      expect(cache.get('other.com')).toBeUndefined();
    });

    it('stores ETag with cache entry', () => {
      const registry = createRegistry();
      cache.update('example.com', registry, '"abc123"');

      expect(cache.get('example.com')?.etag).toBe('"abc123"');
    });
  });

  describe('Key Rotation', () => {
    it('rotateKey() deprecates old key and activates new key', () => {
      // Set up registry with active key
      let registry = createRegistry();
      let oldKey = createKey('old-key', 'old-pubkey');
      oldKey = (activateKey(oldKey) as { success: true; key: KeyMetadata }).key;
      registry = addKeyToRegistry(registry, oldKey);

      // Perform rotation
      registry = rotateKey(registry, 'new-key', 'new-pubkey');

      // Verify old key is deprecated
      const oldKeyState = getKeyById(registry, 'old-key');
      expect(oldKeyState?.state).toBe('deprecated');

      // Verify new key is active
      const newKey = getActiveKey(registry);
      expect(newKey?.key_id).toBe('new-key');
      expect(newKey?.state).toBe('active');

      // Both keys should be in registry
      expect(registry.keys).toHaveLength(2);
    });

    it('rotateKey() throws when no active key exists', () => {
      const registry = createRegistry();

      expect(() => rotateKey(registry, 'new-key', 'pubkey')).toThrow('No active key');
    });

    it('completeRotation() retires deprecated key', () => {
      // Set up and rotate
      let registry = createRegistry();
      let oldKey = createKey('old-key', 'old-pubkey');
      oldKey = (activateKey(oldKey) as { success: true; key: KeyMetadata }).key;
      registry = addKeyToRegistry(registry, oldKey);
      registry = rotateKey(registry, 'new-key', 'new-pubkey');

      // Complete rotation
      registry = completeRotation(registry, 'old-key');

      const oldKeyState = getKeyById(registry, 'old-key');
      expect(oldKeyState?.state).toBe('retired');
    });

    it('completeRotation() throws for non-deprecated key', () => {
      let registry = createRegistry();
      let key = createKey('test-key', 'pubkey');
      key = (activateKey(key) as { success: true; key: KeyMetadata }).key;
      registry = addKeyToRegistry(registry, key);

      expect(() => completeRotation(registry, 'test-key')).toThrow('not deprecated');
    });
  });

  describe('Full lifecycle scenario', () => {
    it('walks through complete key lifecycle', () => {
      // 1. Create initial key
      let registry = createRegistry();
      let key1 = createKey('key-v1', 'pubkey-v1');
      registry = addKeyToRegistry(registry, key1);
      expect(registry.sequence).toBe(1);
      expect(canSign(key1)).toBe(false); // Not yet active

      // 2. Activate key
      key1 = (activateKey(key1) as { success: true; key: KeyMetadata }).key;
      registry = updateKeyInRegistry(registry, key1);
      expect(registry.sequence).toBe(2);
      expect(canSign(key1)).toBe(true);
      expect(canVerify(key1)).toBe(true);

      // 3. Create and rotate to new key
      registry = rotateKey(registry, 'key-v2', 'pubkey-v2');
      const key1AfterRotation = getKeyById(registry, 'key-v1')!;
      const key2 = getActiveKey(registry)!;

      expect(canSign(key1AfterRotation)).toBe(false); // Deprecated
      expect(canVerify(key1AfterRotation)).toBe(true); // Still valid for verification
      expect(canSign(key2)).toBe(true);

      // 4. Complete rotation (retire old key)
      registry = completeRotation(registry, 'key-v1');
      const key1Retired = getKeyById(registry, 'key-v1')!;

      expect(canSign(key1Retired)).toBe(false);
      expect(canVerify(key1Retired)).toBe(true); // Retired keys still verify

      // 5. Compromise old key (security incident discovered)
      const compromiseResult = compromiseKey(key1Retired);
      expect(compromiseResult.success).toBe(true);
      if (compromiseResult.success) {
        registry = updateKeyInRegistry(registry, compromiseResult.key);
      }

      const key1Compromised = getKeyById(registry, 'key-v1')!;
      expect(canVerify(key1Compromised)).toBe(false); // All attestations rejected

      // key2 should still be active and unaffected
      const key2Still = getActiveKey(registry)!;
      expect(canSign(key2Still)).toBe(true);
      expect(canVerify(key2Still)).toBe(true);
    });
  });
});
