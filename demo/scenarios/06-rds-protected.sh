#!/bin/bash
# Scenario 6: Delete the protected database (contrast)
# Expected: ALLOW / REVERSIBLE (deletion_protection will block apply)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 6: Delete the Protected Database"
echo "=============================================="
echo ""
echo "An agent tries to delete the PROTECTED database..."
echo "Target: aws_db_instance.protected"
echo ""
echo "(This shows how RecourseOS recognizes protection)"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_db_instance.protected \
  -out=/tmp/rds-protected-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/rds-protected-destroy.tfplan > "$PLANS_DIR/06-rds-protected.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/06-rds-protected.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/06-rds-protected.json" \
  --format human \
  | tee "$RESULTS_DIR/06-rds-protected.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/06-rds-protected.json" \
  --format json \
  > "$RESULTS_DIR/06-rds-protected.json"

echo ""
echo "=============================================="
echo "THE LESSON:"
echo "- deletion_protection = true"
echo "- AWS will REJECT the deletion at apply time"
echo "- No data at risk"
echo "- RecourseOS recognizes this and allows the plan"
echo "=============================================="
