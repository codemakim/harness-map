import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { discoverClaude, discoverClaudeInstructionFiles } from "../src/claude.js";

const execFile = promisify(execFileCallback);

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

test("expands recursive imports but ignores Markdown code", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  await writeFile(
    join(project, "CLAUDE.md"),
    "Before\n@rules.md,\n\\`@escaped.md\\`\n@./규칙+엄격.md!\n`@inline.md`\n`multi\n@inline.md\nline`\n```md\n```not-a-close\n@fenced.md\n```\nAfter",
  );
  await writeFile(join(project, "rules.md"), "Rule one\n@nested.md");
  await writeFile(join(project, "nested.md"), "Nested rule");
  await writeFile(join(project, "escaped.md"), "escaped import");
  await writeFile(join(project, "규칙+엄격.md"), "strict import");
  await writeFile(join(project, "inline.md"), "inline must not load");
  await writeFile(join(project, "fenced.md"), "fenced must not load");

  const result = await discoverClaude({
    cwd: project,
    target: join(project, "game.ts"),
    userHome: join(root, "home"),
  });
  const [file] = result.instructions;

  assert.equal(
    file.content,
    "Before\nRule one\nNested rule,\n\\`escaped import\\`\nstrict import!\n`@inline.md`\n`multi\n@inline.md\nline`\n```md\n```not-a-close\n@fenced.md\n```\nAfter",
  );
  assert.deepEqual(file.imports?.map((item) => item.displayPath), [
    "./rules.md",
    "./nested.md",
    "./escaped.md",
    "./규칙+엄격.md",
  ]);
  assert.equal(file.effectiveBytes, Buffer.byteLength(file.content));
});

test("limits Claude imports to four hops", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "CLAUDE.md"), "@one.md");
  await writeFile(join(root, "one.md"), "@two.md");
  await writeFile(join(root, "two.md"), "@three.md");
  await writeFile(join(root, "three.md"), "@four.md");
  await writeFile(join(root, "four.md"), "@five.md");
  await writeFile(join(root, "five.md"), "too deep");

  const result = await discoverClaude({
    cwd: root,
    target: join(root, "game.ts"),
    userHome: join(root, "home"),
  });
  const [file] = result.instructions;

  assert.equal(file.content, "@five.md");
  assert.deepEqual(file.imports?.map((item) => item.depth), [1, 2, 3, 4]);
});

test("Claude inventory excludes gitignored files and imported dependencies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFile("git", ["init", "-q"], { cwd: root });
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md");
  await writeFile(join(root, "AGENTS.md"), "shared");
  await writeFile(join(root, "ignored/CLAUDE.md"), "ignored");

  const files = await discoverClaudeInstructionFiles(root, join(root, "home"));

  assert.deepEqual(files.map((file) => file.displayPath), ["./CLAUDE.md"]);
  assert.deepEqual(files[0].imports?.map((item) => item.displayPath), ["./AGENTS.md"]);
});
