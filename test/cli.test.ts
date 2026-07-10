import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";

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
