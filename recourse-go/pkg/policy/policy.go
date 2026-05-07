// Package policy provides verdict decision logic.
package policy

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// Policy defines how to map recoverability results to risk assessments.
type Policy struct {
	Environment string
	StrictMode  bool
}

// DefaultPolicy returns a policy with default settings.
func DefaultPolicy() *Policy {
	return &Policy{
		Environment: "development",
		StrictMode:  false,
	}
}

// ProductionPolicy returns a strict policy for production environments.
func ProductionPolicy() *Policy {
	return &Policy{
		Environment: "production",
		StrictMode:  true,
	}
}

// Evaluate applies the policy to a consequence report and returns the final verdict.
func (p *Policy) Evaluate(report *types.ConsequenceReport) types.Verdict {
	verdict := types.Verdict{
		RiskAssessment: report.RiskAssessment,
		Reasons:        make([]string, 0),
	}

	// Collect reasons for the verdict
	for _, r := range report.ResourceResults {
		if r.Recoverability.Tier >= types.RecoverableFromBackup {
			verdict.Reasons = append(verdict.Reasons, r.Address+": "+r.Recoverability.Reasoning)
		}
	}

	// Apply environment-specific rules
	if p.Environment == "production" {
		verdict = p.applyProductionRules(verdict, report)
	}

	// Apply strict mode
	if p.StrictMode {
		verdict = p.applyStrictMode(verdict, report)
	}

	return verdict
}

func (p *Policy) applyProductionRules(verdict types.Verdict, report *types.ConsequenceReport) types.Verdict {
	// In production, escalate anything that's not fully reversible
	for _, r := range report.ResourceResults {
		if r.Recoverability.Tier > types.Reversible {
			if verdict.RiskAssessment == types.Allow {
				verdict.RiskAssessment = types.Warn
			}
			if r.Recoverability.Tier == types.Unrecoverable && verdict.RiskAssessment == types.Warn {
				verdict.RiskAssessment = types.Escalate
			}
		}
	}
	return verdict
}

func (p *Policy) applyStrictMode(verdict types.Verdict, report *types.ConsequenceReport) types.Verdict {
	// Strict mode: any unrecoverable action blocks
	for _, r := range report.ResourceResults {
		if r.Recoverability.Tier == types.Unrecoverable {
			verdict.RiskAssessment = types.Block
			break
		}
	}
	return verdict
}

// SuggestVerifications returns verification commands for resources that need review.
func (p *Policy) SuggestVerifications(report *types.ConsequenceReport) []types.VerificationSuggestion {
	var suggestions []types.VerificationSuggestion

	for _, r := range report.ResourceResults {
		if r.Recoverability.Tier == types.NeedsReview || r.Recoverability.Confidence < 0.7 {
			suggestion := p.getVerificationForResource(r)
			if suggestion.Command != "" {
				suggestions = append(suggestions, suggestion)
			}
		}
	}

	return suggestions
}

func (p *Policy) getVerificationForResource(r types.ResourceResult) types.VerificationSuggestion {
	switch r.Type {
	case "aws_s3_bucket":
		return types.VerificationSuggestion{
			EvidenceKey:  "s3_versioning_" + r.Address,
			Command:      "aws s3api get-bucket-versioning --bucket ${bucket_name}",
			Description:  "Verify S3 bucket versioning status",
			ExpectedPass: "Versioning is enabled",
			ExpectedFail: "Versioning is not enabled",
		}
	case "aws_db_instance":
		return types.VerificationSuggestion{
			EvidenceKey:  "rds_snapshots_" + r.Address,
			Command:      "aws rds describe-db-snapshots --db-instance-identifier ${db_id}",
			Description:  "Verify RDS snapshot availability",
			ExpectedPass: "Snapshots exist",
			ExpectedFail: "No snapshots found",
		}
	case "aws_dynamodb_table":
		return types.VerificationSuggestion{
			EvidenceKey:  "dynamodb_pitr_" + r.Address,
			Command:      "aws dynamodb describe-continuous-backups --table-name ${table_name}",
			Description:  "Verify DynamoDB point-in-time recovery status",
			ExpectedPass: "PointInTimeRecoveryStatus is ENABLED",
			ExpectedFail: "PointInTimeRecoveryStatus is DISABLED",
		}
	default:
		return types.VerificationSuggestion{}
	}
}
