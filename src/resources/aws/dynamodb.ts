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
import type { EvidenceRequirement } from '../../core/state-schema.js';

export const dynamodbHandler: ResourceHandler = {
  resourceTypes: [
    'aws_dynamodb_table',
    'aws_dynamodb_global_table',
    'aws_dynamodb_table_item',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'dynamodb.deletion_protection',
        level: 'required',
        description: 'Whether deletion protection is enabled',
        blocksSafeVerdict: false,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'dynamodb.pitr_enabled',
        level: 'required',
        description: 'Point-in-time recovery status',
        blocksSafeVerdict: false,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'dynamodb.item_count',
        level: 'required',
        description: 'Approximate number of items in the table',
        blocksSafeVerdict: true,
        defaultAssumption: undefined,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'dynamodb.backups',
        level: 'recommended',
        description: 'Existing on-demand backups',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'dynamodb.global_tables',
        level: 'recommended',
        description: 'Global table replicas',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

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
        note: 'Configuration update, no data at risk',
      });
      result = {
        tier: RecoverabilityTier.REVERSIBLE,
        label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
        reasoning: 'DynamoDB configuration update is reversible',
      };
    } else if (change.type === 'aws_dynamodb_table') {
      result = classifyDynamoDBTable(change, ctx);
    } else if (change.type === 'aws_dynamodb_table_item') {
      ctx.check('resource_type', 'aws_dynamodb_table_item', {
        passed: false,
        note: 'Individual item deletion; check if table has PITR',
      });
      result = {
        tier: RecoverabilityTier.UNRECOVERABLE,
        label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
        reasoning: 'Item deletion is permanent unless table has PITR',
      };
    } else {
      result = {
        tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
        label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
        reasoning: 'DynamoDB resource can be recreated',
      };
    }

    ctx.limitation('Cannot verify AWS Backup configurations outside the plan');
    ctx.limitation('Cannot check for on-demand backups');

    return ctx.build(result);
  },

  getDependencies(
    resource: StateResource,
    allResources: StateResource[]
  ): ResourceDependency[] {
    const deps: ResourceDependency[] = [];

    if (resource.type === 'aws_dynamodb_table') {
      const tableName = resource.values.name as string;
      const tableArn = resource.values.arn as string;

      for (const other of allResources) {
        if (other.address === resource.address) continue;

        const values = JSON.stringify(other.values);

        if (
          (tableName && values.includes(tableName)) ||
          (tableArn && values.includes(tableArn))
        ) {
          deps.push({
            address: other.address,
            dependencyType: 'implicit',
            referenceAttribute: 'table_name',
          });
        }
      }
    }

    return deps;
  },
};

function classifyDynamoDBTable(
  change: ResourceChange,
  ctx: ClassificationContext
): RecoverabilityResult {
  const values = change.before || {};
  const tableName = values.name as string;

  ctx.check('table_name', tableName, {
    passed: true,
    note: `Table: ${tableName}`,
  });

  // Check deletion protection
  const deletionProtection = values.deletion_protection_enabled as boolean;
  ctx.check('deletion_protection_enabled', deletionProtection, {
    passed: deletionProtection !== true,
    note: deletionProtection
      ? 'AWS will block this deletion'
      : 'No deletion protection',
    counterfactual: !deletionProtection ? {
      condition: 'deletion_protection_enabled were true',
      resultingTier: 'blocked',
      explanation: 'Apply would fail; AWS blocks deletion when protection is enabled',
    } : undefined,
  });

  if (deletionProtection) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: 'blocked',
      reasoning: 'APPLY WILL FAIL: deletion_protection_enabled=true; disable protection first to delete',
    };
  }

  // Check PITR
  const pitr = values.point_in_time_recovery as Array<{ enabled?: boolean }>;
  const pitrEnabled = pitr?.[0]?.enabled === true;

  ctx.check('point_in_time_recovery', pitrEnabled, {
    passed: pitrEnabled,
    note: pitrEnabled
      ? 'PITR enabled; can restore to any point in last 35 days'
      : 'PITR not enabled',
    counterfactual: !pitrEnabled ? {
      condition: 'point_in_time_recovery were enabled',
      resultingTier: 'recoverable-from-backup',
      explanation: 'Could restore table data to any point in the last 35 days',
    } : undefined,
  });

  if (pitrEnabled) {
    return {
      tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
      label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
      reasoning: 'Point-in-time recovery enabled; data can be restored',
    };
  }

  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning: 'Table deletion without PITR means all data is permanently lost',
  };
}
