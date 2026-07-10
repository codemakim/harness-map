import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

export const DEFAULT_BUDGET_BYTES = 32 * 1024;

export interface InstructionFile {
  path: string;
  displayPath: string;
  bytes: number;
  content: string;
  kind: "global" | "project";
  precedence: number;
}

export interface CodexMap {
  agent: "codex";
  target: string;
  cwd: string;
  projectRoot: string;
  budgetBytes: number;
  effectiveBytes: number;
  overBudget: boolean;
  instructions: InstructionFile[];
}

export interface DiscoverOptions {
  cwd: string;
  target: string;
  home: string;
  budgetBytes?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDir: string): Promise<string> {
  const fallback = resolve(startDir);
  let current = fallback;

  while (true) {
    if (await exists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

function directoriesBetween(root: string, cwd: string): string[] {
  const suffix = relative(root, cwd);
  if (!suffix) return [root];
  if (suffix.startsWith("..") || parse(suffix).root) return [root];

  const parts = suffix.split(sep);
  return [root, ...parts.map((_, index) => join(root, ...parts.slice(0, index + 1)))];
}

async function selectInstruction(directory: string): Promise<string | undefined> {
  for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
    const path = join(directory, name);
    if (await exists(path)) return path;
  }
  return undefined;
}

async function loadInstruction(
  path: string,
  kind: InstructionFile["kind"],
  displayPath: string,
): Promise<InstructionFile | undefined> {
  if (!(await stat(path)).isFile()) return undefined;
  const content = await readFile(path, "utf8");
  if (!content.trim()) return undefined;

  return {
    path,
    displayPath,
    bytes: Buffer.byteLength(content),
    content,
    kind,
    precedence: 0,
  };
}

export async function discoverCodex(options: DiscoverOptions): Promise<CodexMap> {
  const cwd = resolve(options.cwd);
  const target = resolve(options.target);
  const projectRoot = await findProjectRoot(cwd);
  const candidates: InstructionFile[] = [];

  const globalPath = await selectInstruction(join(options.home, ".codex"));
  if (globalPath) {
    const name = globalPath.split(sep).at(-1);
    const file = await loadInstruction(globalPath, "global", `~/.codex/${name}`);
    if (file) candidates.push(file);
  }

  for (const directory of directoriesBetween(projectRoot, cwd)) {
    const path = await selectInstruction(directory);
    if (!path) continue;
    const file = await loadInstruction(path, "project", `./${relative(projectRoot, path)}`);
    if (file) candidates.push(file);
  }

  const instructions = candidates.map((file, index) => ({ ...file, precedence: index + 1 }));
  const effectiveBytes = instructions.reduce((total, file) => total + file.bytes, 0);
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;

  return {
    agent: "codex",
    target,
    cwd,
    projectRoot,
    budgetBytes,
    effectiveBytes,
    overBudget: effectiveBytes > budgetBytes,
    instructions,
  };
}
