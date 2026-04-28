import chalk from 'chalk';
import type { ClassificationTrace } from '../analyzer/trace.js';

const CONFIDENCE_COLORS = {
  high: chalk.green,
  medium: chalk.yellow,
  low: chalk.red,
};

export function formatExplain(trace: ClassificationTrace): string {
  const lines: string[] = [];

  // Section 1: The verdict
  lines.push('');
  lines.push(formatVerdict(trace));
  lines.push('');

  // Section 2: The decision path
  lines.push(chalk.bold('CLASSIFICATION TRACE'));
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push('');

  for (const check of trace.checks) {
    const symbol = check.passed ? chalk.green('✓') : chalk.red('✗');
    const nameDisplay = chalk.cyan(check.name);
    const valueDisplay = chalk.dim(`→ ${check.valueDisplay}`);

    lines.push(`  ${symbol} ${nameDisplay}`);
    lines.push(`      ${valueDisplay}`);
    lines.push(`      ${check.note}`);
    lines.push('');
  }

  // Section 3: Confidence
  lines.push(chalk.dim('─'.repeat(50)));
  const confColor = CONFIDENCE_COLORS[trace.confidence];
  lines.push(`Confidence: ${confColor(trace.confidence)}`);
  lines.push(chalk.dim(`  ${trace.confidenceReason}`));
  lines.push('');

  // Section 4: What would change the verdict
  if (trace.counterfactuals.length > 0) {
    lines.push(chalk.bold('WHAT WOULD CHANGE THIS'));
    lines.push(chalk.dim('─'.repeat(50)));
    lines.push('');

    for (const cf of trace.counterfactuals) {
      lines.push(`  ${chalk.yellow('•')} If ${chalk.white(cf.condition)}`);
      lines.push(`    → Verdict would be: ${chalk.cyan(cf.resultingTier)}`);
      lines.push(chalk.dim(`    ${cf.explanation}`));
      lines.push('');
    }
  }

  // Section 5: Limitations
  if (trace.limitations.length > 0) {
    lines.push(chalk.bold('LIMITATIONS'));
    lines.push(chalk.dim('─'.repeat(50)));
    lines.push('');

    for (const limitation of trace.limitations) {
      lines.push(`  ${chalk.dim('•')} ${chalk.dim(limitation)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatVerdict(trace: ClassificationTrace): string {
  const { result, confidence } = trace;

  const tierColors: Record<string, (s: string) => string> = {
    'reversible': chalk.green,
    'blocked': chalk.blue,
    'recoverable-with-effort': chalk.yellow,
    'recoverable-from-backup': chalk.hex('#FFA500'),
    'unrecoverable': chalk.red,
  };

  const color = tierColors[result.label] || chalk.white;
  const confColor = CONFIDENCE_COLORS[confidence];

  return [
    chalk.bold('VERDICT'),
    chalk.dim('═'.repeat(50)),
    '',
    `${chalk.bold(trace.resourceAddress)} → ${color(result.label)} (${confColor(confidence)} confidence)`,
    '',
    chalk.dim(result.reasoning),
  ].join('\n');
}

// JSON output for tooling integration
export interface ExplainJsonOutput {
  version: string;
  resource: {
    address: string;
    type: string;
    action: string;
  };
  verdict: {
    tier: number;
    label: string;
    reasoning: string;
  };
  confidence: {
    level: string;
    reason: string;
  };
  trace: Array<{
    check: string;
    value: unknown;
    valueDisplay: string;
    passed: boolean;
    note: string;
  }>;
  counterfactuals: Array<{
    condition: string;
    resultingTier: string;
    explanation: string;
  }>;
  limitations: string[];
}

export function formatExplainJson(trace: ClassificationTrace): string {
  const output: ExplainJsonOutput = {
    version: '0.1.0',
    resource: {
      address: trace.resourceAddress,
      type: trace.resourceType,
      action: trace.action,
    },
    verdict: {
      tier: trace.result.tier,
      label: trace.result.label,
      reasoning: trace.result.reasoning,
    },
    confidence: {
      level: trace.confidence,
      reason: trace.confidenceReason,
    },
    trace: trace.checks.map(c => ({
      check: c.name,
      value: c.value,
      valueDisplay: c.valueDisplay,
      passed: c.passed,
      note: c.note,
    })),
    counterfactuals: trace.counterfactuals,
    limitations: trace.limitations,
  };

  return JSON.stringify(output, null, 2);
}
