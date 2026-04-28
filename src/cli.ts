import { Command } from 'commander';
import { existsSync } from 'fs';
import { parsePlanFile } from './parsers/plan.js';
import { parseStateFile } from './parsers/state.js';
import { analyzeBlastRadius } from './analyzer/blast-radius.js';
import { formatReport } from './output/human.js';
import { formatJson } from './output/json.js';
import { formatExplain, formatExplainJson } from './output/explain.js';
import { getSupportedResourceTypes, getRecoverabilityTraced, hasDetailedTracing } from './resources/index.js';
import { RecoverabilityTier } from './resources/types.js';

const program = new Command();

program
  .name('recourse')
  .description('Know what you can\'t undo before you terraform apply')
  .version('0.1.0');

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

export { program };
