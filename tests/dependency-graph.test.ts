import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, findDependents, findAllAffectedResources } from '../src/analyzer/dependencies.js';
import type { TerraformState, StateResource } from '../src/resources/types.js';

// Helper to create a minimal state resource
function createResource(
  address: string,
  type: string,
  dependsOn: string[] = [],
  values: Record<string, unknown> = {}
): StateResource {
  return {
    address,
    type,
    mode: 'managed',
    name: address.split('.').pop() || address,
    provider: 'registry.terraform.io/hashicorp/aws',
    instances: [{ attributes: values }],
    dependsOn,
    values,
  };
}

// Helper to create a minimal terraform state
function createState(resources: StateResource[]): TerraformState {
  return {
    version: 4,
    serial: 1,
    terraform_version: '1.0.0',
    resources,
  };
}

describe('Dependency Graph', () => {
  describe('buildDependencyGraph', () => {
    it('builds graph from empty state', () => {
      const state = createState([]);
      const graph = buildDependencyGraph(state);

      expect(graph.dependents.size).toBe(0);
      expect(graph.dependencies.size).toBe(0);
    });

    it('builds graph with single resource no dependencies', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
      ]);
      const graph = buildDependencyGraph(state);

      expect(graph.dependents.size).toBe(1);
      expect(graph.dependents.get('aws_s3_bucket.main')).toEqual([]);
      expect(graph.dependencies.get('aws_s3_bucket.main')).toEqual([]);
    });

    it('builds graph with explicit depends_on', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
        createResource('aws_s3_bucket_policy.main', 'aws_s3_bucket_policy', ['aws_s3_bucket.main']),
      ]);
      const graph = buildDependencyGraph(state);

      // Policy depends on bucket
      const policyDeps = graph.dependencies.get('aws_s3_bucket_policy.main');
      expect(policyDeps).toHaveLength(1);
      expect(policyDeps?.[0].address).toBe('aws_s3_bucket.main');
      expect(policyDeps?.[0].dependencyType).toBe('explicit');

      // Bucket has policy as dependent
      const bucketDependents = graph.dependents.get('aws_s3_bucket.main');
      expect(bucketDependents).toHaveLength(1);
      expect(bucketDependents?.[0].address).toBe('aws_s3_bucket_policy.main');
    });

    it('builds graph with multiple explicit dependencies', () => {
      const state = createState([
        createResource('aws_vpc.main', 'aws_vpc'),
        createResource('aws_subnet.public', 'aws_subnet'),
        createResource('aws_instance.web', 'aws_instance', ['aws_vpc.main', 'aws_subnet.public']),
      ]);
      const graph = buildDependencyGraph(state);

      const instanceDeps = graph.dependencies.get('aws_instance.web');
      expect(instanceDeps).toHaveLength(2);

      const depAddresses = instanceDeps?.map(d => d.address).sort();
      expect(depAddresses).toEqual(['aws_subnet.public', 'aws_vpc.main']);
    });

    it('handles resource with dependency on non-existent resource', () => {
      const state = createState([
        createResource('aws_instance.web', 'aws_instance', ['aws_vpc.missing']),
      ]);
      const graph = buildDependencyGraph(state);

      const instanceDeps = graph.dependencies.get('aws_instance.web');
      expect(instanceDeps).toHaveLength(1);
      expect(instanceDeps?.[0].address).toBe('aws_vpc.missing');

      // The missing resource should have instance as dependent
      const missingDependents = graph.dependents.get('aws_vpc.missing');
      expect(missingDependents).toHaveLength(1);
    });
  });

  describe('findDependents', () => {
    it('returns empty for resource with no dependents', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
      ]);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_s3_bucket.main');

      expect(dependents).toHaveLength(0);
    });

    it('finds direct dependents', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
        createResource('aws_s3_bucket_policy.main', 'aws_s3_bucket_policy', ['aws_s3_bucket.main']),
        createResource('aws_s3_bucket_versioning.main', 'aws_s3_bucket_versioning', ['aws_s3_bucket.main']),
      ]);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_s3_bucket.main');

      expect(dependents).toHaveLength(2);
      const addresses = dependents.map(d => d.address).sort();
      expect(addresses).toEqual([
        'aws_s3_bucket_policy.main',
        'aws_s3_bucket_versioning.main',
      ]);
    });

    it('finds transitive dependents (chain)', () => {
      const state = createState([
        createResource('aws_vpc.main', 'aws_vpc'),
        createResource('aws_subnet.main', 'aws_subnet', ['aws_vpc.main']),
        createResource('aws_instance.web', 'aws_instance', ['aws_subnet.main']),
      ]);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_vpc.main');

      // VPC → Subnet → Instance
      expect(dependents.length).toBeGreaterThanOrEqual(2);
      const addresses = dependents.map(d => d.address);
      expect(addresses).toContain('aws_subnet.main');
      expect(addresses).toContain('aws_instance.web');
    });

    it('handles diamond dependency pattern', () => {
      // A → B, A → C, B → D, C → D
      const state = createState([
        createResource('aws_vpc.a', 'aws_vpc'),
        createResource('aws_subnet.b', 'aws_subnet', ['aws_vpc.a']),
        createResource('aws_subnet.c', 'aws_subnet', ['aws_vpc.a']),
        createResource('aws_instance.d', 'aws_instance', ['aws_subnet.b', 'aws_subnet.c']),
      ]);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_vpc.a');

      // A affects B, C, and D
      const addresses = new Set(dependents.map(d => d.address));
      expect(addresses.has('aws_subnet.b')).toBe(true);
      expect(addresses.has('aws_subnet.c')).toBe(true);
      expect(addresses.has('aws_instance.d')).toBe(true);
    });

    it('handles circular dependencies without infinite loop', () => {
      // Create state with circular explicit depends_on (shouldn't happen in real TF but test robustness)
      const state = createState([
        createResource('aws_security_group.a', 'aws_security_group', ['aws_security_group.b']),
        createResource('aws_security_group.b', 'aws_security_group', ['aws_security_group.a']),
      ]);
      const graph = buildDependencyGraph(state);

      // Should not hang - visited set prevents infinite recursion
      const dependentsA = findDependents(graph, 'aws_security_group.a');
      const dependentsB = findDependents(graph, 'aws_security_group.b');

      // Both should find each other but not infinitely recurse
      expect(dependentsA.some(d => d.address === 'aws_security_group.b')).toBe(true);
      expect(dependentsB.some(d => d.address === 'aws_security_group.a')).toBe(true);
    });

    it('handles deep nesting (5+ levels)', () => {
      const resources: StateResource[] = [];
      for (let i = 0; i < 6; i++) {
        const dependsOn = i > 0 ? [`aws_resource.level${i - 1}`] : [];
        resources.push(createResource(`aws_resource.level${i}`, 'aws_resource', dependsOn));
      }
      const state = createState(resources);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_resource.level0');

      // level0 should affect all subsequent levels
      expect(dependents.length).toBeGreaterThanOrEqual(5);
    });

    it('handles fan-out (one resource with many dependents)', () => {
      const resources: StateResource[] = [
        createResource('aws_vpc.main', 'aws_vpc'),
      ];
      // Create 10 subnets all depending on the VPC
      for (let i = 0; i < 10; i++) {
        resources.push(
          createResource(`aws_subnet.subnet${i}`, 'aws_subnet', ['aws_vpc.main'])
        );
      }
      const state = createState(resources);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_vpc.main');

      // Should find at least 10 dependents (may include implicit deps)
      expect(dependents.length).toBeGreaterThanOrEqual(10);
      // Verify all subnets are found
      const addresses = new Set(dependents.map(d => d.address));
      for (let i = 0; i < 10; i++) {
        expect(addresses.has(`aws_subnet.subnet${i}`)).toBe(true);
      }
    });

    it('returns empty for non-existent resource', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
      ]);
      const graph = buildDependencyGraph(state);
      const dependents = findDependents(graph, 'aws_s3_bucket.nonexistent');

      expect(dependents).toHaveLength(0);
    });
  });

  describe('findAllAffectedResources', () => {
    it('finds affected resources for multiple addresses', () => {
      const state = createState([
        createResource('aws_s3_bucket.a', 'aws_s3_bucket'),
        createResource('aws_s3_bucket.b', 'aws_s3_bucket'),
        createResource('aws_s3_bucket_policy.a', 'aws_s3_bucket_policy', ['aws_s3_bucket.a']),
        createResource('aws_s3_bucket_policy.b', 'aws_s3_bucket_policy', ['aws_s3_bucket.b']),
      ]);
      const graph = buildDependencyGraph(state);
      const affected = findAllAffectedResources(graph, ['aws_s3_bucket.a', 'aws_s3_bucket.b']);

      expect(affected.size).toBe(2);
      expect(affected.get('aws_s3_bucket.a')?.[0].address).toBe('aws_s3_bucket_policy.a');
      expect(affected.get('aws_s3_bucket.b')?.[0].address).toBe('aws_s3_bucket_policy.b');
    });

    it('excludes resources with no dependents from result', () => {
      const state = createState([
        createResource('aws_s3_bucket.orphan', 'aws_s3_bucket'),
        createResource('aws_s3_bucket.parent', 'aws_s3_bucket'),
        createResource('aws_s3_bucket_policy.child', 'aws_s3_bucket_policy', ['aws_s3_bucket.parent']),
      ]);
      const graph = buildDependencyGraph(state);
      const affected = findAllAffectedResources(graph, ['aws_s3_bucket.orphan', 'aws_s3_bucket.parent']);

      // Only parent should be in the map (has dependents)
      expect(affected.size).toBe(1);
      expect(affected.has('aws_s3_bucket.parent')).toBe(true);
      expect(affected.has('aws_s3_bucket.orphan')).toBe(false);
    });

    it('handles empty address list', () => {
      const state = createState([
        createResource('aws_s3_bucket.main', 'aws_s3_bucket'),
      ]);
      const graph = buildDependencyGraph(state);
      const affected = findAllAffectedResources(graph, []);

      expect(affected.size).toBe(0);
    });

    it('deduplicates transitive dependents across queries', () => {
      // If A→B→C and we query both A and B, C should appear for both
      const state = createState([
        createResource('aws_vpc.a', 'aws_vpc'),
        createResource('aws_subnet.b', 'aws_subnet', ['aws_vpc.a']),
        createResource('aws_instance.c', 'aws_instance', ['aws_subnet.b']),
      ]);
      const graph = buildDependencyGraph(state);
      const affected = findAllAffectedResources(graph, ['aws_vpc.a', 'aws_subnet.b']);

      // Both should be in the map
      expect(affected.size).toBe(2);
      // A should have B and C as dependents
      const aAffected = affected.get('aws_vpc.a')?.map(d => d.address);
      expect(aAffected).toContain('aws_subnet.b');
      expect(aAffected).toContain('aws_instance.c');
      // B should have C as dependent
      const bAffected = affected.get('aws_subnet.b')?.map(d => d.address);
      expect(bAffected).toContain('aws_instance.c');
    });
  });

  describe('Mixed Explicit and Implicit Dependencies', () => {
    it('combines explicit depends_on with handler-detected implicit deps', () => {
      // RDS with explicit depends_on to VPC, plus implicit references
      const state = createState([
        createResource('aws_vpc.main', 'aws_vpc'),
        createResource('aws_security_group.db', 'aws_security_group', ['aws_vpc.main'], {
          vpc_id: 'vpc-123',
        }),
        createResource('aws_db_instance.main', 'aws_db_instance', ['aws_security_group.db'], {
          vpc_security_group_ids: ['sg-123'],
        }),
      ]);
      const graph = buildDependencyGraph(state);

      // VPC should have security group as dependent (explicit)
      const vpcDependents = graph.dependents.get('aws_vpc.main');
      expect(vpcDependents?.some(d => d.address === 'aws_security_group.db')).toBe(true);

      // Security group should have DB as dependent (explicit)
      const sgDependents = graph.dependents.get('aws_security_group.db');
      expect(sgDependents?.some(d => d.address === 'aws_db_instance.main')).toBe(true);
    });
  });

  describe('Performance', () => {
    it('handles large dependency graph efficiently', () => {
      const resources: StateResource[] = [];
      const resourceCount = 100;

      // Create a network of resources with various dependencies
      for (let i = 0; i < resourceCount; i++) {
        const dependsOn: string[] = [];
        // Each resource depends on 0-3 previous resources
        const depCount = Math.min(i, Math.floor(Math.random() * 4));
        for (let j = 0; j < depCount; j++) {
          const depIndex = Math.floor(Math.random() * i);
          dependsOn.push(`aws_resource.r${depIndex}`);
        }
        resources.push(createResource(`aws_resource.r${i}`, 'aws_resource', dependsOn));
      }

      const state = createState(resources);
      const startTime = Date.now();
      const graph = buildDependencyGraph(state);
      const buildTime = Date.now() - startTime;

      // Should build in reasonable time (< 100ms for 100 resources)
      expect(buildTime).toBeLessThan(100);

      // Should be able to query dependents
      const queryStart = Date.now();
      findDependents(graph, 'aws_resource.r0');
      const queryTime = Date.now() - queryStart;

      // Query should be fast (< 50ms)
      expect(queryTime).toBeLessThan(50);
    });
  });
});
