#!/bin/bash
# Scenario 7: Delete the KMS key (soft delete + encryption cascade)
# Expected: ESCALATE / RECOVERABLE_WITH_EFFORT

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 7: Delete the KMS Key"
echo "=============================================="
echo ""
echo "An agent wants to 'rotate encryption keys'..."
echo "Target: aws_kms_key.app_key"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_kms_key.app_key \
  -target=aws_kms_alias.app_key \
  -out=/tmp/kms-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/kms-destroy.tfplan > "$PLANS_DIR/07-kms-key.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/07-kms-key.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/07-kms-key.json" \
  --format human \
  | tee "$RESULTS_DIR/07-kms-key.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/07-kms-key.json" \
  --format json \
  > "$RESULTS_DIR/07-kms-key.json"

echo ""
echo "=============================================="
echo "WHAT YOU ALMOST LOST:"
echo "- 7-day deletion window (can be cancelled)"
echo "- BUT: S3 buckets encrypted with this key"
echo "- BUT: RDS instance encrypted with this key"
echo "- After deletion: ALL encrypted data inaccessible"
echo "- Even backups become useless without the key!"
echo "=============================================="
