/**
 * Coverage test for requiredEvidence field
 *
 * Ensures every resource type in the evidence requirements registry
 * actually produces requiredEvidence when evaluated.
 */

import { describe, it, expect } from 'vitest';
import {
  getRegisteredResourceTypes,
  getEvidenceRequirements,
} from '../src/core/index.js';
import { evaluateMcpToolCallConsequences } from '../src/evaluator/mcp.js';

describe('requiredEvidence coverage', () => {
  const registeredTypes = getRegisteredResourceTypes();

  it('has requirements defined for expected resource types', () => {
    // These are the resource types we expect to have requirements
    const expectedTypes = [
      'aws_s3_bucket',
      'aws_db_instance',
      'aws_dynamodb_table',
      'aws_iam_role',
      'aws_iam_user',
      'aws_kms_key',
      'aws_instance',
      'aws_ebs_volume',
      'aws_lambda_function',
      'aws_secretsmanager_secret',
      'aws_route53_zone',
      'aws_vpc',
      'aws_eip',
      'aws_ecs_service',
      'aws_eks_cluster',
      'aws_subnet',
      'aws_nat_gateway',
    ];

    for (const type of expectedTypes) {
      expect(
        registeredTypes,
        `${type} should be in registry`
      ).toContain(type);
    }
  });

  it('every registered type has at least one blocking requirement for delete', () => {
    for (const resourceType of registeredTypes) {
      const requirements = getEvidenceRequirements(resourceType, 'delete');

      // Skip if no requirements for delete (some types might only have create/update)
      if (!requirements) continue;

      const blockingReqs = requirements.filter(r => r.blocksSafeVerdict);

      expect(
        blockingReqs.length,
        `${resourceType} should have at least one blocking requirement`
      ).toBeGreaterThan(0);
    }
  });

  describe('MCP evaluator produces requiredEvidence', () => {
    // Map resource types to MCP tool patterns that trigger them
    const resourceTypeToToolPattern: Record<string, { tool: string; args: Record<string, unknown> }> = {
      'aws_s3_bucket': {
        tool: 'aws_s3_delete_bucket',
        args: { bucket: 'test-bucket' },
      },
      'aws_db_instance': {
        tool: 'aws_rds_delete_instance',
        args: { dbInstanceIdentifier: 'test-db' },
      },
      'aws_dynamodb_table': {
        tool: 'aws_dynamodb_delete_table',
        args: { tableName: 'test-table' },
      },
      'aws_kms_key': {
        tool: 'aws_kms_delete_key',
        args: { keyId: 'test-key' },
      },
      'aws_lambda_function': {
        tool: 'aws_lambda_delete_function',
        args: { functionName: 'test-function' },
      },
      'aws_instance': {
        tool: 'aws_ec2_terminate_instance',
        args: { instanceId: 'i-1234567890' },
      },
      'aws_secretsmanager_secret': {
        tool: 'aws_secretsmanager_delete_secret',
        args: { secretId: 'my-secret' },
      },
      'aws_route53_zone': {
        tool: 'aws_route53_delete_hosted_zone',
        args: { hostedZoneId: 'Z1234567890' },
      },
      'aws_vpc': {
        tool: 'aws_ec2_delete_vpc',
        args: { vpcId: 'vpc-12345678' },
      },
      'aws_eip': {
        tool: 'aws_ec2_release_address',
        args: { allocationId: 'eipalloc-12345678' },
      },
      'aws_ecs_service': {
        tool: 'aws_ecs_delete_service',
        args: { service: 'my-service', cluster: 'my-cluster' },
      },
      'aws_eks_cluster': {
        tool: 'aws_eks_delete_cluster',
        args: { name: 'my-cluster' },
      },
      'aws_subnet': {
        tool: 'aws_ec2_delete_subnet',
        args: { subnetId: 'subnet-12345678' },
      },
      'aws_nat_gateway': {
        tool: 'aws_ec2_delete_nat_gateway',
        args: { natGatewayId: 'nat-12345678' },
      },
    };

    for (const [resourceType, pattern] of Object.entries(resourceTypeToToolPattern)) {
      it(`${resourceType} produces requiredEvidence`, () => {
        const result = evaluateMcpToolCallConsequences({
          tool: pattern.tool,
          arguments: pattern.args,
        });

        expect(result.requiredEvidence).toBeDefined();
        expect(result.requiredEvidence!.resourceType).toBe(resourceType);
        expect(result.requiredEvidence!.requirementsDefined).toBe(true);
        expect(result.requiredEvidence!.requirements.length).toBeGreaterThan(0);
      });
    }
  });

  describe('requiredEvidence reflects actual evidence state', () => {
    it('S3 with all evidence shows sufficient=true', () => {
      const result = evaluateMcpToolCallConsequences(
        {
          tool: 'aws_s3_delete_bucket',
          arguments: { bucket: 'test-bucket' },
        },
        {
          awsEvidence: {
            s3Buckets: {
              'test-bucket': {
                bucket: 'test-bucket',
                exists: true,
                versioning: 'Enabled',
                objectLockEnabled: false,
                hasReplication: true,
                hasLifecycleRules: false,
                isEmpty: true,  // All evidence present
              },
            },
          },
        }
      );

      expect(result.requiredEvidence!.sufficient).toBe(true);
      expect(result.requiredEvidence!.sufficiency).toBe('sufficient');
      expect(result.requiredEvidence!.summary.missingBlocking).toBe(0);
    });

    it('S3 with missing blocking evidence shows sufficient=false', () => {
      const result = evaluateMcpToolCallConsequences(
        {
          tool: 'aws_s3_delete_bucket',
          arguments: { bucket: 'test-bucket' },
        },
        {
          awsEvidence: {
            s3Buckets: {
              'test-bucket': {
                bucket: 'test-bucket',
                exists: true,
                versioning: 'Enabled',
                objectLockEnabled: false,
                hasReplication: true,
                hasLifecycleRules: false,
                isEmpty: undefined,  // Missing blocking evidence
                missingEvidence: ['s3.object_listing'],
              },
            },
          },
        }
      );

      expect(result.requiredEvidence!.sufficient).toBe(false);
      expect(result.requiredEvidence!.sufficiency).toBe('blocking_gaps');
      expect(result.requiredEvidence!.summary.missingBlocking).toBe(1);
    });
  });

  describe('unmigrated resource types', () => {
    // This test documents which resource types are NOT yet migrated
    // Remove from this list as each type is migrated

    const unmigratedTypes: string[] = [
      // Add resource types here as you identify gaps
    ];

    it('tracks unmigrated types (none currently)', () => {
      // This test serves as a placeholder when all types are migrated
      // and documents any types that still need migration
      expect(unmigratedTypes.length).toBe(0);
    });

    for (const type of unmigratedTypes) {
      it(`${type} is not yet in registry (expected)`, () => {
        const requirements = getEvidenceRequirements(type, 'delete');
        expect(requirements).toBeUndefined();
      });
    }
  });
});
