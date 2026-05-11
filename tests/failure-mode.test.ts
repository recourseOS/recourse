import { describe, it, expect } from 'vitest';
import {
  checkEvidenceFailures,
  applyFailureMode,
  DEFAULT_FAILURE_MODE,
  PRO_DEFAULT_FAILURE_MODE,
} from '../src/core/failure-mode.js';

describe('failure-mode', () => {
  describe('checkEvidenceFailures', () => {
    it('returns no failures for mutations without missing evidence', () => {
      const mutations = [
        { missingEvidence: [], intent: { target: { id: 'bucket-1' } } },
        { missingEvidence: [], intent: { target: { id: 'bucket-2' } } },
      ];

      const result = checkEvidenceFailures(mutations);

      expect(result.hasFailures).toBe(false);
      expect(result.failedResources).toHaveLength(0);
      expect(result.failureReasons).toHaveLength(0);
    });

    it('detects failures when mutations have missing evidence', () => {
      const mutations = [
        {
          missingEvidence: [
            { key: 's3.versioning', description: 'Unable to verify s3.versioning' },
          ],
          intent: { target: { id: 'my-bucket' } },
        },
      ];

      const result = checkEvidenceFailures(mutations);

      expect(result.hasFailures).toBe(true);
      expect(result.failedResources).toContain('my-bucket');
      expect(result.failureReasons).toContain('Unable to verify s3.versioning');
    });

    it('deduplicates resources and reasons', () => {
      const mutations = [
        {
          missingEvidence: [
            { key: 's3.versioning', description: 'API error' },
            { key: 's3.replication', description: 'API error' },
          ],
          intent: { target: { id: 'bucket-1' } },
        },
        {
          missingEvidence: [{ key: 's3.lifecycle', description: 'API error' }],
          intent: { target: { id: 'bucket-1' } },
        },
      ];

      const result = checkEvidenceFailures(mutations);

      expect(result.failedResources).toEqual(['bucket-1']);
      expect(result.failureReasons).toEqual(['API error']);
    });
  });

  describe('applyFailureMode', () => {
    const failureCheck = {
      hasFailures: true,
      failedResources: ['my-bucket'],
      failureReasons: ['Network timeout'],
    };

    const noFailures = {
      hasFailures: false,
      failedResources: [],
      failureReasons: [],
    };

    it('returns original decision when no failures', () => {
      const result = applyFailureMode('allow', 'All good', noFailures, 'closed');

      expect(result.decision).toBe('allow');
      expect(result.reason).toBe('All good');
    });

    describe('fail-closed mode', () => {
      it('blocks when evidence is unavailable', () => {
        const result = applyFailureMode('allow', 'Original', failureCheck, 'closed');

        expect(result.decision).toBe('block');
        expect(result.reason).toContain('FAIL-CLOSED');
        expect(result.reason).toContain('my-bucket');
      });

      it('blocks even if original decision was escalate', () => {
        const result = applyFailureMode('escalate', 'Original', failureCheck, 'closed');

        expect(result.decision).toBe('block');
      });
    });

    describe('fail-review mode', () => {
      it('escalates allow to review when evidence unavailable', () => {
        const result = applyFailureMode('allow', 'Original', failureCheck, 'review');

        expect(result.decision).toBe('escalate');
        expect(result.reason).toContain('FAIL-REVIEW');
      });

      it('escalates warn to review', () => {
        const result = applyFailureMode('warn', 'Original', failureCheck, 'review');

        expect(result.decision).toBe('escalate');
      });

      it('does not downgrade existing escalate/block', () => {
        expect(applyFailureMode('escalate', 'Original', failureCheck, 'review').decision).toBe('escalate');
        expect(applyFailureMode('block', 'Original', failureCheck, 'review').decision).toBe('block');
      });
    });

    describe('fail-open mode', () => {
      it('keeps original decision but adds warning', () => {
        const result = applyFailureMode('allow', 'Original', failureCheck, 'open');

        expect(result.decision).toBe('allow');
        expect(result.reason).toContain('FAIL-OPEN WARNING');
      });
    });
  });

  describe('default failure modes', () => {
    it('OSS default is review', () => {
      expect(DEFAULT_FAILURE_MODE).toBe('review');
    });

    it('Pro default is closed', () => {
      expect(PRO_DEFAULT_FAILURE_MODE).toBe('closed');
    });
  });
});
