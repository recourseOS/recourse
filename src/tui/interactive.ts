import { existsSync, readFileSync } from 'fs';
import { createInterface, type Interface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { parsePlanFile } from '../parsers/plan.js';
import { parseStateFile } from '../parsers/state.js';
import {
  evaluateMcpToolCallConsequences,
  evaluateShellCommandConsequences,
  evaluateTerraformPlanConsequences,
} from '../evaluator/index.js';
import type { McpToolCall } from '../adapters/index.js';
import type { ConsequenceReport } from '../core/index.js';
import { formatConsequenceJson } from '../output/consequence-json.js';
import { formatTui } from '../output/tui.js';

export type TuiSource = 'terraform' | 'shell' | 'mcp';

export interface InteractiveTuiOptions {
  source?: string;
  input?: string;
  state?: string;
  classifier?: boolean;
  actor?: string;
  environment?: string;
  owner?: string;
  json?: boolean;
  color?: boolean;
}

interface EvaluationContext {
  actorId?: string;
  environment?: string;
  owner?: string;
}

const defaultShellCommand = 'aws s3 rm s3://prod-audit-logs --recursive';
const defaultMcpCall = {
  server: 'aws',
  tool: 's3.delete_bucket',
  arguments: { bucket: 'prod-audit-logs' },
};

export async function runInteractiveTui(options: InteractiveTuiOptions): Promise<ConsequenceReport | undefined> {
  const color = options.color ?? stdout.isTTY;

  if (options.source || options.input) {
    if (!options.source || !options.input) {
      throw new Error('recourse tui requires both --source and --input when running without prompts');
    }

    const source = parseTuiSource(options.source);
    const report = await evaluateTuiInput(source, options.input, options);
    console.log(formatTui(report, {
      source,
      inputLabel: inputLabel(source, options.input),
      color,
      ascii: true,
    }));
    if (options.json) {
      console.log('');
      console.log(formatConsequenceJson(report));
    }
    return report;
  }

  if (!stdin.isTTY) {
    throw new Error('recourse tui needs an interactive terminal, or pass --source and --input');
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let lastReport: ConsequenceReport | undefined;

  try {
    writeIntro(color);

    let keepRunning = true;
    while (keepRunning) {
      const source = await promptSource(rl, color);
      const rawInput = await promptInput(rl, source, color);
      const report = await evaluateTuiInput(source, rawInput, options);
      lastReport = report;

      console.log('');
      console.log(formatTui(report, {
        source,
        inputLabel: inputLabel(source, rawInput),
        color,
        ascii: true,
      }));

      if (await yesNo(rl, 'Show machine-readable JSON?', false, color)) {
        console.log('');
        console.log(formatConsequenceJson(report));
      }

      keepRunning = await yesNo(rl, 'Run another preflight?', false, color);
      if (keepRunning) {
        console.log('');
      }
    }
  } finally {
    rl.close();
  }

  return lastReport;
}

async function evaluateTuiInput(
  source: TuiSource,
  input: string,
  options: InteractiveTuiOptions
): Promise<ConsequenceReport> {
  const adapterContext: EvaluationContext = {
    actorId: options.actor ?? 'operator/tui',
    environment: options.environment ?? 'local',
    owner: options.owner,
  };

  if (source === 'terraform') {
    if (!existsSync(input)) {
      throw new Error(`Terraform plan file not found: ${input}`);
    }

    const plan = await parsePlanFile(input);
    let state = null;
    const stateFile = options.state || 'terraform.tfstate';
    if (existsSync(stateFile)) {
      state = await parseStateFile(stateFile);
    } else if (options.state) {
      throw new Error(`Terraform state file not found: ${options.state}`);
    }

    return evaluateTerraformPlanConsequences(plan, state, {
      useClassifier: Boolean(options.classifier),
      adapterContext,
    });
  }

  if (source === 'shell') {
    return evaluateShellCommandConsequences(input, { adapterContext });
  }

  return evaluateMcpToolCallConsequences(parseMcpInput(input), { adapterContext });
}

function parseTuiSource(source: string): TuiSource {
  if (source !== 'terraform' && source !== 'shell' && source !== 'mcp') {
    throw new Error(`Unsupported TUI source: ${source}. Use terraform, shell, or mcp.`);
  }
  return source;
}

function parseMcpInput(input: string): McpToolCall {
  const raw = existsSync(input) ? readFileSync(input, 'utf8') : input;
  const parsed = JSON.parse(raw) as McpToolCall;
  if (!parsed || typeof parsed.tool !== 'string') {
    throw new Error('MCP input must be JSON with a string "tool" field');
  }
  return parsed;
}

async function promptSource(rl: Interface, color: boolean): Promise<TuiSource> {
  console.log(paint('Choose a source', 'cyan', color));
  console.log('  1) Terraform plan JSON');
  console.log('  2) Shell command');
  console.log('  3) MCP tool call JSON');

  const answer = (await rl.question(paint('Source [2]: ', 'green', color))).trim().toLowerCase();
  if (answer === '1' || answer === 'terraform') return 'terraform';
  if (answer === '3' || answer === 'mcp') return 'mcp';
  return 'shell';
}

async function promptInput(rl: Interface, source: TuiSource, color: boolean): Promise<string> {
  if (source === 'terraform') {
    return promptWithDefault(rl, 'Terraform plan path', 'plan.json', color);
  }

  if (source === 'mcp') {
    return promptWithDefault(rl, 'MCP call JSON or file path', JSON.stringify(defaultMcpCall), color);
  }

  return promptWithDefault(rl, 'Shell command', defaultShellCommand, color);
}

async function promptWithDefault(
  rl: Interface,
  label: string,
  defaultValue: string,
  color: boolean
): Promise<string> {
  const answer = await rl.question(paint(`${label} [${defaultValue}]: `, 'green', color));
  return answer.trim() || defaultValue;
}

async function yesNo(
  rl: Interface,
  label: string,
  defaultValue: boolean,
  color: boolean
): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(paint(`${label} [${suffix}]: `, 'green', color))).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

function writeIntro(color: boolean): void {
  if (stdout.isTTY) {
    stdout.write('\x1b[2J\x1b[H');
  }

  console.log(formatBox([
    paint('RecourseOS TUI', 'green', color),
    'Interactive consequence preflight for Terraform, shell, and MCP actions.',
    '',
    'Command palette:',
    '  recourse tui',
    '  recourse tui --source shell --input "aws s3 rm s3://prod-audit-logs --recursive"',
    '  recourse tui --source terraform --input plan.json',
    '  recourse tui --source mcp --input tool-call.json --json',
  ], color));
  console.log('');
}

function formatBox(lines: string[], color: boolean): string {
  const width = 82;
  const border = `+${'-'.repeat(width - 2)}+`;
  const body = lines.map(line => {
    const visible = stripAnsi(line);
    const padding = Math.max(0, width - visible.length - 4);
    return `| ${line}${' '.repeat(padding)} |`;
  });
  const box = [border, ...body, border].join('\n');
  return paint(box, 'muted', color);
}

function inputLabel(source: TuiSource, input: string): string {
  if (source === 'shell') {
    return `recourse preflight shell '${input.replace(/'/g, "'\\''")}'`;
  }
  if (source === 'mcp') {
    return existsSync(input) ? `recourse preflight mcp ${input}` : 'recourse preflight mcp <json>';
  }
  return `recourse preflight terraform ${input}`;
}

type ColorName = 'cyan' | 'green' | 'muted';

function paint(value: string, color: ColorName, enabled: boolean): string {
  if (!enabled) {
    return value;
  }

  const colors: Record<ColorName, string> = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    muted: '\x1b[2m',
  };

  return `${colors[color]}${value}\x1b[0m`;
}

function stripAnsi(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
    } else {
      result += value[index];
    }
  }
  return result;
}
