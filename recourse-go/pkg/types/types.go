// Package types defines the core types for RecourseOS consequence evaluation.
package types

// RecoverabilityTier represents how recoverable a change is.
// Lower numbers = easier to recover. Higher = worse.
type RecoverabilityTier int

const (
	// Reversible - Can be undone with another API call
	Reversible RecoverabilityTier = 1
	// RecoverableWithEffort - Can recreate but requires work
	RecoverableWithEffort RecoverabilityTier = 2
	// RecoverableFromBackup - Needs backup/snapshot to restore
	RecoverableFromBackup RecoverabilityTier = 3
	// Unrecoverable - Data permanently lost
	Unrecoverable RecoverabilityTier = 4
	// NeedsReview - Evidence insufficient, requires human review
	NeedsReview RecoverabilityTier = 5
)

// String returns the human-readable label for a tier.
func (t RecoverabilityTier) String() string {
	switch t {
	case Reversible:
		return "reversible"
	case RecoverableWithEffort:
		return "recoverable-with-effort"
	case RecoverableFromBackup:
		return "recoverable-from-backup"
	case Unrecoverable:
		return "unrecoverable"
	case NeedsReview:
		return "needs-review"
	default:
		return "unknown"
	}
}

// RiskAssessment is the final verdict for a plan.
type RiskAssessment string

const (
	Allow    RiskAssessment = "allow"
	Warn     RiskAssessment = "warn"
	Escalate RiskAssessment = "escalate"
	Block    RiskAssessment = "block"
)

// TerraformAction represents a Terraform change action.
type TerraformAction string

const (
	ActionCreate  TerraformAction = "create"
	ActionUpdate  TerraformAction = "update"
	ActionDelete  TerraformAction = "delete"
	ActionReplace TerraformAction = "replace"
	ActionRead    TerraformAction = "read"
	ActionNoOp    TerraformAction = "no-op"
)

// ResourceChange represents a single resource change from a Terraform plan.
type ResourceChange struct {
	Address      string                 `json:"address"`
	Type         string                 `json:"type"`
	Name         string                 `json:"name"`
	ProviderName string                 `json:"provider_name"`
	Actions      []TerraformAction      `json:"actions"`
	Before       map[string]interface{} `json:"before"`
	After        map[string]interface{} `json:"after"`
	AfterUnknown map[string]interface{} `json:"after_unknown"`
}

// TerraformPlan represents a parsed Terraform plan.
type TerraformPlan struct {
	FormatVersion    string           `json:"format_version"`
	TerraformVersion string           `json:"terraform_version"`
	ResourceChanges  []ResourceChange `json:"resource_changes"`
	PriorState       *TerraformState  `json:"prior_state,omitempty"`
}

// TerraformState represents Terraform state.
type TerraformState struct {
	FormatVersion    string      `json:"format_version"`
	TerraformVersion string      `json:"terraform_version"`
	Values           StateValues `json:"values"`
}

// StateValues contains the root module and its resources.
type StateValues struct {
	RootModule StateModule `json:"root_module"`
}

// StateModule represents a module in state.
type StateModule struct {
	Resources    []StateResource `json:"resources"`
	ChildModules []StateModule   `json:"child_modules,omitempty"`
}

// StateResource represents a single resource in state.
type StateResource struct {
	Address      string                 `json:"address"`
	Type         string                 `json:"type"`
	Name         string                 `json:"name"`
	ProviderName string                 `json:"provider_name"`
	Values       map[string]interface{} `json:"values"`
	DependsOn    []string               `json:"depends_on,omitempty"`
}

// RecoverabilityResult is the output of evaluating a single change.
type RecoverabilityResult struct {
	Tier       RecoverabilityTier `json:"tier"`
	Label      string             `json:"label"`
	Reasoning  string             `json:"reasoning"`
	Source     string             `json:"source,omitempty"`     // "rules", "classifier", "default"
	Confidence float64            `json:"confidence,omitempty"` // 0-1
}

// AnalyzedChange represents a change with its recoverability analysis.
type AnalyzedChange struct {
	Address        string               `json:"address"`
	Type           string               `json:"type"`
	Actions        []TerraformAction    `json:"actions"`
	Recoverability RecoverabilityResult `json:"recoverability"`
	CascadeImpacts []CascadeImpact      `json:"cascade_impacts,omitempty"`
}

// CascadeImpact represents a downstream impact of a change.
type CascadeImpact struct {
	AffectedResource string `json:"affected_resource"`
	Reason           string `json:"reason"`
}

// BlastRadiusSummary summarizes the overall impact.
type BlastRadiusSummary struct {
	TotalChanges       int                           `json:"total_changes"`
	ByTier             map[RecoverabilityTier]int    `json:"by_tier"`
	CascadeImpactCount int                           `json:"cascade_impact_count"`
	HasUnrecoverable   bool                          `json:"has_unrecoverable"`
	WorstTier          RecoverabilityTier            `json:"worst_tier"`
}

// ConsequenceReport is the final output of evaluation.
type ConsequenceReport struct {
	Changes          []AnalyzedChange   `json:"changes"`
	ResourceResults  []ResourceResult   `json:"resource_results"`
	CrossActionRisks []CrossActionRisk  `json:"cross_action_risks,omitempty"`
	Summary          BlastRadiusSummary `json:"summary"`
	RiskAssessment   RiskAssessment     `json:"risk_assessment"`
	OverallTier      RecoverabilityTier `json:"overall_tier"`
	AssessmentReason string             `json:"assessment_reason"`
}

// CrossActionRisk represents a detected cross-action pattern.
type CrossActionRisk struct {
	PatternID         string             `json:"pattern_id"`
	PatternName       string             `json:"pattern_name"`
	Explanation       string             `json:"explanation"`
	AffectedResources []string           `json:"affected_resources"`
	UpgradeTier       RecoverabilityTier `json:"upgrade_tier"`
}

// ResourceResult represents the evaluation result for a single resource.
type ResourceResult struct {
	Address        string               `json:"address"`
	Type           string               `json:"type"`
	Actions        []TerraformAction    `json:"actions"`
	Recoverability RecoverabilityResult `json:"recoverability"`
}

// Verdict is the final policy decision.
type Verdict struct {
	RiskAssessment RiskAssessment `json:"risk_assessment"`
	Reasons        []string       `json:"reasons"`
}

// VerificationSuggestion suggests a command to gather evidence.
type VerificationSuggestion struct {
	EvidenceKey  string `json:"evidence_key"`
	Command      string `json:"command"`
	Description  string `json:"description"`
	ExpectedPass string `json:"expected_pass"`
	ExpectedFail string `json:"expected_fail"`
}

// WorstTier returns the worst (highest) tier from a slice.
func WorstTier(tiers []RecoverabilityTier) RecoverabilityTier {
	worst := Reversible
	for _, t := range tiers {
		if t > worst {
			worst = t
		}
	}
	return worst
}
