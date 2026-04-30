import type { AnalyzedMutation, ConsequenceReport } from '../core/index.js';

export interface TuiOptions {
  source: string;
  inputLabel?: string;
}

const width = 88;

export function formatTui(report: ConsequenceReport, options: TuiOptions): string {
  const primary = report.mutations[0];
  const source = normalizeSource(options.source);
  const decision = report.decision.toUpperCase();
  const confidence = Math.round((report.summary.worstRecoverability.confidence ?? 1) * 100);
  const confidenceLabel = confidence > 0 ? `${confidence}%` : 'needs evidence';
  const evidence = primary?.evidence.map(item => `${item.key}: ${stringifyValue(item.value, item.present)}`) ?? [];
  const missingEvidence = primary?.missingEvidence.map(item => `${item.key}: ${item.description}`) ?? [];

  const lines = [
    'RECOURSEOS PREFLIGHT',
    '='.repeat(20),
    keyValue('input', source),
    keyValue('adapter', adapterName(options.source)),
    keyValue('actor', actorLine(primary)),
    keyValue('supported inputs', 'Terraform plans, Shell / cloud CLIs, MCP tool calls'),
    '',
    section('CONSEQUENCE DECISION'),
    keyValue('verdict', `${decision} (${report.summary.worstRecoverability.label})`),
    keyValue('policy', policyAction(report.decision)),
    keyValue('confidence', confidenceLabel),
    ...keyValueRows('reason', report.decisionReason),
    '',
    section('NORMALIZED MUTATION'),
    keyValue('target', targetValue(primary)),
    keyValue('action', actionValue(primary)),
    keyValue('provider', providerValue(primary)),
    '',
    section('EVIDENCE'),
    ...bulletRows(evidence, 'present'),
    '',
    section('MISSING EVIDENCE'),
    ...bulletRows(missingEvidence, 'needed'),
    '',
    section('EVALUATION PATH'),
    `1. ${adapterName(options.source)} parsed input into MutationIntent`,
    '2. Known resource rules checked first',
    '3. Semantic unknown fallback handles long-tail resource types',
    `4. Next action: ${nextAction(report.decision)} (${reviewState(report)})`,
    '',
    section('AGENT-SAFE RESPONSE'),
    ...wrapped(agentResponse(report), width),
  ];

  return lines.join('\n');
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

function bulletRows(items: string[], label: string): string[] {
  const normalized = items.length > 0 ? items : ['none'];
  return normalized.flatMap(item =>
    wrappedWithIndent(`- [${label}] ${item}`, '  ')
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

function adapterName(source: string): string {
  return {
    terraform: 'Terraform plan adapter',
    shell: 'Shell command adapter',
    mcp: 'MCP tool-call adapter',
  }[source] ?? `${source} adapter`;
}

function adapterState(activeSource: string, source: string): string {
  const labels: Record<string, string> = {
    terraform: 'Terraform plans',
    shell: 'Shell / cloud CLIs',
    mcp: 'MCP tool calls',
    future: 'kubectl, SQL, APIs',
  };
  const marker = activeSource === source ? 'active' : 'ready';
  return `${marker}: ${labels[source]}`;
}

function policyAction(decision: ConsequenceReport['decision']): string {
  return {
    allow: 'continue',
    warn: 'surface warning',
    escalate: 'human review',
    block: 'do not execute',
  }[decision];
}

function nextAction(decision: ConsequenceReport['decision']): string {
  return {
    allow: 'continue under policy',
    warn: 'show recovery dependency',
    escalate: 'collect evidence or approve',
    block: 'change recovery posture',
  }[decision];
}

function reviewState(report: ConsequenceReport): string {
  if (report.summary.hasUnrecoverable) {
    return 'unrecoverable found';
  }
  return report.summary.needsReview ? 'review required' : 'review not required';
}

function agentResponse(report: ConsequenceReport): string {
  if (report.decision === 'block') {
    return `I checked with RecourseOS. The action is blocked because ${report.decisionReason}`;
  }
  if (report.decision === 'escalate') {
    return `I checked with RecourseOS. The action needs review because ${report.decisionReason}`;
  }
  if (report.decision === 'warn') {
    return `I checked with RecourseOS. The action can continue only after surfacing this recovery dependency: ${report.decisionReason}`;
  }
  return `I checked with RecourseOS. The action is classified as reversible and can continue under normal policy.`;
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
