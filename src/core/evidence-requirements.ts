/**
 * Evidence Requirements Registry
 *
 * This file contains evidence requirements for resource types that have no
 * Terraform handler (MCP-only resources like ECS, EKS).
 *
 * Most handlers now self-describe their requirements via the `evidenceRequirements`
 * field on the ResourceHandler interface. The getEvidenceRequirements function
 * checks handlers first, then falls back to this registry.
 *
 * MIGRATED TO HANDLERS:
 * - aws_s3_bucket → src/resources/aws/s3.ts
 * - aws_db_instance → src/resources/aws/rds.ts
 * - aws_dynamodb_table → src/resources/aws/dynamodb.ts
 * - aws_kms_key → src/resources/aws/kms.ts
 * - aws_instance → src/resources/aws/ec2.ts
 * - aws_ebs_volume → src/resources/aws/ebs.ts
 * - aws_lambda_function → src/resources/aws/lambda.ts
 * - aws_secretsmanager_secret → src/resources/aws/secrets-manager.ts
 * - aws_route53_zone → src/resources/aws/route53.ts
 * - aws_iam_role, aws_iam_user → src/resources/aws/iam.ts (per-type)
 * - aws_vpc, aws_subnet, aws_eip, aws_nat_gateway → src/resources/aws/vpc.ts (per-type)
 */

import type {
  EvidenceRequirement,
  ResourceEvidenceRequirements,
} from './state-schema.js';
import {
  getHandlerEvidenceRequirements,
  getHandlerResourceTypesWithRequirements,
} from '../resources/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// MCP-Only Resources (No Terraform handler exists)
// ─────────────────────────────────────────────────────────────────────────────

const ECS_SERVICE_DELETE: ResourceEvidenceRequirements = {
  resourceType: 'aws_ecs_service',
  action: 'delete',
  requirements: [
    {
      key: 'ecs.running_count',
      level: 'required',
      description: 'Number of tasks currently running in this service',
      blocksSafeVerdict: true,
      defaultAssumption: undefined,
      maxFreshnessSeconds: 60,
    },
    {
      key: 'ecs.load_balancers',
      level: 'required',
      description: 'Load balancer target groups attached to this service',
      blocksSafeVerdict: true,
      defaultAssumption: undefined,
      maxFreshnessSeconds: 300,
    },
    {
      key: 'ecs.service_status',
      level: 'required',
      description: 'Current service status (ACTIVE, DRAINING, INACTIVE)',
      blocksSafeVerdict: false,
      defaultAssumption: 'ACTIVE',
      maxFreshnessSeconds: 60,
    },
    {
      key: 'ecs.desired_count',
      level: 'recommended',
      description: 'Desired number of tasks for scale assessment',
      blocksSafeVerdict: false,
      maxFreshnessSeconds: 300,
    },
    {
      key: 'ecs.cluster_arn',
      level: 'optional',
      description: 'The cluster this service belongs to',
      blocksSafeVerdict: false,
      maxFreshnessSeconds: 3600,
    },
  ],
};

const EKS_CLUSTER_DELETE: ResourceEvidenceRequirements = {
  resourceType: 'aws_eks_cluster',
  action: 'delete',
  requirements: [
    {
      key: 'eks.nodegroup_count',
      level: 'required',
      description: 'Number of managed node groups attached to this cluster',
      blocksSafeVerdict: true,
      defaultAssumption: undefined,
      maxFreshnessSeconds: 300,
    },
    {
      key: 'eks.fargate_profile_count',
      level: 'required',
      description: 'Number of Fargate profiles attached to this cluster',
      blocksSafeVerdict: true,
      defaultAssumption: undefined,
      maxFreshnessSeconds: 300,
    },
    {
      key: 'eks.cluster_status',
      level: 'required',
      description: 'Current cluster status (ACTIVE, CREATING, DELETING, FAILED, etc.)',
      blocksSafeVerdict: false,
      defaultAssumption: 'ACTIVE',
      maxFreshnessSeconds: 60,
    },
    {
      key: 'eks.endpoint',
      level: 'recommended',
      description: 'Cluster API endpoint that will become unreachable',
      blocksSafeVerdict: false,
      maxFreshnessSeconds: 3600,
    },
    {
      key: 'eks.version',
      level: 'optional',
      description: 'Kubernetes version running on the cluster',
      blocksSafeVerdict: false,
      maxFreshnessSeconds: 3600,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry (MCP-only resources without Terraform handlers)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_REQUIREMENTS: ResourceEvidenceRequirements[] = [
  ECS_SERVICE_DELETE,
  EKS_CLUSTER_DELETE,
];

/**
 * Get evidence requirements for a resource type and action.
 * Checks handlers first (new pattern), then falls back to registry.
 * Returns undefined if no requirements are found in either source.
 */
export function getEvidenceRequirements(
  resourceType: string,
  action: 'create' | 'update' | 'delete'
): EvidenceRequirement[] | undefined {
  // Check handler first (self-describing pattern)
  const handlerReqs = getHandlerEvidenceRequirements(resourceType, action);
  if (handlerReqs) {
    return handlerReqs;
  }

  // Fall back to registry (for MCP-only resources)
  const match = ALL_REQUIREMENTS.find(
    r => r.resourceType === resourceType && (r.action === action || r.action === 'any')
  );
  return match?.requirements;
}

/**
 * Get all resource types with evidence requirements (from handlers or registry).
 */
export function getRegisteredResourceTypes(): string[] {
  const registryTypes = ALL_REQUIREMENTS.map(r => r.resourceType);
  const handlerTypes = getHandlerResourceTypesWithRequirements();
  return [...new Set([...handlerTypes, ...registryTypes])];
}

/**
 * Check if a resource type has evidence requirements (from handler or registry).
 */
export function hasEvidenceRequirements(resourceType: string): boolean {
  const handlerReqs = getHandlerEvidenceRequirements(resourceType, 'delete');
  if (handlerReqs) {
    return true;
  }
  return ALL_REQUIREMENTS.some(r => r.resourceType === resourceType);
}

/**
 * Default evidence requirements for unknown resources.
 * Conservative defaults that require review.
 */
export const DEFAULT_UNKNOWN_REQUIREMENTS: EvidenceRequirement[] = [
  {
    key: 'resource.identified',
    level: 'required',
    description: 'Resource type has been identified and mapped',
    blocksSafeVerdict: false,
    defaultAssumption: false,
  },
  {
    key: 'resource.state_known',
    level: 'required',
    description: 'Current resource state is available',
    blocksSafeVerdict: true,
    defaultAssumption: false,
  },
  {
    key: 'resource.recovery_path',
    level: 'recommended',
    description: 'A recovery path has been identified',
    blocksSafeVerdict: false,
    defaultAssumption: false,
  },
];
