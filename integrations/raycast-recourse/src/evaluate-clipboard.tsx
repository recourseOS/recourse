/**
 * Quick evaluate from clipboard
 */

import { showHUD, Clipboard, showToast, Toast } from "@raycast/api";

// High-risk patterns
const HIGH_RISK_PATTERNS = [
  "rm -rf",
  "--recursive",
  "drop database",
  "drop table",
  "truncate",
  "--skip-final-snapshot",
  "delete-db-instance",
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
];

export default async function EvaluateClipboard() {
  try {
    const text = await Clipboard.readText();

    if (!text || !text.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Clipboard is empty",
      });
      return;
    }

    const cmd = text.toLowerCase();

    if (HIGH_RISK_PATTERNS.some((p) => cmd.includes(p))) {
      await showHUD("🛑 BLOCK: High-risk destructive command");
    } else if (MEDIUM_RISK_PATTERNS.some((p) => cmd.includes(p))) {
      await showHUD("⚠️ ESCALATE: Requires confirmation");
    } else {
      await showHUD("✅ ALLOW: No destructive patterns");
    }
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to read clipboard",
    });
  }
}
