# RecourseOS for Terraform Cloud

Run task integration that evaluates Terraform plans before apply.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Terraform Cloud │────▶│  RecourseOS     │────▶│ Terraform Cloud │
│   (post_plan)   │     │  Run Task       │     │   (callback)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │   POST /webhook       │   Analyze plan        │   PATCH result
        │   + plan_json_url     │   Check consequences  │   passed/failed
        └───────────────────────┴───────────────────────┘
```

## Setup

### 1. Deploy the Handler

#### Option A: Cloudflare Workers (Recommended)

```bash
cd integrations/terraform-cloud
npm install
wrangler deploy
```

#### Option B: AWS Lambda

```bash
# Build
npm run build

# Deploy with your preferred method (SAM, CDK, Serverless, etc.)
```

#### Option C: Self-hosted

```typescript
import express from 'express';
import { httpHandler } from './handler';

const app = express();
app.use(express.json());
app.post('/webhook', httpHandler);
app.listen(3000);
```

### 2. Create Run Task in Terraform Cloud

1. Go to your TFC Organization → Settings → Run Tasks
2. Click "Create run task"
3. Configure:
   - **Name:** RecourseOS
   - **Endpoint URL:** Your deployed handler URL
   - **HMAC Key:** (optional, for verification)
4. Click "Create run task"

### 3. Attach to Workspaces

1. Go to your workspace → Settings → Run Tasks
2. Click "+" next to RecourseOS
3. Choose enforcement level:
   - **Advisory:** Shows results but doesn't block
   - **Mandatory:** Blocks apply if RecourseOS fails

## Enforcement Levels

| RecourseOS Result | TFC Status | Mandatory Effect |
|-------------------|------------|------------------|
| ALLOW | `passed` | Apply proceeds |
| WARN | `passed` | Apply proceeds |
| ESCALATE | `failed` | Apply blocked |
| BLOCK | `failed` | Apply blocked |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RECOURSE_SLACK_WEBHOOK` | Optional: Send alerts to Slack |
| `RECOURSE_DISCORD_WEBHOOK` | Optional: Send alerts to Discord |

## Local Testing

```bash
# Terminal 1: Start RecourseOS server
recourse serve

# Terminal 2: Run test
cd integrations/terraform-cloud
npx tsx test.ts
```

## Example Output

When a run is evaluated, you'll see in TFC:

```
⛔ BLOCK: Recoverability is unrecoverable; policy blocks unrecoverable or worse

⛔ aws_s3_bucket.logs: unrecoverable
⛔ aws_db_instance.prod: unrecoverable

📜 Attestation: https://recourse.example.com/.well-known/attestations/861a2070.json
```

The attestation URL links to a cryptographically signed proof of the evaluation.

## Cloudflare Workers Deployment

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Create wrangler.toml
cat > wrangler.toml << EOF
name = "recourse-tfc"
main = "handler.ts"
compatibility_date = "2024-01-01"
EOF

# Deploy
wrangler deploy
```

## API Reference

### POST /webhook

Receives run task requests from Terraform Cloud.

**Headers:**
- `x-tfc-task-callback-url`: URL to send results

**Body:**
```json
{
  "payload_version": 1,
  "access_token": "...",
  "stage": "post_plan",
  "run_id": "run-xxx",
  "workspace_name": "my-workspace",
  "organization_name": "my-org",
  "plan_json_api_url": "https://app.terraform.io/api/v2/plans/xxx/json-output"
}
```

**Response:**
```json
{
  "status": "passed|failed",
  "message": "✅ ALLOW: 3 change(s), all safe",
  "url": "https://recourseos.dev/docs"
}
```

## License

MIT
