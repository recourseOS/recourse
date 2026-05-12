/**
 * Client for RecourseOS Billing API.
 *
 * Handles license validation, usage reporting, and budget sync.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_API_URL = 'https://api.recourse.io';
const CONFIG_DIR = join(homedir(), '.config', 'recourse');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const RESOURCES_QUEUE_FILE = join(CONFIG_DIR, 'resources-queue.json');

export interface LicenseInfo {
  valid: boolean;
  orgId?: string;
  orgName?: string;
  features?: string[];
  error?: string;
}

export interface ManagedResource {
  resourceId: string;
  resourceType: string;
  action: 'create' | 'update' | 'delete';
  estimatedMonthlyCost: number;
  agentId?: string;
}

export interface BudgetInfo {
  limit: number;
  period: 'day' | 'week' | 'month';
  onExceed: 'block' | 'escalate' | 'warn';
  currentSpend: number;
  periodStart: string;
}

export interface BillingClientConfig {
  apiUrl?: string;
  licenseKey?: string;
}

/**
 * Create a billing client instance.
 */
export function createBillingClient(config: BillingClientConfig = {}) {
  const apiUrl = config.apiUrl || process.env.RECOURSE_API_URL || DEFAULT_API_URL;
  let licenseKey = config.licenseKey || loadLicenseKey();
  let cachedLicense: LicenseInfo | null = null;
  let cacheTime = 0;
  const CACHE_TTL = 3600000; // 1 hour

  // Queue for batching resource changes
  let resourcesQueue: ManagedResource[] = loadResourcesQueue();

  return {
    /**
     * Check if cost tracking is enabled (license key configured).
     */
    isEnabled(): boolean {
      return !!licenseKey;
    },

    /**
     * Get the configured license key.
     */
    getLicenseKey(): string | null {
      return licenseKey;
    },

    /**
     * Set the license key.
     */
    setLicenseKey(key: string): void {
      licenseKey = key;
      saveLicenseKey(key);
      cachedLicense = null;
    },

    /**
     * Clear the license key.
     */
    clearLicenseKey(): void {
      licenseKey = null;
      saveLicenseKey('');
      cachedLicense = null;
    },

    /**
     * Validate the current license.
     */
    async validateLicense(): Promise<LicenseInfo> {
      if (!licenseKey) {
        return { valid: false, error: 'no_license_key' };
      }

      // Check cache
      if (cachedLicense && Date.now() - cacheTime < CACHE_TTL) {
        return cachedLicense;
      }

      try {
        const response = await fetch(`${apiUrl}/v1/license/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_key: licenseKey }),
        });

        const data = await response.json() as Record<string, unknown>;

        cachedLicense = {
          valid: data.valid as boolean,
          orgId: data.org_id as string,
          orgName: data.org_name as string,
          features: data.features as string[],
          error: data.error as string,
        };
        cacheTime = Date.now();

        return cachedLicense;
      } catch (err) {
        // Network error - use cached if available, otherwise fail open
        if (cachedLicense) {
          return cachedLicense;
        }
        return { valid: false, error: 'network_error' };
      }
    },

    /**
     * Record a managed resource change.
     * Resources are queued and sent in batches.
     */
    recordResource(resource: ManagedResource): void {
      if (!licenseKey) return;

      resourcesQueue.push(resource);
      saveResourcesQueue(resourcesQueue);

      // Flush if queue is large enough
      if (resourcesQueue.length >= 10) {
        this.flushResources().catch(() => {});
      }
    },

    /**
     * Flush queued resource changes to the API.
     */
    async flushResources(): Promise<void> {
      if (!licenseKey || resourcesQueue.length === 0) return;

      const resources = resourcesQueue.map(r => ({
        resource_id: r.resourceId,
        resource_type: r.resourceType,
        action: r.action,
        estimated_monthly_cost: r.estimatedMonthlyCost,
        agent_id: r.agentId,
      }));

      try {
        const response = await fetch(`${apiUrl}/v1/usage/resources`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_key: licenseKey, resources }),
        });

        if (response.ok) {
          resourcesQueue = [];
          saveResourcesQueue(resourcesQueue);
        }
      } catch {
        // Network error - keep resources in queue for retry
      }
    },

    /**
     * Get current usage for the billing period.
     */
    async getCurrentUsage(): Promise<Record<string, unknown> | null> {
      if (!licenseKey) return null;

      try {
        const response = await fetch(`${apiUrl}/v1/usage/current`, {
          headers: { 'Authorization': `Bearer ${licenseKey}` },
        });

        if (response.ok) {
          return await response.json() as Record<string, unknown>;
        }
        return null;
      } catch {
        return null;
      }
    },

    /**
     * Get budgets for all agents.
     */
    async getBudgets(): Promise<Record<string, BudgetInfo> | null> {
      if (!licenseKey) return null;

      try {
        const response = await fetch(`${apiUrl}/v1/budgets`, {
          headers: { 'Authorization': `Bearer ${licenseKey}` },
        });

        if (response.ok) {
          const data = await response.json() as { budgets: Record<string, unknown> };
          // Normalize snake_case API response to camelCase
          const normalized: Record<string, BudgetInfo> = {};
          for (const [agentId, budget] of Object.entries(data.budgets || {})) {
            const b = budget as Record<string, unknown>;
            normalized[agentId] = {
              limit: b.limit as number,
              period: b.period as 'day' | 'week' | 'month',
              onExceed: (b.on_exceed || b.onExceed) as 'block' | 'escalate' | 'warn',
              currentSpend: (b.current_spend ?? b.currentSpend ?? 0) as number,
              periodStart: (b.period_start || b.periodStart || '') as string,
            };
          }
          return normalized;
        }
        return null;
      } catch {
        return null;
      }
    },

    /**
     * Set budget for an agent.
     */
    async setBudget(agentId: string, budget: Partial<BudgetInfo>): Promise<boolean> {
      if (!licenseKey) return false;

      try {
        const response = await fetch(`${apiUrl}/v1/budgets/${encodeURIComponent(agentId)}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${licenseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(budget),
        });

        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Load license key from config file.
 */
function loadLicenseKey(): string | null {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return config.license_key || null;
  } catch {
    return null;
  }
}

/**
 * Save license key to config file.
 */
function saveLicenseKey(key: string): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let config: Record<string, unknown> = {};
    if (existsSync(CONFIG_FILE)) {
      config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    }

    config.license_key = key || undefined;
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

/**
 * Load resources queue from disk.
 */
function loadResourcesQueue(): ManagedResource[] {
  try {
    if (!existsSync(RESOURCES_QUEUE_FILE)) return [];
    return JSON.parse(readFileSync(RESOURCES_QUEUE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Save resources queue to disk.
 */
function saveResourcesQueue(queue: ManagedResource[]): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(RESOURCES_QUEUE_FILE, JSON.stringify(queue), { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

// Singleton instance
let defaultClient: ReturnType<typeof createBillingClient> | null = null;

/**
 * Get the default billing client instance.
 */
export function getBillingClient(): ReturnType<typeof createBillingClient> {
  if (!defaultClient) {
    defaultClient = createBillingClient();
  }
  return defaultClient;
}
