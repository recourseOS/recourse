/**
 * Example: Runtime Router with RecourseOS Consequence Gate
 *
 * This shows how a runtime router integrates RecourseOS as the
 * consequence-verification layer for agent mutations.
 *
 * The router chooses the lane. RecourseOS guards the dangerous turns.
 */

import { RecourseGate, createGate, type MutationIntent, type GateResult } from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Example 1: Basic Gateway Mode (Production)
// ─────────────────────────────────────────────────────────────────────────────

async function basicGatewayExample() {
  const gate = createGate.gateway({
    actorId: 'agent-123',
    environment: 'production',
  });

  // Listen for events (for logging, metrics, UI updates)
  gate.on((event) => {
    console.log(`[${event.type}]`, event.timestamp);
  });

  // Agent wants to delete an S3 bucket
  const intent: MutationIntent = {
    source: 'shell',
    command: 'aws s3 rb s3://prod-data --force',
  };

  const result = await gate.evaluate(intent);

  if (result.permitted) {
    console.log('Executing command...');
    // executeCommand(intent.command);
  } else {
    console.log(`Blocked: ${result.reason}`);
    console.log(`Decision: ${result.decision}`);
    console.log(`Recoverability: ${result.summary.worstRecoverability.label}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 2: Enterprise Mode with Human Approval
// ─────────────────────────────────────────────────────────────────────────────

async function enterpriseExample() {
  // Simulated approval UI
  async function showApprovalDialog(result: GateResult): Promise<boolean> {
    console.log('\n=== APPROVAL REQUIRED ===');
    console.log(`Action: ${result.mutations[0]?.action || 'unknown'}`);
    console.log(`Target: ${result.mutations[0]?.target.id || 'unknown'}`);
    console.log(`Risk: ${result.decision}`);
    console.log(`Recoverability: ${result.summary.worstRecoverability.label}`);
    console.log(`Reason: ${result.reason}`);
    console.log('========================\n');

    // In real app, this would wait for user input
    // return await waitForUserApproval();
    return true; // Simulate approval
  }

  const gate = createGate.enterprise(showApprovalDialog, {
    actorId: 'agent-456',
    environment: 'production',
  });

  const intent: MutationIntent = {
    source: 'mcp',
    server: 'aws',
    tool: 'rds.delete_db_instance',
    arguments: {
      db_instance_identifier: 'prod-database',
      skip_final_snapshot: true,
    },
  };

  const result = await gate.evaluate(intent);

  if (result.permitted) {
    if (result.approved) {
      console.log('Human approved. Executing...');
    } else {
      console.log('Auto-allowed (low risk). Executing...');
    }
  } else {
    console.log('Blocked or rejected by human.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 3: CI Mode (Pipeline Integration)
// ─────────────────────────────────────────────────────────────────────────────

async function ciExample() {
  const gate = createGate.ci({
    actorId: process.env.CI_ACTOR || 'ci-pipeline',
    environment: 'ci',
  });

  // Terraform plan review
  const intent: MutationIntent = {
    source: 'terraform',
    planJson: JSON.stringify({
      format_version: '1.0',
      resource_changes: [
        {
          address: 'aws_s3_bucket.data',
          type: 'aws_s3_bucket',
          change: { actions: ['delete'] },
        },
      ],
    }),
  };

  const result = await gate.evaluate(intent);

  if (!result.permitted) {
    console.error('CI FAILURE: Dangerous Terraform changes detected');
    console.error(`Decision: ${result.decision}`);
    console.error(`Reason: ${result.reason}`);
    process.exit(1);
  }

  console.log('CI PASS: Terraform changes are safe');
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 4: Advisory Mode (Development)
// ─────────────────────────────────────────────────────────────────────────────

async function advisoryExample() {
  const gate = createGate.advisory({
    actorId: 'developer-local',
    environment: 'development',
  });

  const intent: MutationIntent = {
    source: 'shell',
    command: 'rm -rf ./node_modules',
  };

  const result = await gate.evaluate(intent);

  // Advisory mode always permits (unless hard block)
  // but provides the assessment for education
  if (result.decision === 'warn' || result.decision === 'escalate') {
    console.warn(`Warning: ${result.reason}`);
    console.warn(`This would be ${result.decision}ed in production.`);
  }

  // Proceed anyway in dev
  console.log('Executing in advisory mode...');
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 5: Full Router Integration
// ─────────────────────────────────────────────────────────────────────────────

interface RouterRequest {
  intent: string;
  context: Record<string, unknown>;
}

interface AgentRuntime {
  name: string;
  execute: (request: RouterRequest) => Promise<unknown>;
}

class RuntimeRouter {
  private gate: RecourseGate;
  private runtimes: Map<string, AgentRuntime> = new Map();

  constructor(mode: 'advisory' | 'ci' | 'gateway' = 'gateway') {
    this.gate = new RecourseGate({ mode });
  }

  registerRuntime(runtime: AgentRuntime) {
    this.runtimes.set(runtime.name, runtime);
  }

  async route(request: RouterRequest): Promise<unknown> {
    // 1. Intent classification (simplified)
    const selectedRuntime = this.selectRuntime(request);

    // 2. Detect if this involves a mutation
    const mutation = this.detectMutation(request);

    // 3. If mutation, check with RecourseOS
    if (mutation) {
      const gateResult = await this.gate.evaluate(mutation);

      if (!gateResult.permitted) {
        throw new Error(`Mutation blocked: ${gateResult.reason}`);
      }

      // Attach consequence report to request context
      request.context._consequenceReport = gateResult;
    }

    // 4. Execute via selected runtime
    return selectedRuntime.execute(request);
  }

  private selectRuntime(_request: RouterRequest): AgentRuntime {
    // Simplified: just return first runtime
    return this.runtimes.values().next().value!;
  }

  private detectMutation(request: RouterRequest): MutationIntent | null {
    // Simplified mutation detection
    // In real router, this would analyze the request
    const intent = request.intent.toLowerCase();

    if (intent.includes('delete') || intent.includes('remove')) {
      return {
        source: 'shell',
        command: `aws s3 rm ${request.context.target || 'unknown'}`,
      };
    }

    return null;
  }
}

async function fullRouterExample() {
  const router = new RuntimeRouter('gateway');

  router.registerRuntime({
    name: 'default',
    execute: async (req) => {
      console.log(`Executing: ${req.intent}`);
      return { success: true };
    },
  });

  try {
    await router.route({
      intent: 'Delete the old backup bucket',
      context: { target: 's3://old-backups' },
    });
  } catch (error) {
    console.error('Router blocked the request:', error);
  }
}

// Run examples
async function main() {
  console.log('\n=== Basic Gateway Example ===');
  await basicGatewayExample();

  console.log('\n=== Enterprise Example ===');
  await enterpriseExample();

  console.log('\n=== CI Example ===');
  // Skip CI example as it calls process.exit
  // await ciExample();

  console.log('\n=== Advisory Example ===');
  await advisoryExample();

  console.log('\n=== Full Router Example ===');
  await fullRouterExample();
}

main().catch(console.error);
