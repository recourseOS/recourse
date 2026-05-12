"""
RecourseOS function handlers for OpenAI Assistants.

Usage:
    from recourse_functions import RECOURSE_TOOLS, handle_recourse_function

    # Add to your assistant
    assistant = client.beta.assistants.create(
        model="gpt-4-turbo",
        tools=RECOURSE_TOOLS,
        instructions="Before any destructive action, use recourse_evaluate_* tools."
    )

    # Handle function calls in your run loop
    if tool_call.function.name.startswith("recourse_"):
        result = handle_recourse_function(
            tool_call.function.name,
            json.loads(tool_call.function.arguments)
        )
"""

import json
import subprocess
import tempfile
from typing import Any

# Tool definitions for OpenAI Assistants
RECOURSE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "recourse_evaluate_terraform",
            "description": "Evaluate a Terraform plan for destructive consequences BEFORE running terraform apply. Returns risk assessment (allow/warn/escalate/block) and recoverability information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "plan_json": {
                        "type": "string",
                        "description": "The Terraform plan JSON output (from 'terraform show -json plan.out')"
                    },
                    "state_json": {
                        "type": "string",
                        "description": "Optional: Terraform state JSON for improved accuracy"
                    }
                },
                "required": ["plan_json"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recourse_evaluate_shell",
            "description": "Evaluate a shell command for destructive consequences BEFORE execution. Use for 'aws s3 rm', 'kubectl delete', 'rm -rf', 'DROP TABLE', etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to evaluate"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recourse_evaluate_mcp",
            "description": "Evaluate an MCP tool call for destructive consequences BEFORE invocation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "MCP server name (e.g., 'aws', 'kubernetes')"
                    },
                    "tool": {
                        "type": "string",
                        "description": "Tool name (e.g., 's3.delete_bucket')"
                    },
                    "arguments": {
                        "type": "object",
                        "description": "Tool arguments"
                    }
                },
                "required": ["server", "tool", "arguments"]
            }
        }
    }
]


def _run_recourse_cli(args: list[str]) -> dict:
    """Run recourse-cli and return parsed JSON output."""
    try:
        result = subprocess.run(
            ["npx", "-y", "recourse-cli@latest"] + args,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0 and not result.stdout:
            return {"error": result.stderr or "Unknown error"}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"error": "Evaluation timed out"}
    except json.JSONDecodeError:
        return {"error": "Failed to parse response"}
    except FileNotFoundError:
        return {"error": "npx not found - ensure Node.js is installed"}


def _format_response(raw: dict) -> str:
    """Format CLI output as a human-readable response."""
    if "error" in raw:
        return f"**Error:** {raw['error']}"

    summary = raw.get("summary", {})
    has_unrecoverable = summary.get("hasUnrecoverable", False)
    needs_review = summary.get("needsReview", False)
    worst_recov = summary.get("worstRecoverability", {})
    tier = worst_recov.get("label", "unknown") if isinstance(worst_recov, dict) else "unknown"
    total = summary.get("totalMutations", 0)

    # Determine risk level
    if has_unrecoverable:
        risk = "BLOCK"
        emoji = "⛔"
        instruction = "Do NOT proceed. This action would cause unrecoverable data loss."
    elif needs_review:
        risk = "ESCALATE"
        emoji = "🖐️"
        instruction = "Ask the user to explicitly confirm before proceeding."
    elif tier in ("recoverable-from-backup", "recoverable-with-effort"):
        risk = "WARN"
        emoji = "⚠️"
        instruction = "Inform the user of the risk before proceeding."
    else:
        risk = "ALLOW"
        emoji = "✅"
        instruction = "Safe to proceed."

    # Build reasoning from mutations
    mutations = raw.get("mutations", [])
    reasons = []
    for m in mutations:
        rec = m.get("recoverability", {})
        intent = m.get("intent", {})
        target = intent.get("target", {})
        address = target.get("id") or target.get("type", "unknown")
        if rec.get("reasoning"):
            reasons.append(f"- {address}: {rec['reasoning']}")

    response = [
        f"{emoji} **Risk Assessment: {risk}**",
        f"",
        f"**Recoverability Tier:** {tier}",
        f"**Changes Evaluated:** {total}",
        f"",
    ]

    if reasons:
        response.append("**Details:**")
        response.extend(reasons[:5])  # Limit to 5
        if len(reasons) > 5:
            response.append(f"- ... and {len(reasons) - 5} more")
        response.append("")

    response.append(f"**Action:** {instruction}")

    return "\n".join(response)


def evaluate_terraform(plan_json: str, state_json: str | None = None) -> str:
    """Evaluate a Terraform plan."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write(plan_json)
        plan_path = f.name

    args = ["plan", plan_path, "--format", "json"]

    if state_json:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(state_json)
            args.extend(["--state", f.name])

    raw = _run_recourse_cli(args)
    return _format_response(raw)


def evaluate_shell(command: str) -> str:
    """Evaluate a shell command using RecourseOS CLI."""
    raw = _run_recourse_cli(["evaluate", "shell", command, "--format", "json"])
    return _format_response(raw)


def evaluate_mcp(server: str, tool: str, arguments: dict) -> str:
    """Evaluate an MCP tool call using RecourseOS CLI."""
    mcp_input = json.dumps({"server": server, "tool": tool, "arguments": arguments})
    raw = _run_recourse_cli(["evaluate", "mcp", mcp_input, "--format", "json"])
    return _format_response(raw)


def handle_recourse_function(name: str, arguments: dict[str, Any]) -> str:
    """
    Handle a RecourseOS function call from OpenAI Assistants.

    Args:
        name: Function name (recourse_evaluate_terraform, etc.)
        arguments: Function arguments from the API

    Returns:
        String response to submit back to the assistant
    """
    if name == "recourse_evaluate_terraform":
        return evaluate_terraform(
            arguments["plan_json"],
            arguments.get("state_json")
        )
    elif name == "recourse_evaluate_shell":
        return evaluate_shell(arguments["command"])
    elif name == "recourse_evaluate_mcp":
        return evaluate_mcp(
            arguments["server"],
            arguments["tool"],
            arguments["arguments"]
        )
    else:
        return f"Unknown function: {name}"


# For direct testing
if __name__ == "__main__":
    # Test shell evaluation
    print(evaluate_shell("aws s3 rm s3://prod-data --recursive"))
    print()
    print(evaluate_shell("ls -la"))
