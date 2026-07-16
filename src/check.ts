import type { CompareResult } from "./compare.js";
import type { Warning } from "./inspect.js";

export interface CheckFinding {
  kind: "coverage-gap" | "missing-reference" | "missing-package-script" | "instruction-over-budget" | "independent" | "unconfigured";
  message: string;
  affectedFiles: number;
  instructions?: string[];
  source?: string;
}

export interface CheckResult {
  command: "check";
  agents: ["codex", "claude"];
  fileCount: number;
  affectedFiles: number;
  errors: CheckFinding[];
  warnings: CheckFinding[];
  info: CheckFinding[];
}

export function buildCheckResult(compare: CompareResult, inspectionWarnings: Warning[]): CheckResult {
  const errors: CheckFinding[] = compare.coverageGaps.map((gap) => ({
    kind: "coverage-gap",
    message: `${gap.agent === "claude" ? "Claude" : "Codex"} misses project instructions`,
    affectedFiles: gap.affectedFiles,
    instructions: gap.missingInstructions,
  }));
  const warnings: CheckFinding[] = [];
  const info: CheckFinding[] = [];

  const seen = new Set<string>();
  for (const warning of inspectionWarnings) {
    const key = `${warning.kind}\0${warning.message}\0${warning.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const finding: CheckFinding = {
      kind: warning.kind,
      message: warning.message,
      affectedFiles: 0,
      source: warning.source,
    };
    (warning.kind === "missing-reference" ? errors : warnings).push(finding);
  }

  const independentFiles = compare.contexts
    .filter((context) => context.state === "independent")
    .reduce((total, context) => total + context.fileCount, 0);
  if (independentFiles) {
    warnings.push({
      kind: "independent",
      message: "Codex and Claude use independent project instructions",
      affectedFiles: independentFiles,
    });
  }

  const unconfiguredFiles = compare.contexts
    .filter((context) => context.state === "unconfigured")
    .reduce((total, context) => total + context.fileCount, 0);
  if (unconfiguredFiles) {
    info.push({
      kind: "unconfigured",
      message: "No project instructions found for Codex or Claude",
      affectedFiles: unconfiguredFiles,
    });
  }

  const affectedFiles = new Set(
    compare.contexts
      .filter((context) => context.state === "coverage-gap")
      .flatMap((context) => context.files),
  ).size;
  return {
    command: "check",
    agents: compare.agents,
    fileCount: compare.fileCount,
    affectedFiles,
    errors,
    warnings,
    info,
  };
}
