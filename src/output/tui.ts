import type { AnalyzedMutation, ConsequenceReport } from '../core/index.js';

export interface TuiOptions {
  source: string;
  inputLabel?: string;
}

const leftWidth = 31;
const centerWidth = 43;
const rightWidth = 34;
const width = leftWidth + centerWidth + rightWidth + 10;

export function formatTui(report: ConsequenceReport, options: TuiOptions): string {
  const primary = report.mutations[0];
  const source = normalizeSource(options.source);
  const decision = report.decision.toUpperCase();
  const confidence = Math.round((report.summary.worstRecoverability.confidence ?? 1) * 100);
  const confidenceLabel = confidence > 0 ? `${confidence}%` : 'needs evidence';
  const lines = [
    top(),
    row('RECOURSEOS PREFLIGHT', 'NORMALIZED MUTATION', 'CONSEQUENCE DECISION'),
    sep(),
    row(`input: ${source}`, targetLine(primary), `${decision}  ${report.summary.worstRecoverability.label}`),
    row(`plug: ${adapterName(options.source)}`, actionLine(primary), `confidence: ${confidenceLabel}`),
    row(`actor: ${actorLine(primary)}`, providerLine(primary), `policy: ${policyAction(report.decision)}`),
    sep(),
    row('ADAPTERS', 'EVALUATION PIPELINE', 'NEXT ACTION'),
    row(adapterState(options.source, 'terraform'), '1. parse action into MutationIntent', nextAction(report.decision)),
    row(adapterState(options.source, 'shell'), '2. match known resource rules first', reviewState(report)),
    row(adapterState(options.source, 'mcp'), '3. use semantic unknown fallback', ''),
    row(adapterState(options.source, 'future'), '4. return structured report + TUI', ''),
    sep(),
    full('EVIDENCE'),
    ...bulletRows(primary?.evidence.map(item => `${item.key}: ${stringifyValue(item.value, item.present)}`) ?? ['none']),
    full('MISSING EVIDENCE'),
    ...bulletRows(primary?.missingEvidence.map(item => `${item.key}: ${item.description}`) ?? ['none']),
    full('AGENT-SAFE RESPONSE'),
    ...wrappedRows(agentResponse(report), width - 4).map(line => `| ${line.padEnd(width - 4)} |`),
    bottom(),
  ];

  return lines.join('\n');
}

function top(): string {
  return `+${'-'.repeat(width - 2)}+`;
}

function sep(): string {
  return `+${'-'.repeat(leftWidth + 2)}+${'-'.repeat(centerWidth + 2)}+${'-'.repeat(rightWidth + 2)}+`;
}

function bottom(): string {
  return top();
}

function row(left: string, center: string, right: string): string {
  return `| ${cell(left, leftWidth)} | ${cell(center, centerWidth)} | ${cell(right, rightWidth)} |`;
}

function full(value: string): string {
  return `| ${value.padEnd(width - 4)} |`;
}

function cell(value: string, size: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > size ? `${clean.slice(0, size - 3)}...` : clean.padEnd(size);
}

function bulletRows(items: string[]): string[] {
  const normalized = items.length > 0 ? items : ['none'];
  return normalized.flatMap(item =>
    wrappedRows(`- ${item}`, width - 4).map(line => `| ${line.padEnd(width - 4)} |`)
  );
}

function wrappedRows(value: string, size: number): string[] {
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
      line = word;
    }
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}

function targetLine(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'target: none';
  }
  return `target: ${mutation.intent.target.id}`;
}

function actionLine(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'action: none';
  }
  return `action: ${mutation.intent.action} ${mutation.intent.target.type}`;
}

function providerLine(mutation: AnalyzedMutation | undefined): string {
  if (!mutation) {
    return 'provider: unknown';
  }

  const target = mutation.intent.target;
  const parts = [target.provider, target.service, target.environment].filter(Boolean);
  return parts.length > 0 ? `provider: ${parts.join(' / ')}` : 'provider: unknown';
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
