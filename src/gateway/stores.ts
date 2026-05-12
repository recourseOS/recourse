/**
 * Gateway Stores - Plan and Approval persistence
 *
 * In-memory implementations for development.
 * Replace with database-backed stores for production.
 */

import type {
  TerraformPlanRecord,
  ApprovalRequest,
  PlanStore,
  ApprovalStore,
} from './types.js';

// ============================================================================
// IN-MEMORY PLAN STORE
// ============================================================================

export class InMemoryPlanStore implements PlanStore {
  private plans = new Map<string, TerraformPlanRecord>();

  async save(record: TerraformPlanRecord): Promise<void> {
    this.plans.set(record.planId, record);
  }

  async get(planId: string): Promise<TerraformPlanRecord | null> {
    const record = this.plans.get(planId);
    if (!record) return null;

    // Check expiry
    if (new Date(record.expiresAt) < new Date()) {
      record.status = 'expired';
      return record;
    }

    return record;
  }

  async updateStatus(
    planId: string,
    status: TerraformPlanRecord['status']
  ): Promise<void> {
    const record = this.plans.get(planId);
    if (record) {
      record.status = status;
      if (status === 'applied') {
        record.appliedAt = new Date().toISOString();
      }
    }
  }

  // Cleanup expired plans (call periodically)
  async cleanup(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [planId, record] of this.plans) {
      if (new Date(record.expiresAt) < now && record.status === 'planned') {
        record.status = 'expired';
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// IN-MEMORY APPROVAL STORE
// ============================================================================

export class InMemoryApprovalStore implements ApprovalStore {
  private approvals = new Map<string, ApprovalRequest>();

  async save(request: ApprovalRequest): Promise<void> {
    this.approvals.set(request.approvalId, request);
  }

  async get(approvalId: string): Promise<ApprovalRequest | null> {
    const request = this.approvals.get(approvalId);
    if (!request) return null;

    // Check expiry
    if (new Date(request.expiresAt) < new Date() && request.status === 'pending') {
      request.status = 'expired';
    }

    return request;
  }

  async approve(
    approvalId: string,
    resolution: ApprovalRequest['resolution']
  ): Promise<void> {
    const request = this.approvals.get(approvalId);
    if (!request) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Approval is not pending: ${request.status}`);
    }
    if (new Date(request.expiresAt) < new Date()) {
      request.status = 'expired';
      throw new Error('Approval has expired');
    }

    request.status = 'approved';
    request.resolution = resolution;
  }

  async reject(
    approvalId: string,
    resolution: ApprovalRequest['resolution']
  ): Promise<void> {
    const request = this.approvals.get(approvalId);
    if (!request) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Approval is not pending: ${request.status}`);
    }

    request.status = 'rejected';
    request.resolution = resolution;
  }

  async getExpired(): Promise<ApprovalRequest[]> {
    const now = new Date();
    const expired: ApprovalRequest[] = [];

    for (const request of this.approvals.values()) {
      if (new Date(request.expiresAt) < now && request.status === 'pending') {
        request.status = 'expired';
        expired.push(request);
      }
    }

    return expired;
  }

  async getPending(): Promise<ApprovalRequest[]> {
    return Array.from(this.approvals.values()).filter(
      r => r.status === 'pending'
    );
  }

  // Cleanup old approvals (call periodically)
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    let cleaned = 0;

    for (const [id, request] of this.approvals) {
      if (new Date(request.createdAt) < cutoff) {
        this.approvals.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let planStore: PlanStore | null = null;
let approvalStore: ApprovalStore | null = null;

export function getPlanStore(): PlanStore {
  if (!planStore) {
    planStore = new InMemoryPlanStore();
  }
  return planStore;
}

export function getApprovalStore(): ApprovalStore {
  if (!approvalStore) {
    approvalStore = new InMemoryApprovalStore();
  }
  return approvalStore;
}

// Allow replacing stores (for testing or production backends)
export function setPlanStore(store: PlanStore): void {
  planStore = store;
}

export function setApprovalStore(store: ApprovalStore): void {
  approvalStore = store;
}
