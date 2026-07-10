import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { InstructionFile } from "../src/codex.js";
import { inspectInstructions } from "../src/inspect.js";

function instruction(path: string, content: string, precedence: number): InstructionFile {
  return {
    path,
    displayPath: path,
    bytes: Buffer.byteLength(content),
    content,
    kind: "project",
    precedence,
  };
}

test("reports missing references, scripts, and command drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps/web"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const files = [
    instruction(join(root, "AGENTS.md"), "Use npm. Run npm test. Read [rules](docs/rules.md).", 1),
    instruction(join(root, "apps/web/AGENTS.md"), "Use pnpm. Run pnpm test:web.", 2),
  ];

  const result = await inspectInstructions(files, root);

  assert.deepEqual(result.overrides, [
    { kind: "package-manager", from: "npm", to: "pnpm", source: "apps/web/AGENTS.md" },
    { kind: "test-command", from: "npm test", to: "pnpm test:web", source: "apps/web/AGENTS.md" },
  ]);
  assert.deepEqual(result.warnings.map((warning) => warning.kind), [
    "missing-reference",
    "missing-package-script",
  ]);
  assert.match(result.warnings[1].message, /pnpm test:web/);
});

test("accepts existing references and package scripts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/rules.md"), "rules");
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { check: "node --test" } }));
  const files = [
    instruction(
      join(root, "AGENTS.md"),
      "Read docs/rules.md. Run npm run check, pnpm run check, then pnpm install.",
      1,
    ),
  ];

  const result = await inspectInstructions(files, root);

  assert.deepEqual(result.warnings, []);
});

test("uses the global display path in warnings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "home/.codex/AGENTS.md");
  const global = { ...instruction(path, "Read missing.md", 1), kind: "global" as const, displayPath: "~/.codex/AGENTS.md" };

  const result = await inspectInstructions([global], root);

  assert.equal(result.warnings[0].source, "~/.codex/AGENTS.md");
});
