import { readFile, stat } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

import { findProjectRoot, type InstructionFile } from "./codex.js";

export interface ClaudeMap {
  agent: "claude";
  target: string;
  cwd: string;
  projectRoot: string;
  budgetBytes: null;
  effectiveBytes: number;
  projectEffectiveBytes: number;
  overBudget: false;
  instructions: InstructionFile[];
  skippedInstructions: InstructionFile[];
}

export interface DiscoverClaudeOptions {
  cwd: string;
  target: string;
  userHome: string;
}

function directoriesBetween(root: string, cwd: string): string[] {
  const suffix = relative(root, cwd);
  if (!suffix) return [root];
  if (suffix.startsWith("..") || parse(suffix).root) return [root];
  const parts = suffix.split(sep);
  return [root, ...parts.map((_, index) => join(root, ...parts.slice(0, index + 1)))];
}

async function load(
  path: string,
  displayPath: string,
  kind: InstructionFile["kind"],
): Promise<InstructionFile | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    const data = await readFile(path);
    const content = data.toString("utf8");
    if (!content.trim()) return undefined;
    return {
      path,
      displayPath,
      bytes: data.length,
      effectiveBytes: data.length,
      content,
      kind,
      precedence: 0,
      truncated: false,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

export async function discoverClaude(options: DiscoverClaudeOptions): Promise<ClaudeMap> {
  const cwd = resolve(options.cwd);
  const target = resolve(options.target);
  const projectRoot = await findProjectRoot(cwd);
  const files: InstructionFile[] = [];
  const userFile = await load(
    join(options.userHome, ".claude/CLAUDE.md"),
    "~/.claude/CLAUDE.md",
    "global",
  );
  if (userFile) files.push(userFile);

  for (const directory of directoriesBetween(projectRoot, cwd)) {
    const paths = [join(directory, "CLAUDE.md")];
    if (directory === projectRoot) paths.push(join(directory, ".claude/CLAUDE.md"));
    paths.push(join(directory, "CLAUDE.local.md"));
    for (const path of paths) {
      const file = await load(path, `./${relative(projectRoot, path)}`, "project");
      if (file) files.push(file);
    }
  }

  const instructions = files.map((file, index) => ({ ...file, precedence: index + 1 }));
  const projectEffectiveBytes = instructions
    .filter((file) => file.kind === "project")
    .reduce((total, file) => total + file.effectiveBytes, 0);

  return {
    agent: "claude",
    target,
    cwd,
    projectRoot,
    budgetBytes: null,
    effectiveBytes: instructions.reduce((total, file) => total + file.effectiveBytes, 0),
    projectEffectiveBytes,
    overBudget: false,
    instructions,
    skippedInstructions: [],
  };
}
