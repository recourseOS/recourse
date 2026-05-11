import { describe, it, expect } from 'vitest';
import {
  EvaluationTimer,
  SLA_TARGETS,
  formatTiming,
} from '../src/core/timing.js';

describe('timing', () => {
  describe('SLA_TARGETS', () => {
    it('defines targets for all evaluation types', () => {
      expect(SLA_TARGETS.localEvaluation).toBe(10);
      expect(SLA_TARGETS.remoteEvaluation).toBe(500);
      expect(SLA_TARGETS.planEvaluation).toBe(2000);
      expect(SLA_TARGETS.shellEvaluation).toBe(5);
      expect(SLA_TARGETS.mcpEvaluation).toBe(10);
    });
  });

  describe('EvaluationTimer', () => {
    it('tracks total time', () => {
      const timer = new EvaluationTimer('localEvaluation');
      const timing = timer.finish();

      expect(timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(timing.slaTarget).toBe('localEvaluation');
      expect(timing.slaTargetMs).toBe(10);
    });

    it('tracks phases', () => {
      const timer = new EvaluationTimer();
      timer.startPhase('parse');
      timer.endPhase('parse');
      timer.startPhase('analysis');
      timer.endPhase('analysis');

      const timing = timer.finish();

      expect(timing.parseMs).toBeDefined();
      expect(timing.analysisMs).toBeDefined();
      expect(timing.parseMs).toBeGreaterThanOrEqual(0);
      expect(timing.analysisMs).toBeGreaterThanOrEqual(0);
    });

    it('reports SLA compliance', () => {
      const timer = new EvaluationTimer('localEvaluation');
      const timing = timer.finish();

      // Local evaluation should be fast enough to meet SLA
      expect(timing.metSla).toBe(true);
    });

    it('allows changing SLA target', () => {
      const timer = new EvaluationTimer('localEvaluation');
      timer.setSlaTarget('planEvaluation');
      const timing = timer.finish();

      expect(timing.slaTarget).toBe('planEvaluation');
      expect(timing.slaTargetMs).toBe(2000);
    });
  });

  describe('formatTiming', () => {
    it('formats timing with checkmark when SLA met', () => {
      const timing = {
        totalMs: 5.5,
        parseMs: 1.2,
        analysisMs: 4.3,
        metSla: true,
        slaTarget: 'localEvaluation' as const,
        slaTargetMs: 10,
      };

      const formatted = formatTiming(timing);

      expect(formatted).toContain('✓');
      expect(formatted).toContain('5.5ms');
      expect(formatted).toContain('parse=1.2ms');
      expect(formatted).toContain('analysis=4.3ms');
      expect(formatted).toContain('target: 10ms');
    });

    it('formats timing with warning when SLA missed', () => {
      const timing = {
        totalMs: 150.0,
        metSla: false,
        slaTarget: 'localEvaluation' as const,
        slaTargetMs: 10,
      };

      const formatted = formatTiming(timing);

      expect(formatted).toContain('⚠');
      expect(formatted).toContain('150.0ms');
    });
  });
});
