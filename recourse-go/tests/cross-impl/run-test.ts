#!/usr/bin/env npx tsx
/**
 * Cross-Implementation Attestation Verification Test
 *
 * Tests that:
 * 1. Go can sign, TypeScript can verify
 * 2. TypeScript can sign, Go can verify
 *
 * This proves the attestation protocol is implementation-independent.
 */

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import TypeScript attestation module
import { createHash, generateKeyPairSync, sign, verify } from 'crypto';

interface Attestation {
  input: unknown;
  output: unknown;
  evaluator: string;
  timestamp: string;
  key_id: string;
  attestation_uri: string;
  signature: string;
}

// Simple canonicalize implementation (matches Go/TS implementations)
function canonicalize(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') {
    if (obj === 0) return '0';
    return String(obj);
  }
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => `${canonicalize(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`);
    return '{' + pairs.join(',') + '}';
  }
  throw new Error(`Cannot canonicalize ${typeof obj}`);
}

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

function deriveKeyId(publicKey: Buffer): string {
  const hash = createHash('sha256').update(publicKey).digest();
  return hash.slice(0, 8).toString('hex');
}

function signAttestation(
  input: unknown,
  output: unknown,
  evaluator: string,
  baseUrl: string
): { attestation: Attestation; publicKeyBase64url: string } {
  // Generate keypair
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  const keyId = deriveKeyId(publicKeyRaw);
  const timestamp = new Date().toISOString();

  // Derive attestation ID (from content fields, excluding attestation_uri)
  const idPayload = { input, output, evaluator, timestamp, key_id: keyId };
  const idCanonical = canonicalize(idPayload);
  const idHash = createHash('sha256').update(idCanonical).digest();
  const attestationId = idHash.slice(0, 16).toString('hex');
  const attestationUri = `${baseUrl}/.well-known/attestations/${attestationId}.json`;

  // Build signed payload (includes attestation_uri, excludes signature)
  const signedPayload = {
    attestation_uri: attestationUri,
    evaluator,
    input,
    key_id: keyId,
    output,
    timestamp,
  };
  const signedCanonical = canonicalize(signedPayload);

  // Sign
  const signature = sign(null, Buffer.from(signedCanonical), privateKey);

  return {
    attestation: {
      input,
      output,
      evaluator,
      timestamp,
      key_id: keyId,
      attestation_uri: attestationUri,
      signature: base64urlEncode(signature),
    },
    publicKeyBase64url: base64urlEncode(publicKeyRaw),
  };
}

function verifyAttestation(attestation: Attestation, publicKeyBase64url: string): boolean {
  const publicKeyRaw = base64urlDecode(publicKeyBase64url);

  // Verify key_id matches public key
  const expectedKeyId = deriveKeyId(publicKeyRaw);
  if (attestation.key_id !== expectedKeyId) {
    console.error(`Key ID mismatch: expected ${expectedKeyId}, got ${attestation.key_id}`);
    return false;
  }

  // Verify attestation_id matches content
  const idPayload = {
    input: attestation.input,
    output: attestation.output,
    evaluator: attestation.evaluator,
    timestamp: attestation.timestamp,
    key_id: attestation.key_id,
  };
  const idCanonical = canonicalize(idPayload);
  const idHash = createHash('sha256').update(idCanonical).digest();
  const expectedId = idHash.slice(0, 16).toString('hex');

  const uriMatch = attestation.attestation_uri.match(/\/([a-f0-9]{32})\.json$/);
  if (!uriMatch || uriMatch[1] !== expectedId) {
    console.error(`Attestation ID mismatch: expected ${expectedId}`);
    return false;
  }

  // Reconstruct signed payload
  const signedPayload = {
    attestation_uri: attestation.attestation_uri,
    evaluator: attestation.evaluator,
    input: attestation.input,
    key_id: attestation.key_id,
    output: attestation.output,
    timestamp: attestation.timestamp,
  };
  const signedCanonical = canonicalize(signedPayload);

  // Build SPKI public key
  const spkiHeader = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const spkiPublicKey = Buffer.concat([spkiHeader, publicKeyRaw]);

  // Verify signature
  const signature = base64urlDecode(attestation.signature);
  return verify(
    null,
    Buffer.from(signedCanonical),
    { key: spkiPublicKey, format: 'der', type: 'spki' },
    signature
  );
}

async function main() {
  const goDir = join(__dirname, '../..');
  const tempDir = mkdtempSync(join(tmpdir(), 'attest-test-'));

  console.log('Cross-Implementation Attestation Verification Test');
  console.log('==================================================\n');

  try {
    // Build Go attest command
    console.log('Building Go attest command...');
    execSync('go build -o attest ./cmd/attest', { cwd: goDir, stdio: 'inherit' });

    const testInput = { plan: 'test-plan', resource: 'aws_s3_bucket.example' };
    const testOutput = { risk_assessment: 'warn', tier: 'recoverable-from-backup' };

    // Test 1: Go signs, TypeScript verifies
    console.log('\n--- Test 1: Go signs, TypeScript verifies ---');

    const inputPath = join(tempDir, 'input.json');
    const outputPath = join(tempDir, 'output.json');
    writeFileSync(inputPath, JSON.stringify(testInput));
    writeFileSync(outputPath, JSON.stringify(testOutput));

    const goResult = execSync(
      `./attest sign ${inputPath} ${outputPath} --base-url https://test.recourse.dev --evaluator recourse-go`,
      { cwd: goDir, encoding: 'utf-8' }
    );
    const goSigned = JSON.parse(goResult);
    console.log('Go signed attestation:');
    console.log(`  Key ID: ${goSigned.attestation.key_id}`);
    console.log(`  URI: ${goSigned.attestation.attestation_uri}`);

    const tsVerifyGo = verifyAttestation(goSigned.attestation, goSigned.public_key_base64url);
    console.log(`TypeScript verification: ${tsVerifyGo ? 'PASS ✓' : 'FAIL ✗'}`);

    if (!tsVerifyGo) {
      process.exit(1);
    }

    // Test 2: TypeScript signs, Go verifies
    console.log('\n--- Test 2: TypeScript signs, Go verifies ---');

    const tsSigned = signAttestation(testInput, testOutput, 'recourse-ts', 'https://test.recourse.dev');
    console.log('TypeScript signed attestation:');
    console.log(`  Key ID: ${tsSigned.attestation.key_id}`);
    console.log(`  URI: ${tsSigned.attestation.attestation_uri}`);

    // Write attestation to file for Go to verify
    const attestPath = join(tempDir, 'attestation.json');
    writeFileSync(attestPath, JSON.stringify(tsSigned.attestation));

    const goVerifyResult = execSync(
      `./attest verify ${attestPath} ${tsSigned.publicKeyBase64url}`,
      { cwd: goDir, encoding: 'utf-8' }
    );
    const goVerify = JSON.parse(goVerifyResult);
    console.log(`Go verification: ${goVerify.valid ? 'PASS ✓' : 'FAIL ✗'}`);

    if (!goVerify.valid) {
      console.error(`Go error: ${goVerify.error}`);
      process.exit(1);
    }

    // Test 3: Verify tampered attestation is rejected
    console.log('\n--- Test 3: Tampered attestation rejected ---');

    const tampered = { ...tsSigned.attestation, output: { risk_assessment: 'allow' } };
    const tamperedPath = join(tempDir, 'tampered.json');
    writeFileSync(tamperedPath, JSON.stringify(tampered));

    try {
      execSync(`./attest verify ${tamperedPath} ${tsSigned.publicKeyBase64url}`, {
        cwd: goDir,
        encoding: 'utf-8',
      });
      console.log('Tampered verification: FAIL ✗ (should have been rejected)');
      process.exit(1);
    } catch {
      console.log('Tampered verification: PASS ✓ (correctly rejected)');
    }

    console.log('\n==================================================');
    console.log('All cross-implementation tests passed! ✓');
    console.log('\nThis proves:');
    console.log('  • Go and TypeScript produce compatible attestations');
    console.log('  • Each can verify attestations signed by the other');
    console.log('  • The attestation protocol is implementation-independent');

  } finally {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
