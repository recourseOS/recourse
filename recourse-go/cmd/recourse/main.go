// Package main provides the CLI entry point for recourse-go.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/recourseOS/recourse-go/pkg/evaluator"
	"github.com/recourseOS/recourse-go/pkg/parser"
	"github.com/recourseOS/recourse-go/pkg/policy"
	"github.com/recourseOS/recourse-go/pkg/types"
)

const usage = `recourse-go - Terraform plan consequence evaluator

Usage:
  recourse-go plan <plan.json> [--format json|human] [--env production|staging|development]
  recourse-go resources

Commands:
  plan       Evaluate a Terraform plan JSON file
  resources  List supported resource types

Options:
  --format   Output format: json or human (default: human)
  --env      Environment context for policy (default: development)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}

	switch os.Args[1] {
	case "plan":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Error: plan file path required")
			os.Exit(1)
		}
		runPlan(os.Args[2:])
	case "resources":
		runResources()
	case "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runPlan(args []string) {
	planPath := args[0]
	format := "human"
	env := "development"

	// Parse additional args
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--format":
			if i+1 < len(args) {
				format = args[i+1]
				i++
			}
		case "--env":
			if i+1 < len(args) {
				env = args[i+1]
				i++
			}
		}
	}

	// Parse the plan
	plan, err := parser.ParsePlanFile(planPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing plan: %v\n", err)
		os.Exit(1)
	}

	// Evaluate
	eval := evaluator.New()
	report := eval.EvaluatePlan(plan, plan.PriorState)

	// Apply policy
	var pol *policy.Policy
	switch env {
	case "production":
		pol = policy.ProductionPolicy()
	default:
		pol = policy.DefaultPolicy()
	}
	pol.Environment = env
	verdict := pol.Evaluate(report)

	// Output
	switch format {
	case "json":
		outputJSON(report, verdict)
	default:
		outputHuman(report, verdict)
	}

	// Exit code based on verdict
	switch verdict.RiskAssessment {
	case types.Block:
		os.Exit(2)
	case types.Escalate:
		os.Exit(1)
	default:
		os.Exit(0)
	}
}

func outputJSON(report *types.ConsequenceReport, verdict types.Verdict) {
	output := map[string]interface{}{
		"risk_assessment": verdict.RiskAssessment,
		"overall_tier":    report.OverallTier.String(),
		"resources":       report.ResourceResults,
		"reasons":         verdict.Reasons,
	}
	if len(report.CrossActionRisks) > 0 {
		output["cross_action_risks"] = report.CrossActionRisks
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(output)
}

func outputHuman(report *types.ConsequenceReport, verdict types.Verdict) {
	// Color codes
	red := "\033[31m"
	yellow := "\033[33m"
	green := "\033[32m"
	reset := "\033[0m"
	bold := "\033[1m"

	var color string
	switch verdict.RiskAssessment {
	case types.Block:
		color = red
	case types.Escalate, types.Warn:
		color = yellow
	default:
		color = green
	}

	fmt.Printf("\n%s%sRecourseOS Evaluation%s\n", bold, color, reset)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Printf("Risk Assessment: %s%s%s\n", color, verdict.RiskAssessment, reset)
	fmt.Printf("Overall Tier:    %s\n", report.OverallTier.String())
	fmt.Printf("Resources:       %d\n\n", len(report.ResourceResults))

	// Resource details
	for _, r := range report.ResourceResults {
		tierColor := green
		switch r.Recoverability.Tier {
		case types.Unrecoverable:
			tierColor = red
		case types.RecoverableFromBackup, types.NeedsReview:
			tierColor = yellow
		}

		fmt.Printf("  %s%s%s\n", bold, r.Address, reset)
		fmt.Printf("    Actions: %v\n", r.Actions)
		fmt.Printf("    Tier:    %s%s%s\n", tierColor, r.Recoverability.Label, reset)
		fmt.Printf("    Reason:  %s\n\n", r.Recoverability.Reasoning)
	}

	// Cross-action risks
	if len(report.CrossActionRisks) > 0 {
		fmt.Printf("\n%s%sCross-Action Risks:%s\n", bold, red, reset)
		for _, risk := range report.CrossActionRisks {
			fmt.Printf("  %s⚠ %s%s\n", yellow, risk.PatternName, reset)
			fmt.Printf("    %s\n", risk.Explanation)
			fmt.Printf("    Affected: %v\n\n", risk.AffectedResources)
		}
	}

	// Verdict reasons
	if len(verdict.Reasons) > 0 {
		fmt.Printf("%sReasons for %s:%s\n", bold, verdict.RiskAssessment, reset)
		for _, reason := range verdict.Reasons {
			fmt.Printf("  • %s\n", reason)
		}
	}
}

func runResources() {
	resourceTypes := []string{
		// S3
		"aws_s3_bucket", "aws_s3_bucket_versioning", "aws_s3_bucket_lifecycle_configuration",
		"aws_s3_bucket_replication_configuration", "aws_s3_object",
		// RDS
		"aws_db_instance", "aws_rds_cluster", "aws_db_snapshot", "aws_db_cluster_snapshot",
		"aws_db_parameter_group", "aws_db_subnet_group", "aws_rds_cluster_parameter_group",
		// SQS
		"aws_sqs_queue", "aws_sqs_queue_policy",
		// SNS
		"aws_sns_topic", "aws_sns_topic_subscription", "aws_sns_topic_policy",
		// EC2
		"aws_instance", "aws_ebs_volume", "aws_ebs_snapshot", "aws_ami",
		"aws_launch_template", "aws_security_group", "aws_security_group_rule",
		"aws_eip", "aws_key_pair",
		// IAM
		"aws_iam_user", "aws_iam_role", "aws_iam_policy", "aws_iam_role_policy",
		"aws_iam_user_policy", "aws_iam_role_policy_attachment",
		"aws_iam_user_policy_attachment", "aws_iam_instance_profile", "aws_iam_access_key",
		// Lambda
		"aws_lambda_function", "aws_lambda_layer_version", "aws_lambda_permission",
		"aws_lambda_event_source_mapping",
		// DynamoDB
		"aws_dynamodb_table", "aws_dynamodb_global_table", "aws_dynamodb_table_item",
	}

	fmt.Printf("Supported resource types (%d):\n\n", len(resourceTypes))
	for _, rt := range resourceTypes {
		fmt.Printf("  • %s\n", rt)
	}
}
