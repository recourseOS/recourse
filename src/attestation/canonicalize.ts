/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation
 * https://www.rfc-editor.org/rfc/rfc8785
 *
 * This module provides deterministic JSON serialization for cryptographic
 * signing. Any two compliant implementations will produce identical byte
 * sequences for the same input, enabling signature verification.
 *
 * Key properties:
 * - Object keys sorted lexicographically by UTF-16 code units
 * - No whitespace between tokens
 * - Numbers serialized per ES6 specification
 * - Strings minimally escaped (only required escapes)
 */

export class CanonicalizeError extends Error {
  constructor(message: string, public readonly value?: unknown) {
    super(message);
    this.name = 'CanonicalizeError';
  }
}

/**
 * Canonicalize a JavaScript value to RFC 8785 JSON string.
 *
 * @param value - Any JSON-compatible value
 * @returns Canonical JSON string
 * @throws CanonicalizeError for non-JSON values (undefined, NaN, Infinity, BigInt, etc.)
 */
export function canonicalize(value: unknown): string {
  const seen = new WeakSet<object>();
  return serializeValue(value, seen);
}

function serializeValue(value: unknown, seen: WeakSet<object>): string {
  // Handle null first (typeof null === 'object')
  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  switch (type) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      return serializeNumber(value as number);

    case 'string':
      return serializeString(value as string);

    case 'object':
      return serializeObject(value as object, seen);

    case 'undefined':
      throw new CanonicalizeError('undefined is not valid JSON', value);

    case 'bigint':
      throw new CanonicalizeError('BigInt is not valid JSON', value);

    case 'symbol':
      throw new CanonicalizeError('Symbol is not valid JSON', value);

    case 'function':
      throw new CanonicalizeError('Function is not valid JSON', value);

    default:
      throw new CanonicalizeError(`Unknown type: ${type}`, value);
  }
}

/**
 * Serialize a number per RFC 8785 Section 3.2.2.3
 *
 * Uses ES6 Number.prototype.toString() which matches RFC 8785 requirements:
 * - No leading zeros (except for fractional numbers)
 * - No trailing zeros after decimal point
 * - Uses exponential notation for very large/small numbers
 * - Negative zero serializes as 0
 */
function serializeNumber(n: number): string {
  // Check for non-finite values (NaN, Infinity, -Infinity)
  if (!Number.isFinite(n)) {
    if (Number.isNaN(n)) {
      throw new CanonicalizeError('NaN is not valid JSON', n);
    }
    throw new CanonicalizeError('Infinity is not valid JSON', n);
  }

  // Handle negative zero (IEEE 754 -0 must serialize as "0")
  if (Object.is(n, -0)) {
    return '0';
  }

  // ES6 toString() produces RFC 8785 compliant output for finite numbers
  return String(n);
}

/**
 * Serialize a string per RFC 8785 Section 3.2.2.2
 *
 * Only escape characters that MUST be escaped:
 * - Backslash (\) -> \\
 * - Double quote (") -> \"
 * - Control characters (0x00-0x1F) -> \uXXXX or short form
 *
 * Non-ASCII characters pass through unescaped (UTF-8 in output).
 */
function serializeString(s: string): string {
  let result = '"';

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    const code = s.charCodeAt(i);

    if (code < 0x20) {
      // Control characters (0x00-0x1F) - use short escape or \uXXXX
      switch (code) {
        case 0x08: result += '\\b'; break;  // backspace
        case 0x09: result += '\\t'; break;  // tab
        case 0x0a: result += '\\n'; break;  // newline
        case 0x0c: result += '\\f'; break;  // form feed
        case 0x0d: result += '\\r'; break;  // carriage return
        default:
          // Other control characters use \uXXXX
          result += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else if (char === '"') {
      result += '\\"';
    } else if (char === '\\') {
      result += '\\\\';
    } else {
      // All other characters pass through unescaped
      result += char;
    }
  }

  result += '"';
  return result;
}

/**
 * Serialize an object or array per RFC 8785 Section 3.2.3
 *
 * Arrays: Elements serialized in order, no whitespace
 * Objects: Keys sorted by UTF-16 code units, no whitespace
 */
function serializeObject(obj: object, seen: WeakSet<object>): string {
  // Detect circular references
  if (seen.has(obj)) {
    throw new CanonicalizeError('Circular reference detected', obj);
  }
  seen.add(obj);

  try {
    if (Array.isArray(obj)) {
      return serializeArray(obj, seen);
    }

    // Handle other built-in types that shouldn't appear in JSON
    if (obj instanceof Date) {
      // Date objects are not directly JSON-serializable in canonical form
      // They should be converted to ISO strings before canonicalization
      throw new CanonicalizeError(
        'Date objects must be converted to ISO strings before canonicalization',
        obj
      );
    }

    if (obj instanceof Map || obj instanceof Set) {
      throw new CanonicalizeError(
        'Map and Set must be converted to objects/arrays before canonicalization',
        obj
      );
    }

    return serializePlainObject(obj as Record<string, unknown>, seen);
  } finally {
    seen.delete(obj);
  }
}

function serializeArray(arr: unknown[], seen: WeakSet<object>): string {
  const elements = arr.map(element => serializeValue(element, seen));
  return '[' + elements.join(',') + ']';
}

/**
 * Serialize a plain object with keys sorted by UTF-16 code units.
 *
 * RFC 8785 Section 3.2.3: "The properties are sorted in lexicographic
 * order based on the Unicode code points of the property names."
 *
 * In JavaScript, string comparison with < uses UTF-16 code unit comparison,
 * which is equivalent to what RFC 8785 requires (Unicode code points for
 * BMP characters, which covers all common cases).
 */
function serializePlainObject(
  obj: Record<string, unknown>,
  seen: WeakSet<object>
): string {
  // Get all enumerable own property keys
  const keys = Object.keys(obj);

  // Sort keys by UTF-16 code units (JavaScript default string comparison)
  // This is lexicographic comparison by Unicode code points for BMP
  keys.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const members: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    // Skip undefined values (they're not valid JSON members)
    if (value === undefined) {
      continue;
    }
    const serializedKey = serializeString(key);
    const serializedValue = serializeValue(value, seen);
    members.push(serializedKey + ':' + serializedValue);
  }

  return '{' + members.join(',') + '}';
}

/**
 * Verify that a JSON string is in canonical form.
 *
 * @param json - JSON string to verify
 * @returns true if the string is in canonical form
 */
export function isCanonical(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    const recanonical = canonicalize(parsed);
    return json === recanonical;
  } catch {
    return false;
  }
}

/**
 * Parse JSON and return canonical form.
 *
 * @param json - JSON string (may be non-canonical)
 * @returns Canonical JSON string
 */
export function parseAndCanonicalize(json: string): string {
  const parsed = JSON.parse(json);
  return canonicalize(parsed);
}
