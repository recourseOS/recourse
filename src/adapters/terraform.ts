import type { MutationAction, MutationIntent } from '../core/index.js';
import type { ResourceChange, TerraformAction } from '../resources/types.js';
import type { AdapterContext, ConsequenceAdapter } from './types.js';

export class TerraformPlanAdapter implements ConsequenceAdapter<ResourceChange[]> {
  source = 'terraform' as const;

  parse(changes: ResourceChange[], context: AdapterContext = {}): MutationIntent[] {
    return changes.map(change => terraformChangeToMutation(change, context));
  }
}

export function terraformChangeToMutation(
  change: ResourceChange,
  context: AdapterContext = {}
): MutationIntent {
  return {
    source: 'terraform',
    action: terraformActionsToMutationAction(change.actions),
    target: {
      provider: change.providerName,
      type: change.type,
      id: change.address,
      name: change.name,
      environment: context.environment,
      owner: context.owner,
    },
    actor: context.actorId
      ? {
          id: context.actorId,
          kind: 'unknown',
        }
      : undefined,
    before: change.before,
    after: change.after,
    raw: change,
    metadata: {
      ...context.metadata,
      afterUnknown: change.afterUnknown,
    },
  };
}

function terraformActionsToMutationAction(actions: TerraformAction[]): MutationAction {
  if (actions.includes('delete') && actions.includes('create')) return 'replace';
  if (actions.includes('delete')) return 'delete';
  if (actions.includes('create')) return 'create';
  if (actions.includes('update')) return 'update';
  if (actions.includes('read')) return 'read';
  if (actions.includes('no-op')) return 'no-op';
  return 'execute';
}
