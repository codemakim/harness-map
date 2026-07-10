import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { discoverCodex, discoverInstructionFiles } from "../src/codex.js";

const execFile = promisify(execFileCallback);

async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "apps/web/src"), { recursive: true });
  return root;
}

test("orders global and project instructions from parent to child", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex/AGENTS.md"), "global");
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "apps/web/AGENTS.md"), "web");

  const result = await discoverCodex({
    cwd: join(root, "apps/web/src"),
    target: join(root, "apps/web/src/Home.tsx"),
    home,
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["global", "root", "web"]);
  assert.deepEqual(result.instructions.map((file) => file.precedence), [1, 2, 3]);
  assert.equal(result.effectiveBytes, 13);
});

test("uses AGENTS.override.md instead of AGENTS.md in one directory", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "regular");
  await writeFile(join(root, "AGENTS.override.md"), "override");

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    home: join(root, "home"),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["override"]);
});

test("prefers global override and ignores blank instructions", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex/AGENTS.md"), "global");
  await writeFile(join(home, ".codex/AGENTS.override.md"), "override");
  await writeFile(join(root, "AGENTS.md"), "  \n");

  const result = await discoverCodex({ cwd: root, target: join(root, "file.ts"), home });

  assert.deepEqual(result.instructions.map((file) => file.content), ["override"]);
});

test("falls back to AGENTS.md when override is blank", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "regular");
  await writeFile(join(root, "AGENTS.override.md"), " \n");

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    home: join(root, "home"),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["regular"]);
});

test("repository inventory excludes gitignored instruction files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFile("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "state"));
  await writeFile(join(root, ".gitignore"), "state/\n");
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "state/AGENTS.md"), "ignored");

  const files = await discoverInstructionFiles(root);

  assert.deepEqual(files.map((file) => file.displayPath), ["./AGENTS.md"]);
});
