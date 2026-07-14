import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";

import {
  findProjectRoot,
  type ImportedInstruction,
  type InstructionFile,
} from "./codex.js";

const execFile = promisify(execFileCallback);

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

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function displayImport(path: string, projectRoot: string, userHome: string): string {
  if (isInside(projectRoot, path)) {
    return `./${relative(projectRoot, path).split(sep).join("/")}`;
  }
  if (isInside(userHome, path)) {
    return `~/${relative(userHome, path).split(sep).join("/")}`;
  }
  return path;
}

function markdownCodeRanges(text: string): Array<[number, number]> {
  const fenceRanges: Array<[number, number]> = [];
  let fence: { start: number; marker: string; length: number } | undefined;
  for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence) {
      if (marker) fence = { start: match.index, marker: marker[1][0], length: marker[1].length };
      continue;
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/);
    if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
      fenceRanges.push([fence.start, match.index + line.length]);
      fence = undefined;
    }
  }
  if (fence) fenceRanges.push([fence.start, text.length]);

  let masked = text;
  for (const [start, end] of [...fenceRanges].reverse()) {
    masked = `${masked.slice(0, start)}${" ".repeat(end - start)}${masked.slice(end)}`;
  }
  const inlineRanges: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < masked.length) {
    const start = masked.indexOf("`", cursor);
    if (start === -1) break;
    let length = 1;
    while (masked[start + length] === "`") length += 1;
    let slashCount = 0;
    while (masked[start - slashCount - 1] === "\\") slashCount += 1;
    if (slashCount % 2 === 1) {
      cursor = start + length;
      continue;
    }
    let closing = start + length;
    while (closing < masked.length) {
      closing = masked.indexOf("`", closing);
      if (closing === -1) break;
      let closingLength = 1;
      while (masked[closing + closingLength] === "`") closingLength += 1;
      slashCount = 0;
      while (masked[closing - slashCount - 1] === "\\") slashCount += 1;
      if (closingLength === length && slashCount % 2 === 0) break;
      closing += closingLength;
    }
    if (closing === -1) {
      cursor = start + length;
      continue;
    }
    inlineRanges.push([start, closing + length]);
    cursor = closing + length;
  }
  return [...fenceRanges, ...inlineRanges].sort((left, right) => left[0] - right[0]);
}

async function importedPath(
  token: string,
  sourcePath: string,
  userHome: string,
): Promise<{ path: string; tokenLength: number } | undefined> {
  let candidate = token;
  while (candidate && ".,;:!?".includes(candidate.at(-1) ?? "")) {
    candidate = candidate.slice(0, -1);
  }
  const path = candidate.startsWith("~/")
    ? resolve(userHome, candidate.slice(2))
    : isAbsolute(candidate)
      ? resolve(candidate)
      : resolve(dirname(sourcePath), candidate);
  try {
    return (await stat(path)).isFile() ? { path, tokenLength: candidate.length } : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function expandImports(
  sourcePath: string,
  text: string,
  projectRoot: string,
  userHome: string,
  depth = 0,
  stack = new Set([sourcePath]),
): Promise<{ content: string; imports: ImportedInstruction[] }> {
  if (depth >= 4) return { content: text, imports: [] };
  const imports: ImportedInstruction[] = [];
  const output: string[] = [];
  const codeRanges = markdownCodeRanges(text);
  let offset = 0;

  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const matches = [...line.matchAll(/@([^\s`'"<>()\[\]{}\\]+)/g)];
    let cursor = 0;
    for (const match of matches) {
      const start = match.index;
      const absoluteStart = offset + start;
      if (codeRanges.some(([from, to]) => absoluteStart >= from && absoluteStart < to)) continue;
      const imported = await importedPath(match[1], sourcePath, userHome);
      if (!imported || stack.has(imported.path)) continue;
      const end = start + 1 + imported.tokenLength;
      const data = await readFile(imported.path);
      const nested = await expandImports(
        imported.path,
        data.toString("utf8"),
        projectRoot,
        userHome,
        depth + 1,
        new Set([...stack, imported.path]),
      );
      output.push(line.slice(cursor, start), nested.content);
      cursor = end;
      imports.push({
        path: imported.path,
        displayPath: displayImport(imported.path, projectRoot, userHome),
        bytes: data.length,
        depth: depth + 1,
        content: data.toString("utf8"),
      }, ...nested.imports);
    }
    output.push(line.slice(cursor));
    offset += line.length;
  }

  return { content: output.join(""), imports };
}

async function expandInstructionFiles(
  files: InstructionFile[],
  projectRoot: string,
  userHome: string,
): Promise<InstructionFile[]> {
  return Promise.all(files.map(async (file, index) => {
    const expanded = await expandImports(file.path, file.content, projectRoot, userHome);
    return {
      ...file,
      content: expanded.content,
      effectiveBytes: Buffer.byteLength(expanded.content),
      precedence: index + 1,
      sourceContent: file.content,
      ...(expanded.imports.length ? { imports: expanded.imports } : {}),
    };
  }));
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

  const instructions = await expandInstructionFiles(files, projectRoot, options.userHome);
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

function isClaudeInstruction(relativePath: string): boolean {
  const name = relativePath.split("/").at(-1);
  return (
    name === "CLAUDE.md" ||
    name === "CLAUDE.local.md" ||
    /(^|\/)\.claude\/rules\/.*\.md$/.test(relativePath)
  );
}

export function claudeInspectionFiles(
  files: InstructionFile[],
  projectRoot: string,
): InstructionFile[] {
  const result: InstructionFile[] = [];
  const seen = new Set<string>();
  const add = (file: InstructionFile): void => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    result.push({ ...file, precedence: result.length + 1 });
  };

  for (const file of files) {
    const { imports, sourceContent, ...source } = file;
    add({ ...source, content: sourceContent ?? file.content });
    for (const imported of imports ?? []) {
      if (imported.content === undefined) continue;
      add({
        path: imported.path,
        displayPath: imported.displayPath,
        bytes: imported.bytes,
        effectiveBytes: Buffer.byteLength(imported.content),
        content: imported.content,
        kind: isInside(projectRoot, imported.path) ? "project" : "global",
        precedence: 0,
        truncated: false,
      });
    }
  }
  return result;
}

export async function discoverClaudeInstructionFiles(
  root: string,
  userHome: string,
): Promise<InstructionFile[]> {
  const projectRoot = resolve(root);
  let relativePaths: string[] = [];
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
        "CLAUDE.md",
        ":(glob)**/CLAUDE.md",
        "CLAUDE.local.md",
        ":(glob)**/CLAUDE.local.md",
        ".claude/rules/*.md",
        ":(glob)**/.claude/rules/**/*.md",
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );
    relativePaths = [...new Set(stdout.split("\0").filter(Boolean))].sort();
  } catch {
    async function visit(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== ".git" && entry.name !== "node_modules") {
            await visit(join(directory, entry.name));
          }
          continue;
        }
        const path = join(directory, entry.name);
        const relativePath = relative(projectRoot, path).split(sep).join("/");
        if (entry.isFile() && isClaudeInstruction(relativePath)) relativePaths.push(relativePath);
      }
    }
    await visit(projectRoot);
    relativePaths.sort();
  }

  const files: InstructionFile[] = [];
  for (const relativePath of relativePaths) {
    const path = join(projectRoot, relativePath);
    const displayPath = `./${relativePath}`;
    if (/(^|\/)\.claude\/rules\/.*\.md$/.test(relativePath)) {
      const data = await readFile(path);
      const { content } = parseRule(data.toString("utf8"), path);
      if (!content.trim()) continue;
      files.push({
        path,
        displayPath,
        bytes: data.length,
        effectiveBytes: Buffer.byteLength(content),
        content,
        kind: "project",
        precedence: 0,
        truncated: false,
      });
      continue;
    }
    const file = await load(path, displayPath, "project");
    if (file) files.push(file);
  }
  return expandInstructionFiles(files, projectRoot, userHome);
}
