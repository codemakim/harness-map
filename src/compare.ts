import { resolve } from "node:path";

import type { ClaudeMap } from "./claude.js";
import type { CodexMap } from "./codex.js";
import type { ScanInstruction } from "./scan.js";

interface AgentContext {
  budgetBytes: number | null;
  effectiveBytes: number;
  projectEffectiveBytes: number;
  overBudget: boolean;
  instructions: ScanInstruction[];
}

export interface CompareContext {
  fileCount: number;
  files: string[];
  codex: AgentContext;
  claude: AgentContext;
  differences: string[];
}

export interface CompareResult {
  command: "compare";
  agents: ["codex", "claude"];
  root: string;
  fileCount: number;
  contexts: CompareContext[];
}

function snapshot(map: CodexMap | ClaudeMap): AgentContext {
  return {
    budgetBytes: map.budgetBytes,
    effectiveBytes: map.effectiveBytes,
    projectEffectiveBytes: map.projectEffectiveBytes,
    overBudget: map.overBudget,
    instructions: map.instructions.map((file) => ({
      displayPath: file.displayPath,
      effectiveBytes: file.effectiveBytes,
      truncated: file.truncated,
    })),
  };
}

function differences(codex: AgentContext, claude: AgentContext): string[] {
  const values: string[] = [];
  if (codex.budgetBytes !== claude.budgetBytes) values.push("Instruction budgets differ");
  if (codex.effectiveBytes !== claude.effectiveBytes) values.push("Visible instruction sizes differ");
  const codexPaths = new Set(codex.instructions.map((file) => file.displayPath));
  const claudePaths = new Set(claude.instructions.map((file) => file.displayPath));
  const codexOnly = [...codexPaths].filter((path) => !claudePaths.has(path));
  const claudeOnly = [...claudePaths].filter((path) => !codexPaths.has(path));
  if (codexOnly.length) values.push(`Codex only: ${codexOnly.join(", ")}`);
  if (claudeOnly.length) values.push(`Claude only: ${claudeOnly.join(", ")}`);
  return values;
}

export function groupCompareMaps(
  root: string,
  items: Array<{ relativePath: string; codex: CodexMap; claude: ClaudeMap }>,
): CompareResult {
  const groups = new Map<string, CompareContext>();
  for (const item of items) {
    const codex = snapshot(item.codex);
    const claude = snapshot(item.claude);
    const key = JSON.stringify({ codex, claude });
    let context = groups.get(key);
    if (!context) {
      context = {
        fileCount: 0,
        files: [],
        codex,
        claude,
        differences: differences(codex, claude),
      };
      groups.set(key, context);
    }
    context.files.push(item.relativePath);
    context.fileCount += 1;
  }
  return {
    command: "compare",
    agents: ["codex", "claude"],
    root: resolve(root),
    fileCount: items.length,
    contexts: [...groups.values()],
  };
}
