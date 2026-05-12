/**
 * FlowOS + RecourseOS DAG Demo
 *
 * Demonstrates the full integration:
 * 1. Define a DAG with a recourse_node
 * 2. Execute the DAG
 * 3. RecourseOS intercepts the dangerous command
 * 4. Execution suspends waiting for approval
 * 5. Simulate user approval via API
 * 6. Execution completes
 *
 * Run: npx tsx examples/dag-demo.ts
 */

import {
  DagExecutor,
  InMemoryEventDatabase,
  InMemorySSEBroadcaster,
  type DagDefinition,
  type RecourseEvent,
} from '../src/runtime/index.js';
import { sinkRegistry } from '../src/runtime/event-sink.js';

// ─────────────────────────────────────────────────────────────────────────────
// Define the DAG
// ─────────────────────────────────────────────────────────────────────────────

const dag: DagDefinition = {
  id: 'cleanup-pipeline',
  name: 'Database Cleanup Pipeline',
  nodes: [
    {
      id: 'plan',
      name: 'Plan Cleanup',
      type: 'task',
      config: {
        handler: async () => {
          console.log('  [plan] Analyzing resources to clean up...');
          await sleep(500);
          return { resources: ['staging-db', 'old-backups'] };
        },
      },
    },
    {
      id: 'cleanup-db',
      name: 'Cleanup Staging DB',
      type: 'recourse_node',
      dependsOn: ['plan'],
      config: {
        agentCommand: {
          type: 'shell',
          command: 'aws rds delete-db-instance --db-instance-identifier staging-db --skip-final-snapshot',
        },
      },
    },
    {
      id: 'notify',
      name: 'Send Notification',
      type: 'task',
      dependsOn: ['cleanup-db'],
      config: {
        handler: async () => {
          console.log('  [notify] Sending completion notification...');
          await sleep(200);
          return { sent: true };
        },
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Run the Demo
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  FlowOS + RecourseOS DAG Demo                                                ║
║                                                                              ║
║  DAG: [plan] → [recourse_node: cleanup-db] → [notify]                        ║
║                                                                              ║
║  The recourse_node will intercept the RDS delete command, evaluate it,       ║
║  and escalate for human approval. We'll simulate the approval after 2s.      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Set up infrastructure
  const db = new InMemoryEventDatabase();
  const sse = new InMemorySSEBroadcaster();

  // Subscribe to events for logging
  sse.subscribe('*', (event: RecourseEvent) => {
    console.log(`\n  [EVENT] ${event.type}:`, JSON.stringify(event, null, 2).split('\n').slice(0, 5).join('\n') + '...');
  });

  // Create executor
  const executor = new DagExecutor({
    db,
    sse,
    onNodeStart: (nodeId, node) => {
      console.log(`\n▶ Starting node: ${node.name} (${node.type})`);
    },
    onNodeComplete: (nodeId, result) => {
      console.log(`✓ Completed node: ${nodeId} → ${result.status}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    },
  });

  // Start execution (will suspend at recourse_node waiting for approval)
  console.log('Starting DAG execution...\n');

  const executionPromise = executor.execute(dag);

  // Simulate user approval after 2 seconds
  setTimeout(async () => {
    console.log('\n⏳ Simulating user approval...');

    // Find the pending mutation
    const sink = sinkRegistry.get('cleanup-db');
    if (sink) {
      const pendingIds = sink.getPendingMutationIds();
      console.log(`  Found pending mutations: ${pendingIds.join(', ')}`);

      if (pendingIds.length > 0) {
        // Approve the first pending mutation
        sink.resolveApproval(pendingIds[0], {
          approved: true,
          approver: 'demo-user@example.com',
        });
        console.log(`  ✓ Approved mutation: ${pendingIds[0]}`);
      }
    } else {
      console.log('  No sink found - node may have already completed');
    }
  }, 2000);

  // Wait for execution to complete
  const finalState = await executionPromise;

  // Print summary
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Execution Complete                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

Run ID: ${finalState.runId}
Status: ${finalState.status}
Duration: ${finalState.completedAt!.getTime() - finalState.startedAt.getTime()}ms

Node Results:
`);

  for (const [nodeId, state] of finalState.nodes) {
    const artifacts = state.result?.artifacts
      ? JSON.stringify(state.result.artifacts).slice(0, 60)
      : '';
    console.log(`  ${state.status === 'completed' ? '✓' : '✗'} ${nodeId}: ${state.status} ${artifacts}`);
  }

  console.log(`
Events recorded: ${db.getEvents().length}
`);

  // Print events
  for (const event of db.getEvents()) {
    console.log(`  - ${event.type} (${event.nodeId})`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run
main().catch(console.error);
