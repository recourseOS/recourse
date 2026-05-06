# RecourseOS for Atlantis

Webhook integration that posts consequence analysis as PR comments when Atlantis runs `terraform plan`.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Atlantis   │────▶│  RecourseOS │────▶│  GitHub/    │
│   (plan)    │     │   Webhook   │     │  GitLab/BB  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │   POST webhook    │   Analyze plan    │   POST comment
       │   + plan_json     │   Build report    │   on PR/MR
       └───────────────────┴───────────────────┘
```

## Setup

### 1. Deploy the Webhook Handler

#### Option A: Cloudflare Workers (Recommended)

```bash
cd integrations/atlantis
npm install
wrangler deploy
```

Set secrets:
```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITLAB_TOKEN      # if using GitLab
wrangler secret put BITBUCKET_TOKEN   # if using Bitbucket
```

#### Option B: AWS Lambda

```bash
npm run build
# Deploy with SAM/CDK/Serverless
```

Environment variables:
- `GITHUB_TOKEN` - GitHub personal access token with `repo` scope
- `GITLAB_TOKEN` - GitLab personal access token (optional)
- `BITBUCKET_TOKEN` - Bitbucket app password (optional)

#### Option C: Self-hosted

```typescript
import express from 'express';
import { httpHandler } from './handler';

const app = express();
app.use(express.json());
app.post('/webhook', httpHandler);
app.listen(3000);
```

### 2. Configure Atlantis

Add to your `atlantis.yaml`:

```yaml
version: 3
projects:
  - dir: .
    workflow: recourse

workflows:
  recourse:
    plan:
      steps:
        - init
        - plan
        - run: |
            terraform show -json $PLANFILE > plan.json
            curl -X POST \
              -H "Content-Type: application/json" \
              -d "{
                \"version\": 1,
                \"event_type\": \"plan\",
                \"status\": \"success\",
                \"pull_request\": {
                  \"url\": \"$PULL_URL\",
                  \"num\": $PULL_NUM,
                  \"branch\": \"$HEAD_BRANCH_NAME\",
                  \"author\": \"$PULL_AUTHOR\"
                },
                \"repo\": {
                  \"full_name\": \"$BASE_REPO_OWNER/$BASE_REPO_NAME\",
                  \"clone_url\": \"$HEAD_REPO_CLONE_URL\",
                  \"vcs_type\": \"github\"
                },
                \"project\": {
                  \"name\": \"$PROJECT_NAME\",
                  \"dir\": \"$DIR\",
                  \"workspace\": \"$WORKSPACE\"
                },
                \"plan_json\": $(cat plan.json | jq -Rs .)
              }" \
              https://your-webhook-url/webhook
```

## PR Comment Example

When a plan is evaluated, you'll see a comment like:

---

## :stop_sign: RecourseOS: BLOCKED - Unrecoverable Changes Detected

**Project:** `production` | **Dir:** `.` | **Workspace:** `default`

### Summary

| Metric | Count |
|--------|-------|
| Total Changes | 3 |
| Reversible | 1 |
| Recoverable (effort) | 0 |
| Recoverable (backup) | 0 |
| Needs Review | 0 |
| Unrecoverable | 2 |

### Concerning Changes

| Resource | Action | Risk | Reason |
|----------|--------|------|--------|
| `aws_db_instance.prod` | delete | :stop_sign: unrecoverable | skip_final_snapshot=true, no backups |
| `aws_s3_bucket.data` | delete | :stop_sign: unrecoverable | versioning disabled, no replication |

### Recommended Action

> **Do not apply this plan.** It contains changes that will cause permanent data loss.
>
> Review each flagged resource and ensure backups exist before proceeding.
> Consider enabling deletion protection, final snapshots, or versioning.

---

*Analyzed by [RecourseOS](https://recourseos.dev)*

---

## Supported VCS Providers

| Provider | Token Required | Comment API |
|----------|---------------|-------------|
| GitHub | `GITHUB_TOKEN` | Issues API |
| GitLab | `GITLAB_TOKEN` | Notes API |
| Bitbucket | `BITBUCKET_TOKEN` | Comments API |
| Azure DevOps | Coming soon | - |

## Risk Level Actions

| RecourseOS Result | PR Comment | Suggested Workflow |
|-------------------|------------|-------------------|
| ALLOW | Green checkmark | Auto-approve apply |
| WARN | Yellow warning | Manual apply |
| ESCALATE | Orange alert | Require approval |
| BLOCK | Red stop sign | Block apply |

## Advanced: Block Applies

To block applies when RecourseOS returns BLOCK, add a check step:

```yaml
workflows:
  recourse:
    apply:
      steps:
        - run: |
            RESULT=$(curl -s https://your-api/last-result?pr=$PULL_NUM)
            if [ "$RESULT" = "block" ]; then
              echo "RecourseOS blocked this apply"
              exit 1
            fi
        - apply
```

## License

MIT
