import type { AnalyzedMutation, ConsequenceReport } from '../core/index.js';

export interface TuiOptions {
  source: string;
  inputLabel?: string;
  color?: boolean;
  ascii?: boolean;
}

const width = 88;

export function formatTui(report: ConsequenceReport, options: TuiOptions): string {
  const primary = report.mutations[0];
  const source = normalizeSource(options.source);
  const color = options.color === true;
  const confidence = Math.round((report.summary.worstRecoverability.confidence ?? 1) * 100);
  const confidenceLabel = confidence > 0 ? `${confidence}%` : 'needs evidence';
  const evidence = primary?.evidence.map(item => `${item.key}: ${stringifyValue(item.value, item.present)}`) ?? [];
  const missingEvidence = primary?.missingEvidence.map(item => `${item.key}: ${item.description}`) ?? [];

  const lines = [
    ...(options.ascii ? asciiHeader(color) : []),
    paint('RecourseOS Preflight', 'cyan', color),
    '',
    ...keyValueRows('Command', options.inputLabel ?? source),
    keyValue('Source', source),
    keyValue('Actor', actorLine(primary)),
    '',
    paint(decisionTitle(report.decision), decisionColor(report.decision), color),
    decisionSummary(report),
    '',
    keyValue('Decision', paint(report.decision, decisionColor(report.decision), color)),
    keyValue('Recoverability', report.summary.worstRecoverability.label),
    keyValue('Confidence', confidenceLabel),
    keyValue('Policy', policyAction(report.decision)),
    '',
    section('Action'),
    keyValue('Type', actionValue(primary)),
    keyValue('Target', targetValue(primary)),
    keyValue('Provider', providerValue(primary)),
    '',
    section('Why'),
    ...wrapped(whyText(report, primary), width),
    '',
    section('Evidence Found'),
    ...bulletRows(evidence),
    '',
    section('Evidence Needed'),
    ...bulletRows(missingEvidence),
    '',
    section('Next Steps'),
    ...nextSteps(report),
  ];

  return lines.join('\n');
}

function asciiHeader(color: boolean): string[] {
  return [
    paint(' ____                                      ___  ____', 'green', color),
    paint('|  _ \\ ___  ___ ___  _   _ _ __ ___ ___ / _ \\/ ___|', 'green', color),
    paint('| |_) / _ \\/ __/ _ \\| | | |  __/ __/ _ \\ | | \\___ \\', 'green', color),
    paint('|  _ <  __/ (_| (_) | |_| | | | (_|  __/ |_| |___) |', 'green', color),
    paint('|_| \\_\\___|\\___\\___/ \\__,_|_|  \\___\\___|\\___/|____/', 'green', color),
    paint('consequence preflight for infrastructure actions', 'muted', color),
    '',
  ];
}

function section(value: string): string {
  return `${value}\n${'-'.repeat(value.length)}`;
}

function keyValue(key: string, value: string): string {
  return `${key.padEnd(16)} ${value}`;
}

function keyValueRows(key: string, value: string): string[] {
  const [first = '', ...rest] = wrapped(value, width - 17);
  return [
    keyValue(key, first),
    ...rest.map(line => `${' '.repeat(17)}${line}`),
  ];
}

function bulletRows(items: string[]): string[] {
  const normalized = items.length > 0 ? items : ['none'];
  return normalized.flatMap(item =>
    wrappedWithIndent(`- ${item}`, '  ')
  );
}

function wrapped(value: string, size: number): string[] {
  return wrappedWithIndent(value, '', size);
}

function wrappedWithIndent(value: string, indent: string, size = width): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + word.length + 1 <= size) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = `${indent}${word}`;
    }
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}

function targetValue(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'none';
  }
  return mutation.intent.target.id;
}

function actionValue(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'none';
  }
  return `${mutation.intent.action} ${mutation.intent.target.type}`;
}

function providerValue(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'unknown';
  }

  const target = mutation.intent.target;
  const parts = [target.provider, target.service, target.environment].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'unknown';
}

function actorLine(mutation: AnalyzedMutation | undefined): string {
  return mutation?.intent.actor?.id ?? 'unknown';
}

function normalizeSource(source: string): string {
  return source === 'mcp' ? 'MCP tool call' : source;
}

function policyAction(decision: ConsequenceReport['decision']): string {
  return {
    allow: 'continue',
    warn: 'surface warning',
    escalate: 'human review',
    block: 'do not execute',
  }[decision];
}

function decisionTitle(decision: ConsequenceReport['decision']): string {
  return {
    allow: 'OK TO RUN',
    warn: 'RUN WITH WARNING',
    escalate: 'REVIEW REQUIRED',
    block: 'DO NOT RUN',
  }[decision];
}

function decisionColor(decision: ConsequenceReport['decision']): ColorName {
  const colors: Record<ConsequenceReport['decision'], ColorName> = {
    allow: 'green',
    warn: 'yellow',
    escalate: 'yellow',
    block: 'red',
  };
  return colors[decision];
}

type ColorName = 'cyan' | 'green' | 'yellow' | 'red' | 'muted';

function paint(value: string, color: ColorName, enabled: boolean): string {
  if (!enabled) {
    return value;
  }

  const colors: Record<ColorName, string> = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    muted: '\x1b[2m',
  };

  return `${colors[color]}${value}\x1b[0m`;
}

function decisionSummary(report: ConsequenceReport): string {
  if (report.decision === 'block') {
    return 'This change can cause unrecoverable loss. Change the recovery posture before running it.';
  }
  if (report.decision === 'escalate') {
    return 'Recourse needs more recovery evidence or a human approval before this action runs.';
  }
  if (report.decision === 'warn') {
    return 'This action may be recoverable, but the recovery path should be surfaced before running it.';
  }
  return 'Current evidence says this action is reversible under policy.';
}

function whyText(report: ConsequenceReport, mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return report.decisionReason;
  }
  if (report.decision === 'escalate') {
    return `Recourse recognized ${actionValue(mutation)} on ${targetValue(mutation)}, but it does not have enough recovery evidence to call it safe.`;
  }
  if (report.decision === 'allow') {
    return mutation.recoverability.reasoning;
  }
  return report.decisionReason || mutation.recoverability.reasoning;
}

function nextSteps(report: ConsequenceReport): string[] {
  if (report.decision === 'block') {
    return [
      '1. Do not run this action.',
      '2. Enable protection, backups, snapshots, retention, or another recovery path.',
      '3. Re-run Recourse before applying or invoking the tool.',
    ];
  }
  if (report.decision === 'escalate') {
    return [
      '1. Pause before running this action.',
      '2. Attach the missing evidence or get human approval.',
      '3. Re-run Recourse with the evidence file or use --format json for agent handoff.',
    ];
  }
  if (report.decision === 'warn') {
    return [
      '1. Surface the recovery dependency to the operator.',
      '2. Confirm the backup, versioning, retention, or restore path is acceptable.',
      '3. Continue only if that recovery path is intentional.',
    ];
  }
  return [
    '1. Continue under normal policy.',
    '2. Keep the JSON report if an audit trail is required.',
  ];
}

function stringifyValue(value: unknown, present: boolean): string {
  if (!present) {
    return 'missing';
  }
  if (value === undefined) {
    return 'present';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
