import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverClaude } from "../src/claude.js";

test("orders Claude instructions from user scope to target directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  const project = join(root, "project");
  const targetDir = join(project, "src/game");
  await mkdir(join(userHome, ".claude"), { recursive: true });
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, ".claude"));
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(userHome, ".claude/CLAUDE.md"), "user");
  await writeFile(join(project, "CLAUDE.md"), "root");
  await writeFile(join(project, ".claude/CLAUDE.md"), "project dot claude");
  await writeFile(join(project, "CLAUDE.local.md"), "root local");
  await writeFile(join(project, "src/CLAUDE.md"), "src");
  await writeFile(join(targetDir, "CLAUDE.local.md"), "game local");

  const result = await discoverClaude({
    cwd: targetDir,
    target: join(targetDir, "Battle.ts"),
    userHome,
  });

  assert.deepEqual(result.instructions.map((file) => file.content), [
    "user",
    "root",
    "project dot claude",
    "root local",
    "src",
    "game local",
  ]);
  assert.deepEqual(result.instructions.map((file) => file.precedence), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.budgetBytes, null);
  assert.equal(result.overBudget, false);
});

test("reports an empty Claude instruction stack", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));

  const result = await discoverClaude({
    cwd: root,
    target: join(root, "game.ts"),
    userHome: join(root, "home"),
  });

  assert.deepEqual(result.instructions, []);
  assert.equal(result.effectiveBytes, 0);
});

test("loads unconditional and path-matched Claude rules", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userHome = join(root, "home");
  const project = join(root, "project");
  await mkdir(join(userHome, ".claude/rules"), { recursive: true });
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, ".claude/rules/game"), { recursive: true });
  await mkdir(join(project, "src/game"), { recursive: true });
  await writeFile(join(userHome, ".claude/rules/style.md"), "user rule");
  await writeFile(join(project, ".claude/rules/general.md"), "general rule");
  await writeFile(
    join(project, ".claude/rules/game/typescript.md"),
    '---\npaths:\n  - "src/game/**/*.{ts,tsx}"\n---\ngame rule',
  );
  await writeFile(
    join(project, ".claude/rules/docs.md"),
    '---\npaths:\n  - "docs/**/*.md"\n---\ndocs rule',
  );

  const result = await discoverClaude({
    cwd: join(project, "src/game"),
    target: join(project, "src/game/Battle.ts"),
    userHome,
  });

  assert.deepEqual(result.instructions.map((file) => file.content), [
    "user rule",
    "general rule",
    "game rule",
  ]);
  assert.deepEqual(result.instructions.map((file) => file.displayPath), [
    "~/.claude/rules/style.md",
    "./.claude/rules/general.md",
    "./.claude/rules/game/typescript.md",
  ]);
});
