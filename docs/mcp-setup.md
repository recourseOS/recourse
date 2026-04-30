# MCP Setup

RecourseOS runs as a local MCP stdio server. Agents can call it before executing Terraform, shell, or tool mutations.

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
      "args": ["-y", "recourse-cli", "mcp", "serve"]
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

The exact shell decision can vary as evidence support expands, but it should always be one of `allow`, `warn`, `block`, or `escalate`.

## Available Tools

| Tool | Purpose |
| --- | --- |
| `recourse_evaluate_terraform` | Evaluate Terraform plan JSON before apply. |
| `recourse_evaluate_shell` | Evaluate a shell command before execution. |
| `recourse_evaluate_mcp_call` | Evaluate another MCP tool call before invoking it. |
| `recourse_supported_resources` | List deterministic resource handler coverage. |

## Agent Behavior

Agents should treat RecourseOS as a pre-action consequence check:

- Do not execute when `decision` is `block`.
- Ask for human review when `decision` is `escalate`.
- Surface recovery requirements when `decision` is `warn`.
- Prefer structured fields over parsing explanation text.
- Preserve `missingEvidence` in user-facing review requests.

## Example Agent Prompt

```text
Before applying infrastructure changes, call RecourseOS. If the decision is block, stop. If the decision is escalate, ask me for review and include the missing evidence. If the decision is warn, summarize the recovery requirement before continuing.
```
