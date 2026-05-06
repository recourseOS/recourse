"""RecourseOS tools for LlamaIndex agents."""

from __future__ import annotations

import json
import subprocess
import tempfile
from typing import Optional

from llama_index.core.tools import FunctionTool


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
    needs_review = summary.get("needsReview", 0)
    tier = summary.get("worstTier", "unknown")
    total = summary.get("totalChanges", 0)

    # Determine risk level
    if has_unrecoverable:
        risk = "BLOCK"
        instruction = "Do NOT proceed. This action would cause unrecoverable data loss."
    elif needs_review > 0:
        risk = "ESCALATE"
        instruction = "Ask the user to explicitly confirm before proceeding."
    elif tier in ("recoverable-from-backup", "recoverable-with-effort"):
        risk = "WARN"
        instruction = "Inform the user of the risk before proceeding."
    else:
        risk = "ALLOW"
        instruction = "Safe to proceed."

    # Build reasoning
    changes = raw.get("changes", [])
    reasons = []
    for c in changes:
        rec = c.get("recoverability", {})
        if rec.get("reasoning"):
            reasons.append(f"- {c.get('address', 'unknown')}: {rec['reasoning']}")

    lines = [
        f"**Risk Assessment: {risk}**",
        f"Recoverability Tier: {tier}",
        f"Changes Evaluated: {total}",
        "",
    ]

    if reasons:
        lines.append("**Details:**")
        lines.extend(reasons[:5])
        if len(reasons) > 5:
            lines.append(f"- ... and {len(reasons) - 5} more")
        lines.append("")

    lines.append(f"**Action:** {instruction}")

    return "\n".join(lines)


def recourse_evaluate_terraform(
    plan_json: str,
    state_json: Optional[str] = None,
) -> str:
    """
    Evaluate a Terraform plan for destructive consequences BEFORE running terraform apply.

    Use this tool to check if infrastructure changes are safe. Returns risk assessment
    (allow/warn/escalate/block) and recoverability information.

    Args:
        plan_json: The Terraform plan JSON output (from 'terraform show -json plan.out')
        state_json: Optional Terraform state JSON for improved accuracy

    Returns:
        Risk assessment with recommended action
    """
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


def recourse_evaluate_shell(command: str) -> str:
    """
    Evaluate a shell command for destructive consequences BEFORE execution.

    Use this for commands like 'aws s3 rm', 'kubectl delete', 'rm -rf', 'DROP TABLE', etc.

    Args:
        command: The shell command to evaluate

    Returns:
        Risk assessment with recommended action
    """
    cmd = command.lower()

    # High-risk patterns
    high_risk = [
        "rm -rf", "--recursive", "drop database", "drop table",
        "truncate", "--skip-final-snapshot", "force_destroy",
        "delete-db-instance", "delete-db-cluster"
    ]

    # Medium-risk patterns
    medium_risk = [
        "delete", "remove", "terminate", "destroy", "drop",
        "kubectl delete", "docker rm", "docker rmi"
    ]

    if any(p in cmd for p in high_risk):
        return (
            "**Risk Assessment: BLOCK**\n\n"
            f"Command: `{command}`\n\n"
            "This command matches high-risk destructive patterns.\n\n"
            "**Action:** Do NOT execute without explicit user approval and verified backups."
        )

    if any(p in cmd for p in medium_risk):
        return (
            "**Risk Assessment: ESCALATE**\n\n"
            f"Command: `{command}`\n\n"
            "This command appears destructive.\n\n"
            "**Action:** Ask the user to confirm before executing."
        )

    return (
        "**Risk Assessment: ALLOW**\n\n"
        f"Command: `{command}`\n\n"
        "No destructive patterns detected.\n\n"
        "**Action:** Safe to proceed with normal caution."
    )


def recourse_evaluate_mcp(server: str, tool: str, arguments: dict) -> str:
    """
    Evaluate an MCP tool call for destructive consequences BEFORE invocation.

    Use this before calling MCP tools that delete or modify cloud resources.

    Args:
        server: MCP server name (e.g., 'aws', 'kubernetes', 'gcp')
        tool: Tool name (e.g., 's3.delete_bucket', 'rds.delete_instance')
        arguments: Tool arguments as a dictionary

    Returns:
        Risk assessment with recommended action
    """
    tool_lower = tool.lower()

    if any(p in tool_lower for p in ["delete", "remove", "destroy", "terminate", "drop"]):
        target = (
            arguments.get("bucket") or
            arguments.get("name") or
            arguments.get("identifier") or
            str(arguments)
        )
        return (
            "**Risk Assessment: ESCALATE**\n\n"
            f"Server: `{server}`\n"
            f"Tool: `{tool}`\n"
            f"Target: `{target}`\n\n"
            "This tool call appears destructive.\n\n"
            "**Action:** Ask the user to confirm before invoking."
        )

    return (
        "**Risk Assessment: ALLOW**\n\n"
        f"Server: `{server}`\n"
        f"Tool: `{tool}`\n\n"
        "No destructive patterns detected.\n\n"
        "**Action:** Safe to proceed."
    )


def get_recourse_tools() -> list[FunctionTool]:
    """
    Get all RecourseOS tools for use with LlamaIndex agents.

    Usage:
        from llama_recourse import get_recourse_tools
        from llama_index.core.agent import ReActAgent

        tools = get_recourse_tools()
        agent = ReActAgent.from_tools(tools, llm=llm, verbose=True)

    Returns:
        List of FunctionTool instances
    """
    return [
        FunctionTool.from_defaults(
            fn=recourse_evaluate_terraform,
            name="recourse_evaluate_terraform",
            description=(
                "Evaluate a Terraform plan for destructive consequences BEFORE "
                "running terraform apply. Returns risk assessment (allow/warn/escalate/block). "
                "If risk is BLOCK, do NOT proceed without user approval."
            ),
        ),
        FunctionTool.from_defaults(
            fn=recourse_evaluate_shell,
            name="recourse_evaluate_shell",
            description=(
                "Evaluate a shell command for destructive consequences BEFORE execution. "
                "Use for commands like 'aws s3 rm', 'kubectl delete', 'rm -rf', etc. "
                "If risk is BLOCK, do NOT execute."
            ),
        ),
        FunctionTool.from_defaults(
            fn=recourse_evaluate_mcp,
            name="recourse_evaluate_mcp",
            description=(
                "Evaluate an MCP tool call for destructive consequences BEFORE invocation. "
                "Use before calling MCP tools that delete or modify resources. "
                "If risk is ESCALATE or BLOCK, ask user to confirm."
            ),
        ),
    ]
