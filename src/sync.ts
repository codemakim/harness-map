import { stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { CompareResult } from "./compare.js";

export interface SyncProposal {
  path: string;
  source: string;
  content: string;
  affectedFiles: number;
}

export interface SyncConflict extends Omit<SyncProposal, "content"> {
  reason: string;
}

export interface SyncResult {
  command: "sync";
  from: "codex";
  to: "claude";
  dryRun: boolean;
  root: string;
  proposals: SyncProposal[];
  conflicts: SyncConflict[];
  created: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function buildSyncPlan(comparison: CompareResult): Promise<SyncResult> {
  const affected = new Map<string, number>();
  for (const context of comparison.contexts) {
    for (const source of context.missingFor.claude) {
      affected.set(source, (affected.get(source) ?? 0) + context.fileCount);
    }
  }

  const proposals: SyncProposal[] = [];
  const conflicts: SyncConflict[] = [];
  for (const [source, affectedFiles] of [...affected].sort()) {
    if (basename(source) !== "AGENTS.md") {
      conflicts.push({ path: source, source, affectedFiles, reason: "unsupported Codex instruction filename" });
      continue;
    }
    const sourcePath = resolve(comparison.root, source.replace(/^\.\//, ""));
    const targetPath = join(dirname(sourcePath), "CLAUDE.md");
    const path = `./${targetPath.slice(comparison.root.length + 1)}`;
    const item = { path, source, affectedFiles };
    if (await exists(targetPath)) {
      conflicts.push({ ...item, reason: "target already exists" });
    } else {
      proposals.push({ ...item, content: "@AGENTS.md\n" });
    }
  }

  return {
    command: "sync",
    from: "codex",
    to: "claude",
    dryRun: true,
    root: comparison.root,
    proposals,
    conflicts,
    created: [],
  };
}

export async function writeSyncPlan(plan: SyncResult): Promise<SyncResult> {
  const result = { ...plan, dryRun: false, created: [] as string[] };
  if (plan.conflicts.length) return result;
  for (const proposal of plan.proposals) {
    await writeFile(
      resolve(plan.root, proposal.path.replace(/^\.\//, "")),
      proposal.content,
      { flag: "wx" },
    );
    result.created.push(proposal.path);
  }
  return result;
}
