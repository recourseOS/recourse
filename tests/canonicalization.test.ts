/**
 * RFC 8785 Canonicalization Tests
 *
 * Tests the JCS (JSON Canonicalization Scheme) implementation against
 * the test vectors defined in fixtures/canonicalization-vectors.json.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canonicalize,
  isCanonical,
  parseAndCanonicalize,
  CanonicalizeError,
} from '../src/attestation/canonicalize';

// Load test vectors
const vectorsPath = join(__dirname, 'fixtures/canonicalization-vectors.json');
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf-8'));

describe('RFC 8785 Canonicalization', () => {
  describe('Basic vectors', () => {
    for (const vector of vectors.vectors) {
      it(`${vector.id}: ${vector.description}`, () => {
        // Handle special case for negative zero (can't be represented in JSON)
        const input = vector.use_negative_zero ? -0 : vector.input;
        const result = canonicalize(input);
        expect(result).toBe(vector.expected);
      });
    }
  });

  describe('Number edge cases', () => {
    for (const vector of vectors.number_edge_cases) {
      it(vector.id, () => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      });
    }
  });

  describe('Negative vectors (should throw)', () => {
    it('nan-not-allowed: NaN throws CanonicalizeError', () => {
      expect(() => canonicalize(NaN)).toThrow(CanonicalizeError);
      expect(() => canonicalize(NaN)).toThrow('NaN is not valid JSON');
    });

    it('infinity-not-allowed: Infinity throws CanonicalizeError', () => {
      expect(() => canonicalize(Infinity)).toThrow(CanonicalizeError);
      expect(() => canonicalize(Infinity)).toThrow('Infinity is not valid JSON');
    });

    it('negative-infinity-not-allowed: -Infinity throws CanonicalizeError', () => {
      expect(() => canonicalize(-Infinity)).toThrow(CanonicalizeError);
      expect(() => canonicalize(-Infinity)).toThrow('Infinity is not valid JSON');
    });

    it('undefined-not-allowed: undefined throws CanonicalizeError', () => {
      expect(() => canonicalize(undefined)).toThrow(CanonicalizeError);
      expect(() => canonicalize(undefined)).toThrow('undefined is not valid JSON');
    });

    it('circular-reference: circular references throw CanonicalizeError', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      expect(() => canonicalize(obj)).toThrow(CanonicalizeError);
      expect(() => canonicalize(obj)).toThrow('Circular reference detected');
    });

    it('bigint-not-allowed: BigInt throws CanonicalizeError', () => {
      expect(() => canonicalize(BigInt(9007199254740992))).toThrow(CanonicalizeError);
      expect(() => canonicalize(BigInt(9007199254740992))).toThrow('BigInt is not valid JSON');
    });

    it('function-not-allowed: functions throw CanonicalizeError', () => {
      expect(() => canonicalize(() => {})).toThrow(CanonicalizeError);
      expect(() => canonicalize(() => {})).toThrow('Function is not valid JSON');
    });

    it('symbol-not-allowed: symbols throw CanonicalizeError', () => {
      expect(() => canonicalize(Symbol('test'))).toThrow(CanonicalizeError);
      expect(() => canonicalize(Symbol('test'))).toThrow('Symbol is not valid JSON');
    });

    it('date-not-allowed: Date objects throw CanonicalizeError', () => {
      expect(() => canonicalize(new Date())).toThrow(CanonicalizeError);
      expect(() => canonicalize(new Date())).toThrow('Date objects must be converted');
    });

    it('map-not-allowed: Map objects throw CanonicalizeError', () => {
      expect(() => canonicalize(new Map())).toThrow(CanonicalizeError);
      expect(() => canonicalize(new Map())).toThrow('Map and Set must be converted');
    });

    it('set-not-allowed: Set objects throw CanonicalizeError', () => {
      expect(() => canonicalize(new Set())).toThrow(CanonicalizeError);
      expect(() => canonicalize(new Set())).toThrow('Map and Set must be converted');
    });
  });

  describe('Negative zero handling', () => {
    it('serializes -0 as "0"', () => {
      expect(canonicalize(-0)).toBe('0');
      expect(canonicalize(0)).toBe('0');
      // Both should produce identical output
      expect(canonicalize(-0)).toBe(canonicalize(0));
    });
  });

  describe('Unicode key ordering', () => {
    it('orders keys by UTF-16 code units (ASCII before high Unicode)', () => {
      // 'e' (U+0065) < 'É' (U+00C9) < 'é' (U+00E9)
      const input = { 'é': 1, 'e': 2, 'É': 3 };
      const result = canonicalize(input);
      expect(result).toBe('{"e":2,"É":3,"é":1}');
    });

    it('orders numeric string keys as strings, not numbers', () => {
      const input = { '10': 'a', '2': 'b', '1': 'c' };
      const result = canonicalize(input);
      // String ordering: "1" < "10" < "2"
      expect(result).toBe('{"1":"c","10":"a","2":"b"}');
    });

    it('handles empty string key (sorts first)', () => {
      const input = { 'a': 1, '': 2, 'b': 3 };
      const result = canonicalize(input);
      expect(result).toBe('{"":2,"a":1,"b":3}');
    });
  });

  describe('String escaping', () => {
    it('escapes all control characters (0x00-0x1F)', () => {
      // Test a few key control characters
      expect(canonicalize('\x00')).toBe('"\\u0000"');
      expect(canonicalize('\x01')).toBe('"\\u0001"');
      expect(canonicalize('\x1f')).toBe('"\\u001f"');
    });

    it('uses short escapes where available', () => {
      expect(canonicalize('\b')).toBe('"\\b"');
      expect(canonicalize('\t')).toBe('"\\t"');
      expect(canonicalize('\n')).toBe('"\\n"');
      expect(canonicalize('\f')).toBe('"\\f"');
      expect(canonicalize('\r')).toBe('"\\r"');
    });

    it('does not escape non-ASCII Unicode', () => {
      // These should pass through unescaped
      expect(canonicalize('café')).toBe('"café"');
      expect(canonicalize('日本語')).toBe('"日本語"');
      expect(canonicalize('🎉')).toBe('"🎉"');
    });

    it('escapes backslash and quote', () => {
      expect(canonicalize('a\\b')).toBe('"a\\\\b"');
      expect(canonicalize('a"b')).toBe('"a\\"b"');
      expect(canonicalize('a\\"b')).toBe('"a\\\\\\"b"');
    });
  });

  describe('Object property handling', () => {
    it('skips undefined properties', () => {
      const input = { a: 1, b: undefined, c: 3 };
      const result = canonicalize(input);
      expect(result).toBe('{"a":1,"c":3}');
    });

    it('includes null properties', () => {
      const input = { a: 1, b: null, c: 3 };
      const result = canonicalize(input);
      expect(result).toBe('{"a":1,"b":null,"c":3}');
    });
  });

  describe('isCanonical()', () => {
    it('returns true for canonical JSON', () => {
      expect(isCanonical('{"a":1,"b":2}')).toBe(true);
      expect(isCanonical('[]')).toBe(true);
      expect(isCanonical('null')).toBe(true);
      expect(isCanonical('"hello"')).toBe(true);
    });

    it('returns false for non-canonical JSON', () => {
      // Whitespace
      expect(isCanonical('{ "a": 1 }')).toBe(false);
      // Wrong key order
      expect(isCanonical('{"b":2,"a":1}')).toBe(false);
      // Trailing zeros in number
      expect(isCanonical('1.0')).toBe(false);
    });

    it('returns false for invalid JSON', () => {
      expect(isCanonical('not json')).toBe(false);
      expect(isCanonical('')).toBe(false);
    });
  });

  describe('parseAndCanonicalize()', () => {
    it('canonicalizes non-canonical JSON strings', () => {
      expect(parseAndCanonicalize('{ "b": 2, "a": 1 }')).toBe('{"a":1,"b":2}');
      expect(parseAndCanonicalize('  [ 1,  2,  3 ]  ')).toBe('[1,2,3]');
    });

    it('throws for invalid JSON', () => {
      expect(() => parseAndCanonicalize('not json')).toThrow();
    });
  });

  describe('Complex nested structures', () => {
    it('handles deeply nested objects with correct ordering at each level', () => {
      const input = {
        z: {
          b: { x: 1, a: 2 },
          a: { z: 3, m: 4 },
        },
        a: {
          c: { y: 5, b: 6 },
          a: { x: 7, a: 8 },
        },
      };
      const result = canonicalize(input);
      // Verify outer keys sorted, inner keys sorted at each level
      expect(result).toBe(
        '{"a":{"a":{"a":8,"x":7},"c":{"b":6,"y":5}},"z":{"a":{"m":4,"z":3},"b":{"a":2,"x":1}}}'
      );
    });

    it('handles arrays of mixed objects', () => {
      const input = [
        { z: 1, a: 2 },
        { b: 3, a: 4 },
        null,
        [{ x: 5, m: 6 }],
      ];
      const result = canonicalize(input);
      expect(result).toBe('[{"a":2,"z":1},{"a":4,"b":3},null,[{"m":6,"x":5}]]');
    });
  });

  describe('Attestation-specific scenarios', () => {
    it('canonicalizes a complete attestation payload', () => {
      const attestation = {
        signature: 'abc123', // Should be excluded in real signing, but included here
        timestamp: '2026-05-01T12:00:00Z',
        key_id: 'prod-key-001',
        evaluator: 'recourse:blast-radius:1.0',
        output: {
          verdict: 'BLOCKED',
          tier: 'UNRECOVERABLE',
          reason: 'No recovery mechanism',
        },
        input: {
          tool: 'terraform',
          action: 'destroy',
          target: 'aws_rds_cluster.main',
        },
      };

      const result = canonicalize(attestation);

      // Verify keys are sorted at all levels
      const parsed = JSON.parse(result);
      const keys = Object.keys(parsed);
      expect(keys).toEqual(['evaluator', 'input', 'key_id', 'output', 'signature', 'timestamp']);

      // Verify no structural whitespace (whitespace between tokens)
      // Replace string contents with 'X' to check only structural whitespace
      const withoutStrings = result.replace(/"[^"]*"/g, '"X"');
      expect(withoutStrings).not.toMatch(/\s/);
    });

    it('produces identical output for semantically equivalent inputs', () => {
      const input1 = { b: 2, a: 1, c: { z: 26, a: 1 } };
      const input2 = { a: 1, c: { a: 1, z: 26 }, b: 2 };

      expect(canonicalize(input1)).toBe(canonicalize(input2));
    });
  });
});
