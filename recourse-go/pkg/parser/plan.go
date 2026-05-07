// Package parser handles Terraform plan JSON parsing.
package parser

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/recourseOS/recourse-go/pkg/types"
)

// rawPlan is the raw JSON structure from terraform show -json
type rawPlan struct {
	FormatVersion    string             `json:"format_version"`
	TerraformVersion string             `json:"terraform_version"`
	ResourceChanges  []rawResourceChange `json:"resource_changes"`
	PriorState       *rawState          `json:"prior_state,omitempty"`
}

type rawResourceChange struct {
	Address      string    `json:"address"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	ProviderName string    `json:"provider_name"`
	Change       rawChange `json:"change"`
}

type rawChange struct {
	Actions      []string               `json:"actions"`
	Before       map[string]interface{} `json:"before"`
	After        map[string]interface{} `json:"after"`
	AfterUnknown map[string]interface{} `json:"after_unknown"`
}

type rawState struct {
	FormatVersion    string         `json:"format_version"`
	TerraformVersion string         `json:"terraform_version"`
	Values           rawStateValues `json:"values"`
}

type rawStateValues struct {
	RootModule rawStateModule `json:"root_module"`
}

type rawStateModule struct {
	Resources    []rawStateResource `json:"resources"`
	ChildModules []rawStateModule   `json:"child_modules,omitempty"`
}

type rawStateResource struct {
	Address      string                 `json:"address"`
	Type         string                 `json:"type"`
	Name         string                 `json:"name"`
	ProviderName string                 `json:"provider_name"`
	Values       map[string]interface{} `json:"values"`
	DependsOn    []string               `json:"depends_on,omitempty"`
}

// ParsePlanFile reads and parses a Terraform plan JSON file.
func ParsePlanFile(path string) (*types.TerraformPlan, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open plan file: %w", err)
	}
	defer f.Close()
	return ParsePlan(f)
}

// ParsePlan parses Terraform plan JSON from a reader.
func ParsePlan(r io.Reader) (*types.TerraformPlan, error) {
	var raw rawPlan
	if err := json.NewDecoder(r).Decode(&raw); err != nil {
		return nil, fmt.Errorf("failed to parse plan JSON: %w", err)
	}
	return convertPlan(&raw), nil
}

// ParsePlanBytes parses Terraform plan JSON from bytes.
func ParsePlanBytes(data []byte) (*types.TerraformPlan, error) {
	var raw rawPlan
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse plan JSON: %w", err)
	}
	return convertPlan(&raw), nil
}

func convertPlan(raw *rawPlan) *types.TerraformPlan {
	plan := &types.TerraformPlan{
		FormatVersion:    raw.FormatVersion,
		TerraformVersion: raw.TerraformVersion,
		ResourceChanges:  make([]types.ResourceChange, 0, len(raw.ResourceChanges)),
	}

	for _, rc := range raw.ResourceChanges {
		actions := make([]types.TerraformAction, 0, len(rc.Change.Actions))
		for _, a := range rc.Change.Actions {
			actions = append(actions, types.TerraformAction(a))
		}

		plan.ResourceChanges = append(plan.ResourceChanges, types.ResourceChange{
			Address:      rc.Address,
			Type:         rc.Type,
			Name:         rc.Name,
			ProviderName: rc.ProviderName,
			Actions:      actions,
			Before:       rc.Change.Before,
			After:        rc.Change.After,
			AfterUnknown: rc.Change.AfterUnknown,
		})
	}

	if raw.PriorState != nil {
		plan.PriorState = convertState(raw.PriorState)
	}

	return plan
}

func convertState(raw *rawState) *types.TerraformState {
	return &types.TerraformState{
		FormatVersion:    raw.FormatVersion,
		TerraformVersion: raw.TerraformVersion,
		Values: types.StateValues{
			RootModule: convertModule(&raw.Values.RootModule),
		},
	}
}

func convertModule(raw *rawStateModule) types.StateModule {
	mod := types.StateModule{
		Resources: make([]types.StateResource, 0, len(raw.Resources)),
	}

	for _, r := range raw.Resources {
		mod.Resources = append(mod.Resources, types.StateResource{
			Address:      r.Address,
			Type:         r.Type,
			Name:         r.Name,
			ProviderName: r.ProviderName,
			Values:       r.Values,
			DependsOn:    r.DependsOn,
		})
	}

	for _, child := range raw.ChildModules {
		mod.ChildModules = append(mod.ChildModules, convertModule(&child))
	}

	return mod
}
