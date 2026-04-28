import { readFile } from 'fs/promises';
import type { TerraformState, StateResource } from '../resources/types.js';

interface RawStateResource {
  module?: string;
  mode: string;
  type: string;
  name: string;
  provider: string;
  instances: Array<{
    attributes: Record<string, unknown>;
    dependencies?: string[];
  }>;
}

interface RawTerraformState {
  version: number;
  terraform_version: string;
  resources?: RawStateResource[];
}

function parseStateResource(raw: RawStateResource): StateResource[] {
  // Each resource can have multiple instances (for count/for_each)
  return raw.instances.map((instance, index) => {
    const baseAddress = raw.module
      ? `${raw.module}.${raw.type}.${raw.name}`
      : `${raw.type}.${raw.name}`;

    // For indexed resources, append the index
    const address = raw.instances.length > 1
      ? `${baseAddress}[${index}]`
      : baseAddress;

    return {
      address,
      type: raw.type,
      name: raw.name,
      providerName: raw.provider,
      values: instance.attributes,
      dependsOn: instance.dependencies || [],
    };
  });
}

export async function parseStateFile(filePath: string): Promise<TerraformState> {
  const content = await readFile(filePath, 'utf-8');
  return parseStateJson(content);
}

export function parseStateJson(jsonContent: string): TerraformState {
  const raw = JSON.parse(jsonContent) as RawTerraformState;

  const resources = (raw.resources || [])
    .filter(r => r.mode === 'managed')  // Ignore data sources
    .flatMap(parseStateResource);

  return {
    formatVersion: String(raw.version),
    terraformVersion: raw.terraform_version,
    resources,
  };
}

export function findResource(
  state: TerraformState,
  address: string
): StateResource | undefined {
  return state.resources.find(r => r.address === address);
}

export function findResourcesByType(
  state: TerraformState,
  type: string
): StateResource[] {
  return state.resources.filter(r => r.type === type);
}
