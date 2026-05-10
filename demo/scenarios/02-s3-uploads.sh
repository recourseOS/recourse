#!/bin/bash
# Scenario 2: Delete the uploads bucket (no versioning)
# Expected: BLOCK / UNRECOVERABLE

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 2: Clean Up Old Uploads"
echo "=============================================="
echo ""
echo "An agent wants to 'remove unused storage'..."
echo "Target: aws_s3_bucket.uploads"
echo ""

# Generate the destroy plan
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_s3_bucket.uploads \
  -target=aws_s3_bucket_server_side_encryption_configuration.uploads \
  -out=/tmp/s3-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/s3-destroy.tfplan > "$PLANS_DIR/02-s3-uploads.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/02-s3-uploads.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/02-s3-uploads.json" \
  --format human \
  | tee "$RESULTS_DIR/02-s3-uploads.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/02-s3-uploads.json" \
  --format json \
  > "$RESULTS_DIR/02-s3-uploads.json"

echo ""
echo "=============================================="
echo "WHAT YOU ALMOST LOST:"
echo "- All user-uploaded files"
echo "- Profile photos"
echo "- Documents"
echo "- Versioning: DISABLED (no recovery)"
echo "=============================================="
