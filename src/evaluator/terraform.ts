import { analyzeBlastRadius } from '../analyzer/blast-radius.js';
import { buildDependencyGraph } from '../analyzer/dependencies.js';
import {
  buildCrossActionContext,
  detectCrossActionRisks,
  getWorstCrossActionTier,
  type CrossActionRisk,
} from '../analyzer/cross-action.js';
import { crossActionPatterns } from '../analyzer/cross-action-patterns.js';
import { terraformChangeToMutation } from '../adapters/terraform.js';
import type { AdapterContext } from '../adapters/types.js';
import type {
  AnalyzedMutation,
  ConsequenceReport,
  VerificationSuggestion,
  VerificationStatusInfo,
  RequiredEvidence,
  EvidenceItem,
  FailureMode,
} from '../core/index.js';
import {
  checkEvidenceFailures,
  applyFailureMode,
  DEFAULT_FAILURE_MODE,
} from '../core/index.js';
import {
  TraceBuilder,
  buildVerificationInstructions,
  type ReasoningTrace,
  type VerificationInstructions,
} from './trace.js';
import {
  buildRequiredEvidence,
  getEvidenceRequirements,
  DEFAULT_UNKNOWN_REQUIREMENTS,
} from '../core/index.js';
import {
  RecoverabilityLabels,
  RecoverabilityTier,
  type RecoverabilityResult,
  type TerraformPlan,
  type TerraformState,
  type ResourceChange,
} from '../resources/types.js';
import {
  evaluateBlastRadiusReport,
  type LocalPolicy,
} from '../policy/local.js';
import { getVerificationSuggestions, type VerificationResult, type ClassificationAudit } from '../verification/index.js';

export interface TerraformConsequenceOptions {
  useClassifier?: boolean;
  adapterContext?: AdapterContext;
  policy?: LocalPolicy;
}

export function evaluateTerraformPlanConsequences(
  plan: TerraformPlan,
  state: TerraformState | null,
  options: TerraformConsequenceOptions = {}
): ConsequenceReport {
  // Initialize trace capture
  const trace = new TraceBuilder();
  trace.source('terraform-plan');
  if (state) {
    trace.source('terraform-state');
  }

  trace.step('parse_input', `Parsed Terraform plan with ${plan.resourceChanges?.length ?? 0} resource changes`);

  const blastRadiusReport = analyzeBlastRadius(plan, state, {
    useClassifier: options.useClassifier,
  });

  trace.step('analyze_blast_radius', `Analyzed ${blastRadiusReport.changes.length} changes`, {
    decision: `total_changes=${blastRadiusReport.summary.totalChanges}, has_unrecoverable=${blastRadiusReport.summary.hasUnrecoverable}`,
  });

  const policyEvaluation = evaluateBlastRadiusReport(
    blastRadiusReport,
    options.policy
  );

  const mutations: AnalyzedMutation[] = blastRadiusReport.changes.map(change => {
    const evidence: EvidenceItem[] = [
      {
        key: 'recoverability.reasoning',
        value: change.recoverability.reasoning,
        present: true,
        description: 'Reason produced by the recoverability classifier',
      },
    ];

    // Add evidence from resource state (before values)
    if (change.resource.before) {
      for (const [key, value] of Object.entries(change.resource.before)) {
        if (value !== null && value !== undefined) {
          evidence.push({
            key: `state.${key}`,
            value,
            present: true,
            description: `Resource state: ${key}`,
          });
        }
      }
    }

    const requiredEvidence = buildRequiredEvidenceForChange(change.resource, evidence);

    return {
      intent: terraformChangeToMutation(change.resource, options.adapterContext),
      recoverability: change.recoverability,
      evidence,
      missingEvidence: change.recoverability.tier === RecoverabilityTier.NEEDS_REVIEW
        ? [
            {
              key: 'resource-semantics',
              description: 'Recourse does not have enough evidence to classify this mutation safely',
              effect: 'requires-review',
            },
          ]
        : [],
      dependencyImpact: change.cascadeImpact.map(impact => ({
        targetId: impact.affectedResource,
        reason: impact.reason,
        transitive: true,
      })),
      requiredEvidence,
    };
  });

  // Get effective state for cross-action analysis
  const effectiveState = state || plan.priorState || null;

  // Build verdicts map for cross-action context
  const verdicts = new Map<string, RecoverabilityResult>();
  for (const change of blastRadiusReport.changes) {
    verdicts.set(change.resource.address, change.recoverability);
  }

  // Run cross-action analysis
  const dependencyGraph = effectiveState ? buildDependencyGraph(effectiveState) : null;
  const crossActionContext = buildCrossActionContext(
    blastRadiusReport.changes.map(c => c.resource),
    dependencyGraph,
    verdicts,
    effectiveState
  );
  const crossActionRisks = detectCrossActionRisks(crossActionContext, crossActionPatterns);

  trace.step('cross_action_analysis', `Checked ${crossActionPatterns.length} cross-action patterns`, {
    decision: crossActionRisks.length > 0
      ? `found_risks=${crossActionRisks.map(r => r.patternName).join(',')}`
      : 'no_risks_detected',
  });

  // Get worst tier from cross-action risks (may upgrade plan-level summary)
  const crossActionWorstTier = getWorstCrossActionTier(crossActionRisks);

  // Get worst recoverability from individual mutations
  let worstRecoverability = getWorstRecoverability(
    blastRadiusReport.changes.map(change => change.recoverability)
  );

  // Upgrade if cross-action analysis found worse tier
  if (crossActionWorstTier !== null && crossActionWorstTier > worstRecoverability.tier) {
    const crossActionReason = crossActionRisks
      .map(r => r.patternName)
      .join('; ');
    worstRecoverability = {
      tier: crossActionWorstTier,
      label: RecoverabilityLabels[crossActionWorstTier],
      reasoning: `Cross-action analysis: ${crossActionReason}`,
    };
  }

  // Aggregate verification suggestions from all mutations
  const verificationSuggestions: VerificationSuggestion[] = [];
  const classificationAudits: ClassificationAudit[] = [];
  let aggregateVerificationStatus: VerificationStatusInfo | undefined;

  for (const change of blastRadiusReport.changes) {
    // First, use hardcoded suggestions from the handler
    if (change.recoverability.verificationSuggestions) {
      verificationSuggestions.push(...change.recoverability.verificationSuggestions);
    }
    // Then, if no hardcoded suggestions and resource is being deleted, use classifier
    else if (change.resource.actions.includes('delete')) {
      const result = getVerificationSuggestions(
        change.resource.type,
        change.resource.before || {},
        {
          address: change.resource.address,
        }
      );

      // Track classification audit for debugging and training data
      classificationAudits.push(result.audit);

      // Handle each verification status appropriately
      if (result.status === 'suggestions_available') {
        for (const suggestion of result.suggestions) {
          verificationSuggestions.push({
            ...suggestion,
            // Mark as classifier-generated for transparency
            description: `[${result.classification.source}:${result.classification.confidence.toFixed(2)}] ${suggestion.description}`,
          });
        }
      }

      // Track the "worst" status for the aggregate (prioritize actionable states)
      if (!aggregateVerificationStatus) {
        aggregateVerificationStatus = {
          status: result.status,
          reason: result.statusReason,
          classificationAudit: {
            category: result.classification.category,
            confidence: result.classification.confidence,
            source: result.classification.source,
            riskLevel: result.classification.riskLevel,
          },
        };
      } else {
        // Priority: low_confidence > no_suggestions_available > suggestions_available > not_required
        const statusPriority: Record<string, number> = {
          'low_confidence': 4,
          'no_suggestions_available': 3,
          'suggestions_available': 2,
          'not_required': 1,
        };
        if ((statusPriority[result.status] || 0) > (statusPriority[aggregateVerificationStatus.status] || 0)) {
          aggregateVerificationStatus = {
            status: result.status,
            reason: result.statusReason,
            classificationAudit: {
              category: result.classification.category,
              confidence: result.classification.confidence,
              source: result.classification.source,
              riskLevel: result.classification.riskLevel,
            },
          };
        }
      }
    }
  }

  // Determine if plan has unrecoverable actions (including from cross-action analysis)
  const hasUnrecoverableFromCrossAction = crossActionWorstTier === RecoverabilityTier.UNRECOVERABLE;
  const hasUnrecoverable = blastRadiusReport.summary.hasUnrecoverable || hasUnrecoverableFromCrossAction;

  // Re-evaluate policy with potentially upgraded worst tier
  const finalPolicyEvaluation = hasUnrecoverableFromCrossAction
    ? evaluateBlastRadiusReport(
        { ...blastRadiusReport, summary: { ...blastRadiusReport.summary, hasUnrecoverable: true } },
        options.policy
      )
    : policyEvaluation;

  // Record handlers invoked
  for (const change of blastRadiusReport.changes) {
    trace.handler(change.resource.type);
  }

  // Final trace step
  trace.step('policy_evaluation', `Risk assessment: ${finalPolicyEvaluation.decision}`, {
    decision: finalPolicyEvaluation.decision,
    confidence: 1.0,
  });

  // Build verification instructions for worst-case resource
  const worstChange = blastRadiusReport.changes.find(
    c => c.recoverability.tier === worstRecoverability.tier
  );
  const verificationInstructions = worstChange
    ? buildVerificationInstructions(
        worstChange.resource.type,
        worstChange.resource.before?.id as string | undefined,
        worstRecoverability.tier,
        worstChange.resource.before as Record<string, unknown> | undefined
      )
    : undefined;

  // Check for evidence failures and apply failure mode
  const failureCheck = checkEvidenceFailures(mutations);
  const effectiveFailureMode = options.policy?.failureMode ?? DEFAULT_FAILURE_MODE;

  let finalDecision = finalPolicyEvaluation.decision;
  let finalReason = hasUnrecoverableFromCrossAction
    ? `${finalPolicyEvaluation.reason} (cross-action risk detected)`
    : finalPolicyEvaluation.reason;

  // Apply failure mode if there are evidence failures
  if (failureCheck.hasFailures) {
    const failureModeResult = applyFailureMode(
      finalDecision,
      finalReason,
      failureCheck,
      effectiveFailureMode
    );
    finalDecision = failureModeResult.decision;
    finalReason = failureModeResult.reason;

    trace.step('failure_mode_check', `Evidence failures detected, applying ${effectiveFailureMode} mode`, {
      decision: `failed_resources=${failureCheck.failedResources.length}, mode=${effectiveFailureMode}, result=${finalDecision}`,
    });
  }

  const report: ConsequenceReport = {
    mutations,
    summary: {
      totalMutations: mutations.length,
      worstRecoverability,
      needsReview: worstRecoverability.tier === RecoverabilityTier.NEEDS_REVIEW,
      hasUnrecoverable,
      dependencyImpactCount: blastRadiusReport.summary.cascadeImpactCount,
    },
    riskAssessment: finalDecision,
    assessmentReason: finalReason,
    // Always include cross-action risks (empty array if none detected)
    crossActionRisks,
    // Attestation richness fields
    trace: trace.build(),
    verification: verificationInstructions,
  };

  // Add verification protocol fields
  if (verificationSuggestions.length > 0) {
    report.verificationProtocolVersion = 'v1';
    report.verificationSuggestions = verificationSuggestions;
  }

  // Always include verification status if we evaluated any deletes
  if (aggregateVerificationStatus) {
    report.verificationProtocolVersion = 'v1';
    report.verificationStatus = aggregateVerificationStatus;
  } else if (blastRadiusReport.changes.some(c => c.resource.actions.includes('delete'))) {
    // Deletes exist but all had hardcoded suggestions - mark as evaluated
    report.verificationProtocolVersion = 'v1';
    report.verificationStatus = {
      status: 'suggestions_available',
      reason: 'Handler-provided verification suggestions available',
    };
  }

  return report;
}

function getWorstRecoverability(results: RecoverabilityResult[]): RecoverabilityResult {
  if (results.length === 0) {
    return {
      tier: RecoverabilityTier.REVERSIBLE,
      label: RecoverabilityLabels[RecoverabilityTier.REVERSIBLE],
      reasoning: 'No mutations detected',
    };
  }

  return results.reduce((worst, current) =>
    current.tier > worst.tier ? current : worst
  );
}

/**
 * Build RequiredEvidence for a Terraform resource change.
 */
function buildRequiredEvidenceForChange(
  change: ResourceChange,
  evidence: EvidenceItem[]
): RequiredEvidence {
  const resourceType = change.type;
  const action = change.actions.includes('delete')
    ? 'delete'
    : change.actions.includes('create')
    ? 'create'
    : 'update';

  const requirements = getEvidenceRequirements(resourceType, action);

  if (!requirements) {
    // No requirements defined for this resource/action
    return {
      resourceType,
      action,
      requirementsDefined: false,
      requirements: [],
      summary: { total: 0, satisfied: 0, missingRequired: 0, missingBlocking: 0 },
      sufficient: true,
      sufficiency: 'sufficient',
    };
  }

  return buildRequiredEvidence(resourceType, action, evidence, requirements);
}
