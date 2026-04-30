import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { parsePlanFile } from './parsers/plan.js';
import { parseStateFile } from './parsers/state.js';
import { analyzeBlastRadius } from './analyzer/blast-radius.js';
import { formatReport } from './output/human.js';
import { formatJson } from './output/json.js';
import { formatConsequenceJson } from './output/consequence-json.js';
import { formatExplain, formatExplainJson } from './output/explain.js';
import { formatTui } from './output/tui.js';
import { resolveCloudSubmitConfig, submitConsequenceReport } from './cloud/client.js';
import {
  evaluateMcpToolCallConsequences,
  evaluateShellCommandConsequences,
  evaluateTerraformPlanConsequences,
} from './evaluator/index.js';
import type { McpToolCall } from './adapters/index.js';
import {
  analyzeDynamoDbTableDeletionEvidence,
  analyzeIamRoleDeletionEvidence,
  analyzeKmsKeyDeletionEvidence,
  analyzeRdsInstanceDeletionEvidence,
  analyzeS3BucketDeletionEvidence,
  AwsSignedClient,
  loadAwsCredentials,
  readDynamoDbTableEvidence,
  readIamRoleEvidence,
  readKmsKeyEvidence,
  readRdsInstanceEvidence,
  readS3BucketEvidence,
  type DynamoDbTableEvidence,
  type IamRoleEvidence,
  type KmsKeyEvidence,
  type RdsInstanceEvidence,
  type S3BucketEvidence,
} from './state/index.js';
import { getSupportedResourceTypes, getRecoverabilityTraced, hasDetailedTracing } from './resources/index.js';
import { RecoverabilityTier } from './resources/types.js';
import type { ConsequenceDecision } from './core/index.js';
import { runMcpServer } from './mcp/server.js';
import { runHttpServer } from './http/server.js';
import { runInteractiveTui } from './tui/interactive.js';

const program = new Command();

type EvaluationSource = 'terraform' | 'shell' | 'mcp';

interface EvaluationOptions {
  state?: string;
  classifier: boolean;
  actor?: string;
  environment?: string;
  owner?: string;
  awsS3Evidence?: string;
  awsRdsEvidence?: string;
  awsDynamodbEvidence?: string;
  awsIamEvidence?: string;
  awsKmsEvidence?: string;
}

interface CloudEvaluationOptions extends EvaluationOptions {
  submit?: boolean;
  cloudUrl?: string;
  cloudTimeoutMs: string;
  failOn: string;
}

program
  .name('recourse')
  .description('Know what you can\'t undo before you terraform apply')
  .version('0.1.9');

program
  .command('plan')
  .description('Analyze a Terraform plan for blast radius')
  .argument('<plan-file>', 'Path to Terraform plan JSON file (from terraform show -json)')
  .option('-s, --state <file>', 'Path to Terraform state file (defaults to terraform.tfstate)')
  .option('-f, --format <format>', 'Output format: human or json', 'human')
  .option('--fail-on <tier>', 'Exit with code 1 if any change reaches this tier: unrecoverable, backup, effort, reversible', 'unrecoverable')
  .option('--no-cascade', 'Skip cascade impact analysis')
  .option('--classifier', 'Use ML classifier for unknown resource types (experimental)')
  .action(async (planFile: string, options: {
    state?: string;
    format: string;
    failOn: string;
    cascade: boolean;
    classifier: boolean;
  }) => {
    try {
      // Validate plan file exists
      if (!existsSync(planFile)) {
        console.error(`Error: Plan file not found: ${planFile}`);
        process.exit(1);
      }

      // Parse plan
      const plan = await parsePlanFile(planFile);

      // Parse state if provided or look for default
      let state = null;
      const stateFile = options.state || 'terraform.tfstate';
      if (existsSync(stateFile)) {
        state = await parseStateFile(stateFile);
      } else if (options.state) {
        console.error(`Error: State file not found: ${options.state}`);
        process.exit(1);
      }

      // Analyze
      const report = analyzeBlastRadius(plan, state, {
        useClassifier: options.classifier,
      });

      // Output
      if (options.format === 'json') {
        console.log(formatJson(report));
      } else {
        console.log(formatReport(report));
      }

      // Check fail condition
      const tierMap: Record<string, RecoverabilityTier> = {
        'unrecoverable': RecoverabilityTier.UNRECOVERABLE,
        'backup': RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
        'effort': RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        'reversible': RecoverabilityTier.REVERSIBLE,
      };

      const failTier = tierMap[options.failOn];
      if (failTier !== undefined) {
        const hasFailingChange = report.changes.some(
          c => c.recoverability.tier >= failTier
        );
        if (hasFailingChange) {
          process.exit(1);
        }
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('resources')
  .description('List supported resource types')
  .action(() => {
    const types = getSupportedResourceTypes();
    console.log('Supported resource types:\n');
    for (const type of types) {
      console.log(`  ${type}`);
    }
    console.log(`\nTotal: ${types.length} resource types`);
  });

const mcp = program
  .command('mcp')
  .description('Run RecourseOS agent integration commands');

mcp
  .command('serve')
  .description('Start the RecourseOS MCP stdio server')
  .option('-v, --verbose', 'Log evaluations to stderr')
  .action((options: { verbose?: boolean }) => {
    runMcpServer(process.stdin, process.stdout, { verbose: options.verbose });
  });

program
  .command('serve')
  .description('Start the RecourseOS playground for testing evaluations')
  .option('-p, --port <port>', 'Port to listen on', '3001')
  .option('--no-open', 'Do not open browser automatically')
  .action((options: { port: string; open: boolean }) => {
    runHttpServer(Number(options.port), options.open);
  });

program
  .command('preflight')
  .description('Open the terminal preflight view for a Terraform plan, shell command, or MCP tool call')
  .argument('<source>', 'Mutation source to evaluate: terraform, shell, or mcp')
  .argument('<input>', 'Path to input file for terraform, command string for shell, or JSON/file for mcp')
  .option('-s, --state <file>', 'Path to Terraform state file (for terraform source)')
  .option('--classifier', 'Use unknown-resource classifier where available')
  .option('--actor <id>', 'Actor identity to include in the mutation report')
  .option('--environment <name>', 'Environment name to include in the mutation report')
  .option('--owner <name>', 'Owner name to include in the mutation report')
  .option('--aws-s3-evidence <file>', 'Path to S3 evidence JSON from `recourse evidence aws-s3`')
  .option('--aws-rds-evidence <file>', 'Path to RDS evidence JSON from `recourse evidence aws-rds`')
  .option('--aws-dynamodb-evidence <file>', 'Path to DynamoDB evidence JSON from `recourse evidence aws-dynamodb`')
  .option('--aws-iam-evidence <file>', 'Path to IAM evidence JSON from `recourse evidence aws-iam-role`')
  .option('--aws-kms-evidence <file>', 'Path to KMS evidence JSON from `recourse evidence aws-kms-key`')
  .option('--format <format>', 'Output format: tui or json', 'tui')
  .option('--fail-on <decision>', 'Exit with code 1 if decision reaches: warn, escalate, block', 'block')
  .action(async (source: string, input: string, options: EvaluationOptions & {
    format: string;
    failOn: string;
  }) => {
    try {
      const normalizedSource = parseEvaluationSource(source);
      const report = await evaluateConsequenceInput(normalizedSource, input, options);

      if (options.format === 'json') {
        console.log(formatConsequenceJson(report));
      } else if (options.format === 'tui') {
        console.log(formatTui(report, { source: normalizedSource, inputLabel: input }));
      } else {
        console.error(`Error: Unsupported preflight format: ${options.format}`);
        console.error('Supported formats: tui, json');
        process.exit(1);
      }

      if (shouldFailOnDecision(report.decision, options.failOn)) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('tui')
  .description('Open the interactive RecourseOS terminal preflight UI')
  .option('--source <source>', 'Mutation source to evaluate: terraform, shell, or mcp')
  .option('--input <input>', 'Input for scripted TUI mode: plan path, shell command, or MCP JSON/file')
  .option('-s, --state <file>', 'Path to Terraform state file (for terraform source)')
  .option('--classifier', 'Use unknown-resource classifier where available')
  .option('--actor <id>', 'Actor identity to include in the mutation report')
  .option('--environment <name>', 'Environment name to include in the mutation report')
  .option('--owner <name>', 'Owner name to include in the mutation report')
  .option('--json', 'Print the machine-readable consequence report after the TUI report')
  .option('--no-color', 'Disable ANSI color output')
  .option('--fail-on <decision>', 'Exit with code 1 if decision reaches: warn, escalate, block', 'block')
  .action(async (options: {
    source?: string;
    input?: string;
    state?: string;
    classifier?: boolean;
    actor?: string;
    environment?: string;
    owner?: string;
    json?: boolean;
    color?: boolean;
    failOn: string;
  }) => {
    try {
      const report = await runInteractiveTui(options);
      if (report && shouldFailOnDecision(report.decision, options.failOn)) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('evaluate')
  .description('Evaluate a proposed mutation as a generic consequence report')
  .argument('<source>', 'Mutation source to evaluate: terraform, shell, or mcp')
  .argument('<input>', 'Path to input file for terraform, command string for shell, or JSON/file for mcp')
  .option('-s, --state <file>', 'Path to Terraform state file (for terraform source)')
  .option('--classifier', 'Use unknown-resource classifier where available')
  .option('--actor <id>', 'Actor identity to include in the mutation report')
  .option('--environment <name>', 'Environment name to include in the mutation report')
  .option('--owner <name>', 'Owner name to include in the mutation report')
  .option('--aws-s3-evidence <file>', 'Path to S3 evidence JSON from `recourse evidence aws-s3`')
  .option('--aws-rds-evidence <file>', 'Path to RDS evidence JSON from `recourse evidence aws-rds`')
  .option('--aws-dynamodb-evidence <file>', 'Path to DynamoDB evidence JSON from `recourse evidence aws-dynamodb`')
  .option('--aws-iam-evidence <file>', 'Path to IAM evidence JSON from `recourse evidence aws-iam-role`')
  .option('--aws-kms-evidence <file>', 'Path to KMS evidence JSON from `recourse evidence aws-kms-key`')
  .option('--submit', 'Submit the consequence report to Recourse Cloud after local evaluation')
  .option('--cloud-url <url>', 'Recourse Cloud base URL (defaults to RECOURSE_CLOUD_URL)')
  .option('--cloud-timeout-ms <ms>', 'Recourse Cloud submission timeout in milliseconds', '5000')
  .option('--fail-on <decision>', 'Exit with code 1 if decision reaches: warn, escalate, block', 'block')
  .action(async (source: string, input: string, options: CloudEvaluationOptions) => {
    try {
      const normalizedSource = parseEvaluationSource(source);
      const report = await evaluateConsequenceInput(normalizedSource, input, options);

      console.log(formatConsequenceJson(report));

      if (options.submit) {
        try {
          const submitted = await submitConsequenceReport(report, resolveCloudSubmitConfig({
            cloudUrl: options.cloudUrl,
            organizationId: process.env.RECOURSE_ORGANIZATION_ID,
            actorId: options.actor ?? process.env.RECOURSE_ACTOR_ID,
            environment: options.environment,
            source: normalizedSource,
            timeoutMs: Number(options.cloudTimeoutMs),
          }));
          const policyAction = submitted.policyResult?.action ? ` policy=${submitted.policyResult.action}` : '';
          console.error(`Recourse Cloud: submitted evaluation ${submitted.id}${policyAction}`);
        } catch (error) {
          console.error(`Recourse Cloud: submission failed: ${error instanceof Error ? error.message : error}`);
        }
      }

      if (shouldFailOnDecision(report.decision, options.failOn)) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('evidence')
  .description('Collect read-only live evidence for consequence analysis')
  .argument('<provider>', 'Evidence provider: aws-s3, aws-rds, aws-dynamodb, aws-iam-role, or aws-kms-key')
  .argument('<target>', 'Provider target, such as an S3 bucket, RDS DB, DynamoDB table, IAM role, or KMS key')
  .option('--region <region>', 'AWS region for regional S3 endpoints', 'us-east-1')
  .option('--profile <profile>', 'AWS profile to use when env credentials are not set')
  .action(async (provider: string, target: string, options: {
    region: string;
    profile?: string;
  }) => {
    try {
      if (
        provider !== 'aws-s3'
        && provider !== 'aws-rds'
        && provider !== 'aws-dynamodb'
        && provider !== 'aws-iam-role'
        && provider !== 'aws-kms-key'
      ) {
        console.error(`Error: Unsupported evidence provider: ${provider}`);
        console.error('Supported providers: aws-s3, aws-rds, aws-dynamodb, aws-iam-role, aws-kms-key');
        process.exit(1);
      }

      const credentials = loadAwsCredentials(options.profile);
      const client = new AwsSignedClient(credentials);

      if (provider === 'aws-s3') {
        const evidence = await readS3BucketEvidence(client, target, options.region);
        const analysis = analyzeS3BucketDeletionEvidence(evidence);

        console.log(JSON.stringify({
          provider,
          target,
          collectedAt: new Date().toISOString(),
          evidence,
          analysis,
        }, null, 2));
        return;
      }

      if (provider === 'aws-dynamodb') {
        const evidence = await readDynamoDbTableEvidence(client, target, options.region);
        const analysis = analyzeDynamoDbTableDeletionEvidence(evidence);

        console.log(JSON.stringify({
          provider,
          target,
          collectedAt: new Date().toISOString(),
          evidence,
          analysis,
        }, null, 2));
        return;
      }

      if (provider === 'aws-iam-role') {
        const evidence = await readIamRoleEvidence(client, target);
        const analysis = analyzeIamRoleDeletionEvidence(evidence);

        console.log(JSON.stringify({
          provider,
          target,
          collectedAt: new Date().toISOString(),
          evidence,
          analysis,
        }, null, 2));
        return;
      }

      if (provider === 'aws-kms-key') {
        const evidence = await readKmsKeyEvidence(client, target, options.region);
        const analysis = analyzeKmsKeyDeletionEvidence(evidence);

        console.log(JSON.stringify({
          provider,
          target,
          collectedAt: new Date().toISOString(),
          evidence,
          analysis,
        }, null, 2));
        return;
      }

      const evidence = await readRdsInstanceEvidence(client, target, options.region);
      const analysis = analyzeRdsInstanceDeletionEvidence(evidence);

      console.log(JSON.stringify({
        provider,
        target,
        collectedAt: new Date().toISOString(),
        evidence,
        analysis,
      }, null, 2));
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function parseEvaluationSource(source: string): EvaluationSource {
  if (source !== 'terraform' && source !== 'shell' && source !== 'mcp') {
    console.error(`Error: Unsupported source: ${source}`);
    console.error('Supported sources: terraform, shell, mcp');
    process.exit(1);
  }

  return source;
}

async function evaluateConsequenceInput(
  source: EvaluationSource,
  input: string,
  options: EvaluationOptions
) {
  const adapterContext = {
    actorId: options.actor,
    environment: options.environment,
    owner: options.owner,
  };
  const awsEvidence = {
    ...(options.awsS3Evidence ? { s3Buckets: parseS3EvidenceFile(options.awsS3Evidence) } : {}),
    ...(options.awsRdsEvidence ? { rdsInstances: parseRdsEvidenceFile(options.awsRdsEvidence) } : {}),
    ...(options.awsDynamodbEvidence ? { dynamoDbTables: parseDynamoDbEvidenceFile(options.awsDynamodbEvidence) } : {}),
    ...(options.awsIamEvidence ? { iamRoles: parseIamEvidenceFile(options.awsIamEvidence) } : {}),
    ...(options.awsKmsEvidence ? { kmsKeys: parseKmsEvidenceFile(options.awsKmsEvidence) } : {}),
  };

  if (source === 'terraform') {
    return evaluateTerraformInput(input, options.state, options.classifier, adapterContext);
  }

  if (source === 'shell') {
    return evaluateShellCommandConsequences(input, { adapterContext, awsEvidence });
  }

  return evaluateMcpToolCallConsequences(parseMcpInput(input), { adapterContext, awsEvidence });
}

async function evaluateTerraformInput(
  inputFile: string,
  stateOption: string | undefined,
  useClassifier: boolean,
  adapterContext: {
    actorId?: string;
    environment?: string;
    owner?: string;
  }
) {
  if (!existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const plan = await parsePlanFile(inputFile);

  let state = null;
  const stateFile = stateOption || 'terraform.tfstate';
  if (existsSync(stateFile)) {
    state = await parseStateFile(stateFile);
  } else if (stateOption) {
    console.error(`Error: State file not found: ${stateOption}`);
    process.exit(1);
  }

  return evaluateTerraformPlanConsequences(plan, state, {
    useClassifier,
    adapterContext,
  });
}

function parseMcpInput(input: string): McpToolCall {
  const raw = existsSync(input)
    ? readFileSync(input, 'utf8')
    : input;

  const parsed = JSON.parse(raw) as McpToolCall;
  if (!parsed || typeof parsed.tool !== 'string') {
    throw new Error('MCP input must be JSON with a string "tool" field');
  }

  return parsed;
}

function parseS3EvidenceFile(path: string): Record<string, S3BucketEvidence> {
  if (!existsSync(path)) {
    console.error(`Error: S3 evidence file not found: ${path}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (isObject(parsed) && 's3Buckets' in parsed && isObject(parsed.s3Buckets)) {
    return parsed.s3Buckets as Record<string, S3BucketEvidence>;
  }

  const evidence = isObject(parsed) && 'evidence' in parsed
    ? parsed.evidence
    : parsed;
  if (!isS3BucketEvidence(evidence)) {
    throw new Error('S3 evidence file must contain an evidence object with a bucket field');
  }

  return {
    [evidence.bucket]: evidence,
  };
}

function parseRdsEvidenceFile(path: string): Record<string, RdsInstanceEvidence> {
  if (!existsSync(path)) {
    console.error(`Error: RDS evidence file not found: ${path}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (isObject(parsed) && 'rdsInstances' in parsed && isObject(parsed.rdsInstances)) {
    return parsed.rdsInstances as Record<string, RdsInstanceEvidence>;
  }

  const evidence = isObject(parsed) && 'evidence' in parsed
    ? parsed.evidence
    : parsed;
  if (!isRdsInstanceEvidence(evidence)) {
    throw new Error('RDS evidence file must contain an evidence object with a dbInstanceIdentifier field');
  }

  return {
    [evidence.dbInstanceIdentifier]: evidence,
  };
}

function parseDynamoDbEvidenceFile(path: string): Record<string, DynamoDbTableEvidence> {
  if (!existsSync(path)) {
    console.error(`Error: DynamoDB evidence file not found: ${path}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (isObject(parsed) && 'dynamoDbTables' in parsed && isObject(parsed.dynamoDbTables)) {
    return parsed.dynamoDbTables as Record<string, DynamoDbTableEvidence>;
  }

  const evidence = isObject(parsed) && 'evidence' in parsed
    ? parsed.evidence
    : parsed;
  if (!isDynamoDbTableEvidence(evidence)) {
    throw new Error('DynamoDB evidence file must contain an evidence object with a tableName field');
  }

  return {
    [evidence.tableName]: evidence,
  };
}

function parseIamEvidenceFile(path: string): Record<string, IamRoleEvidence> {
  if (!existsSync(path)) {
    console.error(`Error: IAM evidence file not found: ${path}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (isObject(parsed) && 'iamRoles' in parsed && isObject(parsed.iamRoles)) {
    return parsed.iamRoles as Record<string, IamRoleEvidence>;
  }

  const evidence = isObject(parsed) && 'evidence' in parsed
    ? parsed.evidence
    : parsed;
  if (!isIamRoleEvidence(evidence)) {
    throw new Error('IAM evidence file must contain an evidence object with a roleName field');
  }

  return {
    [evidence.roleName]: evidence,
  };
}

function parseKmsEvidenceFile(path: string): Record<string, KmsKeyEvidence> {
  if (!existsSync(path)) {
    console.error(`Error: KMS evidence file not found: ${path}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (isObject(parsed) && 'kmsKeys' in parsed && isObject(parsed.kmsKeys)) {
    return parsed.kmsKeys as Record<string, KmsKeyEvidence>;
  }

  const evidence = isObject(parsed) && 'evidence' in parsed
    ? parsed.evidence
    : parsed;
  if (!isKmsKeyEvidence(evidence)) {
    throw new Error('KMS evidence file must contain an evidence object with a keyId field');
  }

  return {
    [evidence.keyId]: evidence,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isS3BucketEvidence(value: unknown): value is S3BucketEvidence {
  return isObject(value)
    && typeof value.bucket === 'string'
    && value.bucket.length > 0;
}

function isRdsInstanceEvidence(value: unknown): value is RdsInstanceEvidence {
  return isObject(value)
    && typeof value.dbInstanceIdentifier === 'string'
    && value.dbInstanceIdentifier.length > 0;
}

function isDynamoDbTableEvidence(value: unknown): value is DynamoDbTableEvidence {
  return isObject(value)
    && typeof value.tableName === 'string'
    && value.tableName.length > 0;
}

function isIamRoleEvidence(value: unknown): value is IamRoleEvidence {
  return isObject(value)
    && typeof value.roleName === 'string'
    && value.roleName.length > 0;
}

function isKmsKeyEvidence(value: unknown): value is KmsKeyEvidence {
  return isObject(value)
    && typeof value.keyId === 'string'
    && value.keyId.length > 0;
}

program
  .command('explain')
  .description('Explain the classification for a specific resource')
  .argument('<plan-file>', 'Path to Terraform plan JSON file')
  .argument('<resource-address>', 'Resource address to explain (e.g., aws_db_instance.main)')
  .option('-s, --state <file>', 'Path to Terraform state file')
  .option('-f, --format <format>', 'Output format: human or json', 'human')
  .action(async (planFile: string, resourceAddress: string, options: {
    state?: string;
    format: string;
  }) => {
    try {
      // Validate plan file exists
      if (!existsSync(planFile)) {
        console.error(`Error: Plan file not found: ${planFile}`);
        process.exit(1);
      }

      // Parse plan
      const plan = await parsePlanFile(planFile);

      // Find the resource in the plan
      const change = plan.resourceChanges.find(c => c.address === resourceAddress);
      if (!change) {
        console.error(`Error: Resource not found in plan: ${resourceAddress}`);
        console.error('');
        console.error('Available resources:');
        for (const c of plan.resourceChanges) {
          console.error(`  ${c.address}`);
        }
        process.exit(1);
      }

      // Parse state if provided
      let state = null;
      if (options.state) {
        if (!existsSync(options.state)) {
          console.error(`Error: State file not found: ${options.state}`);
          process.exit(1);
        }
        state = await parseStateFile(options.state);
      } else if (plan.priorState) {
        state = plan.priorState;
      }

      // Check if detailed tracing is available
      if (!hasDetailedTracing(change.type)) {
        console.error(`Note: ${change.type} does not yet have detailed tracing.`);
        console.error('Showing basic classification only.\n');
      }

      // Get traced classification
      const trace = getRecoverabilityTraced(change, state);

      // Output
      if (options.format === 'json') {
        console.log(formatExplainJson(trace));
      } else {
        console.log(formatExplain(trace));
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const decisionSeverity: Record<ConsequenceDecision, number> = {
  allow: 0,
  warn: 1,
  escalate: 2,
  block: 3,
};

function shouldFailOnDecision(
  decision: ConsequenceDecision,
  threshold: string
): boolean {
  const thresholdSeverity = decisionSeverity[threshold as ConsequenceDecision];
  if (thresholdSeverity === undefined) return false;
  return decisionSeverity[decision] >= thresholdSeverity;
}

export { program };
