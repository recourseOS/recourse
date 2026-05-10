#!/bin/bash
# Run all RecourseOS demo scenarios
# Generates plans, evaluates consequences, saves results

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         RecourseOS Live Demo: \"The Save\"                     ║"
echo "║                                                              ║"
echo "║  RecourseOS doesn't just analyze. It saves.                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if terraform is initialized
if [ ! -d "$SCRIPT_DIR/terraform/.terraform" ]; then
  echo "ERROR: Terraform not initialized."
  echo "Run: cd demo/terraform && terraform init && terraform apply"
  exit 1
fi

# Check if RecourseOS is built
if [ ! -f "$SCRIPT_DIR/../dist/index.js" ]; then
  echo "Building RecourseOS..."
  cd "$SCRIPT_DIR/.."
  npm run build
fi

echo "Running all 7 scenarios..."
echo ""

# Run each scenario
for scenario in "$SCRIPT_DIR/scenarios"/*.sh; do
  if [ -f "$scenario" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    bash "$scenario"
    echo ""
    read -p "Press Enter to continue to next scenario..." </dev/tty || true
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    ALL SCENARIOS COMPLETE                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Results saved to:                                           ║"
echo "║    - demo/plans/      (Terraform plan JSONs)                 ║"
echo "║    - demo/results/    (Consequence reports)                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Summary of verdicts:"
echo ""

# Show summary of all verdicts
for result in "$SCRIPT_DIR/results"/*.json; do
  if [ -f "$result" ]; then
    name=$(basename "$result" .json)
    decision=$(jq -r '.riskAssessment // "unknown"' "$result" 2>/dev/null || echo "unknown")
    worst=$(jq -r '.summary.worstRecoverability // "unknown"' "$result" 2>/dev/null || echo "unknown")
    echo "  $name: $decision ($worst)"
  fi
done
