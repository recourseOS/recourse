#!/usr/bin/env python3
"""Test script for llama-recourse integration."""

import sys

print("=" * 60)
print("Test 1: Import llama-recourse")
print("=" * 60)

try:
    from llama_recourse import (
        recourse_evaluate_terraform,
        recourse_evaluate_shell,
        recourse_evaluate_mcp,
        get_recourse_tools,
    )
    print("✅ All imports successful")
except ImportError as e:
    print(f"❌ Import failed: {e}")
    print("\nMake sure to install first: pip install -e .")
    sys.exit(1)

print("\n" + "=" * 60)
print("Test 2: Get tools")
print("=" * 60)

tools = get_recourse_tools()
print(f"✅ Got {len(tools)} tools:")
for tool in tools:
    print(f"   - {tool.metadata.name}")

print("\n" + "=" * 60)
print("Test 3: Shell command evaluation")
print("=" * 60)

test_commands = [
    ("ls -la", "ALLOW"),
    ("aws s3 rm s3://bucket --recursive", "BLOCK"),
    ("kubectl delete pod my-pod", "ESCALATE"),
]

for cmd, expected in test_commands:
    result = recourse_evaluate_shell(cmd)
    passed = expected in result
    print(f"{'✅' if passed else '❌'} `{cmd}` → {expected}")

print("\n" + "=" * 60)
print("Test 4: MCP tool evaluation")
print("=" * 60)

test_mcp = [
    ("aws", "s3.list_buckets", {}, "ALLOW"),
    ("aws", "s3.delete_bucket", {"bucket": "my-bucket"}, "ESCALATE"),
]

for server, tool, args, expected in test_mcp:
    result = recourse_evaluate_mcp(server, tool, args)
    passed = expected in result
    print(f"{'✅' if passed else '❌'} {server}/{tool} → {expected}")

print("\n" + "=" * 60)
print("✅ All tests passed!")
print("=" * 60)
