#!/bin/bash
# Scenario 1: Delete the unprotected production database
# Expected: BLOCK / UNRECOVERABLE

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 1: Delete the Production Database"
echo "=============================================="
echo ""
echo "An agent wants to 'clean up old resources'..."
echo "Target: aws_db_instance.production"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_db_instance.production \
  -out=/tmp/rds-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/rds-destroy.tfplan > "$PLANS_DIR/01-rds-unprotected.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/01-rds-unprotected.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/01-rds-unprotected.json" \
  --format human \
  | tee "$RESULTS_DIR/01-rds-unprotected.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/01-rds-unprotected.json" \
  --format json \
  > "$RESULTS_DIR/01-rds-unprotected.json"

echo ""
echo "=============================================="
echo "WHAT YOU ALMOST LOST:"
echo "- All customer data"
echo "- Order history"
echo "- User accounts"
echo "- skip_final_snapshot = true (NO BACKUP)"
echo "- backup_retention_period = 0 (NO AUTOMATED BACKUPS)"
echo "=============================================="
