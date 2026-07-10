import { access } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { InstructionFile } from "./codex.js";
import { findNearestPackageJson, hasPackageScript } from "./package-json.js";

export interface Override {
  kind: "package-manager" | "test-command";
  from: string;
  to: string;
  source: string;
}

export interface Warning {
  kind: "missing-reference" | "missing-package-script" | "instruction-over-budget";
  message: string;
  source: string;
}

export interface Inspection {
  overrides: Override[];
  warnings: Warning[];
}

const pnpmCommands = new Set([
  "add",
  "audit",
  "bin",
  "config",
  "create",
  "deploy",
  "dlx",
  "env",
  "exec",
  "fetch",
  "help",
  "import",
  "init",
  "install",
  "link",
  "list",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "server",
  "setup",
  "store",
  "uninstall",
  "unlink",
  "update",
  "view",
  "why",
]);

function lastMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.at(-1);
}

function displaySource(file: InstructionFile, projectRoot: string): string {
  if (file.kind === "global") return file.displayPath;
  return relative(projectRoot, file.path) || file.displayPath;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function referencesIn(text: string): Set<string> {
  const references = new Set<string>();
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    references.add(match[1].split("#", 1)[0]);
  }
  for (const match of text.matchAll(/(?:^|[\s`'"(])([^\s`'"()]+\.(?:md|mdx|json|ya?ml|toml))(?=$|[\s`'"),.])/gim)) {
    references.add(match[1]);
  }
  return references;
}

export async function inspectInstructions(
  files: InstructionFile[],
  projectRoot: string,
): Promise<Inspection> {
  const overrides: Override[] = [];
  const warnings: Warning[] = [];
  let previousManager: string | undefined;
  let previousTestCommand: string | undefined;

  for (const file of files) {
    const source = displaySource(file, projectRoot);
    const manager = lastMatch(file.content, /\b(?:npm|pnpm|yarn|bun)\b/g);
    const testCommand = lastMatch(
      file.content,
      /\b(?:npm(?:\s+run)?|pnpm|yarn|bun(?:\s+run)?)\s+[\w:-]*test[\w:-]*/g,
    );

    if (manager && previousManager && manager !== previousManager) {
      overrides.push({ kind: "package-manager", from: previousManager, to: manager, source });
    }
    if (testCommand && previousTestCommand && testCommand !== previousTestCommand) {
      overrides.push({ kind: "test-command", from: previousTestCommand, to: testCommand, source });
    }
    previousManager = manager ?? previousManager;
    previousTestCommand = testCommand ?? previousTestCommand;

    for (const reference of referencesIn(file.content)) {
      if (!reference || reference.startsWith("#") || /^[a-z]+:\/\//i.test(reference) || isAbsolute(reference)) {
        continue;
      }
      const path = resolve(dirname(file.path), reference);
      if (isInside(projectRoot, path) && !(await exists(path))) {
        warnings.push({ kind: "missing-reference", message: `${reference} does not exist`, source });
      }
    }

    for (const match of file.content.matchAll(/\b(npm\s+run|pnpm(?:\s+run)?)\s+([\w:-]+)/g)) {
      const command = match[0];
      const script = match[2];
      if (match[1] === "pnpm" && pnpmCommands.has(script)) continue;
      const packagePath = await findNearestPackageJson(dirname(file.path), projectRoot);
      if (!packagePath || !(await hasPackageScript(packagePath, script))) {
        warnings.push({
          kind: "missing-package-script",
          message: `\`${command}\` is not defined in package.json`,
          source,
        });
      }
    }
  }

  return { overrides, warnings };
}
