import type { TerraformState, StateResource, ResourceDependency, CascadeImpact } from '../resources/types.js';
import { getDependencies } from '../resources/index.js';

export interface DependencyGraph {
  // Map from resource address to resources that depend on it
  dependents: Map<string, ResourceDependency[]>;
  // Map from resource address to resources it depends on
  dependencies: Map<string, ResourceDependency[]>;
  // Map from address to resource type for lookups
  resourceTypes: Map<string, string>;
}

export function buildDependencyGraph(state: TerraformState): DependencyGraph {
  const dependents = new Map<string, ResourceDependency[]>();
  const dependencies = new Map<string, ResourceDependency[]>();
  const resourceTypes = new Map<string, string>();

  // Initialize empty arrays for all resources
  for (const resource of state.resources) {
    dependents.set(resource.address, []);
    dependencies.set(resource.address, []);
    resourceTypes.set(resource.address, resource.type);
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

  return { dependents, dependencies, resourceTypes };
}

/**
 * Find all resources that depend on the given address.
 * Returns CascadeImpact objects with depth tracking.
 */
export function findDependents(
  graph: DependencyGraph,
  address: string,
  visited: Set<string> = new Set(),
  depth: number = 1
): CascadeImpact[] {
  if (visited.has(address)) {
    return [];
  }
  visited.add(address);

  const directDependents = graph.dependents.get(address) || [];
  const allDependents: CascadeImpact[] = [];

  for (const dep of directDependents) {
    const resourceType = graph.resourceTypes.get(dep.address) || 'unknown';

    allDependents.push({
      affectedResource: dep.address,
      resourceType,
      reason: dep.referenceAttribute
        ? `References ${dep.referenceAttribute} of deleted resource`
        : `Depends on deleted resource`,
      depth,
      dependencyType: dep.dependencyType,
    });

    // Recursively find dependents of dependents (at deeper level)
    const transitiveDeps = findDependents(graph, dep.address, visited, depth + 1);
    allDependents.push(...transitiveDeps);
  }

  return allDependents;
}

/**
 * Legacy function for compatibility - returns just ResourceDependency[]
 */
export function findDependentsLegacy(
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

  for (const dep of directDependents) {
    const transitiveDeps = findDependentsLegacy(graph, dep.address, visited);
    allDependents.push(...transitiveDeps);
  }

  return allDependents;
}

export function findAllAffectedResources(
  graph: DependencyGraph,
  addresses: string[]
): Map<string, CascadeImpact[]> {
  const affected = new Map<string, CascadeImpact[]>();

  for (const address of addresses) {
    const dependents = findDependents(graph, address);
    if (dependents.length > 0) {
      affected.set(address, dependents);
    }
  }

  return affected;
}

/**
 * Build a human-readable summary of cascade impacts by type.
 * Example: "3 subnets, 2 NAT gateways, 14 EC2 instances"
 */
export function buildCascadeSummary(impacts: CascadeImpact[]): {
  byType: Record<string, number>;
  maxDepth: number;
  humanReadable: string;
} {
  const byType: Record<string, number> = {};
  let maxDepth = 0;

  for (const impact of impacts) {
    byType[impact.resourceType] = (byType[impact.resourceType] || 0) + 1;
    if (impact.depth > maxDepth) {
      maxDepth = impact.depth;
    }
  }

  // Build human-readable summary
  const parts = Object.entries(byType)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .map(([type, count]) => {
      const shortType = formatResourceType(type);
      return `${count} ${shortType}${count !== 1 ? 's' : ''}`;
    });

  return {
    byType,
    maxDepth,
    humanReadable: parts.join(', ') || 'none',
  };
}

/**
 * Convert AWS resource type to human-readable short form.
 * Example: "aws_instance" → "EC2 instance"
 */
function formatResourceType(type: string): string {
  const typeMap: Record<string, string> = {
    'aws_instance': 'EC2 instance',
    'aws_subnet': 'subnet',
    'aws_security_group': 'security group',
    'aws_db_instance': 'RDS instance',
    'aws_rds_cluster': 'RDS cluster',
    'aws_s3_bucket': 'S3 bucket',
    'aws_lambda_function': 'Lambda function',
    'aws_vpc': 'VPC',
    'aws_nat_gateway': 'NAT gateway',
    'aws_internet_gateway': 'internet gateway',
    'aws_route_table': 'route table',
    'aws_iam_role': 'IAM role',
    'aws_iam_policy': 'IAM policy',
    'aws_elasticache_cluster': 'ElastiCache cluster',
    'aws_sqs_queue': 'SQS queue',
    'aws_sns_topic': 'SNS topic',
    'aws_efs_file_system': 'EFS filesystem',
    'aws_ebs_volume': 'EBS volume',
    'aws_lb': 'load balancer',
    'aws_lb_target_group': 'target group',
  };

  return typeMap[type] || type.replace(/^aws_/, '').replace(/_/g, ' ');
}
