import {
  RecoverabilityTier,
  RecoverabilityLabels,
  type ResourceHandler,
  type ResourceChange,
  type TerraformState,
  type RecoverabilityResult,
  type StateResource,
  type ResourceDependency,
  type ClassificationTrace,
} from '../types.js';
import { ClassificationContext } from '../../analyzer/trace.js';

export const route53Handler: ResourceHandler = {
  resourceTypes: [
    'aws_route53_zone',
    'aws_route53_record',
    'aws_route53_health_check',
  ],

  getRecoverability(
    change: ResourceChange,
    state: TerraformState | null
  ): RecoverabilityResult {
    const ctx = new ClassificationContext(change.address, change.type,
      change.actions.includes('delete') ? 'delete' : 'update');
    const trace = this.getRecoverabilityTraced!(change, state, ctx);
    return trace.result;
  },

  getRecoverabilityTraced(
    change: ResourceChange,
    state: TerraformState | null,
    ctx: ClassificationContext
  ): ClassificationTrace {
    const isDelete = change.actions.includes('delete');

    ctx.check('action', change.actions, {
      passed: true,
      note: isDelete ? 'Resource will be deleted' : 'Resource will be modified',
    });

    let result: RecoverabilityResult;

    if (!isDelete) {
      ctx.check('update_type', 'configuration', {
        passed: true,
        note: 'Route53 configuration update',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'Route53 configuration update is reversible',
      };
    } else if (change.type === 'aws_route53_zone') {
      result = classifyRoute53Zone(change, state, ctx);
    } else if (change.type === 'aws_route53_record') {
      result = classifyRoute53Record(change, ctx);
    } else if (change.type === 'aws_route53_health_check') {
      ctx.check('resource_type', 'aws_route53_health_check', {
        passed: true,
        note: 'Health check can be recreated; may affect routing temporarily',
      });
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Health check can be recreated; may affect routing temporarily',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'Route53 resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify domain registrar NS record configuration');
    ctx.limitation('Cannot check for external DNS references to this zone');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_route53_zone') {
      const zoneId = resource.values.zone_id as string || resource.values.id as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        if (other.values.zone_id === zoneId) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'zone_id',
          });
        }
      }
    }

    return deps;
  },
};

function classifyRoute53Zone(
  change: ResourceChange,
  state: TerraformState | null,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const zoneId = values.zone_id as string || values.id as string;
  const name = values.name as string;
  const isPrivate = values.private_zone as boolean;

  ctx.check('zone_name', name, {
    passed: true,
    note: `Zone: ${name || 'unknown'} (${isPrivate ? 'private' : 'public'})`,
  });

  ctx.check('zone_id', zoneId, {
    passed: true,
    note: `Zone ID: ${zoneId || 'unknown'}`,
  });

  // Count records in this zone
  let recordCount = 0;
  if (state && zoneId) {
    recordCount = state.resources.filter(
      r => r.type === 'aws_route53_record' &&
           r.values.zone_id === zoneId
    ).length;
  }

  ctx.check('record_count', recordCount, {
    passed: recordCount === 0,
    note: recordCount > 0
      ? `Zone contains ${recordCount} DNS records that will be deleted`
      : 'Zone has no records in Terraform state',
  });

  if (recordCount > 0) {
    ctx.addCounterfactual({
      condition: 'records were exported/backed up first',
      resultingTier: 'recoverable-with-effort',
      explanation: 'Exported DNS records can be re-imported to new zone',
    });
  }

  if (!isPrivate) {
    ctx.check('ns_records', null, {
      passed: false,
      note: 'NS records will change; domain registrar must be updated',
    });
  }

  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning: recordCount > 0
      ? `Zone deletion removes ${recordCount} DNS records; all must be recreated`
      : 'Zone can be recreated; NS records will change (update registrar)',
  };
}

function classifyRoute53Record(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const name = values.name as string;
  const type = values.type as string;
  const ttl = values.ttl as number;

  ctx.check('record_name', name, {
    passed: true,
    note: `Record: ${name || 'unknown'}`,
  });

  ctx.check('record_type', type, {
    passed: true,
    note: `Type: ${type || 'unknown'}`,
  });

  ctx.check('ttl', ttl, {
    passed: true,
    note: ttl
      ? `TTL: ${ttl}s (clients may cache for this duration)`
      : 'TTL not specified (alias record)',
  });

  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning: 'DNS record can be recreated; brief propagation delay',
  };
}
