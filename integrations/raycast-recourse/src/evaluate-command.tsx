/**
 * RecourseOS Raycast Extension
 *
 * Quick consequence evaluation from your macOS command bar.
 */

import {
  ActionPanel,
  Action,
  Detail,
  Form,
  Icon,
  Color,
  showToast,
  Toast,
  Clipboard,
  getSelectedText,
} from "@raycast/api";
import { useState, useEffect } from "react";
import { execSync } from "child_process";

type RiskLevel = "allow" | "warn" | "escalate" | "block";

interface EvaluationResult {
  riskAssessment: RiskLevel;
  command: string;
  tier: string;
  reasoning: string;
}

// High-risk patterns
const HIGH_RISK_PATTERNS = [
  "rm -rf",
  "--recursive",
  "drop database",
  "drop table",
  "truncate",
  "--skip-final-snapshot",
  "force_destroy",
  "delete-db-instance",
  "delete-db-cluster",
];

// Medium-risk patterns
const MEDIUM_RISK_PATTERNS = [
  "delete",
  "remove",
  "terminate",
  "destroy",
  "drop",
  "kubectl delete",
  "docker rm",
  "docker rmi",
  "aws s3 rm",
  "gcloud compute instances delete",
  "az vm delete",
];

/**
 * Evaluate a shell command
 */
function evaluateCommand(command: string): EvaluationResult {
  const cmd = command.toLowerCase();

  if (HIGH_RISK_PATTERNS.some((p) => cmd.includes(p))) {
    return {
      riskAssessment: "block",
      command,
      tier: "unrecoverable",
      reasoning: "Command matches high-risk destructive patterns",
    };
  }

  if (MEDIUM_RISK_PATTERNS.some((p) => cmd.includes(p))) {
    return {
      riskAssessment: "escalate",
      command,
      tier: "needs-review",
      reasoning: "Command appears destructive, requires confirmation",
    };
  }

  return {
    riskAssessment: "allow",
    command,
    tier: "reversible",
    reasoning: "No destructive patterns detected",
  };
}

/**
 * Get icon and color for risk level
 */
function getRiskDisplay(risk: RiskLevel): { icon: Icon; color: Color; label: string } {
  switch (risk) {
    case "block":
      return { icon: Icon.XMarkCircle, color: Color.Red, label: "BLOCK" };
    case "escalate":
      return { icon: Icon.ExclamationMark, color: Color.Orange, label: "ESCALATE" };
    case "warn":
      return { icon: Icon.Warning, color: Color.Yellow, label: "WARN" };
    default:
      return { icon: Icon.Checkmark, color: Color.Green, label: "ALLOW" };
  }
}

/**
 * Main command: Evaluate Command
 */
export default function EvaluateCommand() {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Try to get selected text or clipboard on mount
  useEffect(() => {
    async function loadCommand() {
      try {
        const selected = await getSelectedText();
        if (selected && selected.trim()) {
          setCommand(selected.trim());
          setResult(evaluateCommand(selected.trim()));
        }
      } catch {
        try {
          const clipboard = await Clipboard.readText();
          if (clipboard && clipboard.trim()) {
            setCommand(clipboard.trim());
            setResult(evaluateCommand(clipboard.trim()));
          }
        } catch {
          // No text available
        }
      }
      setIsLoading(false);
    }
    loadCommand();
  }, []);

  // Handle form submit
  function handleSubmit(values: { command: string }) {
    const cmd = values.command.trim();
    if (!cmd) {
      showToast({ style: Toast.Style.Failure, title: "Please enter a command" });
      return;
    }
    setCommand(cmd);
    setResult(evaluateCommand(cmd));
  }

  // Show result if available
  if (result) {
    const { icon, color, label } = getRiskDisplay(result.riskAssessment);

    const markdown = `
# ${label} ${result.riskAssessment === "block" ? "🛑" : result.riskAssessment === "escalate" ? "⚠️" : "✅"}

## Command
\`\`\`bash
${result.command}
\`\`\`

## Assessment

| Field | Value |
|-------|-------|
| Risk Level | **${label}** |
| Tier | ${result.tier} |
| Reasoning | ${result.reasoning} |

---

${
  result.riskAssessment === "block"
    ? "**Do not execute this command.** It may cause unrecoverable data loss."
    : result.riskAssessment === "escalate"
    ? "**Confirm before executing.** This command appears destructive."
    : "**Safe to proceed** with normal caution."
}
`;

    return (
      <Detail
        markdown={markdown}
        metadata={
          <Detail.Metadata>
            <Detail.Metadata.TagList title="Risk">
              <Detail.Metadata.TagList.Item text={label} color={color} />
            </Detail.Metadata.TagList>
            <Detail.Metadata.Label title="Tier" text={result.tier} />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Link
              title="Documentation"
              target="https://recourseos.dev/docs"
              text="RecourseOS Docs"
            />
          </Detail.Metadata>
        }
        actions={
          <ActionPanel>
            <Action
              title="Evaluate Another"
              icon={Icon.ArrowClockwise}
              onAction={() => {
                setResult(null);
                setCommand("");
              }}
            />
            <Action.CopyToClipboard
              title="Copy Command"
              content={result.command}
            />
            <Action.OpenInBrowser
              title="Open Documentation"
              url="https://recourseos.dev/docs"
            />
          </ActionPanel>
        }
      />
    );
  }

  // Show form
  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Evaluate" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="command"
        title="Command"
        placeholder="Enter a shell command to evaluate..."
        value={command}
        onChange={setCommand}
        info="Paste a shell command to check for destructive consequences"
      />
    </Form>
  );
}
