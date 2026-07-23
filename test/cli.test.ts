import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  assert.match(stdout.join(""), /harness-map scan/);
  assert.match(stdout.join(""), /harness-map compare/);
  assert.match(stdout.join(""), /harness-map check/);
  assert.match(stdout.join(""), /harness-map sync/);
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
  assert.equal(value.instructions[0].effectiveBytes, value.instructions[0].bytes);
  assert.equal(value.instructions[0].truncated, false);
  assert.deepEqual(Object.keys(value), [
    "agent",
    "target",
    "cwd",
    "budgetBytes",
    "effectiveBytes",
    "projectEffectiveBytes",
    "overBudget",
    "instructions",
    "skippedInstructions",
    "overrides",
    "warnings",
  ]);
});

test("explain uses the explicit Codex home", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  const codexHome = join(root, "custom-codex");
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "src"));
  await mkdir(join(userHome, ".codex"), { recursive: true });
  await mkdir(codexHome);
  await writeFile(join(userHome, ".codex/AGENTS.md"), "default");
  await writeFile(join(codexHome, "AGENTS.md"), "custom");
  const stdout: string[] = [];

  const code = await run(
    ["explain", "src/Home.tsx", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: userHome, codexHome },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.instructions[0].path, join(codexHome, "AGENTS.md"));
});

test("explain supports the Claude instruction stack", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "src"));
  await mkdir(join(userHome, ".claude"), { recursive: true });
  await writeFile(join(userHome, ".claude/CLAUDE.md"), "user");
  await writeFile(join(root, "CLAUDE.md"), "project");
  const stdout: string[] = [];

  const code = await run(
    ["explain", "src/Home.tsx", "--agent", "claude", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: userHome },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.agent, "claude");
  assert.equal(value.budgetBytes, null);
  assert.deepEqual(value.instructions.map((file: { content?: string; displayPath: string }) => file.displayPath), [
    "~/.claude/CLAUDE.md",
    "./CLAUDE.md",
  ]);
});

test("explain names an empty instruction stack", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  const stdout: string[] = [];

  const code = await run(
    ["explain", "game.ts", "--agent", "claude"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );

  assert.equal(code, 0);
  assert.match(stdout.join(""), /No instruction files found\./);
});

test("invalid Codex config exits with its path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex");
  await mkdir(join(root, ".git"));
  await mkdir(codexHome);
  const configPath = join(codexHome, "config.toml");
  await writeFile(configPath, "project_doc_max_bytes = [");
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await run(
    ["tree", "--json"],
    { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
    { processCwd: root, home: join(root, "home"), codexHome },
  );

  assert.equal(code, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(""), new RegExp(configPath));
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

test("tree, budget, and doctor support Claude files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-commands-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".claude/rules"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "AGENTS.md"), "Read docs/missing.md");
  await writeFile(join(root, ".claude/rules/test.md"), "Run pnpm test:game");
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {} }));

  async function json(command: string): Promise<Record<string, unknown>> {
    const stdout: string[] = [];
    const code = await run(
      [command, "--agent", "claude", "--json"],
      { stdout: (value) => stdout.push(value), stderr: () => undefined },
      { processCwd: root, home: join(root, "home") },
    );
    assert.equal(code, 0);
    return JSON.parse(stdout.join(""));
  }

  const tree = await json("tree");
  assert.equal(tree.agent, "claude");
  assert.deepEqual(
    (tree.files as Array<{ displayPath: string }>).map((file) => file.displayPath),
    ["./.claude/rules/test.md", "./CLAUDE.md"],
  );

  const budget = await json("budget");
  assert.equal(budget.agent, "claude");
  assert.equal(budget.budgetBytes, null);
  assert.deepEqual(budget.overBudgetFiles, []);

  const doctor = await json("doctor");
  assert.equal(doctor.agent, "claude");
  assert.equal((doctor.warnings as unknown[]).length, 2);
});

test("Claude doctor resolves imported content from its source directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-doctor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "CLAUDE.md"), "@docs/rules.md");
  await writeFile(join(root, "docs/rules.md"), "Read [guide](missing.md). Run npm run docs.");
  await writeFile(join(root, "docs/package.json"), JSON.stringify({ scripts: { docs: "echo ok" } }));
  const stdout: string[] = [];

  const code = await run(
    ["doctor", "--agent", "claude", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.warnings.length, 1);
  assert.equal(value.warnings[0].source, "docs/rules.md");
});

test("scan groups project files by effective Claude context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".claude/rules"), { recursive: true });
  await mkdir(join(root, "src"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "CLAUDE.md"), "project");
  await writeFile(
    join(root, ".claude/rules/source.md"),
    "---\npaths:\n  - src/**\n---\nsource rule",
  );
  await writeFile(join(root, "src/game.ts"), "export {};");
  await writeFile(join(root, "docs/readme.md"), "# Docs");
  const stdout: string[] = [];

  const code = await run(
    ["scan", "--agent", "claude", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.command, "scan");
  assert.equal(value.agent, "claude");
  assert.equal(value.fileCount, 2);
  assert.equal(value.contexts.length, 2);
  assert.deepEqual(value.contexts.map((context: { files: string[] }) => context.files), [
    ["docs/readme.md"],
    ["src/game.ts"],
  ]);
  assert.deepEqual(
    value.contexts[1].instructions.map((file: { displayPath: string }) => file.displayPath),
    ["./CLAUDE.md", "./.claude/rules/source.md"],
  );
});

test("compare groups files by Codex and Claude context pairs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-compare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "nested"));
  await mkdir(join(userHome, ".codex"), { recursive: true });
  await writeFile(join(userHome, ".codex/AGENTS.md"), "global");
  await writeFile(join(root, "AGENTS.md"), "codex root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "codex nested");
  await writeFile(join(root, "src/game.ts"), "export {};");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["compare", "--agents", "codex,claude", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: userHome },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.command, "compare");
  assert.deepEqual(value.agents, ["codex", "claude"]);
  assert.equal(value.fileCount, 2);
  assert.equal(value.contexts.length, 2);
  assert.deepEqual(value.contexts.map((context: { files: string[] }) => context.files), [
    ["nested/game.ts"],
    ["src/game.ts"],
  ]);
  assert.equal(value.contexts[0].state, "coverage-gap");
  assert.equal(value.contexts[1].state, "shared");
  assert.deepEqual(
    value.contexts[0].codex.instructions.map((file: { displayPath: string }) => file.displayPath),
    ["~/.codex/AGENTS.md", "./AGENTS.md", "./nested/AGENTS.md"],
  );
  assert.equal(value.contexts[0].codex.effectiveBytes > value.contexts[0].codex.projectEffectiveBytes, true);
  assert.deepEqual(value.environment, {
    codex: ["~/.codex/AGENTS.md"],
    claude: [],
  });
  assert.deepEqual(value.coverageGaps, [{
    agent: "claude",
    affectedFiles: 1,
    missingInstructions: ["./nested/AGENTS.md"],
  }]);
});

test("compare recognizes mirrored nested instructions as shared", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-compare-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "content"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "content/AGENTS.md"), "content");
  await writeFile(join(root, "content/CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "content/post.md"), "post");
  const stdout: string[] = [];

  const code = await run(
    ["compare", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.deepEqual(value.contexts.map((context: { state: string }) => context.state), ["shared"]);
  assert.deepEqual(value.coverageGaps, []);
});

test("compare treats global-only instructions as an unconfigured project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-compare-global-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  await mkdir(join(root, ".git"));
  await mkdir(join(userHome, ".codex"), { recursive: true });
  await writeFile(join(userHome, ".codex/AGENTS.md"), "global");
  await writeFile(join(root, "game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["compare", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: userHome },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.contexts[0].state, "unconfigured");
  assert.deepEqual(value.environment.codex, ["~/.codex/AGENTS.md"]);
  assert.deepEqual(value.coverageGaps, []);
});

test("compare reports a project with no instructions as unconfigured", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-compare-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["compare", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.contexts[0].state, "unconfigured");
  assert.deepEqual(value.environment, { codex: [], claude: [] });
  assert.deepEqual(value.coverageGaps, []);
});

test("compare aggregates path-scoped environment instructions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-compare-environment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "docs"));
  await mkdir(join(root, "src"));
  await mkdir(join(userHome, ".claude/rules"), { recursive: true });
  await writeFile(
    join(userHome, ".claude/rules/source.md"),
    "---\npaths:\n  - src/**\n---\nsource rule",
  );
  await writeFile(join(root, "docs/readme.md"), "docs");
  await writeFile(join(root, "src/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["compare", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: userHome },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.deepEqual(value.environment.claude, ["~/.claude/rules/source.md"]);
});

test("check exits cleanly for shared project instructions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-check-clean-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "AGENTS.md"), "shared");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["check", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.command, "check");
  assert.equal(value.affectedFiles, 0);
  assert.deepEqual(value.errors, []);
  assert.deepEqual(value.warnings, []);
  assert.deepEqual(value.info, []);
});

test("check fails when Claude misses nested project instructions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-check-gap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "shared");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["check", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 1);
  assert.equal(value.affectedFiles, 1);
  assert.equal(value.errors.length, 1);
  assert.equal(value.errors[0].kind, "coverage-gap");
  assert.equal(value.errors[0].affectedFiles, 1);
  assert.deepEqual(value.errors[0].instructions, ["./nested/AGENTS.md"]);
});

test("check deduplicates missing references shared by both agents", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-check-reference-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "AGENTS.md"), "Read docs/missing.md");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["check", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 1);
  assert.equal(value.errors.length, 1);
  assert.equal(value.errors[0].kind, "missing-reference");
  assert.equal(value.errors[0].message, "docs/missing.md does not exist");
});

test("check reports an unconfigured project as non-failing info", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-check-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["check", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.deepEqual(value.errors, []);
  assert.equal(value.info.length, 1);
  assert.equal(value.info[0].kind, "unconfigured");
});

test("sync dry-run proposes a minimal Claude bridge without writing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--dry-run", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.command, "sync");
  assert.equal(value.dryRun, true);
  assert.deepEqual(value.proposals, [{
    path: "./nested/CLAUDE.md",
    source: "./nested/AGENTS.md",
    content: "@AGENTS.md\n",
    affectedFiles: 1,
  }]);
  assert.deepEqual(value.conflicts, []);
  await assert.rejects(readFile(join(root, "nested/CLAUDE.md")), { code: "ENOENT" });

  const terminal: string[] = [];
  assert.equal(await run(
    ["sync", "--from", "codex", "--to", "claude"],
    { stdout: (value) => terminal.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  ), 0);
  assert.match(terminal.join(""), /CREATE \.\/nested\/CLAUDE\.md/);
  assert.match(terminal.join(""), /Source: \.\/nested\/AGENTS\.md/);
  assert.match(terminal.join(""), /1 file affected/);
});

test("sync dry-run skips Codex instructions already imported by Claude", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-covered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".claude/rules"), { recursive: true });
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(
    join(root, ".claude/rules/nested.md"),
    "---\npaths:\n  - nested/**\n---\n@../../nested/AGENTS.md",
  );
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--dry-run", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.deepEqual(value.proposals, []);
  assert.deepEqual(value.conflicts, []);
});

test("sync dry-run refuses to replace an existing Claude entrypoint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(join(root, "nested/CLAUDE.md"), "independent Claude rules");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--dry-run", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 1);
  assert.deepEqual(value.proposals, []);
  assert.deepEqual(value.conflicts, [{
    path: "./nested/CLAUDE.md",
    source: "./nested/AGENTS.md",
    affectedFiles: 1,
    reason: "target already exists",
  }]);
  assert.equal(await readFile(join(root, "nested/CLAUDE.md"), "utf8"), "independent Claude rules");
});

test("sync dry-run refuses different Codex and Claude project roots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-roots-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nested = join(root, "nested");
  const codexHome = join(root, "codex-home");
  await mkdir(join(root, ".git"));
  await mkdir(nested);
  await mkdir(codexHome);
  await writeFile(join(nested, "package.json"), "{}");
  await writeFile(join(nested, "game.ts"), "export {};");
  await writeFile(join(codexHome, "config.toml"), 'project_root_markers = ["package.json"]');
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--dry-run"],
    { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
    { processCwd: nested, home: join(root, "home"), codexHome },
  );

  assert.equal(code, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(""), /Codex and Claude project roots differ/);
});

test("sync --write creates the reviewed bridges and prints verification guidance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-write-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const stdout: string[] = [];

  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--write"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );

  assert.equal(code, 0);
  assert.equal(await readFile(join(root, "nested/CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.match(stdout.join(""), /CREATED \.\/nested\/CLAUDE\.md/);
  assert.match(stdout.join(""), /harness-map check/);
});

test("sync --write performs no writes when any target conflicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-atomic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "one"));
  await mkdir(join(root, "two"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "one/AGENTS.md"), "one");
  await writeFile(join(root, "one/game.ts"), "export {};");
  await writeFile(join(root, "two/AGENTS.md"), "two");
  await writeFile(join(root, "two/CLAUDE.md"), "keep me");
  await writeFile(join(root, "two/game.ts"), "export {};");

  const stdout: string[] = [];
  const code = await run(
    ["sync", "--from", "codex", "--to", "claude", "--write", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { processCwd: root, home: join(root, "home") },
  );

  assert.equal(code, 1);
  const value = JSON.parse(stdout.join(""));
  assert.equal(value.dryRun, false);
  assert.deepEqual(value.created, []);
  assert.deepEqual(value.conflicts.map((item: { path: string }) => item.path), ["./two/CLAUDE.md"]);
  await assert.rejects(readFile(join(root, "one/CLAUDE.md")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, "two/CLAUDE.md"), "utf8"), "keep me");
});

test("sync --write is idempotent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-sync-idempotent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "AGENTS.md"), "root");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "nested/AGENTS.md"), "nested");
  await writeFile(join(root, "nested/game.ts"), "export {};");
  const env = { processCwd: root, home: join(root, "home") };

  assert.equal(await run(
    ["sync", "--from", "codex", "--to", "claude", "--write"],
    { stdout: () => undefined, stderr: () => undefined },
    env,
  ), 0);
  const stdout: string[] = [];
  assert.equal(await run(
    ["sync", "--from", "codex", "--to", "claude", "--write", "--json"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    env,
  ), 0);

  const value = JSON.parse(stdout.join(""));
  assert.equal(value.dryRun, false);
  assert.deepEqual(value.created, []);
  assert.equal(await readFile(join(root, "nested/CLAUDE.md"), "utf8"), "@AGENTS.md\n");
});
