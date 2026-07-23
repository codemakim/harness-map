import type {
  AgentContext,
  CompareInstruction,
  CompareResult,
  CompareState,
} from "./compare.js";

interface DiffInstruction {
  displayPath: string;
  effectiveBytes: number;
  truncated: boolean;
  imports: Array<{ displayPath: string; depth: number }>;
}

interface DiffAgentContext {
  budgetBytes: number | null;
  effectiveBytes: number;
  overBudget: boolean;
  instructions: DiffInstruction[];
}

export interface DiffSide {
  state: CompareState;
  codex: DiffAgentContext;
  claude: DiffAgentContext;
}

export interface DiffChange {
  fileCount: number;
  files: string[];
  before: DiffSide;
  after: DiffSide;
  added: { codex: string[]; claude: string[] };
  removed: { codex: string[]; claude: string[] };
}

export interface DiffResult {
  command: "diff";
  before: string;
  after: string;
  beforeFileCount: number;
  afterFileCount: number;
  changedFiles: number;
  addedFiles: string[];
  removedFiles: string[];
  changes: DiffChange[];
}

function agentSnapshot(context: AgentContext): DiffAgentContext {
  const projectInstructions = context.instructions.filter((file) => file.kind === "project");
  return {
    budgetBytes: context.budgetBytes,
    effectiveBytes: context.projectEffectiveBytes,
    overBudget: context.overBudget,
    instructions: projectInstructions.map((file: CompareInstruction) => ({
      displayPath: file.displayPath,
      effectiveBytes: file.effectiveBytes,
      truncated: file.truncated,
      imports: file.imports,
    })),
  };
}

function fileMap(result: CompareResult): Map<string, DiffSide> {
  const files = new Map<string, DiffSide>();
  for (const context of result.contexts) {
    const side = {
      state: context.state,
      codex: agentSnapshot(context.codex),
      claude: agentSnapshot(context.claude),
    };
    for (const file of context.files) files.set(file, side);
  }
  return files;
}

function sourcePaths(side: DiffSide, agent: "codex" | "claude"): string[] {
  return [...new Set(side[agent].instructions.flatMap((file) => [
    file.displayPath,
    ...file.imports.map((item) => item.displayPath),
  ]))];
}

function subtract(left: string[], right: string[]): string[] {
  const other = new Set(right);
  return left.filter((value) => !other.has(value));
}

export function buildDiffResult(
  beforeLabel: string,
  afterLabel: string,
  beforeResult: CompareResult,
  afterResult: CompareResult,
): DiffResult {
  const before = fileMap(beforeResult);
  const after = fileMap(afterResult);
  const addedFiles = [...after.keys()].filter((file) => !before.has(file)).sort();
  const removedFiles = [...before.keys()].filter((file) => !after.has(file)).sort();
  const groups = new Map<string, DiffChange>();

  for (const file of [...before.keys()].filter((path) => after.has(path)).sort()) {
    const left = before.get(file)!;
    const right = after.get(file)!;
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    const added = {
      codex: subtract(sourcePaths(right, "codex"), sourcePaths(left, "codex")),
      claude: subtract(sourcePaths(right, "claude"), sourcePaths(left, "claude")),
    };
    const removed = {
      codex: subtract(sourcePaths(left, "codex"), sourcePaths(right, "codex")),
      claude: subtract(sourcePaths(left, "claude"), sourcePaths(right, "claude")),
    };
    const key = JSON.stringify({ left, right, added, removed });
    let change = groups.get(key);
    if (!change) {
      change = { fileCount: 0, files: [], before: left, after: right, added, removed };
      groups.set(key, change);
    }
    change.files.push(file);
    change.fileCount += 1;
  }

  const changes = [...groups.values()];
  return {
    command: "diff",
    before: beforeLabel,
    after: afterLabel,
    beforeFileCount: before.size,
    afterFileCount: after.size,
    changedFiles: changes.reduce((total, change) => total + change.fileCount, 0),
    addedFiles,
    removedFiles,
    changes,
  };
}
