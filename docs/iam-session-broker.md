# IAM Session Broker

RecourseOS can act as an IAM session broker, issuing time-limited, scoped credentials to agents based on their declared intent.

**This is the "right to act" paradigm** - agents must earn access per operation through RecourseOS evaluation.

## Why Use a Session Broker?

Traditional approach:
```
Agent has long-lived AWS credentials
  → Can do anything the role allows
  → No per-operation visibility
  → Credentials can be leaked/misused
```

With RecourseOS Session Broker:
```
Agent requests credentials for specific operation
  → RecourseOS evaluates intent
  → If approved: scoped, time-limited credentials
  → If denied: no credentials issued
  → Full audit trail
```

## Quick Start

### 1. Set Up Broker Role

Create an AWS role that the broker will assume to issue credentials:

```bash
# The broker needs sts:AssumeRole permission
aws iam create-role \
  --role-name RecourseSessionBroker \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "sts.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Allow the broker to assume other roles (the ones agents will get)
aws iam put-role-policy \
  --role-name RecourseSessionBroker \
  --policy-name AssumeAgentRoles \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::*:role/RecourseAgent*"
    }]
  }'
```

### 2. Set Up Agent Role

Create a role that agents can assume (with broad permissions - the broker will scope them down):

```bash
aws iam create-role \
  --role-name RecourseAgentWorker \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::ACCOUNT:role/RecourseSessionBroker"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach broad permissions (session policy will scope down)
aws iam attach-role-policy \
  --role-name RecourseAgentWorker \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

### 3. Start the Broker

```bash
export RECOURSE_BROKER_ROLE_ARN="arn:aws:iam::123456789012:role/RecourseSessionBroker"
recourse iam broker --port 3002
```

### 4. Agent Requests Credentials

```bash
# Agent wants to list S3 buckets
curl -X POST http://localhost:3002/session \
  -H "Content-Type: application/json" \
  -d '{
    "intent": {
      "type": "shell",
      "command": "aws s3 ls"
    },
    "cloud": "aws",
    "actor": "claude-agent-1",
    "environment": "development"
  }'
```

Response:
```json
{
  "granted": true,
  "riskAssessment": "allow",
  "reason": "Read-only S3 operation",
  "attestation": {
    "attestation_uri": "https://...",
    "key_id": "recourse-local-1"
  },
  "credentials": {
    "accessKeyId": "ASIA...",
    "secretAccessKey": "...",
    "sessionToken": "...",
    "expiration": "2025-05-08T13:15:00Z"
  },
  "session": {
    "sessionId": "recourse-claude-agent-1-1715...",
    "roleArn": "arn:aws:iam::123456789012:role/RecourseAgentWorker",
    "expiresAt": "2025-05-08T13:15:00Z",
    "scopedPermissions": ["s3:ListAllMyBuckets"]
  }
}
```

## Scoped Session Policies

The broker creates a **session policy** that limits credentials to only the requested operation:

### Example: S3 Read

Intent:
```json
{"type": "shell", "command": "aws s3 cp s3://my-bucket/data.csv ."}
```

Session Policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": ["arn:aws:s3:::my-bucket/data.csv"]
  }]
}
```

### Example: Blocked Dangerous Operation

Intent:
```json
{"type": "shell", "command": "aws s3 rb s3://prod-data --force"}
```

Response:
```json
{
  "granted": false,
  "riskAssessment": "block",
  "reason": "S3 bucket deletion - unrecoverable data loss",
  "attestation": {...}
}
```

## CLI Usage

### Start Broker

```bash
recourse iam broker [options]

Options:
  -p, --port <port>          Port to listen on (default: 3002)
  --role-arn <arn>           AWS role ARN for broker
  --allow <levels>           Risk levels that allow credentials (default: allow,warn)
  --duration <seconds>       Default session duration (default: 900)
  --max-duration <seconds>   Maximum session duration (default: 3600)
```

### Request Credentials (CLI client)

```bash
# Request credentials and get JSON response
recourse iam request \
  --broker http://localhost:3002 \
  --intent '{"type":"shell","command":"aws s3 ls"}' \
  --actor claude-agent

# Request credentials and export as environment variables
eval $(recourse iam request \
  --broker http://localhost:3002 \
  --intent '{"type":"shell","command":"aws s3 ls"}' \
  --output env)

# Now use the credentials
aws s3 ls
```

## Integration with Agents

### Claude Code Integration

Add a hook that requests credentials before AWS operations:

```json
{
  "hooks": {
    "pre-tool-call": {
      "command": "scripts/request-credentials.sh",
      "pattern": "aws|kubectl"
    }
  }
}
```

### LangChain Integration

```python
from langchain_recourse import RecourseSessionBroker

broker = RecourseSessionBroker(broker_url="http://localhost:3002")

# In your agent's tool execution
def execute_aws_command(command: str):
    # Request scoped credentials
    session = broker.request_session(
        intent={"type": "shell", "command": command},
        actor="my-langchain-agent"
    )

    if not session.granted:
        return f"Operation blocked: {session.reason}"

    # Use temporary credentials
    import boto3
    client = boto3.client(
        's3',
        aws_access_key_id=session.credentials.access_key_id,
        aws_secret_access_key=session.credentials.secret_access_key,
        aws_session_token=session.credentials.session_token
    )
    # Execute operation...
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RECOURSE_BROKER_ROLE_ARN` | Role ARN the broker assumes |
| `RECOURSE_ALLOWED_LEVELS` | Risk levels that allow credentials |
| `RECOURSE_SESSION_DURATION` | Default session duration in seconds |
| `RECOURSE_MAX_SESSION_DURATION` | Maximum session duration |
| `RECOURSE_ATTESTATION` | Enable attestation (`true`/`false`) |
| `PORT` | HTTP server port |
| `AWS_REGION` | AWS region for STS calls |

## Security Considerations

### Principle of Least Privilege

Session policies scope credentials to the minimum required permissions. Even if the underlying role has broad access, the agent only gets what they need for their declared operation.

### Time-Limited Access

Credentials expire automatically (default: 15 minutes). No long-lived credentials to manage or rotate.

### Audit Trail

Every session grant produces a signed attestation with:
- What was requested
- What was granted
- Risk assessment
- Session metadata

### Trust but Verify

The broker trusts the agent's declared intent but verifies it through RecourseOS evaluation. Agents can't request credentials for operations they don't intend to perform without evaluation.

## Comparison with Other Approaches

| Approach | Per-Operation Control | Time-Limited | Scoped Down | Audit Trail |
|----------|----------------------|--------------|-------------|-------------|
| Long-lived IAM user | No | No | No | CloudTrail only |
| IAM roles | No | Session-based | No | CloudTrail only |
| AWS SSO | No | Session-based | No | CloudTrail only |
| **RecourseOS Broker** | **Yes** | **Yes (15min)** | **Yes** | **Full attestation** |

## Future: GCP and Azure

The broker architecture supports multiple clouds:

```typescript
interface SessionRequest {
  intent: {...};
  cloud: 'aws' | 'gcp' | 'azure';  // Select cloud
  // ...
}
```

GCP and Azure support is planned, using:
- GCP: Service Account impersonation with session tokens
- Azure: Managed Identity with scoped access tokens

## Next Steps

- [Attestation Protocol](./attestation-log-format.md) - Understand the cryptographic signatures
- [MCP Gateway Mode](./mcp-gateway.md) - In-line enforcement for MCP tools
- [CLI Reference](./cli.md) - Full command documentation
