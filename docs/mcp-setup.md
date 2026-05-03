# MCP Setup

RecourseOS runs as an MCP server so AI agents can check consequences before they act. One config block, and your agent knows what's recoverable before it touches infrastructure.

## Quick Start

Add RecourseOS to your agent's MCP config:

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

Then tell the agent to check before destructive commands:

```
Use RecourseOS to check before running: rm -rf /tmp/test
```

## Agent Setup Guides

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

### Config

```bash
claude mcp add recourseos --transport stdio -- npx -y recourse-cli@latest mcp serve
```

Or add to your project's `.mcp.json`:

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

### Making it automatic

Claude Code supports hooks. You can configure a pre-execution hook to check RecourseOS before shell commands (coming soon).

### Verify

```bash
claude mcp list
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

### Config file location

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Add RecourseOS

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

### Restart required

Claude Desktop reads the config file once at startup. After editing, fully quit and reopen the app.

### Usage

Tell Claude to check before destructive commands:

```
Use RecourseOS to check before running: rm -rf /tmp/test
```

</details>

<details>
<summary><strong>Cline (VS Code)</strong></summary>

### Config file location

- **macOS/Linux**: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows**: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

### Add RecourseOS

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

### No persistent instructions

Cline doesn't have persistent custom instructions. Tell Cline explicitly each time:

```
Use RecourseOS to check before running: rm -rf /tmp/test
```

Or start your session with:

```
For this session, check recourse_evaluate_shell before any destructive commands.
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

### Config file location

- **Global**: `~/.cursor/mcp.json`
- **Project-scoped**: `.cursor/mcp.json` (in project root)

### Add RecourseOS

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

### No restart needed

Unlike Claude Desktop, Cursor picks up config changes automatically.

### Agent instructions

Add to your project's `.cursorrules`:

```
Before executing shell commands that delete or modify files, call recourse_evaluate_shell. Follow the riskAssessment field.
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

### Config file location

`~/.codeium/windsurf/mcp_config.json`

### Add RecourseOS

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

### Access settings

Open settings via "Windsurf - Settings" button (bottom right), or press `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows/Linux) and search "Open Windsurf Settings." Navigate to Advanced Settings > Cascade.

</details>

<details>
<summary><strong>Continue (VS Code / JetBrains)</strong></summary>

### Config file location

`~/.continue/config.json` or `~/.continue/config.yaml`

### Add RecourseOS

**Important**: Continue uses an **array** format (not an object like other clients):

```json
{
  "mcpServers": [
    {
      "name": "recourseos",
      "command": "npx",
      "args": ["-y", "recourse-cli@latest", "mcp", "serve"]
    }
  ]
}
```

</details>

<details>
<summary><strong>Zed</strong></summary>

### Config file location

`~/.config/zed/settings.json`

### Add RecourseOS

Zed uses a different key (`context_servers`) and structure:

```json
{
  "context_servers": {
    "recourseos": {
      "command": {
        "path": "npx",
        "args": ["-y", "recourse-cli@latest", "mcp", "serve"]
      }
    }
  }
}
```

</details>

<details>
<summary><strong>JetBrains AI Assistant</strong></summary>

### Config location

Settings > Tools > AI Assistant > Model Context Protocol (MCP)

### Add RecourseOS

In the MCP settings dialog, add a new server with:

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

</details>

<details>
<summary><strong>Other MCP Clients</strong></summary>

### Standard config format

Most MCP clients accept this shape:

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

### If globally installed

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

### Agent instructions

Add to the agent's system prompt:

```
Before executing destructive operations, call RecourseOS.
If riskAssessment is block, stop.
If riskAssessment is escalate, ask me for review.
If riskAssessment is warn, summarize the recovery requirement before continuing.
```

Or instruct the agent to read `recourse://instructions` for the full protocol.

</details>

## Shell Wrapper (No Agent Config Needed)

Wrap dangerous shell commands so they automatically check RecourseOS before executing. Works in your terminal, but **not** inside agents like Cline that spawn their own shell.

Add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
eval "$(recourse wrap)"
```

Or with npx:

```bash
eval "$(npx -y recourse-cli@latest wrap)"
```

Now commands like `rm`, `aws`, `kubectl`, and `terraform` check RecourseOS first:

```bash
rm -rf /tmp/important
# recourse: escalate - Recoverability needs human review
#   └─ /tmp/important: needs-review
# Proceed? [y/N]
```

Customize which commands are wrapped:

```bash
eval "$(recourse wrap --commands rm,aws,kubectl)"
```

To bypass RecourseOS for a specific command:

```bash
command rm -rf /tmp/skip-check
```

## Verify the Wiring

Run the smoke test:

```bash
npm run mcp:smoke
```

Expected output:

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

| Type | Name | Purpose |
| --- | --- | --- |
| Resource | `recourse://instructions` | Safety protocol for agents |
| Prompt | `recourse_agent_instructions` | Same content as a prompt template |

## Attestation

Every evaluation response includes a cryptographic attestation (Ed25519 signature). Always enabled.

Verify attestations:
- `recourse verify attestation.json` — CLI verification
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
