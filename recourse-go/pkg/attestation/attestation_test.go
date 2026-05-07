package attestation

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestCanonicalize(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected string
	}{
		{
			name:     "null",
			input:    nil,
			expected: "null",
		},
		{
			name:     "true",
			input:    true,
			expected: "true",
		},
		{
			name:     "false",
			input:    false,
			expected: "false",
		},
		{
			name:     "integer",
			input:    float64(42),
			expected: "42",
		},
		{
			name:     "negative integer",
			input:    float64(-17),
			expected: "-17",
		},
		{
			name:     "decimal",
			input:    float64(3.14),
			expected: "3.14",
		},
		{
			name:     "simple string",
			input:    "hello",
			expected: `"hello"`,
		},
		{
			name:     "string with quotes",
			input:    `say "hello"`,
			expected: `"say \"hello\""`,
		},
		{
			name:     "string with backslash",
			input:    `path\to\file`,
			expected: `"path\\to\\file"`,
		},
		{
			name:     "string with newline",
			input:    "line1\nline2",
			expected: `"line1\nline2"`,
		},
		{
			name:     "empty array",
			input:    []interface{}{},
			expected: "[]",
		},
		{
			name:     "array with values",
			input:    []interface{}{float64(1), float64(2), float64(3)},
			expected: "[1,2,3]",
		},
		{
			name:     "empty object",
			input:    map[string]interface{}{},
			expected: "{}",
		},
		{
			name: "object with sorted keys",
			input: map[string]interface{}{
				"b": float64(2),
				"a": float64(1),
				"c": float64(3),
			},
			expected: `{"a":1,"b":2,"c":3}`,
		},
		{
			name: "nested object",
			input: map[string]interface{}{
				"outer": map[string]interface{}{
					"inner": "value",
				},
			},
			expected: `{"outer":{"inner":"value"}}`,
		},
		{
			name: "mixed array",
			input: []interface{}{
				"string",
				float64(42),
				true,
				nil,
			},
			expected: `["string",42,true,null]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Canonicalize(tt.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestCanonicalizeJSON(t *testing.T) {
	// Test that parsing JSON and re-canonicalizing produces expected output
	jsonStr := `{"z":1,"a":2,"m":3}`
	expected := `{"a":2,"m":3,"z":1}`

	result, err := CanonicalizeJSON(jsonStr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestIsCanonical(t *testing.T) {
	canonical := `{"a":1,"b":2}`
	nonCanonical := `{"b":2,"a":1}`

	if !IsCanonical(canonical) {
		t.Error("expected canonical JSON to be detected as canonical")
	}
	if IsCanonical(nonCanonical) {
		t.Error("expected non-canonical JSON to be detected as non-canonical")
	}
}

func TestSignerCreation(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	if len(signer.PublicKey()) != ed25519.PublicKeySize {
		t.Errorf("expected public key size %d, got %d", ed25519.PublicKeySize, len(signer.PublicKey()))
	}

	if len(signer.PrivateKey()) != ed25519.PrivateKeySize {
		t.Errorf("expected private key size %d, got %d", ed25519.PrivateKeySize, len(signer.PrivateKey()))
	}

	// Verify key ID is derived from public key
	hash := sha256.Sum256(signer.PublicKey())
	expectedKeyID := hex.EncodeToString(hash[:8])
	if signer.KeyID() != expectedKeyID {
		t.Errorf("expected key ID %s, got %s", expectedKeyID, signer.KeyID())
	}
}

func TestSignerFromKey(t *testing.T) {
	// Create a signer and save its key
	original, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create original signer: %v", err)
	}

	// Recreate signer from saved key
	restored, err := NewSignerFromKey("recourse-go/test", "https://test.recourse.dev", original.PrivateKey())
	if err != nil {
		t.Fatalf("failed to create signer from key: %v", err)
	}

	// Verify key IDs match
	if original.KeyID() != restored.KeyID() {
		t.Errorf("key ID mismatch: original %s, restored %s", original.KeyID(), restored.KeyID())
	}
}

func TestSignAndVerify(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	input := map[string]interface{}{
		"plan": "test-plan",
	}
	output := map[string]interface{}{
		"risk_assessment": "allow",
		"tier":            "reversible",
	}

	// Sign the attestation
	attestation, err := signer.Sign(input, output)
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	// Verify attestation structure
	if attestation.Evaluator != "recourse-go/test" {
		t.Errorf("expected evaluator 'recourse-go/test', got %s", attestation.Evaluator)
	}
	if attestation.KeyID != signer.KeyID() {
		t.Errorf("key ID mismatch")
	}
	if attestation.AttestationURI == "" {
		t.Error("attestation URI should not be empty")
	}
	if attestation.Signature == "" {
		t.Error("signature should not be empty")
	}

	// Verify the attestation
	verifier := NewVerifier()
	if err := verifier.AddPublicKey(signer.KeyID(), signer.PublicKey()); err != nil {
		t.Fatalf("failed to add public key: %v", err)
	}

	if err := verifier.Verify(attestation); err != nil {
		t.Errorf("verification failed: %v", err)
	}
}

func TestVerifyWithPublicKey(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	attestation, err := signer.Sign(map[string]interface{}{"test": true}, map[string]interface{}{"result": "ok"})
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	// Verify with public key
	if err := VerifyWithPublicKey(attestation, signer.PublicKey()); err != nil {
		t.Errorf("verification failed: %v", err)
	}
}

func TestVerifyTamperedAttestation(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	attestation, err := signer.Sign(map[string]interface{}{"test": true}, map[string]interface{}{"result": "ok"})
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	verifier := NewVerifier()
	if err := verifier.AddPublicKey(signer.KeyID(), signer.PublicKey()); err != nil {
		t.Fatalf("failed to add public key: %v", err)
	}

	// Tamper with the output
	tampered := *attestation
	tampered.Output = map[string]interface{}{"result": "tampered"}

	if err := verifier.Verify(&tampered); err == nil {
		t.Error("expected verification to fail for tampered attestation")
	}
}

func TestVerifyUnknownKey(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	attestation, err := signer.Sign(map[string]interface{}{"test": true}, map[string]interface{}{"result": "ok"})
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	// Create verifier without the public key
	verifier := NewVerifier()

	err = verifier.Verify(attestation)
	if err == nil {
		t.Error("expected verification to fail for unknown key")
	}
}

func TestAttestationJSONRoundTrip(t *testing.T) {
	signer, err := NewSigner("recourse-go/test", "https://test.recourse.dev")
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	original, err := signer.Sign(
		map[string]interface{}{"input": "test"},
		map[string]interface{}{"output": "result"},
	)
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	// Marshal to JSON
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Unmarshal back
	var restored Attestation
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	// Verify the restored attestation
	if err := VerifyWithPublicKey(&restored, signer.PublicKey()); err != nil {
		t.Errorf("verification of restored attestation failed: %v", err)
	}
}

func TestExtractAttestationID(t *testing.T) {
	validURI := "urn:recourse:attestation:0123456789abcdef0123456789abcdef"
	id, err := ExtractAttestationID(validURI)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "0123456789abcdef0123456789abcdef" {
		t.Errorf("expected ID '0123456789abcdef0123456789abcdef', got %s", id)
	}

	// Test invalid URIs
	invalidURIs := []string{
		"invalid",
		"urn:recourse:attestation:",
		"urn:recourse:attestation:short",
	}
	for _, uri := range invalidURIs {
		_, err := ExtractAttestationID(uri)
		if err == nil {
			t.Errorf("expected error for invalid URI: %s", uri)
		}
	}
}
