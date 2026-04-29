import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import type { ConsequenceReport } from '../src/core/index.js';
import {
  evidenceFixturePath,
  evidenceScenarios,
  type EvidenceKind,
  type EvidenceScenario,
} from './helpers/evidence-scenarios.js';

const distCli = 'dist/index.js';

describe('compiled CLI scenario matrix', () => {
  it.each(evidenceScenarios)('$name', scenario => {
    expect(existsSync(distCli), 'dist/index.js must exist; run npm run build before CLI scenarios').toBe(true);

    const result = runCli(scenario, 'block');
    const shouldBlock = scenario.expectedDecision === 'block';
    expect(result.status).toBe(shouldBlock ? 1 : 0);
    expect(result.stderr).toBe('');

    const report = JSON.parse(result.stdout) as ConsequenceReport;
    expect(report.summary.worstRecoverability.tier).toBe(scenario.expectedTier);
    expect(report.decision).toBe(scenario.expectedDecision);

    const evidenceKeys = report.mutations.flatMap(mutation =>
      mutation.evidence.map(item => item.key)
    );
    for (const key of scenario.expectedEvidenceKeys) {
      expect(evidenceKeys).toContain(key);
    }
  });

  it('exits nonzero when fail-on threshold is reached', () => {
    const scenario = evidenceScenarios.find(candidate =>
      candidate.name === 'KMS customer key deletion escalates'
    );
    expect(scenario).toBeDefined();

    const result = runCli(scenario as EvidenceScenario, 'escalate');
    expect(result.status).toBe(1);
  });
});

function runCli(scenario: EvidenceScenario, failOn: 'warn' | 'escalate' | 'block') {
  const args = [
    distCli,
    'evaluate',
    scenario.source,
    scenario.source === 'shell'
      ? scenario.input as string
      : JSON.stringify(scenario.input),
    evidenceFlag(scenario.evidenceKind),
    evidenceFixturePath(scenario.fixture),
    '--fail-on',
    failOn,
  ];

  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function evidenceFlag(kind: EvidenceKind): string {
  switch (kind) {
    case 's3':
      return '--aws-s3-evidence';
    case 'rds':
      return '--aws-rds-evidence';
    case 'dynamodb':
      return '--aws-dynamodb-evidence';
    case 'iam':
      return '--aws-iam-evidence';
    case 'kms':
      return '--aws-kms-evidence';
  }
}
