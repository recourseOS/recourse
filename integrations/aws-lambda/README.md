# RecourseOS AWS Lambda

Serverless RecourseOS API deployed as AWS Lambda with API Gateway.

## Quick Deploy

### Using AWS SAM

```bash
cd integrations/aws-lambda
npm install
sam build
sam deploy --guided
```

### Using Serverless Framework

```bash
npm install -g serverless
serverless deploy
```

### Using CDK

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

const fn = new lambda.Function(this, 'RecourseOS', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('dist'),
  timeout: Duration.seconds(30),
});

new apigateway.LambdaRestApi(this, 'RecourseAPI', {
  handler: fn,
});
```

## API Endpoints

### POST /evaluate/terraform

Evaluate a Terraform plan.

**Request:**
```json
{
  "plan": { "resource_changes": [...] },
  "state": { "resources": [...] },
  "actor": "ci-pipeline",
  "environment": "production",
  "owner": "platform-team"
}
```

**Response:**
```json
{
  "riskAssessment": "block",
  "summary": {
    "totalChanges": 3,
    "reversible": 1,
    "recoverableWithEffort": 0,
    "recoverableFromBackup": 0,
    "needsReview": 0,
    "unrecoverable": 2,
    "hasUnrecoverable": true,
    "worstTier": "unrecoverable"
  },
  "changes": [
    {
      "address": "aws_db_instance.prod",
      "action": "delete",
      "resourceType": "aws_db_instance",
      "recoverability": {
        "tier": 4,
        "label": "unrecoverable",
        "reasoning": "skip_final_snapshot=true, no backups"
      }
    }
  ],
  "metadata": {
    "evaluatedAt": "2024-01-15T12:00:00Z",
    "actor": "ci-pipeline",
    "environment": "production",
    "owner": "platform-team"
  }
}
```

### POST /evaluate/shell

Evaluate a shell command.

**Request:**
```json
{
  "command": "aws s3 rm s3://prod-data --recursive",
  "cwd": "/app",
  "actor": "devops-bot"
}
```

**Response:**
```json
{
  "riskAssessment": "block",
  "summary": {
    "totalChanges": 1,
    "hasUnrecoverable": true,
    "worstTier": "unrecoverable"
  },
  "changes": [
    {
      "address": "aws s3 rm s3://prod-data --recursive",
      "action": "execute",
      "resourceType": "shell_command",
      "recoverability": {
        "tier": 4,
        "label": "unrecoverable",
        "reasoning": "Command matches high-risk destructive patterns"
      }
    }
  ]
}
```

### POST /evaluate/mcp

Evaluate an MCP tool call.

**Request:**
```json
{
  "server": "aws",
  "tool": "s3.delete_bucket",
  "arguments": { "bucket": "prod-backups" },
  "actor": "claude-agent"
}
```

**Response:**
```json
{
  "riskAssessment": "escalate",
  "summary": {
    "totalChanges": 1,
    "needsReview": 1,
    "hasUnrecoverable": false,
    "worstTier": "needs-review"
  },
  "changes": [
    {
      "address": "aws:s3.delete_bucket(prod-backups)",
      "action": "call",
      "resourceType": "mcp_tool",
      "recoverability": {
        "tier": 3,
        "label": "needs-review",
        "reasoning": "Tool \"s3.delete_bucket\" appears destructive"
      }
    }
  ]
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0"
}
```

## SAM Template

Create `template.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: RecourseOS Serverless API

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs18.x

Resources:
  RecourseFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: dist/
      Handler: handler.handler
      Events:
        EvaluateTerraform:
          Type: Api
          Properties:
            Path: /evaluate/terraform
            Method: post
        EvaluateShell:
          Type: Api
          Properties:
            Path: /evaluate/shell
            Method: post
        EvaluateMcp:
          Type: Api
          Properties:
            Path: /evaluate/mcp
            Method: post
        Health:
          Type: Api
          Properties:
            Path: /health
            Method: get

Outputs:
  ApiUrl:
    Description: API Gateway endpoint URL
    Value: !Sub "https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/"
```

## Usage with CI/CD

### GitHub Actions

```yaml
- name: Evaluate Terraform Plan
  run: |
    RESULT=$(curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "{\"plan\": $(cat plan.json)}" \
      ${{ secrets.RECOURSE_API_URL }}/evaluate/terraform)

    RISK=$(echo $RESULT | jq -r '.riskAssessment')
    if [ "$RISK" = "block" ]; then
      echo "Plan blocked by RecourseOS"
      exit 1
    fi
```

### GitLab CI

```yaml
evaluate_plan:
  script:
    - |
      RESULT=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"plan\": $(cat plan.json)}" \
        ${RECOURSE_API_URL}/evaluate/terraform)

      if echo $RESULT | jq -e '.riskAssessment == "block"' > /dev/null; then
        echo "Blocked by RecourseOS"
        exit 1
      fi
```

## Local Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally with SAM
sam local start-api

# Test
curl -X POST http://localhost:3000/evaluate/terraform \
  -H "Content-Type: application/json" \
  -d '{"plan": {"resource_changes": []}}'
```

## License

MIT
