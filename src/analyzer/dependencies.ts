import type { TerraformState, StateResource, ResourceDependency } from '../resources/types.js';
import { getDependencies } from '../resources/index.js';

export interface DependencyGraph {
  // Map from resource address to resources that depend on it
  dependents: Map<string, ResourceDependency[]>;
  // Map from resource address to resources it depends on
  dependencies: Map<string, ResourceDependency[]>;
}

export function buildDependencyGraph(state: TerraformState): DependencyGraph {
  const dependents = new Map<string, ResourceDependency[]>();
  const dependencies = new Map<string, ResourceDependency[]>();

  // Initialize empty arrays for all resources
  for (const resource of state.resources) {
    dependents.set(resource.address, []);
    dependencies.set(resource.address, []);
  }

  // Build the graph
  for (const resource of state.resources) {
    // Get explicit dependencies from depends_on
    for (const dep of resource.dependsOn) {
      const existing = dependencies.get(resource.address) || [];
      existing.push({
        address: dep,
        dependencyType: 'explicit',
      });
      dependencies.set(resource.address, existing);

      // Add reverse mapping
      const depDependents = dependents.get(dep) || [];
      depDependents.push({
        address: resource.address,
        dependencyType: 'explicit',
      });
      dependents.set(dep, depDependents);
    }

    // Get implicit dependencies from handler
    const implicitDeps = getDependencies(resource, state.resources);
    for (const dep of implicitDeps) {
      // This is actually a "dependent" relationship from the handler's perspective
      // The handler returns resources that depend on this resource
      const existing = dependents.get(resource.address) || [];
      existing.push(dep);
      dependents.set(resource.address, existing);
    }
  }

  return { dependents, dependencies };
}

export function findDependents(
  graph: DependencyGraph,
  address: string,
  visited: Set<string> = new Set()
): ResourceDependency[] {
  if (visited.has(address)) {
    return [];
  }
  visited.add(address);

  const directDependents = graph.dependents.get(address) || [];
  const allDependents: ResourceDependency[] = [...directDependents];

  // Recursively find dependents of dependents
  for (const dep of directDependents) {
    const transitiveDeps = findDependents(graph, dep.address, visited);
    allDependents.push(...transitiveDeps);
  }

  return allDependents;
}

export function findAllAffectedResources(
  graph: DependencyGraph,
  addresses: string[]
): Map<string, ResourceDependency[]> {
  const affected = new Map<string, ResourceDependency[]>();

  for (const address of addresses) {
    const dependents = findDependents(graph, address);
    if (dependents.length > 0) {
      affected.set(address, dependents);
    }
  }

  return affected;
}
