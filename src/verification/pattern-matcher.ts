/**
 * Pattern Matcher
 *
 * Automatically interprets verification command output using structured patterns.
 * This enables agents to automatically determine if evidence confirms recovery paths
 * without manual interpretation.
 */

import type { OutputPattern, AgentInterpretation } from '../core/mutation.js';

export interface MatchResult {
  matches: boolean;
  interpretation: AgentInterpretation;
  reason: string;
  extractedValue?: unknown;
}

/**
 * Match verification output against an expected pattern.
 */
export function matchPattern(
  output: string,
  exitCode: number,
  pattern: OutputPattern | undefined
): MatchResult {
  if (!pattern) {
    return {
      matches: false,
      interpretation: 'ambiguous',
      reason: 'No pattern defined for automatic matching',
    };
  }

  try {
    switch (pattern.type) {
      case 'exit_code':
        return matchExitCode(exitCode, pattern.expected_exit_code ?? 0);

      case 'json_array_not_empty':
        return matchJsonArrayNotEmpty(output);

      case 'json_field_equals':
        return matchJsonFieldEquals(output, pattern.path!, pattern.expected_value);

      case 'json_field_exists':
        return matchJsonFieldExists(output, pattern.path!);

      case 'regex':
        return matchRegex(output, pattern.regex!);

      default:
        return {
          matches: false,
          interpretation: 'ambiguous',
          reason: `Unknown pattern type: ${(pattern as OutputPattern).type}`,
        };
    }
  } catch (error) {
    return {
      matches: false,
      interpretation: 'error',
      reason: `Pattern matching failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Auto-interpret verification output using expected and failure patterns.
 */
export function interpretVerificationOutput(
  output: string,
  exitCode: number,
  expectedPattern?: OutputPattern,
  failurePattern?: OutputPattern
): MatchResult {
  // First check exit code
  if (exitCode !== 0) {
    // Non-zero exit code usually indicates error
    // Check if the output contains error indicators
    if (output.includes('error') || output.includes('Error') || output.includes('AccessDenied')) {
      return {
        matches: false,
        interpretation: 'error',
        reason: `Command failed with exit code ${exitCode}`,
      };
    }
    // Some commands return non-zero for "not found" which is valid failure signal
    if (failurePattern) {
      const failureMatch = matchPattern(output, exitCode, failurePattern);
      if (failureMatch.matches) {
        return {
          matches: false,
          interpretation: 'matches_failure',
          reason: failureMatch.reason,
        };
      }
    }
    return {
      matches: false,
      interpretation: 'error',
      reason: `Command failed with exit code ${exitCode}`,
    };
  }

  // Check expected pattern first
  if (expectedPattern) {
    const expectedMatch = matchPattern(output, exitCode, expectedPattern);
    if (expectedMatch.matches) {
      return {
        matches: true,
        interpretation: 'matches_expected',
        reason: expectedMatch.reason,
        extractedValue: expectedMatch.extractedValue,
      };
    }
  }

  // Check failure pattern
  if (failurePattern) {
    const failureMatch = matchPattern(output, exitCode, failurePattern);
    if (failureMatch.matches) {
      return {
        matches: false,
        interpretation: 'matches_failure',
        reason: failureMatch.reason,
      };
    }
  }

  // If we have an expected pattern and it didn't match, treat as failure
  if (expectedPattern) {
    return {
      matches: false,
      interpretation: 'matches_failure',
      reason: 'Expected pattern not found in output',
    };
  }

  // No patterns to match
  return {
    matches: false,
    interpretation: 'ambiguous',
    reason: 'No patterns defined for automatic matching',
  };
}

// Pattern matching implementations

function matchExitCode(actual: number, expected: number): MatchResult {
  const matches = actual === expected;
  return {
    matches,
    interpretation: matches ? 'matches_expected' : 'matches_failure',
    reason: matches ? `Exit code ${actual} matches expected ${expected}` : `Exit code ${actual} does not match expected ${expected}`,
  };
}

function matchJsonArrayNotEmpty(output: string): MatchResult {
  const trimmed = output.trim();

  // Handle empty output
  if (!trimmed || trimmed === 'null') {
    return {
      matches: false,
      interpretation: 'matches_failure',
      reason: 'Output is empty or null',
    };
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      if (parsed.length > 0) {
        return {
          matches: true,
          interpretation: 'matches_expected',
          reason: `Array contains ${parsed.length} item(s)`,
          extractedValue: parsed.length,
        };
      }
      return {
        matches: false,
        interpretation: 'matches_failure',
        reason: 'Array is empty',
      };
    }

    return {
      matches: false,
      interpretation: 'ambiguous',
      reason: 'Output is not an array',
    };
  } catch {
    return {
      matches: false,
      interpretation: 'error',
      reason: 'Failed to parse output as JSON',
    };
  }
}

function matchJsonFieldEquals(output: string, path: string, expectedValue: unknown): MatchResult {
  try {
    const parsed = JSON.parse(output.trim());
    const value = getNestedValue(parsed, path);

    if (value === undefined) {
      return {
        matches: false,
        interpretation: 'matches_failure',
        reason: `Field '${path}' not found in output`,
      };
    }

    if (value === expectedValue) {
      return {
        matches: true,
        interpretation: 'matches_expected',
        reason: `Field '${path}' equals '${expectedValue}'`,
        extractedValue: value,
      };
    }

    return {
      matches: false,
      interpretation: 'matches_failure',
      reason: `Field '${path}' is '${value}', not '${expectedValue}'`,
      extractedValue: value,
    };
  } catch {
    return {
      matches: false,
      interpretation: 'error',
      reason: 'Failed to parse output as JSON',
    };
  }
}

function matchJsonFieldExists(output: string, path: string): MatchResult {
  try {
    const parsed = JSON.parse(output.trim());
    const value = getNestedValue(parsed, path);

    if (value !== undefined && value !== null) {
      // For arrays, check if non-empty
      if (Array.isArray(value) && value.length === 0) {
        return {
          matches: false,
          interpretation: 'matches_failure',
          reason: `Field '${path}' exists but is an empty array`,
          extractedValue: value,
        };
      }

      return {
        matches: true,
        interpretation: 'matches_expected',
        reason: `Field '${path}' exists`,
        extractedValue: value,
      };
    }

    return {
      matches: false,
      interpretation: 'matches_failure',
      reason: `Field '${path}' does not exist`,
    };
  } catch {
    return {
      matches: false,
      interpretation: 'error',
      reason: 'Failed to parse output as JSON',
    };
  }
}

function matchRegex(output: string, pattern: string): MatchResult {
  try {
    const regex = new RegExp(pattern);
    const match = regex.exec(output);

    if (match) {
      return {
        matches: true,
        interpretation: 'matches_expected',
        reason: `Regex pattern matched: ${match[0]}`,
        extractedValue: match[0],
      };
    }

    return {
      matches: false,
      interpretation: 'matches_failure',
      reason: 'Regex pattern not found in output',
    };
  } catch (error) {
    return {
      matches: false,
      interpretation: 'error',
      reason: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get nested value from object using dot notation path.
 * Example: getNestedValue({a: {b: 1}}, 'a.b') => 1
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
