"""RecourseOS tools for LangChain agents."""

from __future__ import annotations

import json
import subprocess
import tempfile
from typing import Any, Optional, Type

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field


class TerraformPlanInput(BaseModel):
    """Input for Terraform plan evaluation."""

    plan_json: str = Field(
        description="Terraform plan JSON (from 'terraform show -json plan.out')"
    )
    state_json: Optional[str] = Field(
        default=None,
        description="Optional Terraform state JSON for improved accuracy",
    )


class ShellCommandInput(BaseModel):
    """Input for shell command evaluation."""

    command: str = Field(
        description="Shell command to evaluate (e.g., 'aws s3 rm s3://bucket --recursive')"
    )


class MCPToolCallInput(BaseModel):
    """Input for MCP tool call evaluation."""

    server: str = Field(description="MCP server name (e.g., 'aws', 'kubernetes')")
    tool: str = Field(description="Tool name (e.g., 's3.delete_bucket')")
    arguments: dict = Field(description="Tool arguments as a dictionary")


class ConsequenceReport(BaseModel):
    """Consequence evaluation result."""

    risk: str = Field(description="Risk assessment: allow, warn, escalate, or block")
    tier: str = Field(description="Worst recoverability tier")
    total_changes: int = Field(description="Number of changes evaluated")
    has_unrecoverable: bool = Field(description="Whether any changes are unrecoverable")
    reasoning: str = Field(description="Explanation of the assessment")
    raw: dict = Field(description="Full raw report")


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


def _parse_report(raw: dict) -> ConsequenceReport:
    """Parse raw CLI output into a ConsequenceReport."""
    if "error" in raw:
        return ConsequenceReport(
            risk="escalate",
            tier="unknown",
            total_changes=0,
            has_unrecoverable=False,
            reasoning=f"Error: {raw['error']}",
            raw=raw,
        )

    summary = raw.get("summary", {})
    has_unrecoverable = summary.get("hasUnrecoverable", False)
    needs_review = summary.get("needsReview", 0)
    tier = summary.get("worstTier", "unknown")

    # Determine risk level
    if has_unrecoverable:
        risk = "block"
    elif needs_review > 0:
        risk = "escalate"
    elif tier in ("recoverable-from-backup", "recoverable-with-effort"):
        risk = "warn"
    else:
        risk = "allow"

    # Build reasoning from changes
    changes = raw.get("changes", [])
    if changes:
        reasons = [c.get("recoverability", {}).get("reasoning", "") for c in changes]
        reasoning = "; ".join(filter(None, reasons))
    else:
        reasoning = "No changes detected"

    return ConsequenceReport(
        risk=risk,
        tier=tier,
        total_changes=summary.get("totalChanges", 0),
        has_unrecoverable=has_unrecoverable,
        reasoning=reasoning,
        raw=raw,
    )


class RecourseEvaluateTerraform(BaseTool):
    """Evaluate Terraform plan consequences before apply.

    Use this tool BEFORE executing terraform apply to check if the changes
    are safe. The tool will analyze the plan and return a risk assessment.

    If the risk is 'block', DO NOT proceed without explicit user approval.
    If the risk is 'escalate', ask the user before proceeding.
    """

    name: str = "recourse_evaluate_terraform"
    description: str = (
        "Evaluate a Terraform plan for destructive consequences. "
        "Returns risk assessment (allow/warn/escalate/block) and recoverability info. "
        "Use BEFORE terraform apply to prevent unrecoverable changes."
    )
    args_schema: Type[BaseModel] = TerraformPlanInput

    def _run(
        self,
        plan_json: str,
        state_json: Optional[str] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        # Write plan to temp file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as plan_file:
            plan_file.write(plan_json)
            plan_path = plan_file.name

        args = ["plan", plan_path, "--format", "json"]

        # Add state if provided
        if state_json:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False
            ) as state_file:
                state_file.write(state_json)
                args.extend(["--state", state_file.name])

        raw = _run_recourse_cli(args)
        report = _parse_report(raw)

        return self._format_response(report)

    def _format_response(self, report: ConsequenceReport) -> str:
        lines = [
            f"**Risk Assessment: {report.risk.upper()}**",
            f"Recoverability Tier: {report.tier}",
            f"Changes Evaluated: {report.total_changes}",
            "",
            f"**Reasoning:** {report.reasoning}",
        ]

        if report.risk == "block":
            lines.append("")
            lines.append(
                "⛔ BLOCKED: This action would cause unrecoverable data loss. "
                "Do NOT proceed without explicit user approval and confirmation "
                "that backups exist."
            )
        elif report.risk == "escalate":
            lines.append("")
            lines.append(
                "⚠️ ESCALATE: This action requires human review. "
                "Ask the user to confirm before proceeding."
            )

        return "\n".join(lines)


class RecourseEvaluateShell(BaseTool):
    """Evaluate shell command consequences before execution.

    Use this tool BEFORE running destructive shell commands like:
    - aws s3 rm, aws rds delete-db-instance
    - rm -rf, kubectl delete
    - DROP TABLE, TRUNCATE
    """

    name: str = "recourse_evaluate_shell"
    description: str = (
        "Evaluate a shell command for destructive consequences. "
        "Use BEFORE executing commands that delete data or resources. "
        "Returns risk assessment and whether to proceed."
    )
    args_schema: Type[BaseModel] = ShellCommandInput

    def _run(
        self,
        command: str,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        # Use the MCP server's shell evaluation via CLI
        # For now, we'll do pattern matching similar to the console demo
        raw = _run_recourse_cli(["mcp", "eval-shell", command, "--format", "json"])

        if "error" in raw:
            # Fallback: basic pattern analysis
            return self._fallback_analysis(command)

        report = _parse_report(raw)
        return self._format_response(report, command)

    def _fallback_analysis(self, command: str) -> str:
        """Basic pattern matching when CLI isn't available."""
        cmd = command.lower()

        # High-risk patterns
        if any(p in cmd for p in ["rm -rf", "--recursive", "drop ", "truncate ", "delete-db", "--skip-final-snapshot"]):
            return (
                "**Risk Assessment: BLOCK**\n\n"
                "⛔ This command matches high-risk destructive patterns. "
                "Do NOT execute without explicit user approval and verified backups."
            )

        # Medium-risk patterns
        if any(p in cmd for p in ["delete", "remove", "terminate", "destroy"]):
            return (
                "**Risk Assessment: ESCALATE**\n\n"
                "⚠️ This command appears destructive. "
                "Ask the user to confirm before proceeding."
            )

        return (
            "**Risk Assessment: ALLOW**\n\n"
            "No destructive patterns detected. Proceed with normal caution."
        )

    def _format_response(self, report: ConsequenceReport, command: str) -> str:
        lines = [
            f"**Risk Assessment: {report.risk.upper()}**",
            f"Command: `{command}`",
            "",
            f"**Analysis:** {report.reasoning}",
        ]

        if report.risk == "block":
            lines.append("")
            lines.append("⛔ BLOCKED: Do NOT execute this command.")
        elif report.risk == "escalate":
            lines.append("")
            lines.append("⚠️ Ask user to confirm before executing.")

        return "\n".join(lines)


class RecourseEvaluateMCP(BaseTool):
    """Evaluate MCP tool call consequences before invocation.

    Use this tool BEFORE calling other MCP tools that modify state,
    especially tools from AWS, GCP, Azure, or Kubernetes servers.
    """

    name: str = "recourse_evaluate_mcp"
    description: str = (
        "Evaluate an MCP tool call for destructive consequences. "
        "Use BEFORE invoking MCP tools that delete or modify resources. "
        "Pass the server name, tool name, and arguments."
    )
    args_schema: Type[BaseModel] = MCPToolCallInput

    def _run(
        self,
        server: str,
        tool: str,
        arguments: dict,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        # Build the tool call JSON
        tool_call = {"server": server, "tool": tool, "arguments": arguments}

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(tool_call, f)
            call_path = f.name

        raw = _run_recourse_cli(["mcp", "eval-mcp", call_path, "--format", "json"])

        if "error" in raw:
            return self._fallback_analysis(tool, arguments)

        report = _parse_report(raw)
        return self._format_response(report, server, tool)

    def _fallback_analysis(self, tool: str, arguments: dict) -> str:
        """Basic pattern matching when CLI isn't available."""
        tool_lower = tool.lower()

        if any(p in tool_lower for p in ["delete", "remove", "destroy", "terminate"]):
            return (
                f"**Risk Assessment: ESCALATE**\n\n"
                f"Tool `{tool}` appears destructive. "
                f"Ask the user to confirm before invoking."
            )

        return (
            f"**Risk Assessment: ALLOW**\n\n"
            f"Tool `{tool}` does not match destructive patterns."
        )

    def _format_response(
        self, report: ConsequenceReport, server: str, tool: str
    ) -> str:
        lines = [
            f"**Risk Assessment: {report.risk.upper()}**",
            f"Server: {server}",
            f"Tool: {tool}",
            "",
            f"**Analysis:** {report.reasoning}",
        ]

        if report.risk == "block":
            lines.append("")
            lines.append("⛔ BLOCKED: Do NOT invoke this tool.")
        elif report.risk == "escalate":
            lines.append("")
            lines.append("⚠️ Ask user to confirm before invoking.")

        return "\n".join(lines)


class RecourseToolkit:
    """Toolkit containing all RecourseOS evaluation tools.

    Usage:
        from langchain_recourse import RecourseToolkit

        toolkit = RecourseToolkit()
        tools = toolkit.get_tools()

        # Add to your agent
        agent = create_react_agent(llm, tools, prompt)
    """

    def get_tools(self) -> list[BaseTool]:
        """Get all RecourseOS tools."""
        return [
            RecourseEvaluateTerraform(),
            RecourseEvaluateShell(),
            RecourseEvaluateMCP(),
        ]
