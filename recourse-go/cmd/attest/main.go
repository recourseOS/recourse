// Package main provides a CLI tool for attestation operations.
// Used for cross-implementation verification testing.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	"github.com/recourseOS/recourse-go/pkg/attestation"
)

const usage = `attest - Attestation signing and verification tool

Usage:
  attest sign <input.json> <output.json> [--base-url URL] [--evaluator NAME]
  attest verify <attestation.json> <pubkey-base64url>
  attest keygen

Commands:
  sign     Sign input/output to produce attestation (outputs JSON with attestation and public key)
  verify   Verify an attestation with a public key
  keygen   Generate a new keypair and output public key

Options:
  --base-url   Instance base URL (default: https://recourse.local)
  --evaluator  Evaluator name (default: recourse-go)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}

	switch os.Args[1] {
	case "sign":
		runSign(os.Args[2:])
	case "verify":
		runVerify(os.Args[2:])
	case "keygen":
		runKeygen()
	case "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runSign(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "Error: input.json and output.json paths required")
		os.Exit(1)
	}

	inputPath := args[0]
	outputPath := args[1]
	baseURL := "https://recourse.local"
	evaluator := "recourse-go"

	// Parse flags
	for i := 2; i < len(args); i++ {
		switch args[i] {
		case "--base-url":
			if i+1 < len(args) {
				baseURL = args[i+1]
				i++
			}
		case "--evaluator":
			if i+1 < len(args) {
				evaluator = args[i+1]
				i++
			}
		}
	}

	// Read input and output JSON
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading input: %v\n", err)
		os.Exit(1)
	}

	outputData, err := os.ReadFile(outputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading output: %v\n", err)
		os.Exit(1)
	}

	var input, output interface{}
	if err := json.Unmarshal(inputData, &input); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing input JSON: %v\n", err)
		os.Exit(1)
	}
	if err := json.Unmarshal(outputData, &output); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing output JSON: %v\n", err)
		os.Exit(1)
	}

	// Create signer
	signer, err := attestation.NewSigner(evaluator, baseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating signer: %v\n", err)
		os.Exit(1)
	}

	// Sign
	attest, err := signer.Sign(input, output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error signing: %v\n", err)
		os.Exit(1)
	}

	// Output attestation with public key (for cross-implementation testing)
	result := map[string]interface{}{
		"attestation":         attest,
		"public_key_base64url": base64.RawURLEncoding.EncodeToString(signer.PublicKey()),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "Error encoding result: %v\n", err)
		os.Exit(1)
	}
}

func runVerify(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "Error: attestation.json and pubkey-base64url required")
		os.Exit(1)
	}

	attestPath := args[0]
	pubkeyB64 := args[1]

	// Read attestation
	attestData, err := os.ReadFile(attestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading attestation: %v\n", err)
		os.Exit(1)
	}

	var attest attestation.Attestation
	if err := json.Unmarshal(attestData, &attest); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing attestation JSON: %v\n", err)
		os.Exit(1)
	}

	// Decode public key
	pubkey, err := base64.RawURLEncoding.DecodeString(pubkeyB64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error decoding public key: %v\n", err)
		os.Exit(1)
	}

	// Verify
	if err := attestation.VerifyWithPublicKey(&attest, pubkey); err != nil {
		fmt.Printf(`{"valid": false, "error": %q}`, err.Error())
		fmt.Println()
		os.Exit(1)
	}

	fmt.Println(`{"valid": true}`)
}

func runKeygen() {
	signer, err := attestation.NewSigner("recourse-go", "https://recourse.local")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating key: %v\n", err)
		os.Exit(1)
	}

	result := map[string]string{
		"key_id":               signer.KeyID(),
		"public_key_base64url": base64.RawURLEncoding.EncodeToString(signer.PublicKey()),
		"private_key_base64":   base64.StdEncoding.EncodeToString(signer.PrivateKey()),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(result)
}
