# MCP Setup

RecourseOS runs as an MCP server so AI agents can check consequences before they act. One config block, and your agent knows what's recoverable before it touches infrastructure.

## Start the Server

For an installed CLI:

```bash
recourse mcp serve
```

For local development:

```bash
npm run build
node dist/index.js mcp serve
```

## MCP Client Config

Most MCP clients that support stdio servers accept this shape:

```json
{
  "mcpServers": {
    "recourseos": {
      "command": "recourse",
      "args": ["mcp", "serve"]
    }
  }
}
```

If the CLI is not installed globally, use `npx`:

```json
{
  "mcpServers": {
    "recourseos": {
      "command": "npx",
      "args": ["-y", "recourse-cli@latest", "mcp", "serve"]
    }
  }
}
```

Local development config:

```json
{
  "mcpServers": {
    "recourseos": {
      "command": "node",
      "args": ["dist/index.js", "mcp", "serve"]
    }
  }
}
```

Example files are available in `examples/mcp/`.

## Verify the Wiring

Run the local smoke test:

```bash
npm run mcp:smoke
```

The smoke test starts `recourse mcp serve`, lists tools, calls `recourse_supported_resources`, evaluates a destructive shell command, and evaluates a Terraform fixture.

Expected output includes:

```text
MCP smoke test passed
tools=5
resources=175
shellRiskAssessment=escalate
terraformRiskAssessment=block
```

## Available Tools

| Tool | Purpose |
| --- | --- |
| `recourse_evaluate_terraform` | Evaluate Terraform plan JSON before apply |
| `recourse_evaluate_shell` | Evaluate a shell command before execution |
| `recourse_evaluate_mcp_call` | Evaluate another MCP tool call before invoking it |
| `recourse_evaluate_with_evidence` | Re-evaluate with verification evidence |
| `recourse_supported_resources` | List deterministic resource handler coverage |

## Resources & Prompts

The server also exposes:

| Type | Name | Purpose |
| --- | --- | --- |
| Resource | `recourse://instructions` | Safety protocol for agents |
| Prompt | `recourse_agent_instructions` | Same content as a prompt template |

Agents can read `recourse://instructions` to learn when to call RecourseOS and how to interpret results.

## Attestation

Every evaluation response includes a cryptographic attestation — an Ed25519 signature over the input and output. This is always enabled; there's no opt-out.

Attestations can be verified via:
- `GET /.well-known/recourse-keys.json` — public key registry
- `GET /.well-known/attestations/{id}.json` — individual attestations

## Agent Behavior

Agents should treat RecourseOS as a pre-action consequence check:

- **allow**: Safe to proceed
- **warn**: Proceed with caution, inform user
- **escalate**: Stop and ask user for explicit approval
- **block**: Do not proceed without human review

If `escalate` or `block` includes `verificationSuggestions`:
1. Run the suggested verification commands
2. Call `recourse_evaluate_with_evidence` with the results
3. The assessment may upgrade if evidence confirms recovery paths

## Example Agent Prompt

```text
Before executing destructive operations, call RecourseOS.
If riskAssessment is block, stop.
If riskAssessment is escalate, ask me for review.
If riskAssessment is warn, summarize the recovery requirement before continuing.
```

Or read the built-in instructions from `recourse://instructions`.
