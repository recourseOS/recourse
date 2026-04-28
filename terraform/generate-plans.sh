#!/bin/bash
# Generate Terraform plans for all scenarios
# Requires AWS credentials configured

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
OUTPUT_DIR="$SCRIPT_DIR/plans"

mkdir -p "$OUTPUT_DIR"

echo "Generating Terraform plans..."
echo ""

for scenario in "$SCENARIOS_DIR"/*/; do
    name=$(basename "$scenario")
    echo "=== $name ==="

    cd "$scenario"

    # Initialize
    terraform init -input=false > /dev/null 2>&1 || {
        echo "  [skip] terraform init failed"
        continue
    }

    # Generate create plan
    if terraform plan -out=plan.bin -input=false > /dev/null 2>&1; then
        terraform show -json plan.bin > "$OUTPUT_DIR/${name}-create.json"
        echo "  [ok] ${name}-create.json"
    else
        echo "  [skip] plan failed (may need AWS credentials)"
    fi

    # Clean up
    rm -f plan.bin

    cd "$SCRIPT_DIR"
    echo ""
done

echo "Plans written to: $OUTPUT_DIR"
echo ""
echo "Test with:"
echo "  blast plan $OUTPUT_DIR/<scenario>-create.json"
