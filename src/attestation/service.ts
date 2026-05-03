/**
 * Attestation Service
 *
 * Manages the lifecycle of attestations:
 * - Key generation and persistence
 * - Attestation creation and storage
 * - Key registry serving
 *
 * This service is the main integration point for the attestation protocol.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createPrivateKey, createPublicKey, KeyObject } from 'crypto';
import {
  generateKeyPair,
  createAttestation,
  signAttestation,
  verifyAttestation,
  deriveAttestationId,
  base64urlEncode,
  base64urlDecode,
  Attestation,
  AttestationContent,
  VerificationResult,
} from './signing.js';
import {
  KeyMetadata,
  KeyRegistry,
  createKey,
  activateKey,
  createRegistry,
  addKeyToRegistry,
  updateKeyInRegistry,
  getActiveKey,
  getKeyById,
} from './key-management.js';

/**
 * Configuration for the attestation service
 */
export interface AttestationServiceConfig {
  /** Directory to store keys and config. Defaults to ~/.recourse */
  configDir?: string;

  /** Instance ID for this RecourseOS instance */
  instanceId?: string;

  /** Base URL for attestation URIs */
  instanceBaseUrl?: string;

  /** Evaluator version string */
  evaluatorVersion?: string;
}

/**
 * Stored key data (persisted to disk)
 */
interface StoredKeyData {
  key_id: string;
  private_key_pem: string;
  public_key_base64url: string;
  state: KeyMetadata['state'];
  created_at: string;
  activated_at?: string;
}

/**
 * Attestation Service
 *
 * Singleton service that manages attestation operations.
 */
export class AttestationService {
  private configDir: string;
  private instanceId: string;
  private instanceBaseUrl: string;
  private evaluatorVersion: string;

  private privateKey: KeyObject | null = null;
  private publicKeyBase64url: string | null = null;
  private keyMetadata: KeyMetadata | null = null;
  private registry: KeyRegistry;

  /**
   * In-memory attestation storage (for URL retrieval)
   *
   * IMPORTANT: Current limitation - attestations are stored in memory only.
   * They are lost when the server restarts. For production deployments
   * requiring audit trails or long-term verification, implement persistent
   * storage (database, file system, or external service).
   *
   * The storage interface is internal and can be swapped to a persistent
   * implementation without changing the public API.
   */
  private attestations: Map<string, Attestation> = new Map();

  constructor(config: AttestationServiceConfig = {}) {
    this.configDir = config.configDir ?? join(homedir(), '.recourse');
    this.instanceId = config.instanceId ?? 'recourse-local';
    this.instanceBaseUrl = config.instanceBaseUrl ?? 'http://localhost:3001';
    this.evaluatorVersion = config.evaluatorVersion ?? '1.0.0';
    this.registry = createRegistry();
  }

  /**
   * Initialize the service: load or generate keys
   */
  async initialize(): Promise<void> {
    // Ensure config directory exists with secure permissions (0700)
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }

    const keyPath = join(this.configDir, 'signing-key.json');

    if (existsSync(keyPath)) {
      // Load existing key
      await this.loadKey(keyPath);
    } else {
      // Generate new key
      await this.generateAndSaveKey(keyPath);
    }

    // Build registry
    if (this.keyMetadata) {
      this.registry = addKeyToRegistry(createRegistry(), this.keyMetadata);
      this.registry = {
        ...this.registry,
        // Add instance_id to registry
        instance_id: this.instanceId,
      } as KeyRegistry & { instance_id: string };
    }
  }

  /**
   * Load existing key from disk
   */
  private async loadKey(keyPath: string): Promise<void> {
    const data: StoredKeyData = JSON.parse(readFileSync(keyPath, 'utf8'));

    // Reconstruct private key from PEM
    this.privateKey = createPrivateKey(data.private_key_pem);
    this.publicKeyBase64url = data.public_key_base64url;

    // Reconstruct key metadata
    this.keyMetadata = {
      key_id: data.key_id,
      public_key: data.public_key_base64url,
      state: data.state,
      created_at: data.created_at,
      activated_at: data.activated_at,
      algorithm: 'Ed25519',
    };
  }

  /**
   * Generate new key and save to disk
   */
  private async generateAndSaveKey(keyPath: string): Promise<void> {
    const keypair = generateKeyPair();
    this.privateKey = keypair.privateKey;
    this.publicKeyBase64url = keypair.publicKeyBase64url;

    // Create key metadata
    const keyId = `${this.instanceId}-1`;
    let key = createKey(keyId, keypair.publicKeyBase64url);

    // Immediately activate (first key)
    const result = activateKey(key);
    if (!result.success) {
      throw new Error(`Failed to activate key: ${result.error}`);
    }
    this.keyMetadata = result.key;

    // Persist to disk
    const privateKeyPem = keypair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;

    const storedData: StoredKeyData = {
      key_id: this.keyMetadata.key_id,
      private_key_pem: privateKeyPem,
      public_key_base64url: keypair.publicKeyBase64url,
      state: this.keyMetadata.state,
      created_at: this.keyMetadata.created_at,
      activated_at: this.keyMetadata.activated_at,
    };

    // Write with secure permissions (0600 - owner read/write only)
    writeFileSync(keyPath, JSON.stringify(storedData, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    // Ensure permissions are set (in case umask interfered)
    chmodSync(keyPath, 0o600);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.privateKey !== null && this.keyMetadata !== null;
  }

  /**
   * Get the key registry (for /.well-known/recourse-keys.json)
   */
  getKeyRegistry(): KeyRegistry & { instance_id: string } {
    return {
      ...this.registry,
      instance_id: this.instanceId,
    } as KeyRegistry & { instance_id: string };
  }

  /**
   * Create an attestation for an evaluation
   */
  createAttestation(input: unknown, output: unknown): Attestation {
    if (!this.privateKey || !this.keyMetadata || !this.publicKeyBase64url) {
      throw new Error('AttestationService not initialized. Call initialize() first.');
    }

    const evaluator = `recourse:blast-radius:${this.evaluatorVersion}`;

    const attestation = createAttestation(
      input,
      output,
      evaluator,
      this.privateKey,
      this.keyMetadata,
      this.instanceBaseUrl
    );

    // Store for URL retrieval
    const id = deriveAttestationId(attestation);
    this.attestations.set(id, attestation);

    return attestation;
  }

  /**
   * Get an attestation by ID (for /.well-known/attestations/{id}.json)
   */
  getAttestation(id: string): Attestation | null {
    return this.attestations.get(id) ?? null;
  }

  /**
   * Verify an attestation
   */
  verifyAttestation(attestation: Attestation): VerificationResult {
    const keyMeta = getKeyById(this.registry, attestation.key_id);
    if (!keyMeta) {
      return {
        valid: false,
        reason: `Unknown key_id: ${attestation.key_id}`,
      };
    }

    return verifyAttestation(attestation, keyMeta.public_key, keyMeta);
  }

  /**
   * Get instance base URL
   */
  getInstanceBaseUrl(): string {
    return this.instanceBaseUrl;
  }

  /**
   * Get current key ID
   */
  getCurrentKeyId(): string | null {
    return this.keyMetadata?.key_id ?? null;
  }
}

// Global singleton instance
let serviceInstance: AttestationService | null = null;

/**
 * Get or create the global attestation service instance
 */
export function getAttestationService(config?: AttestationServiceConfig): AttestationService {
  if (!serviceInstance) {
    serviceInstance = new AttestationService(config);
  }
  return serviceInstance;
}

/**
 * Reset the global instance (for testing)
 */
export function resetAttestationService(): void {
  serviceInstance = null;
}
