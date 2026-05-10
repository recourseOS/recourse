import { describe, expect, it } from 'vitest';
import { matchPattern, interpretVerificationOutput, type MatchResult } from '../src/verification/pattern-matcher.js';
import type { OutputPattern } from '../src/core/mutation.js';

describe('Pattern Matcher', () => {
  describe('matchPattern', () => {
    describe('undefined pattern', () => {
      it('returns ambiguous when pattern is undefined', () => {
        const result = matchPattern('output', 0, undefined);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('ambiguous');
        expect(result.reason).toContain('No pattern defined');
      });
    });

    describe('exit_code pattern', () => {
      it('matches when exit code equals expected', () => {
        const pattern: OutputPattern = { type: 'exit_code', expected_exit_code: 0 };
        const result = matchPattern('', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.reason).toContain('Exit code 0 matches expected 0');
      });

      it('fails when exit code does not match', () => {
        const pattern: OutputPattern = { type: 'exit_code', expected_exit_code: 0 };
        const result = matchPattern('', 1, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('does not match');
      });

      it('defaults to expected_exit_code 0 when not specified', () => {
        const pattern: OutputPattern = { type: 'exit_code' };
        const result = matchPattern('', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('handles non-zero expected exit code', () => {
        const pattern: OutputPattern = { type: 'exit_code', expected_exit_code: 2 };
        const result = matchPattern('', 2, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
      });
    });

    describe('json_array_not_empty pattern', () => {
      it('matches non-empty array', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('[{"id": "snap-123"}, {"id": "snap-456"}]', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.reason).toContain('2 item(s)');
        expect(result.extractedValue).toBe(2);
      });

      it('matches single-element array', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('["item"]', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.extractedValue).toBe(1);
      });

      it('fails on empty array', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('[]', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('empty');
      });

      it('fails on empty output', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('empty or null');
      });

      it('fails on null output', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('null', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('returns ambiguous for non-array JSON', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('{"key": "value"}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('ambiguous');
        expect(result.reason).toContain('not an array');
      });

      it('returns error for invalid JSON', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('not json', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
        expect(result.reason).toContain('parse');
      });

      it('handles whitespace around JSON', () => {
        const pattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = matchPattern('  [1, 2, 3]  \n', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.extractedValue).toBe(3);
      });
    });

    describe('json_field_equals pattern', () => {
      it('matches when field equals expected value', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = matchPattern('{"Status": "Enabled"}', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.extractedValue).toBe('Enabled');
      });

      it('fails when field does not equal expected', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = matchPattern('{"Status": "Suspended"}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain("'Suspended'");
        expect(result.extractedValue).toBe('Suspended');
      });

      it('fails when field is missing', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = matchPattern('{"OtherField": "value"}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('not found');
      });

      it('handles nested path', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Versioning.Status', expected_value: 'Enabled' };
        const result = matchPattern('{"Versioning": {"Status": "Enabled"}}', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.extractedValue).toBe('Enabled');
      });

      it('handles deeply nested path', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'a.b.c.d', expected_value: 'value' };
        const result = matchPattern('{"a": {"b": {"c": {"d": "value"}}}}', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('handles boolean expected value', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Enabled', expected_value: true };
        const result = matchPattern('{"Enabled": true}', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('handles numeric expected value', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Count', expected_value: 42 };
        const result = matchPattern('{"Count": 42}', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('returns error for invalid JSON', () => {
        const pattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = matchPattern('not json', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
      });
    });

    describe('json_field_exists pattern', () => {
      it('matches when field exists', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'VersionId' };
        const result = matchPattern('{"VersionId": "abc123"}', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.extractedValue).toBe('abc123');
      });

      it('fails when field does not exist', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'VersionId' };
        const result = matchPattern('{"OtherField": "value"}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('does not exist');
      });

      it('fails when field is null', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'VersionId' };
        const result = matchPattern('{"VersionId": null}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('fails when field is empty array', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'Snapshots' };
        const result = matchPattern('{"Snapshots": []}', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('empty array');
      });

      it('matches when field is non-empty array', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'Snapshots' };
        const result = matchPattern('{"Snapshots": [{"id": 1}]}', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('handles nested path', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'Bucket.Versioning' };
        const result = matchPattern('{"Bucket": {"Versioning": "Enabled"}}', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('fails for nested path when parent missing', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'Bucket.Versioning' };
        const result = matchPattern('{"OtherBucket": {"Versioning": "Enabled"}}', 0, pattern);
        expect(result.matches).toBe(false);
      });

      it('returns error for invalid JSON', () => {
        const pattern: OutputPattern = { type: 'json_field_exists', path: 'Field' };
        const result = matchPattern('not json', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
      });
    });

    describe('regex pattern', () => {
      it('matches when regex found', () => {
        const pattern: OutputPattern = { type: 'regex', regex: 'snapshot-\\w+' };
        const result = matchPattern('Snapshot ID: snapshot-abc123', 0, pattern);
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.extractedValue).toBe('snapshot-abc123');
      });

      it('fails when regex not found', () => {
        const pattern: OutputPattern = { type: 'regex', regex: 'snapshot-\\w+' };
        const result = matchPattern('No snapshots found', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('handles complex regex', () => {
        const pattern: OutputPattern = { type: 'regex', regex: 'PITR:\\s*(enabled|active)' };
        const result = matchPattern('Status: OK, PITR: enabled, Region: us-east-1', 0, pattern);
        expect(result.matches).toBe(true);
      });

      it('returns error for invalid regex', () => {
        const pattern: OutputPattern = { type: 'regex', regex: '(unclosed' };
        const result = matchPattern('test', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
        expect(result.reason).toContain('Invalid regex');
      });
    });

    describe('unknown pattern type', () => {
      it('returns ambiguous for unknown pattern type', () => {
        const pattern = { type: 'unknown_type' } as unknown as OutputPattern;
        const result = matchPattern('output', 0, pattern);
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('ambiguous');
        expect(result.reason).toContain('Unknown pattern type');
      });
    });
  });

  describe('interpretVerificationOutput', () => {
    describe('non-zero exit code handling', () => {
      it('returns error for non-zero exit code with error in output', () => {
        const result = interpretVerificationOutput(
          'error: Access denied',
          1
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
        expect(result.reason).toContain('exit code 1');
      });

      it('detects Error in output', () => {
        const result = interpretVerificationOutput(
          'Error: Connection refused',
          1
        );
        expect(result.interpretation).toBe('error');
      });

      it('detects AccessDenied in output', () => {
        const result = interpretVerificationOutput(
          'AccessDenied: You are not authorized',
          1
        );
        expect(result.interpretation).toBe('error');
      });

      it('checks failure pattern on non-zero exit if no error keywords', () => {
        const failurePattern: OutputPattern = { type: 'regex', regex: 'NotFound' };
        const result = interpretVerificationOutput(
          'NotFound: Resource does not exist',
          1,
          undefined,
          failurePattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('returns error for non-zero exit when no patterns match', () => {
        const result = interpretVerificationOutput(
          'Some output without keywords',
          127
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
        expect(result.reason).toContain('exit code 127');
      });
    });

    describe('expected pattern matching', () => {
      it('returns matches_expected when expected pattern matches', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Enabled"}',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
        expect(result.extractedValue).toBe('Enabled');
      });

      it('returns matches_failure when expected pattern does not match', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Disabled"}',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
        expect(result.reason).toContain('Expected pattern not found');
      });
    });

    describe('failure pattern matching', () => {
      it('returns matches_failure when failure pattern matches', () => {
        // Use a pattern that MATCHES the failure state (e.g., Status = Disabled)
        const failurePattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Disabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Disabled"}',
          0,
          undefined,
          failurePattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });
    });

    describe('combined pattern matching', () => {
      it('prioritizes expected pattern over failure pattern', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const failurePattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Disabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Enabled"}',
          0,
          expectedPattern,
          failurePattern
        );
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
      });

      it('falls through to failure pattern when expected does not match', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const failurePattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Disabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Disabled"}',
          0,
          expectedPattern,
          failurePattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });
    });

    describe('no patterns case', () => {
      it('returns ambiguous when no patterns defined', () => {
        const result = interpretVerificationOutput(
          'Some output',
          0
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('ambiguous');
        expect(result.reason).toContain('No patterns defined');
      });
    });

    describe('real-world scenarios', () => {
      it('handles S3 versioning check - enabled', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const result = interpretVerificationOutput(
          '{"Status": "Enabled", "MFADelete": "Disabled"}',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(true);
        expect(result.interpretation).toBe('matches_expected');
      });

      it('handles S3 versioning check - disabled', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'Status', expected_value: 'Enabled' };
        const failurePattern: OutputPattern = { type: 'regex', regex: '^\\{\\}$' };
        const result = interpretVerificationOutput(
          '{}',
          0,
          expectedPattern,
          failurePattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('handles RDS snapshots check - snapshots exist', () => {
        const expectedPattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = interpretVerificationOutput(
          '[{"DBSnapshotIdentifier": "snap-1"}, {"DBSnapshotIdentifier": "snap-2"}]',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(true);
        expect(result.extractedValue).toBe(2);
      });

      it('handles RDS snapshots check - no snapshots', () => {
        const expectedPattern: OutputPattern = { type: 'json_array_not_empty' };
        const result = interpretVerificationOutput(
          '[]',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });

      it('handles DynamoDB PITR check - enabled', () => {
        const expectedPattern: OutputPattern = { type: 'json_field_equals', path: 'ContinuousBackupsStatus', expected_value: 'ENABLED' };
        const result = interpretVerificationOutput(
          '{"ContinuousBackupsStatus": "ENABLED", "PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED"}}',
          0,
          expectedPattern
        );
        expect(result.matches).toBe(true);
      });

      it('handles AWS CLI error response', () => {
        const result = interpretVerificationOutput(
          'An error occurred (AccessDenied) when calling the DescribeBucketVersioning operation',
          255
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('error');
      });

      it('handles AWS CLI resource not found - returns error for outputs containing error keyword', () => {
        // Note: AWS CLI outputs with "error" keyword are treated as errors, not as expected failure conditions
        // This is because "error" typically indicates something unexpected happened
        const failurePattern: OutputPattern = { type: 'regex', regex: 'NoSuchBucket|NotFound|does not exist' };
        const result = interpretVerificationOutput(
          'An error occurred (NoSuchBucket) when calling the GetBucketVersioning operation',
          254,
          undefined,
          failurePattern
        );
        expect(result.matches).toBe(false);
        // "error" keyword in output triggers error interpretation
        expect(result.interpretation).toBe('error');
      });

      it('handles failure pattern on non-zero exit without error keywords', () => {
        // When output doesn't contain "error", "Error", or "AccessDenied", failure pattern is checked
        const failurePattern: OutputPattern = { type: 'regex', regex: 'NoSuchBucket|NotFound' };
        const result = interpretVerificationOutput(
          'NoSuchBucket: The specified bucket does not exist',
          1,
          undefined,
          failurePattern
        );
        expect(result.matches).toBe(false);
        expect(result.interpretation).toBe('matches_failure');
      });
    });
  });

  describe('edge cases', () => {
    it('handles unicode in output', () => {
      const pattern: OutputPattern = { type: 'regex', regex: '名前' };
      const result = matchPattern('名前: テスト', 0, pattern);
      expect(result.matches).toBe(true);
    });

    it('handles very large JSON output', () => {
      const largeArray = Array(1000).fill({ id: 'test', value: 123 });
      const pattern: OutputPattern = { type: 'json_array_not_empty' };
      const result = matchPattern(JSON.stringify(largeArray), 0, pattern);
      expect(result.matches).toBe(true);
      expect(result.extractedValue).toBe(1000);
    });

    it('handles empty string path in json_field_exists - does not match', () => {
      const pattern: OutputPattern = { type: 'json_field_exists', path: '' };
      const result = matchPattern('{"field": "value"}', 0, pattern);
      // Empty path splits to [''] which doesn't match any key
      expect(result.matches).toBe(false);
      expect(result.interpretation).toBe('matches_failure');
    });

    it('handles multiline output', () => {
      const pattern: OutputPattern = { type: 'regex', regex: 'Status:\\s*ACTIVE' };
      const result = matchPattern('Name: test\nStatus: ACTIVE\nRegion: us-east-1', 0, pattern);
      expect(result.matches).toBe(true);
    });

    it('handles Windows-style line endings', () => {
      const pattern: OutputPattern = { type: 'json_array_not_empty' };
      const result = matchPattern('[\r\n  {"id": 1}\r\n]', 0, pattern);
      expect(result.matches).toBe(true);
    });
  });
});
