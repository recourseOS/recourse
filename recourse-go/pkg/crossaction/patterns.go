// Package crossaction implements cross-action pattern detection.
//
// Cross-action patterns are dangerous combinations of changes that
// individually might be safe but together represent elevated risk.
package crossaction

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// Confidence levels for relationship detection
type Confidence string

const (
	ConfidenceDefinite Confidence = "definite"
	ConfidenceProbable Confidence = "probable"
	ConfidencePossible Confidence = "possible"
)

// Relationship describes the connection between two resources.
type Relationship struct {
	Type            string     // "backup", "replica", "protection"
	Source          string     // Source resource address
	Target          string     // Target resource address
	DetectionMethod string     // How the relationship was detected
	Confidence      Confidence // Confidence level
}

// PatternMatch represents a detected cross-action pattern.
type PatternMatch struct {
	PatternID         string
	PatternName       string
	Explanation       string
	AffectedResources []string
	Relationship      Relationship
	UpgradeTier       types.RecoverabilityTier
}

// Analyzer detects cross-action patterns in Terraform plans.
type Analyzer struct{}

// NewAnalyzer creates a new cross-action analyzer.
func NewAnalyzer() *Analyzer {
	return &Analyzer{}
}

// Analyze detects all cross-action patterns in a set of resource changes.
func (a *Analyzer) Analyze(changes []types.ResourceChange) []PatternMatch {
	var matches []PatternMatch

	// Pattern 1: Backup and protected resource both deleted
	matches = append(matches, a.detectBackupAndProtectedDeleted(changes)...)

	// Pattern 2: Replica and primary both deleted
	matches = append(matches, a.detectReplicaAndPrimaryDeleted(changes)...)

	// Pattern 3: Protection disabled then deleted
	matches = append(matches, a.detectProtectionDisabledThenDeleted(changes)...)

	return matches
}

// detectBackupAndProtectedDeleted finds cases where a snapshot is deleted
// along with the resource it backs up.
func (a *Analyzer) detectBackupAndProtectedDeleted(changes []types.ResourceChange) []PatternMatch {
	var matches []PatternMatch

	// Find all deletions
	var snapshotDeletions []types.ResourceChange
	var instanceDeletions []types.ResourceChange
	deletedInstanceIds := make(map[string]string) // id -> address

	for _, c := range changes {
		if !isDelete(c) {
			continue
		}

		switch c.Type {
		case "aws_db_snapshot", "aws_ebs_snapshot", "aws_rds_cluster_snapshot":
			snapshotDeletions = append(snapshotDeletions, c)
		case "aws_db_instance", "aws_instance", "aws_rds_cluster":
			instanceDeletions = append(instanceDeletions, c)
			id := getResourceIdentifier(c)
			if id != "" {
				deletedInstanceIds[id] = c.Address
			}
		}
	}

	// Check each snapshot for relationship to deleted instance
	for _, snapshot := range snapshotDeletions {
		snapshotSourceId := getSnapshotSourceId(snapshot)
		if snapshotSourceId == "" {
			continue
		}

		if instanceAddr, found := deletedInstanceIds[snapshotSourceId]; found {
			matches = append(matches, PatternMatch{
				PatternID:   "backup_and_protected_both_deleted",
				PatternName: "Backup and protected resource both deleted",
				Explanation: "The backup '" + snapshot.Address + "' is being deleted in the same plan as the resource it backs up ('" + instanceAddr + "'). Recovery from this backup would not be possible after this plan applies.",
				AffectedResources: []string{instanceAddr, snapshot.Address},
				Relationship: Relationship{
					Type:            "backup",
					Source:          snapshot.Address,
					Target:          instanceAddr,
					DetectionMethod: "explicit_reference",
					Confidence:      ConfidenceDefinite,
				},
				UpgradeTier: types.Unrecoverable,
			})
		}
	}

	return matches
}

// detectReplicaAndPrimaryDeleted finds cases where both a replica and its
// primary database are being deleted.
func (a *Analyzer) detectReplicaAndPrimaryDeleted(changes []types.ResourceChange) []PatternMatch {
	var matches []PatternMatch

	// Find all DB deletions
	var dbDeletions []types.ResourceChange
	deletedPrimaryIds := make(map[string]string) // id -> address

	for _, c := range changes {
		if !isDelete(c) {
			continue
		}

		if c.Type == "aws_db_instance" || c.Type == "aws_rds_cluster" {
			dbDeletions = append(dbDeletions, c)
			id := getResourceIdentifier(c)
			if id != "" {
				deletedPrimaryIds[id] = c.Address
			}
		}
	}

	// Check each deletion for replica relationship
	for _, db := range dbDeletions {
		replicaSourceId := getReplicaSourceId(db)
		if replicaSourceId == "" {
			continue
		}

		if primaryAddr, found := deletedPrimaryIds[replicaSourceId]; found {
			matches = append(matches, PatternMatch{
				PatternID:   "replica_and_primary_both_deleted",
				PatternName: "Replica and primary both deleted",
				Explanation: "The replica '" + db.Address + "' is being deleted in the same plan as its primary ('" + primaryAddr + "'). All copies of the data would be lost after this plan applies.",
				AffectedResources: []string{primaryAddr, db.Address},
				Relationship: Relationship{
					Type:            "replica",
					Source:          db.Address,
					Target:          primaryAddr,
					DetectionMethod: "explicit_reference",
					Confidence:      ConfidenceDefinite,
				},
				UpgradeTier: types.Unrecoverable,
			})
		}
	}

	return matches
}

// detectProtectionDisabledThenDeleted finds cases where deletion protection
// is disabled and the resource is deleted in the same plan.
func (a *Analyzer) detectProtectionDisabledThenDeleted(changes []types.ResourceChange) []PatternMatch {
	var matches []PatternMatch

	// Group changes by address
	changesByAddress := make(map[string][]types.ResourceChange)
	for _, c := range changes {
		changesByAddress[c.Address] = append(changesByAddress[c.Address], c)
	}

	// Find resources with both update and delete actions
	for address, addressChanges := range changesByAddress {
		var hasUpdate, hasDelete bool
		var updateChange types.ResourceChange

		for _, c := range addressChanges {
			if isUpdate(c) {
				hasUpdate = true
				updateChange = c
			}
			if isDelete(c) {
				hasDelete = true
			}
		}

		if !hasUpdate || !hasDelete {
			continue
		}

		// Check if update disabled deletion protection
		beforeProtection, beforeOk := updateChange.Before["deletion_protection"].(bool)
		afterProtection, afterOk := updateChange.After["deletion_protection"].(bool)

		if beforeOk && afterOk && beforeProtection && !afterProtection {
			matches = append(matches, PatternMatch{
				PatternID:   "protection_disabled_then_deleted",
				PatternName: "Protection disabled then resource deleted",
				Explanation: "Deletion protection was disabled and the resource '" + address + "' was deleted in the same plan. This bypasses the protection mechanism designed to prevent accidental deletion.",
				AffectedResources: []string{address},
				Relationship: Relationship{
					Type:            "protection",
					Source:          address,
					Target:          address,
					DetectionMethod: "explicit_reference",
					Confidence:      ConfidenceDefinite,
				},
				UpgradeTier: types.Unrecoverable,
			})
		}
	}

	return matches
}

// Helper functions

func isDelete(c types.ResourceChange) bool {
	for _, action := range c.Actions {
		if action == types.ActionDelete {
			return true
		}
	}
	return false
}

func isUpdate(c types.ResourceChange) bool {
	for _, action := range c.Actions {
		if action == types.ActionUpdate {
			return true
		}
	}
	return false
}

func getResourceIdentifier(c types.ResourceChange) string {
	if c.Before == nil {
		return c.Name
	}
	if id, ok := c.Before["identifier"].(string); ok {
		return id
	}
	if id, ok := c.Before["id"].(string); ok {
		return id
	}
	return c.Name
}

func getSnapshotSourceId(c types.ResourceChange) string {
	if c.Before == nil {
		return ""
	}
	// For RDS snapshots
	if id, ok := c.Before["db_instance_identifier"].(string); ok {
		return id
	}
	// For EBS snapshots
	if id, ok := c.Before["volume_id"].(string); ok {
		return id
	}
	// For RDS cluster snapshots
	if id, ok := c.Before["db_cluster_identifier"].(string); ok {
		return id
	}
	return ""
}

func getReplicaSourceId(c types.ResourceChange) string {
	if c.Before == nil {
		return ""
	}
	// For RDS read replicas
	if id, ok := c.Before["replicate_source_db"].(string); ok {
		return id
	}
	// For Aurora replicas
	if id, ok := c.Before["replication_source_identifier"].(string); ok {
		return id
	}
	return ""
}
