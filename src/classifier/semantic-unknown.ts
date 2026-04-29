import type { ResourceChange, TerraformState } from '../resources/types.js';
import type { ClassifierFeatures, ClassifierTier } from './decision-tree.js';
import { buildSemanticResourceProfile, type SemanticResourceProfile } from './semantic-profile.js';

export type SemanticClassifierTier = ClassifierTier | 'needs-review';

export interface SemanticClassifierResult {
  tier: SemanticClassifierTier;
  confidence: number;
  model: string;
  evidence: string[];
}

export function classifyUnknownResourceSemantically(
  change: ResourceChange,
  _state: TerraformState | null,
  features: ClassifierFeatures
): SemanticClassifierResult {
  const profile = buildSemanticResourceProfile(change, features);
  return classifySemanticProfile(profile);
}

export function classifySemanticProfile(profile: SemanticResourceProfile): SemanticClassifierResult {
  if (!profile.isDelete) {
    return verdict('reversible', 0.99, ['non-delete action']);
  }

  if (profile.isConfigOnly) {
    return verdict('reversible', 0.98, ['config-only resource pattern']);
  }

  if (profile.isRelationship) {
    return verdict('reversible', 0.97, ['relationship resource pattern']);
  }

  if (profile.kind === 'dns') {
    return verdict('reversible', 0.98, ['dns/config resource']);
  }

  if (profile.kind === 'iam') {
    return verdict('reversible', 0.96, ['iam/config relationship']);
  }

  if (profile.hasDeletionProtection) {
    return verdict('reversible', 0.98, ['deletion protection enabled']);
  }

  if (profile.isCredential) {
    if (profile.hasRecoveryWindow) {
      return verdict('recoverable-with-effort', 0.9, ['credential has recovery/deletion window']);
    }
    return verdict('unrecoverable', 0.94, ['credential material cannot be recovered after deletion']);
  }

  if (profile.kind === 'storage') {
    if (profile.hasVersioning || profile.hasBackup) {
      return verdict(
        'recoverable-from-backup',
        0.93,
        [profile.hasVersioning ? 'versioning enabled' : 'storage retention/backup evidence']
      );
    }

    if (profile.forceDeletes) {
      return verdict('unrecoverable', 0.92, ['force deletion without versioning/retention evidence']);
    }

    return verdict('needs-review', 0.62, ['storage deletion without versioning/retention evidence']);
  }

  if (profile.kind === 'database') {
    if (profile.hasBackup || profile.hasRecoveryWindow) {
      return verdict('recoverable-from-backup', 0.92, ['database backup/retention evidence']);
    }

    if (profile.skipsFinalSnapshot) {
      return verdict('unrecoverable', 0.92, ['database delete skips final snapshot and has no backup evidence']);
    }

    return verdict('needs-review', 0.64, ['database deletion without backup evidence']);
  }

  if (profile.kind === 'disk') {
    if (profile.hasBackup || profile.hasVersioning) {
      return verdict('recoverable-from-backup', 0.9, ['disk/snapshot recovery evidence']);
    }
    return verdict('unrecoverable', 0.88, ['disk-like resource deletion without snapshot evidence']);
  }

  if (profile.hasRecoveryWindow) {
    return verdict('recoverable-with-effort', 0.86, ['recovery/deletion window present']);
  }

  return verdict('needs-review', 0.55, ['unknown resource semantics']);
}

function verdict(tier: SemanticClassifierTier, confidence: number, evidence: string[]): SemanticClassifierResult {
  return {
    tier,
    confidence,
    model: 'semantic-unknown@bitnet-contract-v1',
    evidence,
  };
}
