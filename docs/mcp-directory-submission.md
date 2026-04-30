# MCP Directory Submission Draft

This is the draft PR for submitting RecourseOS to the [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) repository.

---

## PR Title

Add RecourseOS - consequence analysis for AI agents

## PR Description

RecourseOS is an MCP server that evaluates proposed actions before execution and returns structured consequence reports. It helps agents avoid unrecoverable mistakes by checking Terraform plans, shell commands, and other MCP tool calls before they run.

**What it does:**
- Analyzes Terraform plans before `terraform apply`
- Evaluates shell commands (aws, kubectl, rm, etc.) before execution
- Checks other MCP tool calls before invocation
- Returns decision (`allow`, `warn`, `escalate`, `block`) with recoverability tier and evidence

**Why it matters:**
Agents are getting a bad rap for causing infrastructure damage. RecourseOS gives them a way to check consequences before acting, not after.

## Entry to add to README.md

Add under the appropriate category (likely "Developer Tools" or a new "Infrastructure" category):

```markdown
### RecourseOS

Consequence analysis for AI agents. Evaluates Terraform plans, shell commands, and MCP tool calls before execution. Returns structured reports with recoverability tier (reversible/recoverable/unrecoverable) and decision (allow/warn/escalate/block).

**Tools:**
- `recourse_evaluate_terraform` - Check Terraform plans before apply
- `recourse_evaluate_shell` - Check shell commands before execution
- `recourse_evaluate_mcp_call` - Check other MCP tool calls before invocation
- `recourse_supported_resources` - List resources with deterministic rules

**Links:**
- [GitHub](https://github.com/recourseOS/recourse)
- [npm](https://www.npmjs.com/package/recourse-cli)
- [Documentation](https://recourseos.github.io/recourse/)

**Quick Start:**
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
```

## Checklist before submitting

- [x] MCP server works (`recourse mcp serve`)
- [x] Published to npm (`recourse-cli@0.1.5`)
- [x] README has prominent MCP section
- [x] Tool descriptions optimized for agent adoption
- [x] Tested against real AWS infrastructure
- [x] Tested MCP integration with Claude Code
- [ ] GitHub repo is public
- [ ] Documentation site is live (if linking to it)

## Notes

- The repo URL assumes `github.com/recourseOS/recourse` - update if different
- The documentation link assumes GitHub Pages - remove if not set up
- Consider which category fits best in the servers README
