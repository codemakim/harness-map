import { relative } from "node:path";

import { DEFAULT_BUDGET_BYTES, type CodexMap, type InstructionFile } from "./codex.js";
import type { Inspection, Warning } from "./inspect.js";

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
    projectEffectiveBytes: map.projectEffectiveBytes,
    overBudget: map.overBudget,
    instructions: map.instructions.map(publicFile),
    skippedInstructions: map.skippedInstructions.map(publicFile),
    overrides: inspection.overrides,
    warnings: inspection.warnings,
  };
}

export function renderExplain(map: CodexMap, inspection: Inspection): string {
  const lines = ["Effective instructions for:", relative(map.projectRoot, map.target), ""];

  for (const file of map.instructions) {
    const size = file.truncated
      ? `${formatSize(file.effectiveBytes)} of ${formatSize(file.bytes)} (truncated)`
      : formatSize(file.effectiveBytes);
    lines.push(`${file.precedence}. ${file.displayPath}`, `   - ${size}`, "");
  }

  lines.push(
    `Total visible size: ${formatSize(map.effectiveBytes)}`,
    `Project budget: ${formatSize(map.projectEffectiveBytes)} / ${formatSize(map.budgetBytes)}`,
  );

  if (map.skippedInstructions.length) {
    lines.push(
      "",
      "Skipped by budget:",
      ...map.skippedInstructions.map((file) => `- ${file.displayPath} (${formatSize(file.bytes)})`),
    );
  }

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

function publicFile(file: InstructionFile): Omit<InstructionFile, "content"> {
  const { content: _content, ...value } = file;
  return value;
}

export function toTreeJson(files: InstructionFile[]): object {
  return { command: "tree", files: files.map(publicFile) };
}

export function renderTree(files: InstructionFile[]): string {
  if (!files.length) return "No instruction files found.\n";
  return `${files.map((file) => `${file.displayPath}  ${formatSize(file.bytes)}`).join("\n")}\n`;
}

export function toBudgetJson(
  files: InstructionFile[],
  budgetBytes = DEFAULT_BUDGET_BYTES,
): object {
  return {
    command: "budget",
    budgetBytes,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files: files.map(publicFile),
    overBudgetFiles: files.filter((file) => file.bytes > budgetBytes).map(publicFile),
  };
}

export function renderBudget(
  files: InstructionFile[],
  budgetBytes = DEFAULT_BUDGET_BYTES,
): string {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const lines = files.map((file) => `${file.displayPath}  ${formatSize(file.bytes)}`);
  lines.push(`Total discovered size: ${formatSize(total)} / ${formatSize(budgetBytes)}`);
  return `${lines.join("\n")}\n`;
}

export function toDoctorJson(warnings: Warning[]): object {
  return { command: "doctor", warnings };
}

export function renderDoctor(warnings: Warning[]): string {
  if (!warnings.length) return "No warnings.\n";
  return `${warnings.map((warning) => `- ${warning.message} (${warning.source})`).join("\n")}\n`;
}
