import type { RecoverabilityResult, RecoverabilityTier } from '../resources/types.js';

// A single check in the classification trace
export interface TraceCheck {
  name: string;           // e.g., "deletion_protection"
  value: unknown;         // The actual value found
  valueDisplay: string;   // Human-readable value (e.g., "true", "not set")
  passed: boolean;        // Did this check pass (not trigger a classification)?
  note: string;           // What this means (e.g., "blocked at cloud")
}

// What would change the verdict
export interface Counterfactual {
  condition: string;      // e.g., "deletion_protection were set to true"
  resultingTier: string;  // e.g., "blocked"
  explanation: string;    // e.g., "Apply would fail, no data at risk"
}

// Confidence level for the classification
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Full classification trace
export interface ClassificationTrace {
  resourceAddress: string;
  resourceType: string;
  action: string;
  checks: TraceCheck[];
  result: RecoverabilityResult;
  confidence: ConfidenceLevel;
  confidenceReason: string;
  counterfactuals: Counterfactual[];
  limitations: string[];  // What the analyzer can't see
}

// Context object passed to handlers for tracing
export class ClassificationContext {
  readonly resourceAddress: string;
  readonly resourceType: string;
  readonly action: string;

  private checks: TraceCheck[] = [];
  private counterfactuals: Counterfactual[] = [];
  private limitations: string[] = [];
  private missingAttributes: string[] = [];

  constructor(resourceAddress: string, resourceType: string, action: string) {
    this.resourceAddress = resourceAddress;
    this.resourceType = resourceType;
    this.action = action;
  }

  // Record a check that was performed
  check(
    name: string,
    value: unknown,
    options: {
      passed: boolean;
      note: string;
      counterfactual?: {
        condition: string;
        resultingTier: string;
        explanation: string;
      };
    }
  ): void {
    const valueDisplay = this.formatValue(value);

    this.checks.push({
      name,
      value,
      valueDisplay,
      passed: options.passed,
      note: options.note,
    });

    if (options.counterfactual) {
      this.counterfactuals.push(options.counterfactual);
    }
  }

  // Record that an attribute was missing from the plan
  attributeMissing(name: string, defaultAssumed?: string): void {
    this.missingAttributes.push(name);
    this.checks.push({
      name,
      value: undefined,
      valueDisplay: defaultAssumed ? `not set (assuming ${defaultAssumed})` : 'not set',
      passed: true,
      note: defaultAssumed ? `Using Terraform default: ${defaultAssumed}` : 'Attribute not in plan',
    });
  }

  // Record a limitation of the analysis
  limitation(description: string): void {
    this.limitations.push(description);
  }

  // Add a counterfactual without a check
  addCounterfactual(cf: Counterfactual): void {
    this.counterfactuals.push(cf);
  }

  // Build the final trace
  build(result: RecoverabilityResult): ClassificationTrace {
    const { confidence, reason } = this.calculateConfidence();

    return {
      resourceAddress: this.resourceAddress,
      resourceType: this.resourceType,
      action: this.action,
      checks: this.checks,
      result,
      confidence,
      confidenceReason: reason,
      counterfactuals: this.counterfactuals,
      limitations: this.limitations,
    };
  }

  private calculateConfidence(): { confidence: ConfidenceLevel; reason: string } {
    // High: All expected attributes present, multiple checks performed
    // Medium: Some attributes missing, relying on defaults
    // Low: Few checks possible, limited visibility

    if (this.missingAttributes.length === 0 && this.checks.length >= 3) {
      return {
        confidence: 'high',
        reason: 'All relevant attributes present and checked',
      };
    }

    if (this.missingAttributes.length > 0 && this.missingAttributes.length <= 2) {
      return {
        confidence: 'medium',
        reason: `Some attributes missing from plan: ${this.missingAttributes.join(', ')}`,
      };
    }

    if (this.missingAttributes.length > 2 || this.checks.length < 2) {
      return {
        confidence: 'low',
        reason: this.checks.length < 2
          ? 'Limited attribute coverage for this resource type'
          : `Multiple attributes missing: ${this.missingAttributes.join(', ')}`,
      };
    }

    return {
      confidence: 'medium',
      reason: 'Standard coverage',
    };
  }

  private formatValue(value: unknown): string {
    if (value === undefined) return 'not set';
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value.length > 50 ? value.slice(0, 47) + '...' : value;
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '{object}';
    return String(value);
  }
}

// Helper to create a context for a resource
export function createContext(
  resourceAddress: string,
  resourceType: string,
  actions: string[]
): ClassificationContext {
  const action = actions.includes('delete')
    ? (actions.includes('create') ? 'replace' : 'delete')
    : actions.includes('create')
    ? 'create'
    : 'update';

  return new ClassificationContext(resourceAddress, resourceType, action);
}
