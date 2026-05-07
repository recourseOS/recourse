// Package evaluator provides the main evaluation logic for Terraform plans.
package evaluator

import (
	"github.com/recourseOS/recourse-go/pkg/crossaction"
	"github.com/recourseOS/recourse-go/pkg/resources"
	"github.com/recourseOS/recourse-go/pkg/types"
)

// Evaluator evaluates Terraform plans for recoverability.
type Evaluator struct {
	registry        *resources.Registry
	crossActionAnalyzer *crossaction.Analyzer
}

// New creates a new Evaluator with the default handler registry.
func New() *Evaluator {
	return &Evaluator{
		registry:        resources.NewRegistry(),
		crossActionAnalyzer: crossaction.NewAnalyzer(),
	}
}

// EvaluatePlan evaluates a Terraform plan and returns a consequence report.
func (e *Evaluator) EvaluatePlan(plan *types.TerraformPlan, state *types.TerraformState) *types.ConsequenceReport {
	report := &types.ConsequenceReport{
		ResourceResults:  make([]types.ResourceResult, 0, len(plan.ResourceChanges)),
		CrossActionRisks: make([]types.CrossActionRisk, 0),
	}

	var worstTier types.RecoverabilityTier = types.Reversible

	for _, change := range plan.ResourceChanges {
		// Skip no-op changes
		if len(change.Actions) == 1 && change.Actions[0] == types.ActionNoOp {
			continue
		}

		handler := e.registry.GetHandler(change.Type)
		result := handler.GetRecoverability(change, state)

		resourceResult := types.ResourceResult{
			Address:        change.Address,
			Type:           change.Type,
			Actions:        change.Actions,
			Recoverability: result,
		}

		report.ResourceResults = append(report.ResourceResults, resourceResult)

		// Track worst tier
		if result.Tier > worstTier {
			worstTier = result.Tier
		}
	}

	// Cross-action pattern detection
	crossActionMatches := e.crossActionAnalyzer.Analyze(plan.ResourceChanges)
	for _, match := range crossActionMatches {
		report.CrossActionRisks = append(report.CrossActionRisks, types.CrossActionRisk{
			PatternID:         match.PatternID,
			PatternName:       match.PatternName,
			Explanation:       match.Explanation,
			AffectedResources: match.AffectedResources,
			UpgradeTier:       match.UpgradeTier,
		})

		// Cross-action patterns can upgrade the overall tier
		if match.UpgradeTier > worstTier {
			worstTier = match.UpgradeTier
		}
	}

	// Determine overall risk assessment
	report.OverallTier = worstTier
	report.RiskAssessment = DetermineRiskAssessment(worstTier, report.ResourceResults)

	return report
}

// DetermineRiskAssessment converts the worst tier to a risk assessment.
func DetermineRiskAssessment(tier types.RecoverabilityTier, results []types.ResourceResult) types.RiskAssessment {
	// Count by tier
	counts := make(map[types.RecoverabilityTier]int)
	for _, r := range results {
		counts[r.Recoverability.Tier]++
	}

	switch tier {
	case types.Reversible:
		return types.Allow
	case types.RecoverableWithEffort:
		return types.Warn
	case types.RecoverableFromBackup:
		// If more than 2 resources need backup recovery, escalate
		if counts[types.RecoverableFromBackup] > 2 {
			return types.Escalate
		}
		return types.Warn
	case types.Unrecoverable:
		return types.Block
	case types.NeedsReview:
		return types.Escalate
	default:
		return types.Escalate
	}
}
