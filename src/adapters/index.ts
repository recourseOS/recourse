export type {
  AdapterContext,
  ConsequenceAdapter,
} from './types.js';

export {
  TerraformPlanAdapter,
  terraformChangeToMutation,
} from './terraform.js';

export {
  ShellCommandAdapter,
  shellCommandToMutation,
  type ShellCommandInput,
} from './shell.js';

export {
  McpToolCallAdapter,
  mcpToolCallToMutation,
  type McpToolCall,
} from './mcp.js';
