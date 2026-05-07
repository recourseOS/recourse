// Package attestation implements cryptographic attestation for consequence reports.
//
// This implements the RecourseOS Attestation Protocol, enabling cross-implementation
// verification between Go and TypeScript implementations.
package attestation

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Attestation represents a signed consequence evaluation attestation.
// This structure matches the TypeScript implementation for cross-implementation interop.
type Attestation struct {
	Input          interface{} `json:"input"`
	Output         interface{} `json:"output"`
	Evaluator      string      `json:"evaluator"`
	Timestamp      string      `json:"timestamp"`
	KeyID          string      `json:"key_id"`
	AttestationURI string      `json:"attestation_uri"`
	Signature      string      `json:"signature"` // Ed25519, base64url encoded
}

// Signer handles attestation signing operations.
type Signer struct {
	privateKey      ed25519.PrivateKey
	publicKey       ed25519.PublicKey
	keyID           string
	evaluator       string
	instanceBaseURL string // Base URL for attestation URIs
}

// NewSigner creates a new Signer with a fresh Ed25519 key pair.
// The instanceBaseURL is used to construct attestation URIs (e.g., "https://example.com").
func NewSigner(evaluator, instanceBaseURL string) (*Signer, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key pair: %w", err)
	}

	// Key ID is first 8 bytes of SHA-256 of public key, hex encoded
	hash := sha256.Sum256(pub)
	keyID := hex.EncodeToString(hash[:8])

	return &Signer{
		privateKey:      priv,
		publicKey:       pub,
		keyID:           keyID,
		evaluator:       evaluator,
		instanceBaseURL: strings.TrimSuffix(instanceBaseURL, "/"),
	}, nil
}

// NewSignerFromKey creates a Signer from an existing private key.
// The key should be 64 bytes (Ed25519 private key).
func NewSignerFromKey(evaluator, instanceBaseURL string, privateKey []byte) (*Signer, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d, got %d", ed25519.PrivateKeySize, len(privateKey))
	}

	priv := ed25519.PrivateKey(privateKey)
	pub := priv.Public().(ed25519.PublicKey)

	hash := sha256.Sum256(pub)
	keyID := hex.EncodeToString(hash[:8])

	return &Signer{
		privateKey:      priv,
		publicKey:       pub,
		keyID:           keyID,
		evaluator:       evaluator,
		instanceBaseURL: strings.TrimSuffix(instanceBaseURL, "/"),
	}, nil
}

// PublicKey returns the public key bytes.
func (s *Signer) PublicKey() []byte {
	return s.publicKey
}

// PrivateKey returns the private key bytes.
func (s *Signer) PrivateKey() []byte {
	return s.privateKey
}

// KeyID returns the key identifier.
func (s *Signer) KeyID() string {
	return s.keyID
}

// Sign creates an attestation for the given input and output.
// This follows the RecourseOS Attestation Protocol:
// 1. Derive attestation_id from content fields (excluding attestation_uri and signature)
// 2. Construct attestation_uri from instance base URL
// 3. Sign the full attestation (including attestation_uri, excluding signature)
func (s *Signer) Sign(input, output interface{}) (*Attestation, error) {
	timestamp := time.Now().UTC().Format(time.RFC3339)

	// Step 1: Build content payload for ID derivation (excludes attestation_uri and signature)
	idPayload := map[string]interface{}{
		"input":     input,
		"output":    output,
		"evaluator": s.evaluator,
		"timestamp": timestamp,
		"key_id":    s.keyID,
	}

	// Canonicalize for ID derivation
	idCanonical, err := Canonicalize(idPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to canonicalize ID payload: %w", err)
	}

	// Compute attestation ID: SHA-256(canonical).slice(0, 16).hex()
	hash := sha256.Sum256([]byte(idCanonical))
	attestationID := hex.EncodeToString(hash[:16])

	// Step 2: Construct attestation URI (URL format for TypeScript compatibility)
	attestationURI := fmt.Sprintf("%s/.well-known/attestations/%s.json", s.instanceBaseURL, attestationID)

	// Step 3: Build signed payload (includes attestation_uri, excludes signature)
	signedPayload := map[string]interface{}{
		"attestation_uri": attestationURI,
		"evaluator":       s.evaluator,
		"input":           input,
		"key_id":          s.keyID,
		"output":          output,
		"timestamp":       timestamp,
	}

	// Canonicalize the signed payload
	signedCanonical, err := Canonicalize(signedPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to canonicalize signed payload: %w", err)
	}

	// Sign the canonical payload
	signature := ed25519.Sign(s.privateKey, []byte(signedCanonical))
	signatureB64 := base64.RawURLEncoding.EncodeToString(signature)

	return &Attestation{
		Input:          input,
		Output:         output,
		Evaluator:      s.evaluator,
		Timestamp:      timestamp,
		KeyID:          s.keyID,
		AttestationURI: attestationURI,
		Signature:      signatureB64,
	}, nil
}

// Verifier handles attestation verification operations.
type Verifier struct {
	publicKeys map[string]ed25519.PublicKey // keyID -> publicKey
}

// NewVerifier creates a new Verifier.
func NewVerifier() *Verifier {
	return &Verifier{
		publicKeys: make(map[string]ed25519.PublicKey),
	}
}

// AddPublicKey registers a public key for verification.
func (v *Verifier) AddPublicKey(keyID string, publicKey []byte) error {
	if len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size: expected %d, got %d", ed25519.PublicKeySize, len(publicKey))
	}
	v.publicKeys[keyID] = ed25519.PublicKey(publicKey)
	return nil
}

// Verify checks the attestation signature.
// Returns nil if valid, error if invalid.
func (v *Verifier) Verify(attestation *Attestation) error {
	// Look up the public key
	publicKey, ok := v.publicKeys[attestation.KeyID]
	if !ok {
		return fmt.Errorf("unknown key ID: %s", attestation.KeyID)
	}

	// Reconstruct the signed payload (includes attestation_uri, excludes signature)
	signedPayload := map[string]interface{}{
		"attestation_uri": attestation.AttestationURI,
		"evaluator":       attestation.Evaluator,
		"input":           attestation.Input,
		"key_id":          attestation.KeyID,
		"output":          attestation.Output,
		"timestamp":       attestation.Timestamp,
	}

	// Canonicalize the signed payload
	signedCanonical, err := Canonicalize(signedPayload)
	if err != nil {
		return fmt.Errorf("failed to canonicalize signed payload: %w", err)
	}

	// Decode the signature
	signature, err := base64.RawURLEncoding.DecodeString(attestation.Signature)
	if err != nil {
		return fmt.Errorf("failed to decode signature: %w", err)
	}

	// Verify the signature
	if !ed25519.Verify(publicKey, []byte(signedCanonical), signature) {
		return fmt.Errorf("invalid signature")
	}

	// Verify the attestation ID matches the content
	idPayload := map[string]interface{}{
		"input":     attestation.Input,
		"output":    attestation.Output,
		"evaluator": attestation.Evaluator,
		"timestamp": attestation.Timestamp,
		"key_id":    attestation.KeyID,
	}

	idCanonical, err := Canonicalize(idPayload)
	if err != nil {
		return fmt.Errorf("failed to canonicalize ID payload: %w", err)
	}

	hash := sha256.Sum256([]byte(idCanonical))
	expectedID := hex.EncodeToString(hash[:16])

	// Extract attestation ID from URI and verify
	actualID, err := ExtractAttestationID(attestation.AttestationURI)
	if err != nil {
		return fmt.Errorf("failed to extract attestation ID: %w", err)
	}

	if actualID != expectedID {
		return fmt.Errorf("attestation ID mismatch: expected %s, got %s", expectedID, actualID)
	}

	return nil
}

// VerifyWithPublicKey verifies an attestation with a provided public key,
// without requiring pre-registration.
func VerifyWithPublicKey(attestation *Attestation, publicKey []byte) error {
	if len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size: expected %d, got %d", ed25519.PublicKeySize, len(publicKey))
	}

	// Verify the key ID matches
	hash := sha256.Sum256(publicKey)
	expectedKeyID := hex.EncodeToString(hash[:8])
	if attestation.KeyID != expectedKeyID {
		return fmt.Errorf("key ID mismatch: expected %s, got %s", expectedKeyID, attestation.KeyID)
	}

	v := NewVerifier()
	v.publicKeys[attestation.KeyID] = ed25519.PublicKey(publicKey)
	return v.Verify(attestation)
}

// ExtractAttestationID extracts the attestation ID from an attestation URI.
// Supports both URL format (.well-known/attestations/{id}.json) and URN format.
func ExtractAttestationID(uri string) (string, error) {
	// Try URL format: https://example.com/.well-known/attestations/{id}.json
	urlPattern := regexp.MustCompile(`/([a-f0-9]{32})\.json$`)
	if matches := urlPattern.FindStringSubmatch(uri); len(matches) == 2 {
		return matches[1], nil
	}

	// Try URN format: urn:recourse:attestation:{id}
	const urnPrefix = "urn:recourse:attestation:"
	if strings.HasPrefix(uri, urnPrefix) && len(uri) >= len(urnPrefix)+32 {
		return uri[len(urnPrefix):], nil
	}

	return "", fmt.Errorf("invalid attestation URI format: %s", uri)
}
