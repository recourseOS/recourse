/**
 * RecourseOS Attestation Protocol
 *
 * Cryptographic attestation layer for agent decisions.
 * Implements the protocol specified in docs/attestation-protocol-design.html.
 *
 * Current Limitations:
 * - Attestations are stored in memory only and lost on server restart.
 *   For production audit trails, implement persistent storage.
 * - Single-instance design; no built-in replication or clustering.
 *
 * @module attestation
 */

// §4 Canonicalization (RFC 8785)
export {
  canonicalize,
  isCanonical,
  parseAndCanonicalize,
  CanonicalizeError,
} from './canonicalize.js';

// §5 Key Management
export {
  KeyState,
  KeyMetadata,
  KeyRegistry,
  TransitionResult,
  CacheEntry,
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
} from './key-management.js';

// §4.2-4.4 Signing and Verification
// §6 Transport (attestation ID derivation, URI construction)
export {
  AttestationSigningError,
  AttestationContent,
  Attestation,
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
  VerificationResult,
} from './signing.js';

// Attestation Service (main integration point)
export {
  AttestationService,
  AttestationServiceConfig,
  getAttestationService,
  resetAttestationService,
} from './service.js';
