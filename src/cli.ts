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
import { parseRiskLevels } from './mcp/gateway.js';
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
import { verifyAttestation, type Attestation, type VerifyResult } from './verify/index.js';

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
  .version('0.1.39');

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

mcp
  .command('gateway')
  .description('Start RecourseOS as an MCP gateway (proxies tool calls through evaluation)')
  .option('-c, --config <file>', 'Path to gateway config JSON')
  .option('-v, --verbose', 'Log evaluations to stderr')
  .option('--allow <levels>', 'Comma-separated risk levels to allow (default: allow,warn)', 'allow,warn')
  .option('--upstream <json>', 'JSON array of upstream servers [{name, command, args}]')
  .action(async (options: { config?: string; verbose?: boolean; allow?: string; upstream?: string }) => {
    const { startGateway, loadGatewayConfig } = await import('./mcp/gateway.js');

    let config = loadGatewayConfig(options.config);

    if (options.upstream) {
      try {
        config.upstreams = JSON.parse(options.upstream);
      } catch {
        console.error('Invalid --upstream JSON');
        process.exit(1);
      }
    }

    if (options.allow) {
      config.allowedRiskLevels = parseRiskLevels(options.allow);
    }

    if (options.verbose !== undefined) {
      config.verbose = options.verbose;
    }

    await startGateway(config);
  });

// Gateway command - enforcement layer for agents
const gatewayCmd = program
  .command('gateway')
  .description('Agent enforcement gateway - wrapped tools that cannot be bypassed');

gatewayCmd
  .command('serve')
  .description('Start the RecourseOS Gateway MCP server (enforcement mode)')
  .option('-v, --verbose', 'Log gate decisions to stderr')
  .option('-p, --policy <file>', 'Path to policy YAML file')
  .option('-e, --environment <env>', 'Current environment (e.g., production, staging)')
  .action(async (options: { verbose?: boolean; policy?: string; environment?: string }) => {
    const { runGatewayMcpServer } = await import('./gateway/mcp-server.js');
    await runGatewayMcpServer(process.stdin, process.stdout, {
      verbose: options.verbose,
      policyFile: options.policy,
      environment: options.environment as 'dev' | 'staging' | 'prod' | undefined,
    });
  });

gatewayCmd
  .command('doctor')
  .description('Verify gateway enforcement configuration and run self-tests')
  .option('-e, --environment <env>', 'Environment to test (dev, staging, prod)', 'prod')
  .option('-p, --policy <file>', 'Path to policy YAML file')
  .option('--json', 'Output results as JSON')
  .action(async (options: { environment: string; policy?: string; json?: boolean }) => {
    const { runGatewayDoctor } = await import('./gateway/doctor.js');
    const exitCode = await runGatewayDoctor({
      environment: options.environment as 'dev' | 'staging' | 'prod',
      policyFile: options.policy,
      jsonOutput: options.json,
    });
    process.exit(exitCode);
  });

program
  .command('serve')
  .description('Start the RecourseOS playground for testing evaluations')
  .option('-p, --port <port>', 'Port to listen on', '3001')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port: string; open: boolean }) => {
    await runHttpServer({
      port: Number(options.port),
      openBrowser: options.open,
    });
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

      if (shouldFailOnDecision(report.riskAssessment, options.failOn)) {
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
      if (report && shouldFailOnDecision(report.riskAssessment, options.failOn)) {
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

      if (shouldFailOnDecision(report.riskAssessment, options.failOn)) {
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

// ============================================================================
// Verify Command
// ============================================================================

program
  .command('verify')
  .description('Verify an attestation signature')
  .argument('[attestation]', 'Attestation JSON (inline, file path, or - for stdin)')
  .option('-t, --trust <urls>', 'Comma-separated trusted instance URLs')
  .option('--cross-check', 'Fetch attestation from URI and compare')
  .option('-f, --format <format>', 'Output format: human or json', 'human')
  .action(async (attestationArg: string | undefined, options: {
    trust?: string;
    crossCheck?: boolean;
    format: string;
  }) => {
    try {
      // Read attestation from argument, file, or stdin
      let attestationJson: string;

      if (!attestationArg || attestationArg === '-') {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        attestationJson = Buffer.concat(chunks).toString('utf8');
      } else if (existsSync(attestationArg)) {
        // Read from file
        attestationJson = readFileSync(attestationArg, 'utf8');
      } else {
        // Treat as inline JSON
        attestationJson = attestationArg;
      }

      // Parse attestation
      let attestation: Attestation;
      try {
        attestation = JSON.parse(attestationJson);
      } catch {
        console.error('Error: Invalid JSON');
        process.exit(1);
      }

      // Validate basic structure
      if (!attestation.signature || !attestation.key_id || !attestation.attestation_uri) {
        console.error('Error: Not a valid attestation (missing signature, key_id, or attestation_uri)');
        process.exit(1);
      }

      // Parse trusted instances
      const trustedInstances = options.trust
        ? options.trust.split(',').map(u => u.trim())
        : [];

      // Verify
      const result: VerifyResult = await verifyAttestation(attestation, {
        trustedInstances,
        crossCheck: options.crossCheck,
      });

      // Output
      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.valid) {
          console.log('✓ Attestation verified');
          console.log('');
          console.log(`  Key ID:    ${result.keyId}`);
          console.log(`  Key State: ${result.keyState}`);
          console.log(`  Timestamp: ${result.timestamp}`);
          console.log(`  Evaluator: ${attestation.evaluator}`);
          console.log('');
          console.log('Input:');
          console.log(JSON.stringify(attestation.input, null, 2));
          console.log('');
          console.log('Output (riskAssessment):');
          const output = attestation.output as Record<string, unknown>;
          console.log(`  ${output.riskAssessment ?? 'unknown'}`);
        } else {
          console.error('✗ Verification failed');
          console.error('');
          console.error(`  Reason: ${result.reason}`);
          if (result.details) {
            console.error(`  Details: ${result.details}`);
          }
          process.exit(1);
        }
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

// ============================================================================
// Exec Command - Shell wrapper that checks RecourseOS before executing
// ============================================================================

import { spawn } from 'child_process';
import * as readline from 'readline';

program
  .command('exec')
  .description('Execute a shell command after checking with RecourseOS')
  .argument('<command>', 'Shell command to execute (quote the entire command)')
  .option('-y, --yes', 'Auto-approve escalate assessments')
  .option('--force', 'Execute even if blocked (dangerous)')
  .action(async (command: string, options: { yes?: boolean; force?: boolean }) => {

    // Evaluate the command
    const result = evaluateShellCommandConsequences(command, {});
    const assessment = result.riskAssessment;
    const reason = result.assessmentReason || '';

    // Color codes
    const colors = {
      reset: '\x1b[0m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
    };

    const assessmentColors: Record<string, string> = {
      allow: colors.green,
      warn: colors.yellow,
      escalate: colors.yellow,
      block: colors.red,
    };

    // Show assessment
    console.error(`${colors.dim}recourse:${colors.reset} ${assessmentColors[assessment]}${assessment}${colors.reset} - ${reason}`);

    if (result.mutations && result.mutations.length > 0) {
      for (const mutation of result.mutations) {
        const tier = mutation.recoverability?.label || 'unknown';
        console.error(`${colors.dim}  └─${colors.reset} ${mutation.intent?.target?.id || 'unknown'}: ${tier}`);
      }
    }

    // Decision logic
    if (assessment === 'allow') {
      // Safe to execute
      executeCommand(command);
    } else if (assessment === 'warn') {
      // Execute with warning already shown
      executeCommand(command);
    } else if (assessment === 'escalate') {
      if (options.yes) {
        executeCommand(command);
      } else {
        const approved = await promptConfirm(`${colors.yellow}Proceed?${colors.reset} [y/N] `);
        if (approved) {
          executeCommand(command);
        } else {
          console.error(`${colors.dim}Aborted.${colors.reset}`);
          process.exit(1);
        }
      }
    } else if (assessment === 'block') {
      if (options.force) {
        console.error(`${colors.red}${colors.bold}WARNING: Forcing blocked command${colors.reset}`);
        executeCommand(command);
      } else {
        console.error(`${colors.red}Blocked.${colors.reset} Use --force to override.`);
        process.exit(1);
      }
    }
  });

/**
 * Execute a shell command after RecourseOS evaluation.
 *
 * SECURITY NOTE: shell:true is intentional here because:
 * 1. This is the `recourse exec` CLI command where user explicitly provides a command
 * 2. Commands may include shell features (pipes, redirections, etc.)
 * 3. The command is validated by RecourseOS before execution
 *
 * This is NOT used for programmatic/untrusted input.
 */
function executeCommand(command: string): void {
  // Validate command is a non-empty string
  if (typeof command !== 'string' || command.trim().length === 0) {
    console.error('Invalid command: must be a non-empty string');
    process.exit(1);
  }

  const child = spawn(command, {
    shell: true,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

function promptConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// ============================================================================
// Wrap Command - Generate shell aliases for automatic RecourseOS checking
// ============================================================================

program
  .command('wrap')
  .description('Output shell aliases that route dangerous commands through RecourseOS')
  .option('--commands <list>', 'Comma-separated list of commands to wrap', 'rm,rmdir,kubectl,aws,gcloud,az,terraform')
  .action((options: { commands: string }) => {
    const commands = options.commands.split(',').map(c => c.trim());

    console.log('# RecourseOS shell wrapper');
    console.log('# Add to your shell profile: eval "$(recourse wrap)"');
    console.log('# Or for specific commands: eval "$(recourse wrap --commands rm,aws)"');
    console.log('');

    for (const cmd of commands) {
      // Create a function that wraps the command
      console.log(`${cmd}() {`);
      console.log(`  if command -v recourse >/dev/null 2>&1; then`);
      console.log(`    recourse exec "${cmd} $*"`);
      console.log(`  else`);
      console.log(`    command ${cmd} "$@"`);
      console.log(`  fi`);
      console.log(`}`);
      console.log('');
    }

    console.log('# To bypass RecourseOS, use: command rm ...');
  });

// IAM Session Broker
const iam = program
  .command('iam')
  .description('IAM session broker for scoped cloud credentials');

iam
  .command('broker')
  .description('Start the IAM session broker server')
  .option('-p, --port <port>', 'Port to listen on', '3002')
  .option('--role-arn <arn>', 'AWS role ARN for broker (env: RECOURSE_BROKER_ROLE_ARN)')
  .option('--allow <levels>', 'Risk levels that allow credential issuance', 'allow,warn')
  .option('--duration <seconds>', 'Default session duration in seconds', '900')
  .option('--max-duration <seconds>', 'Maximum session duration in seconds', '3600')
  .action(async (options: {
    port: string;
    roleArn?: string;
    allow: string;
    duration: string;
    maxDuration: string;
  }) => {
    if (options.roleArn) {
      process.env.RECOURSE_BROKER_ROLE_ARN = options.roleArn;
    }
    if (!process.env.RECOURSE_BROKER_ROLE_ARN) {
      console.error('Error: RECOURSE_BROKER_ROLE_ARN required (via --role-arn or environment)');
      process.exit(1);
    }

    process.env.RECOURSE_ALLOWED_LEVELS = options.allow;
    process.env.RECOURSE_SESSION_DURATION = options.duration;
    process.env.RECOURSE_MAX_SESSION_DURATION = options.maxDuration;
    process.env.PORT = options.port;

    const { runBrokerServer } = await import('./iam/broker-server.js');
    await runBrokerServer();
  });

iam
  .command('request')
  .description('Request scoped credentials from a broker')
  .requiredOption('--broker <url>', 'Session broker URL')
  .requiredOption('--intent <json>', 'Intent JSON: {"type":"shell","command":"..."} or {"type":"mcp","tool":"...","arguments":{}}')
  .option('--actor <id>', 'Actor identity')
  .option('--environment <name>', 'Environment name')
  .option('--duration <seconds>', 'Requested session duration')
  .option('--output <format>', 'Output format: json or env', 'json')
  .action(async (options: {
    broker: string;
    intent: string;
    actor?: string;
    environment?: string;
    duration?: string;
    output: string;
  }) => {
    try {
      const intent = JSON.parse(options.intent);

      const request = {
        intent,
        cloud: 'aws' as const,
        actor: options.actor,
        environment: options.environment,
        durationSeconds: options.duration ? parseInt(options.duration) : undefined,
      };

      const response = await fetch(`${options.broker}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const result = await response.json() as {
        granted: boolean;
        riskAssessment: string;
        credentials?: {
          accessKeyId: string;
          secretAccessKey: string;
          sessionToken: string;
          expiration: string;
        };
      };

      if (options.output === 'env' && result.granted && result.credentials) {
        // Output as environment variables for eval
        console.log(`export AWS_ACCESS_KEY_ID="${result.credentials.accessKeyId}"`);
        console.log(`export AWS_SECRET_ACCESS_KEY="${result.credentials.secretAccessKey}"`);
        console.log(`export AWS_SESSION_TOKEN="${result.credentials.sessionToken}"`);
        console.log(`# Session expires: ${result.credentials.expiration}`);
        console.log(`# Risk: ${result.riskAssessment}`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }

      if (!result.granted) {
        process.exit(1);
      }
    } catch (error: any) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Cost tracking commands
import { getBillingClient } from './cost/index.js';

const config = program
  .command('config')
  .description('Manage RecourseOS configuration');

config
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (e.g., license_key)')
  .argument('<value>', 'Configuration value')
  .action(async (key: string, value: string) => {
    const client = getBillingClient();

    if (key === 'license_key') {
      client.setLicenseKey(value);

      // Validate the key
      const info = await client.validateLicense();
      if (info.valid) {
        console.log(`License key set successfully.`);
        console.log(`Organization: ${info.orgName}`);
        console.log(`Features: ${info.features?.join(', ')}`);
      } else {
        console.error(`Warning: License key may be invalid (${info.error})`);
        console.log('Key saved anyway. Will retry validation on next use.');
      }
    } else {
      console.error(`Unknown configuration key: ${key}`);
      process.exit(1);
    }
  });

config
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key')
  .action((key: string) => {
    const client = getBillingClient();

    if (key === 'license_key') {
      const licenseKey = client.getLicenseKey();
      if (licenseKey) {
        // Only show prefix for security
        const masked = licenseKey.slice(0, 10) + '...' + licenseKey.slice(-4);
        console.log(masked);
      } else {
        console.log('Not set');
      }
    } else {
      console.error(`Unknown configuration key: ${key}`);
      process.exit(1);
    }
  });

config
  .command('unset')
  .description('Remove a configuration value')
  .argument('<key>', 'Configuration key')
  .action((key: string) => {
    const client = getBillingClient();

    if (key === 'license_key') {
      client.clearLicenseKey();
      console.log('License key removed.');
    } else {
      console.error(`Unknown configuration key: ${key}`);
      process.exit(1);
    }
  });

const budget = program
  .command('budget')
  .description('Manage agent spending budgets');

budget
  .command('set')
  .description('Set budget for an agent')
  .argument('<agent>', 'Agent ID')
  .requiredOption('-l, --limit <amount>', 'Monthly spending limit in USD')
  .option('-p, --period <period>', 'Budget period: day, week, month', 'month')
  .option('-e, --on-exceed <action>', 'Action when exceeded: block, escalate, warn', 'block')
  .action(async (agent: string, options: { limit: string; period: string; onExceed: string }) => {
    const client = getBillingClient();

    if (!client.isEnabled()) {
      console.error('Cost tracking not enabled. Set a license key first:');
      console.error('  recourse config set license_key <your-key>');
      process.exit(1);
    }

    const success = await client.setBudget(agent, {
      limit: parseFloat(options.limit),
      period: options.period as 'day' | 'week' | 'month',
      onExceed: options.onExceed as 'block' | 'escalate' | 'warn',
    });

    if (success) {
      console.log(`Budget set for ${agent}:`);
      console.log(`  Limit: $${options.limit}/${options.period}`);
      console.log(`  On exceed: ${options.onExceed}`);
    } else {
      console.error('Failed to set budget.');
      process.exit(1);
    }
  });

budget
  .command('list')
  .description('List all agent budgets')
  .action(async () => {
    const client = getBillingClient();

    if (!client.isEnabled()) {
      console.error('Cost tracking not enabled. Set a license key first.');
      process.exit(1);
    }

    const budgets = await client.getBudgets();

    if (!budgets || Object.keys(budgets).length === 0) {
      console.log('No budgets configured.');
      return;
    }

    console.log('Agent Budgets:\n');
    for (const [agentId, budget] of Object.entries(budgets)) {
      const pct = Math.round((budget.currentSpend / budget.limit) * 100);
      console.log(`${agentId}:`);
      console.log(`  Limit: $${budget.limit}/${budget.period}`);
      console.log(`  Spent: $${budget.currentSpend} (${pct}%)`);
      console.log(`  On exceed: ${budget.onExceed}`);
      console.log('');
    }
  });

budget
  .command('status')
  .description('Check budget status')
  .argument('[agent]', 'Agent ID (optional, shows all if not specified)')
  .action(async (agent?: string) => {
    const client = getBillingClient();

    if (!client.isEnabled()) {
      console.error('Cost tracking not enabled. Set a license key first.');
      process.exit(1);
    }

    const budgets = await client.getBudgets();

    if (!budgets) {
      console.log('No budgets configured.');
      return;
    }

    if (agent) {
      const budget = budgets[agent];
      if (!budget) {
        console.log(`No budget set for ${agent}`);
        return;
      }
      const pct = Math.round((budget.currentSpend / budget.limit) * 100);
      const remaining = budget.limit - budget.currentSpend;
      console.log(`${agent}: $${budget.currentSpend} / $${budget.limit} (${pct}%)`);
      console.log(`Remaining: $${remaining.toFixed(2)}`);
    } else {
      for (const [agentId, budget] of Object.entries(budgets)) {
        const pct = Math.round((budget.currentSpend / budget.limit) * 100);
        console.log(`${agentId}: $${budget.currentSpend} / $${budget.limit} (${pct}%)`);
      }
    }
  });

program
  .command('usage')
  .description('Show current billing period usage')
  .action(async () => {
    const client = getBillingClient();

    if (!client.isEnabled()) {
      console.error('Cost tracking not enabled. Set a license key first:');
      console.error('  recourse config set license_key <your-key>');
      process.exit(1);
    }

    const usage = await client.getCurrentUsage();

    if (!usage) {
      console.error('Failed to fetch usage data.');
      process.exit(1);
    }

    console.log('Current Billing Period\n');
    console.log(`Period: ${new Date(usage.period_start as string).toLocaleDateString()} - ${new Date(usage.period_end as string).toLocaleDateString()}`);
    console.log(`Managed resources: ${usage.managed_resources}`);
    console.log(`Cloud spend: $${(usage.cloud_spend as number).toFixed(2)}/mo`);
    console.log(`Free tier remaining: $${(usage.free_tier_remaining as number).toFixed(2)}`);
    console.log(`Billing amount: $${(usage.billing_amount as number).toFixed(2)}`);

    const byAgent = usage.by_agent as Record<string, { resources: number; monthly_cost: number }>;
    if (byAgent && Object.keys(byAgent).length > 0) {
      console.log('\nBy Agent:');
      for (const [agentId, agentUsage] of Object.entries(byAgent)) {
        console.log(`  ${agentId}: $${agentUsage.monthly_cost.toFixed(2)}/mo (${agentUsage.resources} resources)`);
      }
    }
  });

export { program };
