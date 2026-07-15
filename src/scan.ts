import { execFile as execFileCallback } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { ClaudeMap } from "./claude.js";
import type { CodexMap, InstructionFile } from "./codex.js";

const execFile = promisify(execFileCallback);

export interface ScanInstruction {
  displayPath: string;
  effectiveBytes: number;
  truncated: boolean;
}

export interface ScanContext {
  fileCount: number;
  files: string[];
  effectiveBytes: number;
  instructions: ScanInstruction[];
}

export interface ScanResult {
  command: "scan";
  agent: "codex" | "claude";
  root: string;
  fileCount: number;
  contexts: ScanContext[];
}

async function repositoryPaths(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    );
    return stdout.split("\0").filter(Boolean).sort();
  } catch {
    const paths: string[] = [];
    async function visit(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name !== ".git" && entry.name !== "node_modules") {
            await visit(join(directory, entry.name));
          }
        } else if (entry.isFile()) {
          paths.push(relative(root, join(directory, entry.name)).split(sep).join("/"));
        }
      }
    }
    await visit(root);
    return paths.sort();
  }
}

export async function scanTargets(
  root: string,
  instructionFiles: InstructionFile[],
): Promise<Array<{ path: string; relativePath: string }>> {
  const projectRoot = resolve(root);
  const excluded = new Set(instructionFiles.flatMap((file) => [
    resolve(file.path),
    ...(file.imports ?? []).map((item) => resolve(item.path)),
  ]));
  const targets: Array<{ path: string; relativePath: string }> = [];
  for (const relativePath of await repositoryPaths(projectRoot)) {
    const path = resolve(projectRoot, relativePath);
    if (excluded.has(path)) continue;
    try {
      if ((await stat(path)).isFile()) targets.push({ path, relativePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return targets;
}

export function groupScanMaps(
  agent: "codex" | "claude",
  root: string,
  items: Array<{ relativePath: string; map: CodexMap | ClaudeMap }>,
): ScanResult {
  const groups = new Map<string, ScanContext>();
  for (const { relativePath, map } of items) {
    const key = JSON.stringify(map.instructions.map((file) => [
      file.path,
      file.effectiveBytes,
      file.truncated,
    ]));
    let context = groups.get(key);
    if (!context) {
      context = {
        fileCount: 0,
        files: [],
        effectiveBytes: map.effectiveBytes,
        instructions: map.instructions.map((file) => ({
          displayPath: file.displayPath,
          effectiveBytes: file.effectiveBytes,
          truncated: file.truncated,
        })),
      };
      groups.set(key, context);
    }
    context.files.push(relativePath);
    context.fileCount += 1;
  }
  return {
    command: "scan",
    agent,
    root: resolve(root),
    fileCount: items.length,
    contexts: [...groups.values()],
  };
}
