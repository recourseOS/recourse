#!/bin/bash
# Scenario 4: Delete the IAM app role (cascade impact)
# Expected: ESCALATE / RECOVERABLE_WITH_EFFORT

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 4: Remove Old IAM Role"
echo "=============================================="
echo ""
echo "An agent wants to 'clean up unused IAM roles'..."
echo "Target: aws_iam_role.app_role"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_iam_role.app_role \
  -target=aws_iam_role_policy.app_policy \
  -target=aws_iam_instance_profile.app_profile \
  -out=/tmp/iam-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/iam-destroy.tfplan > "$PLANS_DIR/04-iam-role-cascade.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/04-iam-role-cascade.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/04-iam-role-cascade.json" \
  --format human \
  | tee "$RESULTS_DIR/04-iam-role-cascade.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/04-iam-role-cascade.json" \
  --format json \
  > "$RESULTS_DIR/04-iam-role-cascade.json"

echo ""
echo "=============================================="
echo "CASCADE IMPACT:"
echo "- 3 Lambda functions depend on this role"
echo "- 2 EC2 instances use this role"
echo "- All 5 services will fail IMMEDIATELY"
echo "=============================================="
