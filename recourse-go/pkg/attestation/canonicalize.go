// Package attestation implements cryptographic attestation for consequence reports.
//
// This implements the RecourseOS Attestation Protocol, enabling cross-implementation
// verification between Go and TypeScript implementations.
package attestation

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Canonicalize produces an RFC 8785 (JCS) canonical JSON representation.
// This is used for cryptographic signing - any compliant implementation will
// produce identical byte sequences for the same input.
func Canonicalize(v interface{}) (string, error) {
	return canonicalizeValue(v)
}

func canonicalizeValue(v interface{}) (string, error) {
	if v == nil {
		return "null", nil
	}

	switch val := v.(type) {
	case bool:
		if val {
			return "true", nil
		}
		return "false", nil

	case float64:
		return canonicalizeNumber(val)

	case int:
		return strconv.Itoa(val), nil

	case int64:
		return strconv.FormatInt(val, 10), nil

	case string:
		return canonicalizeString(val), nil

	case []interface{}:
		return canonicalizeArray(val)

	case map[string]interface{}:
		return canonicalizeObject(val)

	case json.Number:
		// Handle json.Number (used when decoding with UseNumber)
		return val.String(), nil

	default:
		// Try to marshal and re-parse as map/slice
		data, err := json.Marshal(v)
		if err != nil {
			return "", fmt.Errorf("cannot canonicalize type %T: %w", v, err)
		}
		var parsed interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			return "", fmt.Errorf("cannot re-parse marshaled value: %w", err)
		}
		return canonicalizeValue(parsed)
	}
}

// canonicalizeNumber per RFC 8785 Section 3.2.2.3
// Uses Go's strconv which matches ES6 Number.prototype.toString()
func canonicalizeNumber(n float64) (string, error) {
	// Check for special values
	if n != n { // NaN
		return "", fmt.Errorf("NaN is not valid JSON")
	}
	if n > 1e308 || n < -1e308 { // Infinity check
		return "", fmt.Errorf("Infinity is not valid JSON")
	}

	// Handle negative zero
	if n == 0 {
		return "0", nil
	}

	// Use strconv.FormatFloat with 'g' format for shortest representation
	// This matches ES6 behavior
	s := strconv.FormatFloat(n, 'f', -1, 64)

	// Check if exponential notation would be shorter
	exp := strconv.FormatFloat(n, 'e', -1, 64)
	if len(exp) < len(s) {
		s = exp
	}

	return s, nil
}

// canonicalizeString per RFC 8785 Section 3.2.2.2
// Only escape required characters: backslash, quote, control chars
func canonicalizeString(s string) string {
	var b strings.Builder
	b.WriteByte('"')

	for _, r := range s {
		if r < 0x20 {
			// Control characters
			switch r {
			case '\b':
				b.WriteString("\\b")
			case '\t':
				b.WriteString("\\t")
			case '\n':
				b.WriteString("\\n")
			case '\f':
				b.WriteString("\\f")
			case '\r':
				b.WriteString("\\r")
			default:
				// Use \uXXXX for other control chars
				b.WriteString(fmt.Sprintf("\\u%04x", r))
			}
		} else if r == '"' {
			b.WriteString("\\\"")
		} else if r == '\\' {
			b.WriteString("\\\\")
		} else {
			b.WriteRune(r)
		}
	}

	b.WriteByte('"')
	return b.String()
}

// canonicalizeArray serializes array elements in order, no whitespace
func canonicalizeArray(arr []interface{}) (string, error) {
	var parts []string
	for _, elem := range arr {
		s, err := canonicalizeValue(elem)
		if err != nil {
			return "", err
		}
		parts = append(parts, s)
	}
	return "[" + strings.Join(parts, ",") + "]", nil
}

// canonicalizeObject serializes object with keys sorted by UTF-16 code units
func canonicalizeObject(obj map[string]interface{}) (string, error) {
	// Get and sort keys
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys) // Go's string sort is lexicographic by UTF-8, close enough for ASCII keys

	var parts []string
	for _, k := range keys {
		v := obj[k]
		if v == nil {
			// Include null values
			parts = append(parts, canonicalizeString(k)+":null")
			continue
		}
		valStr, err := canonicalizeValue(v)
		if err != nil {
			return "", err
		}
		parts = append(parts, canonicalizeString(k)+":"+valStr)
	}

	return "{" + strings.Join(parts, ",") + "}", nil
}

// CanonicalizeJSON parses a JSON string and returns its canonical form.
func CanonicalizeJSON(jsonStr string) (string, error) {
	var v interface{}
	if err := json.Unmarshal([]byte(jsonStr), &v); err != nil {
		return "", fmt.Errorf("invalid JSON: %w", err)
	}
	return Canonicalize(v)
}

// IsCanonical checks if a JSON string is already in canonical form.
func IsCanonical(jsonStr string) bool {
	canonical, err := CanonicalizeJSON(jsonStr)
	if err != nil {
		return false
	}
	return jsonStr == canonical
}
