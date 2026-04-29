import type { ConsequenceReport } from '../core/index.js';

export interface ConsequenceJsonOutput extends ConsequenceReport {
  version: string;
}

export function formatConsequenceJson(report: ConsequenceReport): string {
  return JSON.stringify(toConsequenceJson(report), null, 2);
}

export function toConsequenceJson(report: ConsequenceReport): ConsequenceJsonOutput {
  return {
    version: '0.1.0',
    ...report,
  };
}
