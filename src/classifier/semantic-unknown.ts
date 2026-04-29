import type { ResourceChange, TerraformState } from '../resources/types.js';
import type { ClassifierFeatures, ClassifierTier } from './decision-tree.js';

export type SemanticClassifierTier = ClassifierTier | 'needs-review';

export interface SemanticClassifierResult {
  tier: SemanticClassifierTier;
  confidence: number;
  model: string;
  evidence: string[];
}

const STORAGE_TYPE_HINTS = ['bucket', 'storage', 'blob', 'object', 'container', 'share'];
const DATABASE_TYPE_HINTS = ['database', 'sql', 'postgres', 'mysql', 'mariadb', 'redis', 'cache', 'cosmos'];
const DISK_TYPE_HINTS = ['disk', 'volume', 'snapshot'];
const IAM_TYPE_HINTS = ['iam', 'role_assignment', 'binding', 'member', 'policy', 'permission', 'access'];
const DNS_TYPE_HINTS = ['dns', 'record_set', 'record'];
const CREDENTIAL_TYPE_HINTS = ['password', 'secret_version', 'service_account_key', 'credential', 'access_key'];

const DELETION_PROTECTION_KEYS = [
  'deletion_protection',
  'deletion_protection_enabled',
  'protect_from_delete',
  'termination_protection',
  'prevent_destroy',
  'enable_deletion_protection',
];

const VERSIONING_KEYS = [
  'versioning',
  'bucket_versioning',
  'versioning_configuration',
  'versioning_enabled',
  'enable_versioning',
];

const BACKUP_KEYS = [
  'backup_retention_period',
  'backup_retention_days',
  'backup_retention',
  'backup_policy',
  'automated_backup',
  'continuous_backup',
  'point_in_time_recovery',
  'point_in_time_recovery_enabled',
  'pitr',
  'short_term_retention_policy',
  'delete_retention_policy',
  'container_delete_retention_policy',
];

const RETENTION_KEYS = [
  'recovery_window_in_days',
  'deletion_window_in_days',
  'retention_in_days',
  'retention_days',
  'retention_period',
  'message_retention_seconds',
];

export function classifyUnknownResourceSemantically(
  change: ResourceChange,
  _state: TerraformState | null,
  features: ClassifierFeatures
): SemanticClassifierResult {
  if (!change.actions.includes('delete')) {
    return verdict('reversible', 0.99, ['non-delete action']);
  }

  const attrs = change.before ?? change.after ?? {};
  const type = change.type.toLowerCase();
  const evidence: string[] = [];

  if (hasAnyTypeHint(type, DNS_TYPE_HINTS)) {
    return verdict('reversible', 0.98, ['dns/config resource']);
  }

  if (hasAnyTypeHint(type, IAM_TYPE_HINTS) && !hasAnyTypeHint(type, CREDENTIAL_TYPE_HINTS)) {
    return verdict('reversible', 0.96, ['iam/config relationship']);
  }

  if (booleanSignal(attrs, DELETION_PROTECTION_KEYS) === true || features.has_deletion_protection === 1) {
    return verdict('reversible', 0.98, ['deletion protection enabled']);
  }

  const retentionDays = positiveNumberSignal(attrs, RETENTION_KEYS);
  if (hasAnyTypeHint(type, CREDENTIAL_TYPE_HINTS)) {
    if (retentionDays > 0 || features.deletion_window_days > 0) {
      return verdict('recoverable-with-effort', 0.9, ['credential has recovery/deletion window']);
    }
    return verdict('unrecoverable', 0.94, ['credential material cannot be recovered after deletion']);
  }

  const hasVersioning = booleanSignal(attrs, VERSIONING_KEYS) === true || features.has_versioning === 1;
  const hasBackup =
    booleanSignal(attrs, BACKUP_KEYS) === true
    || positiveNumberSignal(attrs, BACKUP_KEYS) > 0
    || features.has_backup === 1
    || features.has_snapshot === 1
    || features.has_pitr === 1
    || features.has_retention_period === 1;

  if (hasAnyTypeHint(type, STORAGE_TYPE_HINTS)) {
    if (hasVersioning || hasBackup) {
      evidence.push(hasVersioning ? 'versioning enabled' : 'storage retention/backup evidence');
      return verdict('recoverable-from-backup', 0.93, evidence);
    }

    if (booleanSignal(attrs, ['force_destroy', 'force_delete']) === true) {
      return verdict('unrecoverable', 0.92, ['force deletion without versioning/retention evidence']);
    }

    return verdict('needs-review', 0.62, ['storage deletion without versioning/retention evidence']);
  }

  if (hasAnyTypeHint(type, DATABASE_TYPE_HINTS)) {
    if (hasBackup || retentionDays > 0) {
      return verdict('recoverable-from-backup', 0.92, ['database backup/retention evidence']);
    }

    if (booleanSignal(attrs, ['skip_final_snapshot']) === true || features.skip_final_snapshot === 1) {
      return verdict('unrecoverable', 0.92, ['database delete skips final snapshot and has no backup evidence']);
    }

    return verdict('needs-review', 0.64, ['database deletion without backup evidence']);
  }

  if (hasAnyTypeHint(type, DISK_TYPE_HINTS)) {
    if (hasBackup || hasVersioning) {
      return verdict('recoverable-from-backup', 0.9, ['disk/snapshot recovery evidence']);
    }
    return verdict('unrecoverable', 0.88, ['disk-like resource deletion without snapshot evidence']);
  }

  if (retentionDays > 0) {
    return verdict('recoverable-with-effort', 0.86, ['recovery/deletion window present']);
  }

  return verdict('needs-review', 0.55, ['unknown resource semantics']);
}

function verdict(tier: SemanticClassifierTier, confidence: number, evidence: string[]): SemanticClassifierResult {
  return {
    tier,
    confidence,
    model: 'semantic-unknown',
    evidence,
  };
}

function hasAnyTypeHint(type: string, hints: string[]): boolean {
  return hints.some(hint => type.includes(hint));
}

function booleanSignal(value: unknown, keys: string[]): boolean | undefined {
  let foundFalse = false;

  for (const [key, current] of walk(value)) {
    if (!keys.includes(key)) continue;
    const normalized = normalizeBool(current);
    if (normalized === true) return true;
    if (normalized === false) foundFalse = true;
  }

  return foundFalse ? false : undefined;
}

function positiveNumberSignal(value: unknown, keys: string[]): number {
  let max = 0;

  for (const [key, current] of walk(value)) {
    if (!keys.includes(key)) continue;
    if (typeof current === 'number' && current > max) max = current;
    if (typeof current === 'boolean' && current) max = Math.max(max, 1);
    max = Math.max(max, maxPositiveNumber(current));
  }

  return max;
}

function normalizeBool(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    let foundFalse = false;
    for (const item of value) {
      const normalized = normalizeBool(item);
      if (normalized === true) return true;
      if (normalized === false) foundFalse = true;
    }
    return foundFalse ? false : undefined;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'enabled' || normalized === 'true') return true;
    if (normalized === 'disabled' || normalized === 'false') return false;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if ('enabled' in record) return normalizeBool(record.enabled);
    if ('status' in record) return normalizeBool(record.status);
  }
  return undefined;
}

function maxPositiveNumber(value: unknown): number {
  let max = 0;

  if (typeof value === 'number') return value > 0 ? value : 0;
  if (Array.isArray(value)) {
    for (const item of value) max = Math.max(max, maxPositiveNumber(item));
    return max;
  }
  if (!value || typeof value !== 'object') return 0;

  for (const current of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, maxPositiveNumber(current));
  }

  return max;
}

function* walk(value: unknown): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, current] of Object.entries(value as Record<string, unknown>)) {
    yield [key, current];
    yield* walk(current);
  }
}
