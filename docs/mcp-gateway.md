# MCP Gateway Mode

RecourseOS can operate as an MCP gateway, intercepting all tool calls and evaluating them before forwarding to upstream servers.

**This is in-line enforcement** - dangerous tool calls are blocked before they can execute.

## Architecture

```
┌─────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   Agent     │────▶│  RecourseOS Gateway │────▶│ Upstream MCP    │
│  (Claude)   │     │                     │     │ Servers         │
└─────────────┘     └─────────────────────┘     └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Risk Assessment │
                    │ allow → forward │
                    │ block → error   │
                    └─────────────────┘
```

## Quick Start

### 1. Create Gateway Config

```json
{
  "upstreams": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "/path/to/allowed"]
    },
    {
      "name": "aws",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-aws"]
    }
  ],
  "allowedRiskLevels": ["allow", "warn"],
  "verbose": true
}
```

### 2. Start the Gateway

```bash
recourse mcp gateway --config gateway.json
```

### 3. Configure Claude Desktop

Point Claude at the gateway instead of individual servers:

```json
{
  "mcpServers": {
    "recourse-gateway": {
      "command": "recourse",
      "args": ["mcp", "gateway", "--config", "/path/to/gateway.json"]
    }
  }
}
```

## CLI Options

```bash
recourse mcp gateway [options]

Options:
  -c, --config <file>    Path to gateway config JSON
  -v, --verbose          Log evaluations to stderr
  --allow <levels>       Risk levels to allow (default: allow,warn)
  --upstream <json>      Inline upstream server config
```

## Configuration Reference

### Gateway Config

```typescript
interface GatewayConfig {
  // Upstream MCP servers to proxy
  upstreams: UpstreamServer[];

  // Risk levels that proceed to upstream
  // "allow" - Safe operations only
  // "allow,warn" - Safe + recoverable (default)
  // "allow,warn,escalate" - Only block truly dangerous
  // "allow,warn,escalate,block" - Audit-only mode
  allowedRiskLevels: ('allow' | 'warn' | 'escalate' | 'block')[];

  // Log evaluations to stderr
  verbose?: boolean;

  // Generate signed attestations
  attestation?: boolean;
}
```

### Upstream Server Config

```typescript
interface UpstreamServer {
  name: string;           // Display name
  command: string;        // Executable
  args?: string[];        // Arguments
  env?: Record<string, string>;  // Environment variables
}
```

## How It Works

1. **Agent connects** to RecourseOS gateway as its MCP server
2. **Gateway discovers tools** from all upstream servers
3. **Agent sees aggregated tools** from all upstreams
4. **Agent calls a tool** (e.g., `aws_s3_delete_bucket`)
5. **Gateway evaluates** the call with RecourseOS
6. **If safe**: Forward to upstream, return result
7. **If dangerous**: Return error with explanation

## Example: Blocked Operation

When an agent tries a dangerous operation:

```
Agent: tools/call aws_s3_delete_bucket {bucket: "prod-data"}

Gateway evaluates...
Risk: BLOCK - Unrecoverable data loss

Response to agent:
{
  "error": {
    "code": -32000,
    "message": "RecourseOS BLOCKED: S3 bucket deletion without versioning enabled",
    "data": {
      "riskAssessment": "block",
      "attestation": "https://localhost:3001/.well-known/attestations/abc123.json",
      "mutations": [...]
    }
  }
}
```

## Example: Allowed Operation

When an agent tries a safe operation:

```
Agent: tools/call read_file {path: "/docs/readme.md"}

Gateway evaluates...
Risk: ALLOW - Read-only operation

Response to agent:
{
  "result": {
    "content": "# README...",
    "_recourse": {
      "attestation_uri": "https://...",
      "risk_assessment": "allow"
    }
  }
}
```

## Built-in Tools

The gateway adds its own tools:

### recourse_gateway_status

Returns gateway configuration and connected upstreams:

```json
{
  "gateway": "recourse",
  "version": "0.1.0",
  "upstreams": [
    {"name": "filesystem", "tools": 5},
    {"name": "aws", "tools": 23}
  ],
  "policy": {
    "allowedRiskLevels": ["allow", "warn"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RECOURSE_UPSTREAMS` | JSON array of upstream servers |
| `RECOURSE_ALLOWED_LEVELS` | Comma-separated allowed risk levels |
| `RECOURSE_VERBOSE` | Enable verbose logging (`true`/`false`) |

## Security Considerations

### Fail-Open vs Fail-Closed

By default, the gateway **fails open** if RecourseOS evaluation errors occur. This prevents blocking the agent entirely. For high-security environments, you can configure fail-closed behavior.

### Audit Trail

Every tool call produces a signed attestation with:
- What tool was called
- What arguments were passed
- What the risk assessment was
- Whether it was allowed or blocked

### Bypass Prevention

Unlike client-side evaluation, gateway mode cannot be bypassed by the agent. The agent has no direct connection to upstream servers.

## Comparison: MCP Server vs Gateway Mode

| Feature | MCP Server Mode | Gateway Mode |
|---------|-----------------|--------------|
| Agent calls RecourseOS | Voluntarily | All calls intercepted |
| Can be bypassed | Yes | No |
| Requires agent cooperation | Yes | No |
| Works with any MCP tools | Manual integration | Automatic |
| Enforcement level | Advisory | In-line |

## Production Deployment

For production, deploy the gateway as a service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recourse-gateway
spec:
  template:
    spec:
      containers:
        - name: gateway
          image: ghcr.io/recourseos/recourse:latest
          args: ["mcp", "gateway", "--config", "/etc/recourse/gateway.json"]
          volumeMounts:
            - name: config
              mountPath: /etc/recourse
```

## Next Steps

- [Attestation Protocol](./attestation-protocol-design.md) - Understand the cryptographic signatures
- [Resource Coverage](./resource-coverage.html) - See which resources are evaluated
- [CLI Reference](./cli.md) - Full command documentation
