#!/usr/bin/env python3
"""Test script for langchain-recourse integration."""

import json
import sys

# Test 1: Import test
print("=" * 60)
print("Test 1: Import langchain-recourse")
print("=" * 60)

try:
    from langchain_recourse import (
        RecourseEvaluateTerraform,
        RecourseEvaluateShell,
        RecourseEvaluateMCP,
        RecourseToolkit,
    )
    print("✅ All imports successful")
except ImportError as e:
    print(f"❌ Import failed: {e}")
    print("\nMake sure to install first:")
    print("  pip install -e .")
    sys.exit(1)

# Test 2: Toolkit instantiation
print("\n" + "=" * 60)
print("Test 2: Create toolkit and get tools")
print("=" * 60)

toolkit = RecourseToolkit()
tools = toolkit.get_tools()
print(f"✅ Toolkit created with {len(tools)} tools:")
for tool in tools:
    print(f"   - {tool.name}: {tool.description[:60]}...")

# Test 3: Terraform plan evaluation
print("\n" + "=" * 60)
print("Test 3: Evaluate safe Terraform plan")
print("=" * 60)

safe_plan = {
    "format_version": "1.0",
    "resource_changes": [
        {
            "address": "aws_s3_bucket.test",
            "type": "aws_s3_bucket",
            "provider_name": "registry.terraform.io/hashicorp/aws",
            "change": {
                "actions": ["update"],
                "before": {"bucket": "test", "tags": {}},
                "after": {"bucket": "test", "tags": {"env": "test"}},
            },
        }
    ],
}

terraform_tool = RecourseEvaluateTerraform()
print(f"Input: S3 bucket tag update (safe)")
result = terraform_tool._run(plan_json=json.dumps(safe_plan))
print(f"Result:\n{result}")

# Test 4: Dangerous Terraform plan
print("\n" + "=" * 60)
print("Test 4: Evaluate dangerous Terraform plan")
print("=" * 60)

dangerous_plan = {
    "format_version": "1.0",
    "resource_changes": [
        {
            "address": "aws_db_instance.prod",
            "type": "aws_db_instance",
            "provider_name": "registry.terraform.io/hashicorp/aws",
            "change": {
                "actions": ["delete"],
                "before": {
                    "identifier": "prod-db",
                    "skip_final_snapshot": True,
                    "backup_retention_period": 0,
                },
                "after": None,
            },
        }
    ],
}

print(f"Input: RDS deletion with skip_final_snapshot=true (dangerous)")
result = terraform_tool._run(plan_json=json.dumps(dangerous_plan))
print(f"Result:\n{result}")

# Test 5: Shell command evaluation
print("\n" + "=" * 60)
print("Test 5: Evaluate shell commands")
print("=" * 60)

shell_tool = RecourseEvaluateShell()

test_commands = [
    "ls -la",
    "aws s3 ls s3://my-bucket",
    "aws s3 rm s3://my-bucket --recursive",
    "rm -rf /tmp/cache",
    "kubectl delete pod my-pod",
]

for cmd in test_commands:
    print(f"\nCommand: {cmd}")
    result = shell_tool._run(command=cmd)
    # Extract just the risk line
    risk_line = result.split("\n")[0]
    print(f"  → {risk_line}")

# Test 6: MCP tool evaluation
print("\n" + "=" * 60)
print("Test 6: Evaluate MCP tool calls")
print("=" * 60)

mcp_tool = RecourseEvaluateMCP()

test_calls = [
    ("aws", "s3.list_buckets", {}),
    ("aws", "s3.delete_bucket", {"bucket": "my-bucket"}),
    ("kubernetes", "delete_pod", {"name": "my-pod", "namespace": "default"}),
]

for server, tool, args in test_calls:
    print(f"\nMCP: {server}/{tool}")
    result = mcp_tool._run(server=server, tool=tool, arguments=args)
    risk_line = result.split("\n")[0]
    print(f"  → {risk_line}")

# Summary
print("\n" + "=" * 60)
print("Test Summary")
print("=" * 60)
print("✅ All tests completed!")
print("\nNote: Tests used fallback pattern matching.")
print("For full functionality, ensure recourse-cli is installed:")
print("  npm install -g recourse-cli")
