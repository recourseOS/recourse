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
shellDecision=escalate
terraformDecision=block
```

The exact shell riskAssessment can vary as evidence support expands, but it should always be one of `allow`, `warn`, `block`, or `escalate`.

## Available Tools

| Tool | Purpose |
| --- | --- |
| `recourse_evaluate_terraform` | Evaluate Terraform plan JSON before apply. |
| `recourse_evaluate_shell` | Evaluate a shell command before execution. |
| `recourse_evaluate_mcp_call` | Evaluate another MCP tool call before invoking it. |
| `recourse_supported_resources` | List deterministic resource handler coverage. |

## Agent Behavior

Agents should treat RecourseOS as a pre-action consequence check:

- Do not execute when `riskAssessment` is `block`.
- Ask for human review when `riskAssessment` is `escalate`.
- Surface recovery requirements when `riskAssessment` is `warn`.
- Prefer structured fields over parsing explanation text.
- Preserve `missingEvidence` in user-facing review requests.

## Example Agent Prompt

```text
Before applying infrastructure changes, call RecourseOS. If the riskAssessment is block, stop. If the riskAssessment is escalate, ask me for review and include the missing evidence. If the riskAssessment is warn, summarize the recovery requirement before continuing.
```
