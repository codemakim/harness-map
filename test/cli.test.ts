import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { run } from "../src/cli.js";

const execFile = promisify(execFileCallback);

test("prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(["--help"], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });

  assert.equal(code, 0);
  assert.match(stdout.join(""), /harness-map explain <file>/);
  assert.deepEqual(stderr, []);
});

test("bin entrypoint executes the CLI", async () => {
  const { stdout } = await execFile(process.execPath, ["--import", "tsx", "src/bin.ts", "--help"], {
    cwd: join(import.meta.dirname, ".."),
  });

  assert.match(stdout, /harness-map explain <file>/);
});

test("explain --json emits stable parseable output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "AGENTS.md"), "Use pnpm");
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await run(
    ["explain", "src/Home.tsx", "--json"],
    {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  assert.equal(value.agent, "codex");
  assert.equal(value.target, "src/Home.tsx");
  assert.equal(value.budgetBytes, 32768);
  assert.deepEqual(Object.keys(value), [
    "agent",
    "target",
    "cwd",
    "budgetBytes",
    "effectiveBytes",
    "overBudget",
    "instructions",
    "overrides",
    "warnings",
  ]);
});

test("tree, budget, and doctor expose repository JSON contracts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-commands-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "Read docs/missing.md");
  await writeFile(join(root, "nested/AGENTS.override.md"), "Run pnpm check");
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {} }));

  async function json(command: string): Promise<Record<string, unknown>> {
    const stdout: string[] = [];
    const code = await run(
      [command, "--json"],
      { stdout: (value) => stdout.push(value), stderr: () => undefined },
      { processCwd: root, home: join(root, "home") },
    );
    assert.equal(code, 0);
    return JSON.parse(stdout.join(""));
  }

  const tree = await json("tree");
  assert.equal(tree.command, "tree");
  assert.equal(
    (tree.files as Array<{ displayPath: string }>).some((item) => item.displayPath === "./AGENTS.md"),
    true,
  );

  const budget = await json("budget");
  assert.equal(budget.command, "budget");
  assert.equal(typeof budget.totalBytes, "number");

  const doctor = await json("doctor");
  assert.equal(doctor.command, "doctor");
  assert.equal(Array.isArray(doctor.warnings), true);
  assert.equal((doctor.warnings as unknown[]).length, 2);
});
