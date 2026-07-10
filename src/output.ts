import { relative } from "node:path";

import type { CodexMap } from "./codex.js";
import type { Inspection } from "./inspect.js";

export function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function toExplainJson(map: CodexMap, inspection: Inspection): object {
  return {
    agent: map.agent,
    target: relative(map.projectRoot, map.target),
    cwd: map.cwd,
    budgetBytes: map.budgetBytes,
    effectiveBytes: map.effectiveBytes,
    overBudget: map.overBudget,
    instructions: map.instructions.map(({ content: _content, ...file }) => file),
    overrides: inspection.overrides,
    warnings: inspection.warnings,
  };
}

export function renderExplain(map: CodexMap, inspection: Inspection): string {
  const lines = ["Effective instructions for:", relative(map.projectRoot, map.target), ""];

  for (const file of map.instructions) {
    lines.push(`${file.precedence}. ${file.displayPath}`, `   - ${formatSize(file.bytes)}`, "");
  }

  lines.push(`Effective size: ${formatSize(map.effectiveBytes)} / ${formatSize(map.budgetBytes)}`);

  if (inspection.overrides.length) {
    lines.push(
      "",
      "Overrides:",
      ...inspection.overrides.map(
        (item) =>
          `- ${item.kind === "package-manager" ? "Package manager" : "Test command"}: ${item.from} -> ${item.to}`,
      ),
    );
  }

  if (inspection.warnings.length) {
    lines.push("", "Warnings:", ...inspection.warnings.map((item) => `- ${item.message}`));
  }

  return `${lines.join("\n")}\n`;
}
