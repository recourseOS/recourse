/**
 * Key Management State Machine
 *
 * Implements §5 of the RecourseOS Attestation Protocol.
 * Manages signing key lifecycle with 5-state model:
 *
 *   pending → active → deprecated → retired
 *                          ↓
 *                     compromised
 *
 * Any state may transition to `compromised` on security incident.
 */

/**
 * Key lifecycle states per §5.2
 */
export type KeyState = 'pending' | 'active' | 'deprecated' | 'retired' | 'compromised';

/**
 * Metadata for a signing key per §5.1
 */
export interface KeyMetadata {
  /** Unique key identifier (e.g., "recourse-prod-2026-001") */
  key_id: string;

  /** Ed25519 public key in base64url encoding */
  public_key: string;

  /** Current lifecycle state */
  state: KeyState;

  /** ISO 8601 timestamp when key was created */
  created_at: string;

  /** ISO 8601 timestamp when key was activated (if applicable) */
  activated_at?: string;

  /** ISO 8601 timestamp when key was deprecated (if applicable) */
  deprecated_at?: string;

  /** ISO 8601 timestamp when key was retired or compromised (if applicable) */
  terminated_at?: string;

  /** Algorithm identifier (always "Ed25519" for v1) */
  algorithm: 'Ed25519';
}

/**
 * Key registry structure per §5.3
 * Served at /.well-known/recourse-keys.json
 */
export interface KeyRegistry {
  /** Version of the registry format */
  version: 1;

  /** ISO 8601 timestamp of last registry update */
  updated_at: string;

  /** Monotonically increasing sequence number for rollback protection */
  sequence: number;

  /** Array of all keys (active and historical) */
  keys: KeyMetadata[];
}

/**
 * Result of a state transition attempt
 */
export type TransitionResult =
  | { success: true; key: KeyMetadata }
  | { success: false; error: string };

/**
 * Valid state transitions per §5.4
 */
const VALID_TRANSITIONS: Record<KeyState, KeyState[]> = {
  pending: ['active', 'compromised'],
  active: ['deprecated', 'compromised'],
  deprecated: ['retired', 'compromised'],
  retired: ['compromised'],
  compromised: [], // Terminal state
};

/**
 * Create a new key in pending state
 */
export function createKey(key_id: string, public_key: string): KeyMetadata {
  return {
    key_id,
    public_key,
    state: 'pending',
    created_at: new Date().toISOString(),
    algorithm: 'Ed25519',
  };
}

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: KeyState, to: KeyState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Transition a key to a new state with validation
 */
export function transitionKey(key: KeyMetadata, to: KeyState): TransitionResult {
  const from = key.state;

  // Check if transition is valid
  if (!isValidTransition(from, to)) {
    return {
      success: false,
      error: `Invalid state transition: ${from} → ${to}. Valid transitions from ${from}: [${VALID_TRANSITIONS[from].join(', ')}]`,
    };
  }

  // Create updated key with new state and timestamps
  const now = new Date().toISOString();
  const updated: KeyMetadata = { ...key, state: to };

  switch (to) {
    case 'active':
      updated.activated_at = now;
      break;
    case 'deprecated':
      updated.deprecated_at = now;
      break;
    case 'retired':
    case 'compromised':
      updated.terminated_at = now;
      break;
  }

  return { success: true, key: updated };
}

/**
 * Activate a pending key
 */
export function activateKey(key: KeyMetadata): TransitionResult {
  return transitionKey(key, 'active');
}

/**
 * Deprecate an active key (begin rotation)
 */
export function deprecateKey(key: KeyMetadata): TransitionResult {
  return transitionKey(key, 'deprecated');
}

/**
 * Retire a deprecated key (end rotation)
 */
export function retireKey(key: KeyMetadata): TransitionResult {
  return transitionKey(key, 'retired');
}

/**
 * Mark a key as compromised (any state)
 */
export function compromiseKey(key: KeyMetadata): TransitionResult {
  // Compromised is terminal - can't compromise an already compromised key
  if (key.state === 'compromised') {
    return {
      success: false,
      error: 'Key is already compromised',
    };
  }
  return transitionKey(key, 'compromised');
}

/**
 * Check if a key can sign new attestations
 */
export function canSign(key: KeyMetadata): boolean {
  return key.state === 'active';
}

/**
 * Check if attestations signed by this key should be accepted
 *
 * Per §4.4: Keys in `pending` or `compromised` state fail verification.
 * Keys in `active`, `deprecated`, or `retired` state pass verification.
 */
export function canVerify(key: KeyMetadata): boolean {
  return key.state === 'active' || key.state === 'deprecated' || key.state === 'retired';
}

/**
 * Get the active key from a registry (for signing)
 */
export function getActiveKey(registry: KeyRegistry): KeyMetadata | undefined {
  return registry.keys.find((k) => k.state === 'active');
}

/**
 * Get a key by ID from a registry (for verification)
 */
export function getKeyById(
  registry: KeyRegistry,
  key_id: string
): KeyMetadata | undefined {
  return registry.keys.find((k) => k.key_id === key_id);
}

/**
 * Create an empty key registry
 */
export function createRegistry(): KeyRegistry {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    sequence: 0,
    keys: [],
  };
}

/**
 * Add a key to the registry with sequence increment
 */
export function addKeyToRegistry(
  registry: KeyRegistry,
  key: KeyMetadata
): KeyRegistry {
  // Check for duplicate key_id
  if (registry.keys.some((k) => k.key_id === key.key_id)) {
    throw new Error(`Key with ID "${key.key_id}" already exists in registry`);
  }

  return {
    ...registry,
    updated_at: new Date().toISOString(),
    sequence: registry.sequence + 1,
    keys: [...registry.keys, key],
  };
}

/**
 * Update a key in the registry with sequence increment
 */
export function updateKeyInRegistry(
  registry: KeyRegistry,
  updated: KeyMetadata
): KeyRegistry {
  const index = registry.keys.findIndex((k) => k.key_id === updated.key_id);
  if (index === -1) {
    throw new Error(`Key with ID "${updated.key_id}" not found in registry`);
  }

  const keys = [...registry.keys];
  keys[index] = updated;

  return {
    ...registry,
    updated_at: new Date().toISOString(),
    sequence: registry.sequence + 1,
    keys,
  };
}

/**
 * Cache entry for a key registry
 */
export interface CacheEntry {
  registry: KeyRegistry;
  fetched_at: string;
  etag?: string;
}

/**
 * Registry cache with rollback protection per §5.5
 */
export class RegistryCache {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Get cached registry for a host
   */
  get(host: string): CacheEntry | undefined {
    return this.cache.get(host);
  }

  /**
   * Update cache with rollback protection
   *
   * @param host - The host this registry belongs to
   * @param registry - The new registry data
   * @param etag - Optional ETag for HTTP caching
   * @param forceRefresh - If true, bypass rollback protection (requires explicit operator action)
   * @returns true if update succeeded, false if rollback detected
   */
  update(
    host: string,
    registry: KeyRegistry,
    etag?: string,
    forceRefresh = false
  ): boolean {
    const existing = this.cache.get(host);

    // Check for rollback (sequence going backwards)
    if (existing && !forceRefresh) {
      if (registry.sequence < existing.registry.sequence) {
        // Rollback detected - reject update
        return false;
      }
    }

    this.cache.set(host, {
      registry,
      fetched_at: new Date().toISOString(),
      etag,
    });

    return true;
  }

  /**
   * Force refresh the cache, bypassing rollback protection
   * This should be logged per §5.5.2
   */
  forceRefresh(host: string, registry: KeyRegistry, etag?: string): void {
    this.cache.set(host, {
      registry,
      fetched_at: new Date().toISOString(),
      etag,
    });
  }

  /**
   * Clear cache for a specific host
   */
  clear(host: string): void {
    this.cache.delete(host);
  }

  /**
   * Clear entire cache
   */
  clearAll(): void {
    this.cache.clear();
  }
}

/**
 * Perform key rotation: deprecate old key, add and activate new key
 *
 * This is a convenience function that performs the standard rotation sequence.
 * Both keys remain valid for verification during the overlap window.
 */
export function rotateKey(
  registry: KeyRegistry,
  newKeyId: string,
  newPublicKey: string
): KeyRegistry {
  // Find current active key
  const activeKey = getActiveKey(registry);
  if (!activeKey) {
    throw new Error('No active key to rotate from');
  }

  // Deprecate the current active key
  const deprecateResult = deprecateKey(activeKey);
  if (!deprecateResult.success) {
    throw new Error(`Failed to deprecate active key: ${deprecateResult.error}`);
  }

  // Create and activate new key
  let newKey = createKey(newKeyId, newPublicKey);
  const activateResult = activateKey(newKey);
  if (!activateResult.success) {
    throw new Error(`Failed to activate new key: ${activateResult.error}`);
  }
  newKey = activateResult.key;

  // Update registry with both changes
  let updated = updateKeyInRegistry(registry, deprecateResult.key);
  updated = addKeyToRegistry(updated, newKey);

  return updated;
}

/**
 * Complete rotation: retire the deprecated key
 *
 * Call this after the overlap window has closed.
 */
export function completeRotation(registry: KeyRegistry, keyId: string): KeyRegistry {
  const key = getKeyById(registry, keyId);
  if (!key) {
    throw new Error(`Key "${keyId}" not found`);
  }

  if (key.state !== 'deprecated') {
    throw new Error(`Key "${keyId}" is not deprecated (current state: ${key.state})`);
  }

  const retireResult = retireKey(key);
  if (!retireResult.success) {
    throw new Error(`Failed to retire key: ${retireResult.error}`);
  }

  return updateKeyInRegistry(registry, retireResult.key);
}
