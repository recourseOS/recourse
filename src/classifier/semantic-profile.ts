import type { ResourceChange } from '../resources/types.js';
import type { ClassifierFeatures } from './decision-tree.js';

export type SemanticResourceKind =
  | 'storage'
  | 'database'
  | 'disk'
  | 'iam'
  | 'dns'
  | 'credential'
  | 'config'
  | 'relationship'
  | 'unknown';

export interface SemanticResourceProfile {
  resourceType: string;
  kind: SemanticResourceKind;
  isDelete: boolean;
  isConfigOnly: boolean;
  isRelationship: boolean;
  isCredential: boolean;
  hasDeletionProtection: boolean;
  hasVersioning: boolean;
  hasBackup: boolean;
  hasRecoveryWindow: boolean;
  recoveryWindowDays: number;
  skipsFinalSnapshot: boolean;
  forceDeletes: boolean;
  evidence: string[];
}

const STORAGE_TYPE_HINTS = ['bucket', 'storage', 'blob', 'object', 'container', 'share'];
const DATABASE_TYPE_HINTS = ['database', 'sql', 'postgres', 'mysql', 'mariadb', 'redis', 'cache', 'cosmos'];
const DISK_TYPE_HINTS = ['disk', 'volume', 'snapshot'];
const IAM_TYPE_HINTS = ['iam', 'role_assignment', 'binding', 'member', 'policy', 'permission', 'access'];
const DNS_TYPE_HINTS = ['dns', 'record_set', 'record'];
const CREDENTIAL_TYPE_HINTS = ['password', 'secret_version', 'service_account_key', 'credential', 'access_key'];

const CONFIG_ONLY_SUFFIXES = [
  '_policy',
  '_configuration',
  '_config',
  '_setting',
  '_settings',
  '_rule',
  '_permission',
  '_endpoint',
  '_iam_policy',
  '_iam_binding',
  '_iam_member',
  '_access_level',
  '_diagnostic_setting',
];

const RELATIONSHIP_SUFFIXES = [
  '_attachment',
  '_membership',
  '_association',
  '_binding',
  '_member',
  '_assignment',
];

const CONFIG_ONLY_TYPES = new Set([
  'aws_lambda_function_event_invoke_config',
  'aws_s3_bucket_cors_configuration',
  'aws_s3_bucket_website_configuration',
  'aws_s3_bucket_notification',
  'aws_s3_bucket_object_lock_configuration',
  'aws_api_gateway_deployment',
  'aws_api_gateway_stage',
  'aws_cloudwatch_event_rule',
  'aws_cloudwatch_event_target',
  'google_project_service',
  'google_project_iam_audit_config',
  'google_compute_project_metadata',
  'google_compute_project_metadata_item',
  'google_dns_record_set',
  'google_cloud_run_service_iam_policy',
  'azurerm_resource_group',
  'azurerm_dns_a_record',
  'azurerm_dns_cname_record',
  'azurerm_private_dns_a_record',
  'azurerm_management_lock',
]);

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

const RECOVERY_WINDOW_KEYS = [
  'recovery_window_in_days',
  'deletion_window_in_days',
  'retention_in_days',
  'retention_days',
  'retention_period',
  'message_retention_seconds',
];

const FORCE_DELETE_KEYS = ['force_destroy', 'force_delete'];

export function buildSemanticResourceProfile(
  change: ResourceChange,
  features: ClassifierFeatures
): SemanticResourceProfile {
  const attrs = change.before ?? change.after ?? {};
  const resourceType = change.type.toLowerCase();
  const isConfigOnly = isConfigOnlyResource(resourceType);
  const isRelationship = isRelationshipResource(resourceType);
  const isCredential = hasAnyTypeHint(resourceType, CREDENTIAL_TYPE_HINTS);
  const recoveryWindowDays = positiveNumberSignal(attrs, RECOVERY_WINDOW_KEYS);
  const hasDeletionProtection =
    booleanSignal(attrs, DELETION_PROTECTION_KEYS) === true || features.has_deletion_protection === 1;
  const hasVersioning = booleanSignal(attrs, VERSIONING_KEYS) === true || features.has_versioning === 1;
  const hasBackup =
    booleanSignal(attrs, BACKUP_KEYS) === true
    || positiveNumberSignal(attrs, BACKUP_KEYS) > 0
    || features.has_backup === 1
    || features.has_snapshot === 1
    || features.has_pitr === 1
    || features.has_retention_period === 1;
  const hasRecoveryWindow = recoveryWindowDays > 0 || features.deletion_window_days > 0;
  const skipsFinalSnapshot = booleanSignal(attrs, ['skip_final_snapshot']) === true || features.skip_final_snapshot === 1;
  const forceDeletes = booleanSignal(attrs, FORCE_DELETE_KEYS) === true;

  const profile: SemanticResourceProfile = {
    resourceType,
    kind: inferKind(resourceType, isConfigOnly, isRelationship, isCredential),
    isDelete: change.actions.includes('delete'),
    isConfigOnly,
    isRelationship,
    isCredential,
    hasDeletionProtection,
    hasVersioning,
    hasBackup,
    hasRecoveryWindow,
    recoveryWindowDays,
    skipsFinalSnapshot,
    forceDeletes,
    evidence: [],
  };

  if (profile.isConfigOnly) profile.evidence.push('config-only resource pattern');
  if (profile.isRelationship) profile.evidence.push('relationship resource pattern');
  if (profile.hasDeletionProtection) profile.evidence.push('deletion protection enabled');
  if (profile.hasVersioning) profile.evidence.push('versioning enabled');
  if (profile.hasBackup) profile.evidence.push('backup, snapshot, retention, or PITR evidence');
  if (profile.hasRecoveryWindow) profile.evidence.push('recovery/deletion window present');
  if (profile.skipsFinalSnapshot) profile.evidence.push('final snapshot skipped');
  if (profile.forceDeletes) profile.evidence.push('force deletion requested');

  return profile;
}

export function isConfigOnlyResource(resourceType: string): boolean {
  const normalized = resourceType.toLowerCase();
  if (CONFIG_ONLY_TYPES.has(normalized)) return true;
  return CONFIG_ONLY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

export function isRelationshipResource(resourceType: string): boolean {
  const normalized = resourceType.toLowerCase();
  return RELATIONSHIP_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

function inferKind(
  resourceType: string,
  isConfigOnly: boolean,
  isRelationship: boolean,
  isCredential: boolean
): SemanticResourceKind {
  if (isRelationship) return 'relationship';
  if (isCredential) return 'credential';
  if (isConfigOnly) return 'config';
  if (hasAnyTypeHint(resourceType, DNS_TYPE_HINTS)) return 'dns';
  if (hasAnyTypeHint(resourceType, IAM_TYPE_HINTS)) return 'iam';
  if (hasAnyTypeHint(resourceType, STORAGE_TYPE_HINTS)) return 'storage';
  if (hasAnyTypeHint(resourceType, DATABASE_TYPE_HINTS)) return 'database';
  if (hasAnyTypeHint(resourceType, DISK_TYPE_HINTS)) return 'disk';
  return 'unknown';
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
