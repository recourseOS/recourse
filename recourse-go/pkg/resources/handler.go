// Package resources provides resource-specific recoverability handlers.
package resources

import (
	"github.com/recourseOS/recourse-go/pkg/types"
)

// Handler evaluates recoverability for specific resource types.
type Handler interface {
	// ResourceTypes returns the Terraform resource types this handler covers.
	ResourceTypes() []string

	// GetRecoverability evaluates the recoverability of a change.
	GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult
}

// Registry maps resource types to handlers.
type Registry struct {
	handlers map[string]Handler
	fallback Handler
}

// NewRegistry creates a new handler registry with all built-in handlers.
func NewRegistry() *Registry {
	r := &Registry{
		handlers: make(map[string]Handler),
		fallback: &DefaultHandler{},
	}

	// Register all handlers
	handlers := []Handler{
		NewS3Handler(),
		NewRDSHandler(),
		NewSQSHandler(),
		NewSNSHandler(),
		NewEC2Handler(),
		NewIAMHandler(),
		NewLambdaHandler(),
		NewDynamoDBHandler(),
	}

	for _, h := range handlers {
		for _, rt := range h.ResourceTypes() {
			r.handlers[rt] = h
		}
	}

	return r
}

// GetHandler returns the handler for a resource type.
func (r *Registry) GetHandler(resourceType string) Handler {
	if h, ok := r.handlers[resourceType]; ok {
		return h
	}
	return r.fallback
}

// DefaultHandler provides conservative defaults for unknown resource types.
type DefaultHandler struct{}

func (h *DefaultHandler) ResourceTypes() []string {
	return nil // Fallback handler
}

func (h *DefaultHandler) GetRecoverability(change types.ResourceChange, state *types.TerraformState) types.RecoverabilityResult {
	// Check if this is a delete action
	for _, action := range change.Actions {
		if action == types.ActionDelete {
			return types.RecoverabilityResult{
				Tier:       types.RecoverableWithEffort,
				Label:      types.RecoverableWithEffort.String(),
				Reasoning:  "Unknown resource type; assuming recoverable with effort for deletes",
				Source:     "default",
				Confidence: 0.5,
			}
		}
	}

	// Updates and creates are generally reversible
	return types.RecoverabilityResult{
		Tier:       types.Reversible,
		Label:      types.Reversible.String(),
		Reasoning:  "Unknown resource type; updates and creates are generally reversible",
		Source:     "default",
		Confidence: 0.5,
	}
}
