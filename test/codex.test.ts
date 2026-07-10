import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import type { CodexConfig } from "../src/codex-config.js";
import { discoverCodex, discoverInstructionFiles, findProjectRoot } from "../src/codex.js";

const execFile = promisify(execFileCallback);

async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "apps/web/src"), { recursive: true });
  return root;
}

function codexConfig(codexHome: string, overrides: Partial<CodexConfig> = {}): CodexConfig {
  return {
    codexHome,
    configPath: join(codexHome, "config.toml"),
    fallbackFilenames: [],
    maxBytes: 32768,
    rootMarkers: [".git"],
    ...overrides,
  };
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
    config: codexConfig(join(home, ".codex")),
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
    config: codexConfig(join(root, "home/.codex")),
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

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    config: codexConfig(join(home, ".codex")),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["override"]);
});

test("blank project override shadows AGENTS.md", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "regular");
  await writeFile(join(root, "AGENTS.override.md"), " \n");

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    config: codexConfig(join(root, "home/.codex")),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), []);
});

test("uses configured fallback filenames in order", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "TEAM.md"), "team");
  await writeFile(join(root, ".agents.md"), "agents");

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    config: codexConfig(join(root, "home/.codex"), {
      fallbackFilenames: ["TEAM.md", ".agents.md"],
    }),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["team"]);
});

test("finds the nearest configured project root", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".project-root"), "");
  const cwd = join(root, "apps/web/src");

  assert.equal(await findProjectRoot(cwd, [".project-root"]), root);
  assert.equal(await findProjectRoot(cwd, ["missing.marker"]), cwd);
  assert.equal(await findProjectRoot(cwd, []), cwd);
});

test("repository inventory excludes gitignored instruction files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFile("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "state"));
  await writeFile(join(root, ".gitignore"), "state/\n");
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "TEAM.md"), "team");
  await writeFile(join(root, "state/AGENTS.md"), "ignored");

  const files = await discoverInstructionFiles(root, ["TEAM.md"]);

  assert.deepEqual(files.map((file) => file.displayPath), ["./AGENTS.md", "./TEAM.md"]);
});

test("global instructions do not consume the project budget", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "home/.codex");
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, "AGENTS.md"), "global");
  await writeFile(join(root, "AGENTS.md"), "root");

  const result = await discoverCodex({
    cwd: root,
    target: join(root, "file.ts"),
    config: codexConfig(codexHome, { maxBytes: 4 }),
  });

  assert.equal(result.projectEffectiveBytes, 4);
  assert.equal(result.effectiveBytes, 10);
  assert.equal(result.overBudget, false);
});

test("truncates the final project file and skips later files", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "123456");
  await writeFile(join(root, "apps/web/AGENTS.md"), Buffer.from([0xe2, 0x82, 0xac, 0x78]));
  await writeFile(join(root, "apps/web/src/AGENTS.md"), "later");

  const result = await discoverCodex({
    cwd: join(root, "apps/web/src"),
    target: join(root, "apps/web/src/file.ts"),
    config: codexConfig(join(root, "home/.codex"), { maxBytes: 8 }),
  });

  assert.deepEqual(result.instructions.map((file) => file.content), ["123456", "�"]);
  assert.deepEqual(
    result.instructions.map(({ bytes, effectiveBytes, truncated }) => ({ bytes, effectiveBytes, truncated })),
    [
      { bytes: 6, effectiveBytes: 6, truncated: false },
      { bytes: 4, effectiveBytes: 2, truncated: true },
    ],
  );
  assert.equal(result.projectEffectiveBytes, 8);
  assert.equal(result.overBudget, true);
  assert.deepEqual(result.skippedInstructions.map((file) => file.displayPath), ["./apps/web/src/AGENTS.md"]);
});
