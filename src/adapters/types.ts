import type { MutationIntent, MutationSource } from '../core/index.js';

export interface AdapterContext {
  actorId?: string;
  environment?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsequenceAdapter<Input = unknown> {
  source: MutationSource;
  parse(input: Input, context?: AdapterContext): MutationIntent[] | Promise<MutationIntent[]>;
}
