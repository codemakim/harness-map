import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function findGitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    throw new Error("diff requires a Git repository");
  }
}

export async function withGitSnapshot<T>(
  repositoryRoot: string,
  revision: string,
  callback: (snapshotRoot: string) => Promise<T>,
): Promise<T> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "harness-map-diff-"));
  const snapshotRoot = join(temporaryRoot, "repo");
  try {
    await execFile("git", [
      "clone",
      "--quiet",
      "--shared",
      "--no-checkout",
      repositoryRoot,
      snapshotRoot,
    ]);
    await execFile("git", ["checkout", "--quiet", "--detach", revision], { cwd: snapshotRoot });
    return await callback(snapshotRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
