#!/bin/bash
# Scenario 3: Delete the sessions table (no PITR)
# Expected: BLOCK / UNRECOVERABLE

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 3: Delete the Sessions Table"
echo "=============================================="
echo ""
echo "An agent wants to 'reset user sessions'..."
echo "Target: aws_dynamodb_table.sessions"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_dynamodb_table.sessions \
  -out=/tmp/dynamodb-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/dynamodb-destroy.tfplan > "$PLANS_DIR/03-dynamodb-sessions.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/03-dynamodb-sessions.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/03-dynamodb-sessions.json" \
  --format human \
  | tee "$RESULTS_DIR/03-dynamodb-sessions.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/03-dynamodb-sessions.json" \
  --format json \
  > "$RESULTS_DIR/03-dynamodb-sessions.json"

echo ""
echo "=============================================="
echo "WHAT YOU ALMOST LOST:"
echo "- All active user sessions"
echo "- Forced logout for all users"
echo "- Point-in-time recovery: DISABLED"
echo "- No AWS Backup recovery points"
echo "=============================================="
