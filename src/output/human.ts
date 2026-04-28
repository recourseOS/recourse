import chalk from 'chalk';
import type { BlastRadiusReport, BlastRadiusChange } from '../resources/types.js';
import { RecoverabilityTier } from '../resources/types.js';

const TIER_COLORS: Record<RecoverabilityTier, (text: string) => string> = {
  [RecoverabilityTier.REVERSIBLE]: chalk.green,
  [RecoverabilityTier.RECOVERABLE_WITH_EFFORT]: chalk.yellow,
  [RecoverabilityTier.RECOVERABLE_FROM_BACKUP]: chalk.hex('#FFA500'), // Orange
  [RecoverabilityTier.UNRECOVERABLE]: chalk.red,
};

const ACTION_SYMBOLS: Record<string, string> = {
  'create': '+',
  'delete': '-',
  'update': '~',
  'replace': '!',
};

function getActionSymbol(actions: string[]): string {
  if (actions.includes('delete') && actions.includes('create')) {
    return ACTION_SYMBOLS['replace'];
  }
  if (actions.includes('delete')) {
    return ACTION_SYMBOLS['delete'];
  }
  if (actions.includes('create')) {
    return ACTION_SYMBOLS['create'];
  }
  if (actions.includes('update')) {
    return ACTION_SYMBOLS['update'];
  }
  return '?';
}

function getActionLabel(actions: string[]): string {
  if (actions.includes('delete') && actions.includes('create')) {
    return 'REPLACE';
  }
  if (actions.includes('delete')) {
    return 'DELETE';
  }
  if (actions.includes('create')) {
    return 'CREATE';
  }
  if (actions.includes('update')) {
    return 'UPDATE';
  }
  return 'UNKNOWN';
}

function formatChange(change: BlastRadiusChange): string {
  const { resource, recoverability, cascadeImpact } = change;
  const symbol = getActionSymbol(resource.actions);
  const action = getActionLabel(resource.actions);
  const color = TIER_COLORS[recoverability.tier];

  const lines: string[] = [];

  // Main change line
  const actionColor = resource.actions.includes('delete') ? chalk.red : chalk.cyan;
  lines.push(`  ${actionColor(symbol)} ${actionColor(action)} ${chalk.bold(resource.address)}`);

  // Recoverability
  lines.push(`    Recoverability: ${color(recoverability.label)} (${recoverability.reasoning})`);

  // Cascade impact
  if (cascadeImpact.length > 0) {
    lines.push(`    Cascade impact:`);
    for (const impact of cascadeImpact.slice(0, 5)) {
      lines.push(`      -> ${impact.affectedResource} (${impact.reason})`);
    }
    if (cascadeImpact.length > 5) {
      lines.push(`      ... and ${cascadeImpact.length - 5} more`);
    }
  }

  return lines.join('\n');
}

export function formatReport(report: BlastRadiusReport): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold('BLAST RADIUS REPORT'));
  lines.push(chalk.dim('═'.repeat(50)));
  lines.push('');

  if (report.changes.length === 0) {
    lines.push(chalk.green('  No changes detected.'));
    lines.push('');
    return lines.join('\n');
  }

  // Group changes by action type
  const deletes = report.changes.filter(c => c.resource.actions.includes('delete'));
  const creates = report.changes.filter(c =>
    c.resource.actions.includes('create') && !c.resource.actions.includes('delete')
  );
  const updates = report.changes.filter(c =>
    c.resource.actions.includes('update') &&
    !c.resource.actions.includes('delete') &&
    !c.resource.actions.includes('create')
  );

  // Destructive changes first
  if (deletes.length > 0) {
    lines.push(chalk.red.bold('DESTRUCTIVE CHANGES'));
    lines.push('');
    for (const change of deletes) {
      lines.push(formatChange(change));
      lines.push('');
    }
  }

  // Updates
  if (updates.length > 0) {
    lines.push(chalk.yellow.bold('UPDATES'));
    lines.push('');
    for (const change of updates) {
      lines.push(formatChange(change));
      lines.push('');
    }
  }

  // Creates
  if (creates.length > 0) {
    lines.push(chalk.green.bold('CREATES'));
    lines.push('');
    for (const change of creates) {
      lines.push(formatChange(change));
      lines.push('');
    }
  }

  // Summary
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push(chalk.bold('SUMMARY'));
  lines.push('');

  const { summary } = report;

  lines.push(`  Total changes: ${summary.totalChanges}`);
  lines.push('');

  if (summary.byTier[RecoverabilityTier.UNRECOVERABLE] > 0) {
    lines.push(`  ${TIER_COLORS[RecoverabilityTier.UNRECOVERABLE]('Unrecoverable:')}  ${summary.byTier[RecoverabilityTier.UNRECOVERABLE]} resources`);
  }
  if (summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP] > 0) {
    lines.push(`  ${TIER_COLORS[RecoverabilityTier.RECOVERABLE_FROM_BACKUP]('From backup:')}    ${summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP]} resources`);
  }
  if (summary.byTier[RecoverabilityTier.RECOVERABLE_WITH_EFFORT] > 0) {
    lines.push(`  ${TIER_COLORS[RecoverabilityTier.RECOVERABLE_WITH_EFFORT]('With effort:')}    ${summary.byTier[RecoverabilityTier.RECOVERABLE_WITH_EFFORT]} resources`);
  }
  if (summary.byTier[RecoverabilityTier.REVERSIBLE] > 0) {
    lines.push(`  ${TIER_COLORS[RecoverabilityTier.REVERSIBLE]('Reversible:')}     ${summary.byTier[RecoverabilityTier.REVERSIBLE]} resources`);
  }

  if (summary.cascadeImpactCount > 0) {
    lines.push('');
    lines.push(`  ${chalk.magenta('Cascade impact:')} ${summary.cascadeImpactCount} additional resources affected`);
  }

  lines.push('');

  // Warning banner
  if (summary.hasUnrecoverable) {
    lines.push(chalk.bgRed.white.bold(' WARNING ') + chalk.red(' This plan contains unrecoverable changes!'));
    lines.push('');
  } else if (summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP] > 0) {
    lines.push(chalk.bgYellow.black.bold(' CAUTION ') + chalk.yellow(' Some changes require backup to recover.'));
    lines.push('');
  }

  return lines.join('\n');
}

export function formatCompact(report: BlastRadiusReport): string {
  const { summary } = report;

  if (report.changes.length === 0) {
    return chalk.green('No changes');
  }

  const parts: string[] = [];

  if (summary.byTier[RecoverabilityTier.UNRECOVERABLE] > 0) {
    parts.push(chalk.red(`${summary.byTier[RecoverabilityTier.UNRECOVERABLE]} unrecoverable`));
  }
  if (summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP] > 0) {
    parts.push(chalk.hex('#FFA500')(`${summary.byTier[RecoverabilityTier.RECOVERABLE_FROM_BACKUP]} need backup`));
  }
  if (summary.byTier[RecoverabilityTier.RECOVERABLE_WITH_EFFORT] > 0) {
    parts.push(chalk.yellow(`${summary.byTier[RecoverabilityTier.RECOVERABLE_WITH_EFFORT]} recoverable`));
  }
  if (summary.byTier[RecoverabilityTier.REVERSIBLE] > 0) {
    parts.push(chalk.green(`${summary.byTier[RecoverabilityTier.REVERSIBLE]} reversible`));
  }

  return parts.join(', ');
}
