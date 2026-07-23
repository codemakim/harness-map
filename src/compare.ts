import { resolve } from "node:path";

import type { ClaudeMap } from "./claude.js";
import type { CodexMap } from "./codex.js";
export type CompareState = "shared" | "coverage-gap" | "independent" | "unconfigured";

export interface CompareInstruction {
  displayPath: string;
  effectiveBytes: number;
  truncated: boolean;
  kind: "global" | "project";
  imports: Array<{ displayPath: string; depth: number }>;
}

export interface AgentContext {
  budgetBytes: number | null;
  effectiveBytes: number;
  projectEffectiveBytes: number;
  overBudget: boolean;
  instructions: CompareInstruction[];
}

export interface CompareContext {
  fileCount: number;
  files: string[];
  codex: AgentContext;
  claude: AgentContext;
  state: CompareState;
  missingFor: { codex: string[]; claude: string[] };
  differences: string[];
}

export interface CoverageGap {
  agent: "codex" | "claude";
  affectedFiles: number;
  missingInstructions: string[];
}

export interface CompareResult {
  command: "compare";
  agents: ["codex", "claude"];
  root: string;
  fileCount: number;
  environment: { codex: string[]; claude: string[] };
  coverageGaps: CoverageGap[];
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
      kind: file.kind,
      imports: (file.imports ?? []).map((item) => ({
        displayPath: item.displayPath,
        depth: item.depth,
      })),
    })),
  };
}

function classify(codex: AgentContext, claude: AgentContext): {
  state: CompareState;
  missingFor: CompareContext["missingFor"];
  differences: string[];
} {
  const codexProject = codex.instructions.filter((file) => file.kind === "project");
  const claudeProject = claude.instructions.filter((file) => file.kind === "project");
  if (!codexProject.length && !claudeProject.length) {
    return {
      state: "unconfigured",
      missingFor: { codex: [], claude: [] },
      differences: ["No project instructions"],
    };
  }

  const codexPaths = new Set(codexProject.map((file) => file.displayPath));
  const claudeDirectPaths = new Set(claudeProject.map((file) => file.displayPath));
  const claudeImportedPaths = new Set(claudeProject.flatMap((file) => file.imports.map((item) => item.displayPath)));
  const sharedCodex = [...codexPaths].filter(
    (path) => claudeDirectPaths.has(path) || claudeImportedPaths.has(path),
  );
  const uncoveredCodex = [...codexPaths].filter((path) => !sharedCodex.includes(path));
  const uncoveredClaude = claudeProject
    .filter((file) => (
      !codexPaths.has(file.displayPath) &&
      !file.imports.some((item) => codexPaths.has(item.displayPath))
    ))
    .map((file) => file.displayPath);

  if (!claudeProject.length) {
    return {
      state: "coverage-gap",
      missingFor: { codex: [], claude: uncoveredCodex },
      differences: [`Claude misses: ${uncoveredCodex.join(", ")}`],
    };
  }
  if (!codexProject.length) {
    return {
      state: "coverage-gap",
      missingFor: { codex: uncoveredClaude, claude: [] },
      differences: [`Codex misses: ${uncoveredClaude.join(", ")}`],
    };
  }
  if (sharedCodex.length && uncoveredCodex.length) {
    return {
      state: "coverage-gap",
      missingFor: { codex: [], claude: uncoveredCodex },
      differences: [`Claude misses: ${uncoveredCodex.join(", ")}`],
    };
  }
  if (sharedCodex.length && !uncoveredCodex.length && !uncoveredClaude.length) {
    return {
      state: "shared",
      missingFor: { codex: [], claude: [] },
      differences: [],
    };
  }
  return {
    state: "independent",
    missingFor: { codex: [], claude: [] },
    differences: ["Independent project instruction sources"],
  };
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
      const classification = classify(codex, claude);
      context = {
        fileCount: 0,
        files: [],
        codex,
        claude,
        ...classification,
      };
      groups.set(key, context);
    }
    context.files.push(item.relativePath);
    context.fileCount += 1;
  }
  const contexts = [...groups.values()];
  const coverageGaps: CoverageGap[] = [];
  for (const agent of ["codex", "claude"] as const) {
    const gapContexts = contexts.filter((context) => context.missingFor[agent].length);
    if (!gapContexts.length) continue;
    coverageGaps.push({
      agent,
      affectedFiles: gapContexts.reduce((total, context) => total + context.fileCount, 0),
      missingInstructions: [...new Set(gapContexts.flatMap((context) => context.missingFor[agent]))],
    });
  }
  const environment = (agent: "codex" | "claude"): string[] => [
    ...new Set(contexts.flatMap((context) => (
      context[agent].instructions
        .filter((file) => file.kind === "global")
        .map((file) => file.displayPath)
    ))),
  ];
  return {
    command: "compare",
    agents: ["codex", "claude"],
    root: resolve(root),
    fileCount: items.length,
    environment: {
      codex: environment("codex"),
      claude: environment("claude"),
    },
    coverageGaps,
    contexts,
  };
}
