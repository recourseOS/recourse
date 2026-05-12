/**
 * RecourseOS Runtime Router Integration
 *
 * The router chooses the lane. RecourseOS guards the dangerous turns.
 *
 * @example
 * ```typescript
 * import { RecourseGate, createGate } from '@recourse/runtime-router';
 *
 * // Production: full enforcement
 * const gate = createGate.gateway();
 *
 * // Before executing any mutation
 * const result = await gate.evaluate({
 *   source: 'shell',
 *   command: 'aws s3 rm s3://prod-bucket --recursive'
 * });
 *
 * if (result.permitted) {
 *   await executeCommand(command);
 * } else if (result.approvalRequested) {
 *   // Show approval UI, wait for human decision
 *   showApprovalDialog(result);
 * } else {
 *   // Blocked - show reason to user
 *   showBlockedMessage(result.reason);
 * }
 * ```
 *
 * @example Enterprise mode with approval callback
 * ```typescript
 * const gate = createGate.enterprise(async (result) => {
 *   // This is called when decision is 'escalate'
 *   // Show UI, wait for human, return true/false
 *   return await showApprovalDialog(result);
 * });
 *
 * // Now evaluate() will pause on 'escalate' and call your callback
 * const result = await gate.evaluate(intent);
 * // result.approved will be set based on callback return
 * ```
 */

export { RecourseGate, createGate } from './client.js';

export type {
  // Mutation Intents
  MutationIntent,
  MutationSource,
  TerraformIntent,
  ShellIntent,
  McpIntent,
  KubernetesIntent,
  DockerIntent,
  CloudApiIntent,

  // Gate Configuration
  GateConfig,
  GateMode,
  RiskDecision,

  // Gate Results
  GateResult,
  RecoverabilityInfo,
  MutationAnalysis,
  ConsequenceSummary,
  Attestation,

  // Events
  GateEvent,
  GateEventType,
  GateEventHandler,
} from './types.js';
