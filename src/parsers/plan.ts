import { readFile } from 'fs/promises';
import type { TerraformPlan, ResourceChange, TerraformAction } from '../resources/types.js';

interface RawPlanResourceChange {
  address: string;
  type: string;
  name: string;
  provider_name: string;
  change: {
    actions: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    after_unknown: Record<string, unknown>;
  };
}

interface RawTerraformPlan {
  format_version: string;
  terraform_version: string;
  resource_changes?: RawPlanResourceChange[];
  prior_state?: {
    format_version: string;
    terraform_version: string;
    values?: {
      root_module?: {
        resources?: Array<{
          address: string;
          type: string;
          name: string;
          provider_name: string;
          values: Record<string, unknown>;
          depends_on?: string[];
        }>;
        child_modules?: Array<{
          address: string;
          resources?: Array<{
            address: string;
            type: string;
            name: string;
            provider_name: string;
            values: Record<string, unknown>;
            depends_on?: string[];
          }>;
        }>;
      };
    };
  };
}

function normalizeAction(action: string): TerraformAction {
  const actionMap: Record<string, TerraformAction> = {
    'create': 'create',
    'read': 'read',
    'update': 'update',
    'delete': 'delete',
    'no-op': 'no-op',
  };
  return actionMap[action] || 'no-op';
}

function parseResourceChange(raw: RawPlanResourceChange): ResourceChange {
  return {
    address: raw.address,
    type: raw.type,
    name: raw.name,
    providerName: raw.provider_name,
    actions: raw.change.actions.map(normalizeAction),
    before: raw.change.before,
    after: raw.change.after,
    afterUnknown: raw.change.after_unknown || {},
  };
}

export async function parsePlanFile(filePath: string): Promise<TerraformPlan> {
  const content = await readFile(filePath, 'utf-8');
  return parsePlanJson(content);
}

export function parsePlanJson(jsonContent: string): TerraformPlan {
  const raw = JSON.parse(jsonContent) as RawTerraformPlan;

  const resourceChanges = (raw.resource_changes || [])
    .filter((rc) => rc.type !== 'data')  // Ignore data sources
    .map(parseResourceChange);

  // Extract prior state if present
  let priorState = undefined;
  if (raw.prior_state?.values?.root_module) {
    const rootResources = raw.prior_state.values.root_module.resources || [];
    const childResources = (raw.prior_state.values.root_module.child_modules || [])
      .flatMap(m => m.resources || []);

    priorState = {
      formatVersion: raw.prior_state.format_version,
      terraformVersion: raw.prior_state.terraform_version,
      resources: [...rootResources, ...childResources].map(r => ({
        address: r.address,
        type: r.type,
        name: r.name,
        providerName: r.provider_name,
        values: r.values,
        dependsOn: r.depends_on || [],
      })),
    };
  }

  return {
    formatVersion: raw.format_version,
    terraformVersion: raw.terraform_version,
    resourceChanges,
    priorState,
  };
}

export function filterDestructiveChanges(plan: TerraformPlan): ResourceChange[] {
  return plan.resourceChanges.filter(change =>
    change.actions.includes('delete') ||
    // 'replace' is represented as ['delete', 'create'] in Terraform
    (change.actions.includes('delete') && change.actions.includes('create'))
  );
}

export function filterAllChanges(plan: TerraformPlan): ResourceChange[] {
  return plan.resourceChanges.filter(change =>
    !change.actions.every(a => a === 'no-op')
  );
}
