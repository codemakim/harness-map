import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";

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

async function markdownFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name))
    .sort();
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .sort();
  for (const child of directories) files.push(...await markdownFiles(child));
  return files;
}

function parseRule(text: string, path: string): { content: string; paths?: string[] } {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return { content: text };
  const value = parseYaml(frontmatter[1]);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: frontmatter must be an object`);
  }
  const paths = (value as Record<string, unknown>).paths;
  if (paths !== undefined && (!Array.isArray(paths) || paths.some((item) => typeof item !== "string"))) {
    throw new Error(`${path}: paths must be an array of strings`);
  }
  return { content: text.slice(frontmatter[0].length), paths: paths as string[] | undefined };
}

async function loadRules(
  directory: string,
  displayPrefix: string,
  kind: InstructionFile["kind"],
  targetPath: string,
): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  for (const path of await markdownFiles(directory)) {
    const data = await readFile(path);
    const { content, paths } = parseRule(data.toString("utf8"), path);
    if (paths && !paths.some((pattern) => minimatch(targetPath, pattern, { dot: true }))) continue;
    if (!content.trim()) continue;
    files.push({
      path,
      displayPath: `${displayPrefix}/${relative(directory, path).split(sep).join("/")}`,
      bytes: data.length,
      effectiveBytes: Buffer.byteLength(content),
      content,
      kind,
      precedence: 0,
      truncated: false,
    });
  }
  return files;
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
  const targetPath = relative(projectRoot, target).split(sep).join("/");
  files.push(...await loadRules(
    join(options.userHome, ".claude/rules"),
    "~/.claude/rules",
    "global",
    targetPath,
  ));

  for (const directory of directoriesBetween(projectRoot, cwd)) {
    const paths = [join(directory, "CLAUDE.md")];
    if (directory === projectRoot) {
      paths.push(join(directory, ".claude/CLAUDE.md"));
    }
    for (const path of paths) {
      const file = await load(path, `./${relative(projectRoot, path)}`, "project");
      if (file) files.push(file);
    }
    if (directory === projectRoot) {
      files.push(...await loadRules(
        join(projectRoot, ".claude/rules"),
        "./.claude/rules",
        "project",
        targetPath,
      ));
    }
    const localPath = join(directory, "CLAUDE.local.md");
    const localFile = await load(localPath, `./${relative(projectRoot, localPath)}`, "project");
    if (localFile) files.push(localFile);
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
