package resources

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// S3Handler evaluates S3 bucket recoverability.
type S3Handler struct{}

func NewS3Handler() *S3Handler {
	return &S3Handler{}
}

func (h *S3Handler) ResourceTypes() []string {
	return []string{
		"aws_s3_bucket",
		"aws_s3_bucket_versioning",
		"aws_s3_bucket_lifecycle_configuration",
		"aws_s3_bucket_replication_configuration",
		"aws_s3_object",
	}
}

func (h *S3Handler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	// Check if this is a delete
	isDelete := false
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			isDelete = true
			break
		}
	}

	if !isDelete {
		return types.RecoverabilityResult{
			Tier:       types.Reversible,
			Label:      types.Reversible.String(),
			Reasoning:  "S3 configuration changes can be reverted",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	// For deletes, check versioning status
	switch change.Type {
	case "aws_s3_bucket":
		return h.evaluateBucketDelete(change)
	case "aws_s3_object":
		return h.evaluateObjectDelete(change)
	default:
		return types.RecoverabilityResult{
			Tier:       types.RecoverableWithEffort,
			Label:      types.RecoverableWithEffort.String(),
			Reasoning:  "S3 configuration can be recreated",
			Source:     "rules",
			Confidence: 0.9,
		}
	}
}

func (h *S3Handler) evaluateBucketDelete(change types.ResourceChange) types.RecoverabilityResult {
	before := change.Before
	if before == nil {
		return types.RecoverabilityResult{
			Tier:       types.NeedsReview,
			Label:      types.NeedsReview.String(),
			Reasoning:  "Cannot determine bucket state; no before values",
			Source:     "rules",
			Confidence: 0.3,
		}
	}

	// Check if bucket is empty
	// Note: object_count is not typically in Terraform state, but check if available
	if objectCount, ok := before["object_count"].(float64); ok && objectCount == 0 {
		return types.RecoverabilityResult{
			Tier:       types.RecoverableWithEffort,
			Label:      types.RecoverableWithEffort.String(),
			Reasoning:  "Bucket is empty; can be recreated",
			Source:     "rules",
			Confidence: 0.9,
		}
	}

	// IMPORTANT: Versioning does NOT protect bucket deletion.
	// When you delete an S3 bucket, you must first empty it (including all versions).
	// Versioning only protects objects within a bucket, not the bucket itself.
	// Once the bucket is deleted, all version history is gone.

	return types.RecoverabilityResult{
		Tier:       types.Unrecoverable,
		Label:      types.Unrecoverable.String(),
		Reasoning:  "Bucket deletion is permanent; versioning does not survive bucket deletion",
		Source:     "rules",
		Confidence: 1.0,
	}
}

func (h *S3Handler) evaluateObjectDelete(change types.ResourceChange) types.RecoverabilityResult {
	// For individual objects, check if bucket has versioning
	// This is a simplified check - full implementation would look up bucket state
	return types.RecoverabilityResult{
		Tier:       types.RecoverableWithEffort,
		Label:      types.RecoverableWithEffort.String(),
		Reasoning:  "S3 object deletion; recovery depends on bucket versioning",
		Source:     "rules",
		Confidence: 0.7,
	}
}
