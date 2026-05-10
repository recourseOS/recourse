#!/bin/bash
# Scenario 5: Delete the VPC (cascade demo)
# Expected: BLOCK / UNRECOVERABLE (due to RDS)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$DEMO_DIR/terraform"
PLANS_DIR="$DEMO_DIR/plans"
RESULTS_DIR="$DEMO_DIR/results"

echo "=============================================="
echo "SCENARIO 5: Delete the VPC"
echo "=============================================="
echo ""
echo "An agent wants to 'tear down the network'..."
echo "Target: aws_vpc.main (and all dependents)"
echo ""

# Generate the destroy plan for the entire VPC and its contents
echo ">> Generating Terraform destroy plan..."
cd "$TERRAFORM_DIR"
terraform plan -destroy \
  -target=aws_vpc.main \
  -target=aws_subnet.public \
  -target=aws_subnet.private_a \
  -target=aws_subnet.private_b \
  -target=aws_nat_gateway.main \
  -target=aws_internet_gateway.main \
  -target=aws_eip.nat \
  -target=aws_instance.web_server_1 \
  -target=aws_instance.web_server_2 \
  -target=aws_db_instance.production \
  -out=/tmp/vpc-destroy.tfplan \
  -no-color

# Convert to JSON
terraform show -json /tmp/vpc-destroy.tfplan > "$PLANS_DIR/05-vpc-cascade.json"
echo ""
echo ">> Plan saved to: $PLANS_DIR/05-vpc-cascade.json"
echo ""

# Run RecourseOS evaluation
echo ">> RecourseOS is evaluating the consequences..."
echo ""

cd "$DEMO_DIR/.."
node dist/index.js plan "$PLANS_DIR/05-vpc-cascade.json" \
  --format human \
  | tee "$RESULTS_DIR/05-vpc-cascade.txt"

# Also save JSON output
node dist/index.js plan "$PLANS_DIR/05-vpc-cascade.json" \
  --format json \
  > "$RESULTS_DIR/05-vpc-cascade.json"

echo ""
echo "=============================================="
echo "CASCADE SUMMARY:"
echo "- 3 subnets destroyed"
echo "- 2 EC2 instances terminated"
echo "- 1 NAT gateway removed"
echo "- 1 RDS instance destroyed (UNRECOVERABLE!)"
echo "- Elastic IP released (cannot reclaim)"
echo "=============================================="
