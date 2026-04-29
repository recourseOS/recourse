# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**recourseOS** is a consequence-evaluation layer for AI agents and automation. It intercepts tool calls that mutate state (from MCP servers, Terraform, kubectl, etc.), evaluates their blast radius against live system state, and either auto-approves, blocks, or escalates to humans with consequences spelled out.

Key distinction: This is NOT an identity/permissions tool or model gateway. It works downstream of those, answering: "Given current state, what does this call actually do, and is it recoverable?"

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm test             # Run tests with vitest
npm run lint         # ESLint

# CLI usage (after build)
node dist/index.js plan <plan.json> [--state <state.json>] [--format human|json]
node dist/index.js resources   # List supported resource types
```

## Architecture

```
src/
├── index.ts / cli.ts       # CLI entry point (Commander.js)
├── parsers/
│   ├── plan.ts             # Terraform plan JSON parser
│   └── state.ts            # Terraform state JSON parser
├── analyzer/
│   ├── blast-radius.ts     # Main analysis orchestration
│   ├── dependencies.ts     # Resource dependency graph
│   └── recoverability.ts   # Re-exports from resources
├── resources/
│   ├── types.ts            # Core types: RecoverabilityTier, ResourceHandler, etc.
│   ├── index.ts            # Resource handler registry
│   └── aws/*.ts            # Per-service handlers (s3, rds, ec2, iam, lambda, vpc, etc.)
└── output/
    ├── human.ts            # Colored terminal output
    └── json.ts             # Structured JSON output
```

## Key Concepts

**Recoverability Tiers** (defined in `src/resources/types.ts`):
1. `REVERSIBLE` - Can undo with another API call
2. `RECOVERABLE_WITH_EFFORT` - Can recreate but requires work
3. `RECOVERABLE_FROM_BACKUP` - Needs snapshot/backup to restore
4. `UNRECOVERABLE` - Data is permanently lost

**Resource Handlers**: Each AWS service has a handler in `src/resources/aws/` that implements:
- `getRecoverability(change, state)` - Determines tier based on resource config
- `getDependencies(resource, allResources)` - Finds implicit references

**Unknown-resource classification**: `src/classifier/` currently ships a zero-dependency decision tree for unknown resource types. The decision tree is a baseline for abstract feature transfer, not the safety authority. The planned BitNet integration should replace the decision tree for unknown resources only; AWS handlers remain authoritative and should continue to provide traced, deterministic verdicts.

**Adding a new resource type**: Create a handler in `src/resources/aws/`, implement the `ResourceHandler` interface, add it to the registry in `src/resources/index.ts`.

## Current Scope (v0.1)

- Terraform plan analysis only (AWS provider)
- 70 AWS resource types supported
- CLI tool (`blast plan`)
- Experimental unknown-resource classifier for GCP/Azure patterns
- BitNet is the intended future classifier for multi-cloud unknowns
- No MCP server, CI/CD integration, or approval flows yet
