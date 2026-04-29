export type MutationSource =
  | 'terraform'
  | 'kubernetes'
  | 'sql'
  | 'cloud-api'
  | 'mcp'
  | 'shell'
  | 'git'
  | 'saas'
  | 'internal-api';

export type ActorKind = 'human' | 'agent' | 'ci' | 'service' | 'unknown';

export type MutationAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'replace'
  | 'execute'
  | 'grant'
  | 'revoke'
  | 'no-op';

export interface MutationActor {
  id: string;
  kind: ActorKind;
  identityProvider?: string;
  displayName?: string;
}

export interface MutationTarget {
  provider?: string;
  service?: string;
  type: string;
  id: string;
  name?: string;
  environment?: string;
  owner?: string;
  region?: string;
  account?: string;
}

export interface MutationIntent {
  source: MutationSource;
  action: MutationAction;
  target: MutationTarget;
  actor?: MutationActor;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  raw?: unknown;
  metadata?: Record<string, unknown>;
}

export interface EvidenceItem {
  key: string;
  value?: unknown;
  present: boolean;
  description: string;
}

export interface MissingEvidence {
  key: string;
  description: string;
  effect: 'lowers-confidence' | 'requires-review' | 'blocks-safe-verdict';
}

export interface DependencyImpact {
  targetId: string;
  targetType?: string;
  reason: string;
  transitive: boolean;
}
