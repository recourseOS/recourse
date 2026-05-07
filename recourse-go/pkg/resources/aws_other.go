package resources

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// SQSHandler evaluates SQS queue recoverability.
type SQSHandler struct{}

func NewSQSHandler() *SQSHandler { return &SQSHandler{} }

func (h *SQSHandler) ResourceTypes() []string {
	return []string{"aws_sqs_queue", "aws_sqs_queue_policy"}
}

func (h *SQSHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete && change.Type == "aws_sqs_queue" {
			// Check if queue has messages
			if before := change.Before; before != nil {
				if msgCount, ok := before["approximate_number_of_messages"].(float64); ok && msgCount > 0 {
					return types.RecoverabilityResult{
						Tier:       types.Unrecoverable,
						Label:      types.Unrecoverable.String(),
						Reasoning:  "Queue contains messages that will be lost",
						Source:     "rules",
						Confidence: 0.95,
					}
				}
			}
			// Queue is empty or message count unknown - can be recreated
			return types.RecoverabilityResult{
				Tier:       types.RecoverableWithEffort,
				Label:      types.RecoverableWithEffort.String(),
				Reasoning:  "Queue can be recreated; URL will change",
				Source:     "rules",
				Confidence: 0.9,
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "SQS configuration changes can be reverted",
		Source:     "rules",
		Confidence: 1.0,
	}
}

// SNSHandler evaluates SNS topic recoverability.
type SNSHandler struct{}

func NewSNSHandler() *SNSHandler { return &SNSHandler{} }

func (h *SNSHandler) ResourceTypes() []string {
	return []string{"aws_sns_topic", "aws_sns_topic_subscription", "aws_sns_topic_policy"}
}

func (h *SNSHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			return types.RecoverabilityResult{
				Tier:       types.RecoverableWithEffort,
				Label:      types.RecoverableWithEffort.String(),
				Reasoning:  "SNS topic/subscription can be recreated; no message persistence",
				Source:     "rules",
				Confidence: 0.9,
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "SNS configuration changes can be reverted",
		Source:     "rules",
		Confidence: 1.0,
	}
}

// EC2Handler evaluates EC2 instance recoverability.
type EC2Handler struct{}

func NewEC2Handler() *EC2Handler { return &EC2Handler{} }

func (h *EC2Handler) ResourceTypes() []string {
	return []string{
		"aws_instance", "aws_ebs_volume", "aws_ebs_snapshot",
		"aws_ami", "aws_launch_template", "aws_security_group",
		"aws_security_group_rule", "aws_eip", "aws_key_pair",
	}
}

func (h *EC2Handler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			switch change.Type {
			case "aws_instance":
				// Check if instance has EBS volumes that will be deleted
				return types.RecoverabilityResult{
					Tier:       types.RecoverableFromBackup,
					Label:      types.RecoverableFromBackup.String(),
					Reasoning:  "EC2 instance termination; recovery depends on AMI/snapshot availability",
					Source:     "rules",
					Confidence: 0.8,
				}
			case "aws_ebs_volume":
				return types.RecoverabilityResult{
					Tier:       types.Unrecoverable,
					Label:      types.Unrecoverable.String(),
					Reasoning:  "EBS volume deletion permanently destroys data unless snapshot exists",
					Source:     "rules",
					Confidence: 0.9,
				}
			case "aws_ebs_snapshot", "aws_ami":
				return types.RecoverabilityResult{
					Tier:       types.Unrecoverable,
					Label:      types.Unrecoverable.String(),
					Reasoning:  "Deleting snapshot/AMI permanently destroys this backup point",
					Source:     "rules",
					Confidence: 1.0,
				}
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "EC2 configuration changes can be reverted",
		Source:     "rules",
		Confidence: 0.9,
	}
}

// IAMHandler evaluates IAM resource recoverability.
type IAMHandler struct{}

func NewIAMHandler() *IAMHandler { return &IAMHandler{} }

func (h *IAMHandler) ResourceTypes() []string {
	return []string{
		"aws_iam_user", "aws_iam_role", "aws_iam_policy",
		"aws_iam_role_policy", "aws_iam_user_policy",
		"aws_iam_role_policy_attachment", "aws_iam_user_policy_attachment",
		"aws_iam_instance_profile", "aws_iam_access_key",
	}
}

func (h *IAMHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			// All IAM resources are recoverable-with-effort (can be recreated)
			// Access keys: new keys can be generated, but applications need updating
			// Roles/policies: can be recreated from configuration
			return types.RecoverabilityResult{
				Tier:       types.RecoverableWithEffort,
				Label:      types.RecoverableWithEffort.String(),
				Reasoning:  "IAM resource can be recreated; may break dependencies temporarily",
				Source:     "rules",
				Confidence: 0.9,
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "IAM configuration changes can be reverted",
		Source:     "rules",
		Confidence: 1.0,
	}
}

// LambdaHandler evaluates Lambda function recoverability.
type LambdaHandler struct{}

func NewLambdaHandler() *LambdaHandler { return &LambdaHandler{} }

func (h *LambdaHandler) ResourceTypes() []string {
	return []string{
		"aws_lambda_function", "aws_lambda_layer_version",
		"aws_lambda_permission", "aws_lambda_event_source_mapping",
	}
}

func (h *LambdaHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			return types.RecoverabilityResult{
				Tier:       types.RecoverableWithEffort,
				Label:      types.RecoverableWithEffort.String(),
				Reasoning:  "Lambda function can be redeployed from source; no persistent state",
				Source:     "rules",
				Confidence: 0.95,
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "Lambda configuration changes can be reverted",
		Source:     "rules",
		Confidence: 1.0,
	}
}

// DynamoDBHandler evaluates DynamoDB table recoverability.
type DynamoDBHandler struct{}

func NewDynamoDBHandler() *DynamoDBHandler { return &DynamoDBHandler{} }

func (h *DynamoDBHandler) ResourceTypes() []string {
	return []string{
		"aws_dynamodb_table", "aws_dynamodb_global_table",
		"aws_dynamodb_table_item",
	}
}

func (h *DynamoDBHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			if change.Type == "aws_dynamodb_table" {
				// Check for point-in-time recovery
				if before := change.Before; before != nil {
					if pitr, ok := before["point_in_time_recovery"].([]interface{}); ok && len(pitr) > 0 {
						if p, ok := pitr[0].(map[string]interface{}); ok {
							if enabled, ok := p["enabled"].(bool); ok && enabled {
								return types.RecoverabilityResult{
									Tier:       types.RecoverableFromBackup,
									Label:      types.RecoverableFromBackup.String(),
									Reasoning:  "DynamoDB table has PITR enabled; can restore from backup",
									Source:     "rules",
									Confidence: 0.95,
								}
							}
						}
					}
				}
				return types.RecoverabilityResult{
					Tier:       types.Unrecoverable,
					Label:      types.Unrecoverable.String(),
					Reasoning:  "DynamoDB table deletion without PITR; ALL DATA WILL BE LOST",
					Source:     "rules",
					Confidence: 0.9,
				}
			}
		}
	}
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "DynamoDB configuration changes can be reverted",
		Source:     "rules",
		Confidence: 1.0,
	}
}
