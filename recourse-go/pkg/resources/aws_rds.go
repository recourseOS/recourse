package resources

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// RDSHandler evaluates RDS instance/cluster recoverability.
type RDSHandler struct{}

func NewRDSHandler() *RDSHandler {
	return &RDSHandler{}
}

func (h *RDSHandler) ResourceTypes() []string {
	return []string{
		"aws_db_instance",
		"aws_rds_cluster",
		"aws_db_snapshot",
		"aws_db_cluster_snapshot",
		"aws_db_parameter_group",
		"aws_db_subnet_group",
		"aws_rds_cluster_parameter_group",
	}
}

func (h *RDSHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
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
			Reasoning:  "RDS configuration changes can be reverted",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	switch change.Type {
	case "aws_db_instance":
		return h.evaluateInstanceDelete(change)
	case "aws_rds_cluster":
		return h.evaluateClusterDelete(change)
	case "aws_db_snapshot", "aws_db_cluster_snapshot":
		return h.evaluateSnapshotDelete(change)
	default:
		return types.RecoverabilityResult{
			Tier:       types.RecoverableWithEffort,
			Label:      types.RecoverableWithEffort.String(),
			Reasoning:  "RDS configuration can be recreated",
			Source:     "rules",
			Confidence: 0.9,
		}
	}
}

func (h *RDSHandler) evaluateInstanceDelete(change types.ResourceChange) types.RecoverabilityResult {
	before := change.Before
	if before == nil {
		return types.RecoverabilityResult{
			Tier:       types.NeedsReview,
			Label:      types.NeedsReview.String(),
			Reasoning:  "Cannot determine RDS instance state; no before values",
			Source:     "rules",
			Confidence: 0.3,
		}
	}

	// Check skip_final_snapshot
	skipFinalSnapshot := false
	if skip, ok := before["skip_final_snapshot"].(bool); ok && skip {
		skipFinalSnapshot = true
	}

	// Check deletion_protection
	deletionProtection := false
	if prot, ok := before["deletion_protection"].(bool); ok && prot {
		deletionProtection = true
	}

	// Check backup_retention_period
	backupRetention := 0
	if ret, ok := before["backup_retention_period"].(float64); ok {
		backupRetention = int(ret)
	}

	if deletionProtection {
		return types.RecoverabilityResult{
			Tier:       types.Reversible,
			Label:      types.Reversible.String(),
			Reasoning:  "RDS instance has deletion_protection enabled; delete will fail",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	if skipFinalSnapshot && backupRetention == 0 {
		return types.RecoverabilityResult{
			Tier:       types.Unrecoverable,
			Label:      types.Unrecoverable.String(),
			Reasoning:  "RDS instance delete with skip_final_snapshot=true and no automated backups; ALL DATA WILL BE LOST",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	if skipFinalSnapshot {
		return types.RecoverabilityResult{
			Tier:       types.RecoverableFromBackup,
			Label:      types.RecoverableFromBackup.String(),
			Reasoning:  "RDS instance delete with skip_final_snapshot=true but has automated backups; can restore from backup",
			Source:     "rules",
			Confidence: 0.9,
		}
	}

	// Final snapshot will be created
	return types.RecoverabilityResult{
		Tier:       types.RecoverableFromBackup,
		Label:      types.RecoverableFromBackup.String(),
		Reasoning:  "RDS instance delete will create final snapshot; can restore from snapshot",
		Source:     "rules",
		Confidence: 0.95,
	}
}

func (h *RDSHandler) evaluateClusterDelete(change types.ResourceChange) types.RecoverabilityResult {
	before := change.Before
	if before == nil {
		return types.RecoverabilityResult{
			Tier:       types.NeedsReview,
			Label:      types.NeedsReview.String(),
			Reasoning:  "Cannot determine RDS cluster state; no before values",
			Source:     "rules",
			Confidence: 0.3,
		}
	}

	skipFinalSnapshot := false
	if skip, ok := before["skip_final_snapshot"].(bool); ok && skip {
		skipFinalSnapshot = true
	}

	deletionProtection := false
	if prot, ok := before["deletion_protection"].(bool); ok && prot {
		deletionProtection = true
	}

	if deletionProtection {
		return types.RecoverabilityResult{
			Tier:       types.Reversible,
			Label:      types.Reversible.String(),
			Reasoning:  "RDS cluster has deletion_protection enabled; delete will fail",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	if skipFinalSnapshot {
		return types.RecoverabilityResult{
			Tier:       types.Unrecoverable,
			Label:      types.Unrecoverable.String(),
			Reasoning:  "RDS cluster delete with skip_final_snapshot=true; ALL DATA WILL BE LOST",
			Source:     "rules",
			Confidence: 1.0,
		}
	}

	return types.RecoverabilityResult{
		Tier:       types.RecoverableFromBackup,
		Label:      types.RecoverableFromBackup.String(),
		Reasoning:  "RDS cluster delete will create final snapshot; can restore from snapshot",
		Source:     "rules",
		Confidence: 0.95,
	}
}

func (h *RDSHandler) evaluateSnapshotDelete(change types.ResourceChange) types.RecoverabilityResult {
	return types.RecoverabilityResult{
		Tier:       types.Unrecoverable,
		Label:      types.Unrecoverable.String(),
		Reasoning:  "Deleting RDS snapshot permanently destroys this backup point",
		Source:     "rules",
		Confidence: 1.0,
	}
}
