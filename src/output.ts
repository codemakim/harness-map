import { relative } from "node:path";

import { DEFAULT_BUDGET_BYTES, type CodexMap, type InstructionFile } from "./codex.js";
import type { ClaudeMap } from "./claude.js";
import type { CheckFinding, CheckResult } from "./check.js";
import type { CompareResult } from "./compare.js";
import type { Inspection, Warning } from "./inspect.js";
import type { ScanResult } from "./scan.js";
import type { SyncResult } from "./sync.js";

export function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function toExplainJson(map: CodexMap | ClaudeMap, inspection: Inspection): object {
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

export function renderExplain(map: CodexMap | ClaudeMap, inspection: Inspection): string {
  const lines = ["Effective instructions for:", relative(map.projectRoot, map.target), ""];

  for (const file of map.instructions) {
    const size = file.truncated
      ? `${formatSize(file.effectiveBytes)} of ${formatSize(file.bytes)} (truncated)`
      : formatSize(file.effectiveBytes);
    lines.push(`${file.precedence}. ${file.displayPath}`, `   - ${size}`, "");
    if (file.imports?.length) {
      lines.splice(
        -1,
        0,
        ...file.imports.map((item) => `   - imports ${item.displayPath} (${formatSize(item.bytes)})`),
      );
    }
  }

  if (map.agent === "claude" && !map.instructions.length) {
    lines.push("No instruction files found.", "");
  }

  lines.push(`Total visible size: ${formatSize(map.effectiveBytes)}`);
  lines.push(
    map.budgetBytes === null
      ? "Project budget: not defined"
      : `Project budget: ${formatSize(map.projectEffectiveBytes)} / ${formatSize(map.budgetBytes)}`,
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

function publicFile(file: InstructionFile): object {
  const { content: _content, sourceContent: _sourceContent, ...value } = file;
  return {
    ...value,
    ...(value.imports
      ? {
          imports: value.imports.map(({ content: _importContent, ...item }) => item),
        }
      : {}),
  };
}

export function toTreeJson(files: InstructionFile[], agent = "codex"): object {
  return { command: "tree", agent, files: files.map(publicFile) };
}

export function renderTree(files: InstructionFile[]): string {
  if (!files.length) return "No instruction files found.\n";
  return `${files.map((file) => `${file.displayPath}  ${formatSize(file.bytes)}`).join("\n")}\n`;
}

export function toBudgetJson(
  files: InstructionFile[],
  budgetBytes: number | null = DEFAULT_BUDGET_BYTES,
  agent = "codex",
): object {
  return {
    command: "budget",
    agent,
    budgetBytes,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files: files.map(publicFile),
    overBudgetFiles: budgetBytes === null
      ? []
      : files.filter((file) => file.bytes > budgetBytes).map(publicFile),
  };
}

export function renderBudget(
  files: InstructionFile[],
  budgetBytes: number | null = DEFAULT_BUDGET_BYTES,
): string {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const lines = files.map((file) => `${file.displayPath}  ${formatSize(file.bytes)}`);
  lines.push(
    budgetBytes === null
      ? `Total discovered size: ${formatSize(total)} (no hard budget)`
      : `Total discovered size: ${formatSize(total)} / ${formatSize(budgetBytes)}`,
  );
  return `${lines.join("\n")}\n`;
}

export function toDoctorJson(warnings: Warning[], agent = "codex"): object {
  return { command: "doctor", agent, warnings };
}

export function renderDoctor(warnings: Warning[]): string {
  if (!warnings.length) return "No warnings.\n";
  return `${warnings.map((warning) => `- ${warning.message} (${warning.source})`).join("\n")}\n`;
}

export function renderScan(result: ScanResult): string {
  const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const lines = [
    `Scanned ${count(result.fileCount, "file")} across ${count(result.contexts.length, "effective context")}.`,
  ];
  result.contexts.forEach((context, index) => {
    lines.push("", `${index + 1}. ${count(context.fileCount, "file")} - ${formatSize(context.effectiveBytes)}`);
    lines.push(
      context.instructions.length
        ? `   Instructions: ${context.instructions.map((file) => file.displayPath).join(", ")}`
        : "   Instructions: none",
      ...context.files.slice(0, 5).map((file) => `   - ${file}`),
    );
    if (context.fileCount > 5) lines.push(`   - ... ${context.fileCount - 5} more`);
  });
  return `${lines.join("\n")}\n`;
}

export function renderCompare(result: CompareResult): string {
  const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const lines = [
    `Compared ${count(result.fileCount, "file")} across ${count(result.contexts.length, "comparison context")}.`,
  ];
  if (result.environment.codex.length || result.environment.claude.length) {
    lines.push(
      "",
      "Environment:",
      `- Codex: ${result.environment.codex.join(", ") || "none"}`,
      `- Claude: ${result.environment.claude.join(", ") || "none"}`,
    );
  }
  if (result.coverageGaps.length) {
    lines.push("", "Coverage gaps:");
    for (const gap of result.coverageGaps) {
      const name = gap.agent === "claude" ? "Claude" : "Codex";
      lines.push(
        `- ${name} misses instructions for ${count(gap.affectedFiles, "file")}`,
        ...gap.missingInstructions.map((path) => `  - ${path}`),
      );
    }
  }
  result.contexts.forEach((context, index) => {
    const codexProject = context.codex.instructions.filter((file) => file.kind === "project");
    const claudeProject = context.claude.instructions.filter((file) => file.kind === "project");
    const codexBudget = context.codex.budgetBytes === null
      ? "no hard budget"
      : `${formatSize(context.codex.projectEffectiveBytes)} / ${formatSize(context.codex.budgetBytes)}`;
    const claudeBudget = context.claude.budgetBytes === null
      ? `${formatSize(context.claude.effectiveBytes)} / no hard budget`
      : `${formatSize(context.claude.effectiveBytes)} / ${formatSize(context.claude.budgetBytes)}`;
    lines.push(
      "",
      `${index + 1}. ${count(context.fileCount, "file")} - ${context.state}`,
      `   Codex: ${codexBudget}`,
      `   - ${codexProject.map((file) => file.displayPath).join(", ") || "no project instructions"}`,
      `   Claude: ${claudeBudget}`,
      `   - ${claudeProject.map((file) => file.displayPath).join(", ") || "no project instructions"}`,
      "   Findings:",
      ...(context.differences.length
        ? context.differences.map((value) => `   - ${value}`)
        : ["   - none"]),
      "   Files:",
      ...context.files.slice(0, 5).map((file) => `   - ${file}`),
    );
    if (context.fileCount > 5) lines.push(`   - ... ${context.fileCount - 5} more`);
  });
  return `${lines.join("\n")}\n`;
}

export function renderCheck(result: CheckResult): string {
  if (!result.errors.length && !result.warnings.length && !result.info.length) {
    return "No actionable findings.\n";
  }
  const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const lines = [
    `${count(result.errors.length, "error")}, ${count(result.warnings.length, "warning")}, ${result.info.length} info`,
  ];
  const add = (level: string, finding: CheckFinding): void => {
    lines.push("", `${level} ${finding.message}`);
    if (finding.affectedFiles) {
      lines.push(
        level === "INFO"
          ? `- ${count(finding.affectedFiles, "file")} in project`
          : `- ${count(finding.affectedFiles, "file")} affected`,
      );
    }
    if (finding.source) lines.push(`- Source: ${finding.source}`);
    if (finding.instructions) lines.push(...finding.instructions.map((path) => `- ${path}`));
  };
  result.errors.forEach((finding) => add("ERROR", finding));
  result.warnings.forEach((finding) => add("WARN", finding));
  result.info.forEach((finding) => add("INFO", finding));
  return `${lines.join("\n")}\n`;
}

export function renderSync(result: SyncResult): string {
  const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;
  if (!result.proposals.length && !result.conflicts.length) return "No Claude bridges needed.\n";
  const lines = [
    `Dry run: ${count(result.proposals.length, "bridge")} proposed, ${count(result.conflicts.length, "conflict")}.`,
  ];
  for (const item of result.proposals) {
    lines.push(
      "",
      `CREATE ${item.path}`,
      `- Source: ${item.source}`,
      `- ${count(item.affectedFiles, "file")} affected`,
      `- Content: ${item.content.trim()}`,
    );
  }
  for (const item of result.conflicts) {
    lines.push(
      "",
      `CONFLICT ${item.path}`,
      `- Source: ${item.source}`,
      `- ${count(item.affectedFiles, "file")} affected`,
      `- ${item.reason}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
