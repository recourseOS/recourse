import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
  type ResourceChange,
  type ResourceDependency,
  type ResourceHandler,
  type StateResource,
  type TerraformState,
} from '../types.js';
import type { EvidenceRequirement } from '../../core/state-schema.js';

export const gcpBigQueryHandler: ResourceHandler = {
  resourceTypes: [
    'google_bigquery_dataset',
    'google_bigquery_table',
    'google_bigquery_routine',
    'google_bigquery_dataset_iam_binding',
    'google_bigquery_dataset_iam_member',
    'google_bigquery_dataset_iam_policy',
    'google_bigquery_table_iam_binding',
    'google_bigquery_table_iam_member',
    'google_bigquery_table_iam_policy',
  ],

  evidenceRequirements: {
    delete: [
      {
        key: 'bigquery.deletion_protection',
        level: 'required',
        description: 'Whether deletion protection is enabled on the table',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'bigquery.delete_contents_on_destroy',
        level: 'required',
        description: 'Whether dataset will delete all tables on destroy',
        blocksSafeVerdict: true,
        defaultAssumption: false,
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'bigquery.time_travel_hours',
        level: 'required',
        description: 'Time travel window in hours for data recovery',
        blocksSafeVerdict: true,
        defaultAssumption: 168, // 7 days default
        maxFreshnessSeconds: 3600,
      },
      {
        key: 'bigquery.snapshots',
        level: 'recommended',
        description: 'Existing table snapshots for recovery',
        blocksSafeVerdict: false,
        defaultAssumption: [],
        maxFreshnessSeconds: 3600,
      },
    ] satisfies EvidenceRequirement[],
  },

  getRecoverability(change: ResourceChange, _state: TerraformState | null): RecoverabilityResult {
    const isDelete = change.actions.includes('delete');
    if (!isDelete) return reversible('BigQuery configuration update is reversible');

    if (change.type.includes('_iam_')) {
      return reversible('BigQuery IAM binding/member/policy is config-only and can be reapplied');
    }

    if (change.type === 'google_bigquery_routine') {
      return reversible('BigQuery routine is code/config and can be recreated from Terraform');
    }

    if (change.type === 'google_bigquery_dataset') {
      return classifyDataset(change);
    }

    if (change.type === 'google_bigquery_table') {
      return classifyTable(change);
    }

    return recoverableWithEffort('BigQuery resource can be recreated, but data recovery needs review');
  },

  getDependencies(resource: StateResource, allResources: StateResource[]): ResourceDependency[] {
    const id = (resource.values.dataset_id ?? resource.values.table_id ?? resource.values.id) as string;
    if (!id) return [];

    return allResources
      .filter(other => other.address !== resource.address && JSON.stringify(other.values).includes(id))
      .map(other => ({
        address: other.address,
        dependencyType: 'implicit',
        referenceAttribute: 'bigquery_id',
      }));
  },
};

function classifyDataset(change: ResourceChange): RecoverabilityResult {
  const values = change.before ?? {};

  if (values.delete_contents_on_destroy === true) {
    return unrecoverable('BigQuery dataset delete_contents_on_destroy=true can destroy all contained tables and data');
  }

  const timeTravelHours = numberValue(values.max_time_travel_hours);
  if (timeTravelHours && timeTravelHours > 0) {
    return recoverableFromBackup(`BigQuery dataset time travel is configured for ${timeTravelHours} hours`);
  }

  return recoverableWithEffort('BigQuery dataset deletion may fail if non-empty; if empty, dataset can be recreated from Terraform');
}

function classifyTable(change: ResourceChange): RecoverabilityResult {
  const values = change.before ?? {};

  if (values.deletion_protection === true) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: 'blocked',
      reasoning: 'APPLY WILL FAIL: deletion_protection=true; disable protection first to delete',
    };
  }

  const timeTravelHours = numberValue(values.max_time_travel_hours);
  if (timeTravelHours && timeTravelHours > 0) {
    return recoverableFromBackup(`BigQuery table time travel is configured for ${timeTravelHours} hours`);
  }

  return {
    tier: RecoverabilityTier.NEEDS_REVIEW,
    label: RecoverabilityLabels[RecoverabilityTier.NEEDS_REVIEW],
    reasoning: 'BigQuery table deletion lacks dataset time-travel evidence in the plan; data recovery requires review',
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function reversible(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.REVERSIBLE,
    label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
    reasoning,
  };
}

function recoverableWithEffort(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_WITH_EFFORT,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_WITH_EFFORT],
    reasoning,
  };
}

function recoverableFromBackup(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.RECOVERABLE_FROM_BACKUP,
    label: RecoverabilityLabels[RecoverabilityTier.RECOVERABLE_FROM_BACKUP],
    reasoning,
  };
}

function unrecoverable(reasoning: string): RecoverabilityResult {
  return {
    tier: RecoverabilityTier.UNRECOVERABLE,
    label: RecoverabilityLabels[RecoverabilityTier.UNRECOVERABLE],
    reasoning,
  };
}
