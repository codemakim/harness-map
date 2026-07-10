import { execFile as execFileCallback } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { CodexConfig } from "./codex-config.js";

const execFile = promisify(execFileCallback);

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
  config: CodexConfig;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDir: string, markers: string[] = [".git"]): Promise<string> {
  const fallback = resolve(startDir);
  if (!markers.length) return fallback;
  let current = fallback;

  while (true) {
    if ((await Promise.all(markers.map((marker) => exists(join(current, marker))))).some(Boolean)) {
      return current;
    }
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

export function instructionFilenames(fallbackFilenames: string[] = []): string[] {
  return [...new Set(["AGENTS.override.md", "AGENTS.md", ...fallbackFilenames])]
    .map((name) => name.trim())
    .filter(Boolean);
}

async function selectInstruction(
  directory: string,
  filenames: string[],
  skipEmpty: boolean,
): Promise<string | undefined> {
  for (const name of filenames) {
    const path = join(directory, name);
    try {
      if (!(await stat(path)).isFile()) continue;
      if (!skipEmpty || (await readFile(path, "utf8")).trim()) return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
  const projectRoot = await findProjectRoot(cwd, options.config.rootMarkers);
  const candidates: InstructionFile[] = [];

  const globalPath = await selectInstruction(
    options.config.codexHome,
    ["AGENTS.override.md", "AGENTS.md"],
    true,
  );
  if (globalPath) {
    const name = globalPath.split(sep).at(-1);
    const displayPath = options.config.codexHome.endsWith(`${sep}.codex`)
      ? `~/.codex/${name}`
      : globalPath;
    const file = await loadInstruction(globalPath, "global", displayPath);
    if (file) candidates.push(file);
  }

  const filenames = instructionFilenames(options.config.fallbackFilenames);
  for (const directory of directoriesBetween(projectRoot, cwd)) {
    const path = await selectInstruction(directory, filenames, false);
    if (!path) continue;
    const file = await loadInstruction(path, "project", `./${relative(projectRoot, path)}`);
    if (file) candidates.push(file);
  }

  const instructions = candidates.map((file, index) => ({ ...file, precedence: index + 1 }));
  const effectiveBytes = instructions.reduce((total, file) => total + file.bytes, 0);
  const budgetBytes = options.config.maxBytes;

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

export async function discoverInstructionFiles(
  root: string,
  fallbackFilenames: string[] = [],
): Promise<InstructionFile[]> {
  const projectRoot = resolve(root);
  const files: InstructionFile[] = [];
  const filenames = instructionFilenames(fallbackFilenames);

  try {
    const { stdout } = await execFile(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...filenames.flatMap((name) => [name, `:(glob)**/${name}`]),
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );
    for (const relativePath of stdout.split("\0").filter(Boolean)) {
      const path = join(projectRoot, relativePath);
      if (!(await exists(path))) continue;
      const file = await loadInstruction(path, "project", `./${relativePath}`);
      if (file) files.push(file);
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    // Non-Git directories use a filesystem walk.
  }

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== ".git" && entry.name !== "node_modules") {
          await visit(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !filenames.includes(entry.name)) continue;

      const path = join(directory, entry.name);
      const file = await loadInstruction(path, "project", `./${relative(projectRoot, path)}`);
      if (file) files.push(file);
    }
  }

  await visit(projectRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
