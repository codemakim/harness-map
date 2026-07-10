# harness-map v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a publishable TypeScript CLI that reconstructs Codex instruction discovery and reports path-specific context, budget, overrides, and obvious broken references.

**Architecture:** Keep one Node.js package with five focused source files. `codex.ts` discovers ordered instruction files, `inspect.ts` analyzes their text, `package-json.ts` validates documented scripts, `output.ts` renders terminal and JSON output, and `cli.ts` connects the four commands. Tests create temporary repositories at runtime, so the repository carries no fixture tree.

**Tech Stack:** Node.js 20+, TypeScript 5, ESM, `node:fs`, `node:path`, `node:test`, `node:util.parseArgs`, `tsx` for tests, `tsc` for builds.

## Global Constraints

- Codex only in v0.1.
- Runtime dependencies: zero.
- No AI calls and no network calls.
- Default instruction budget: exactly `32768` UTF-8 bytes.
- In one directory, `AGENTS.override.md` replaces `AGENTS.md`.
- Instruction order is global, then project root through effective working directory.
- Terminal output and stable JSON output are both required.
- `compare` and multi-agent package boundaries remain deferred.

---

## File Map

```text
package.json                 package metadata, scripts, and bin mapping
tsconfig.json                strict ESM build configuration
src/cli.ts                   argument parsing, command dispatch, exit codes
src/codex.ts                 root detection and Codex instruction discovery
src/inspect.ts               references, overrides, and warning aggregation
src/package-json.ts          nearest package.json and script validation
src/output.ts                terminal and JSON rendering
test/codex.test.ts           discovery and precedence tests
test/inspect.test.ts         reference, script, and override tests
test/cli.test.ts             command and JSON contract tests
```

## Task 1: Bootstrap Package And Testable CLI Boundary

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `test/cli.test.ts`

**Interfaces:**
- Produces: `run(argv: string[], io?: CliIo): Promise<number>`
- Produces: executable `harness-map` mapped to `dist/cli.js`

- [ ] **Step 1: Write the failing CLI help test**

```ts
// test/cli.test.ts
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: Add the minimal package configuration and verify the test fails**

```json
{
  "name": "harness-map",
  "version": "0.1.0",
  "description": "Show what instructions an agent actually reads for a file.",
  "type": "module",
  "bin": {
    "harness-map": "dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsx --test test/*.test.ts",
    "check": "npm run build && npm test"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0"
  },
  "license": "MIT"
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "test"]
}
```

Run: `npm install && npm test`

Expected: FAIL because `../src/cli.js` does not exist.

- [ ] **Step 3: Implement the CLI shell**

```ts
// src/cli.ts
#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const help = `Usage:
  harness-map explain <file> [--agent codex] [--cwd <dir>] [--json]
  harness-map tree [--json]
  harness-map budget [--json]
  harness-map doctor [--json]
`;

export async function run(
  argv: string[],
  io: CliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.stdout(help);
    return 0;
  }

  io.stderr(`Unknown command: ${argv[0]}\n${help}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
```

- [ ] **Step 4: Verify test and build**

Run: `npm test && npm run build`

Expected: one passing test and `dist/cli.js` generated.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/cli.ts test/cli.test.ts
git commit -m "chore: bootstrap TypeScript CLI"
```

## Task 2: Reconstruct Codex Instruction Discovery

**Files:**
- Create: `src/codex.ts`
- Create: `test/codex.test.ts`

**Interfaces:**
- Produces: `DEFAULT_BUDGET_BYTES = 32768`
- Produces: `InstructionFile`, `CodexMap`, and `DiscoverOptions`
- Produces: `discoverCodex(options: DiscoverOptions): Promise<CodexMap>`
- Produces: `findProjectRoot(startDir: string): Promise<string>`

- [ ] **Step 1: Write discovery and precedence tests**

```ts
// test/codex.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverCodex } from "../src/codex.js";

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "apps/web/src"), { recursive: true });
  return root;
}

test("orders global and project instructions from parent to child", async (t) => {
  const root = await repo();
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
});

test("uses AGENTS.override.md instead of AGENTS.md in one directory", async (t) => {
  const root = await repo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "AGENTS.md"), "regular");
  await writeFile(join(root, "AGENTS.override.md"), "override");

  const result = await discoverCodex({ cwd: root, target: join(root, "file.ts"), home: join(root, "home") });

  assert.deepEqual(result.instructions.map((file) => file.content), ["override"]);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx tsx --test test/codex.test.ts`

Expected: FAIL because `src/codex.ts` does not exist.

- [ ] **Step 3: Implement discovery with Node standard library only**

```ts
// src/codex.ts
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, parse, relative, resolve } from "node:path";

export const DEFAULT_BUDGET_BYTES = 32768;

export interface InstructionFile {
  path: string;
  displayPath: string;
  bytes: number;
  content: string;
  kind: "global" | "project";
  precedence: number;
}

export interface CodexMap {
  agent: "codex";
  target: string;
  cwd: string;
  projectRoot: string;
  budgetBytes: number;
  effectiveBytes: number;
  overBudget: boolean;
  instructions: InstructionFile[];
}

export interface DiscoverOptions {
  cwd: string;
  target: string;
  home: string;
  budgetBytes?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDir: string): Promise<string> {
  let current = resolve(startDir);
  while (true) {
    if (await exists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

function directoriesBetween(root: string, cwd: string): string[] {
  const suffix = relative(root, cwd);
  if (!suffix) return [root];
  if (suffix.startsWith("..") || parse(suffix).root) return [root];
  const parts = suffix.split(/[\\/]/);
  return [root, ...parts.map((_, index) => join(root, ...parts.slice(0, index + 1)))];
}

async function selectInstruction(dir: string): Promise<string | undefined> {
  for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
    const path = join(dir, name);
    if (await exists(path)) return path;
  }
  return undefined;
}

async function load(path: string, kind: InstructionFile["kind"], displayPath: string): Promise<InstructionFile | undefined> {
  if (!(await exists(path)) || !(await stat(path)).isFile()) return undefined;
  const content = await readFile(path, "utf8");
  if (content.length === 0) return undefined;
  return { path, displayPath, bytes: Buffer.byteLength(content), content, kind, precedence: 0 };
}

export async function discoverCodex(options: DiscoverOptions): Promise<CodexMap> {
  const cwd = resolve(options.cwd);
  const target = resolve(options.target);
  const projectRoot = await findProjectRoot(cwd);
  const candidates: InstructionFile[] = [];
  const globalPath = await selectInstruction(join(options.home, ".codex"));
  if (globalPath) {
    const file = await load(globalPath, "global", `~/.codex/${globalPath.split(/[\\/]/).at(-1)}`);
    if (file) candidates.push(file);
  }
  for (const dir of directoriesBetween(projectRoot, cwd)) {
    const path = await selectInstruction(dir);
    if (!path) continue;
    const file = await load(path, "project", `./${relative(projectRoot, path)}`);
    if (file) candidates.push(file);
  }
  const instructions = candidates.map((file, index) => ({ ...file, precedence: index + 1 }));
  const effectiveBytes = instructions.reduce((sum, file) => sum + file.bytes, 0);
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  return { agent: "codex", target, cwd, projectRoot, budgetBytes, effectiveBytes, overBudget: effectiveBytes > budgetBytes, instructions };
}
```

- [ ] **Step 4: Verify discovery tests and build**

Run: `npm test && npm run build`

Expected: all tests pass with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/codex.ts test/codex.test.ts
git commit -m "feat: discover Codex instructions"
```

## Task 3: Detect Overrides And Broken Execution Contracts

**Files:**
- Create: `src/package-json.ts`
- Create: `src/inspect.ts`
- Create: `test/inspect.test.ts`

**Interfaces:**
- Produces: `findNearestPackageJson(startDir, projectRoot): Promise<string | undefined>`
- Produces: `hasPackageScript(packagePath, script): Promise<boolean>`
- Produces: `inspectInstructions(files, projectRoot): Promise<Inspection>`
- Produces: stable `Override` and `Warning` records used by both renderers.

- [ ] **Step 1: Write focused inspection tests**

```ts
// test/inspect.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { InstructionFile } from "../src/codex.js";
import { inspectInstructions } from "../src/inspect.js";

function file(path: string, content: string, precedence: number): InstructionFile {
  return { path, displayPath: path, bytes: Buffer.byteLength(content), content, kind: "project", precedence };
}

test("reports missing references, scripts, and package manager drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps/web"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const files = [
    file(join(root, "AGENTS.md"), "Use npm. Run npm test. Read docs/rules.md", 1),
    file(join(root, "apps/web/AGENTS.md"), "Use pnpm. Run pnpm test:web", 2),
  ];

  const result = await inspectInstructions(files, root);

  assert.deepEqual(result.overrides, [
    { kind: "package-manager", from: "npm", to: "pnpm", source: "apps/web/AGENTS.md" },
    { kind: "test-command", from: "npm test", to: "pnpm test:web", source: "apps/web/AGENTS.md" },
  ]);
  assert.equal(result.warnings.some((warning) => warning.kind === "missing-reference"), true);
  assert.equal(result.warnings.some((warning) => warning.message.includes("test:web")), true);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx tsx --test test/inspect.test.ts`

Expected: FAIL because inspection modules do not exist.

- [ ] **Step 3: Implement package script lookup**

```ts
// src/package-json.ts
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function findNearestPackageJson(startDir: string, projectRoot: string): Promise<string | undefined> {
  let current = resolve(startDir);
  const root = resolve(projectRoot);
  while (true) {
    const candidate = join(current, "package.json");
    try {
      await access(candidate);
      return candidate;
    } catch {}
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function hasPackageScript(packagePath: string, script: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(packagePath, "utf8"));
    if (!value || typeof value !== "object" || !("scripts" in value)) return false;
    const scripts = (value as { scripts?: unknown }).scripts;
    return Boolean(scripts && typeof scripts === "object" && script in scripts);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Implement small regex-based inspection**

```ts
// src/inspect.ts
import { access } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { InstructionFile } from "./codex.js";
import { findNearestPackageJson, hasPackageScript } from "./package-json.js";

export interface Override {
  kind: "package-manager" | "test-command";
  from: string;
  to: string;
  source: string;
}

export interface Warning {
  kind: "missing-reference" | "missing-package-script" | "instruction-over-budget";
  message: string;
  source: string;
}

export interface Inspection { overrides: Override[]; warnings: Warning[] }

const managers = /\b(npm|pnpm|yarn|bun)\b/g;
const testCommands = /\b(?:npm(?: run)?|pnpm|yarn|bun(?: run)?)\s+[\w:-]*test[\w:-]*/g;
const markdownLinks = /\[[^\]]*\]\(([^)]+)\)/g;
const inlinePaths = /(?:^|[\s`'"(])([^\s`'"()]+\.(?:md|mdx|json|ya?ml|toml))(?=$|[\s`'"),.])/gim;
const packageCommands = /\b(npm run|pnpm|yarn|bun run)\s+([\w:-]+)/g;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function source(file: InstructionFile, root: string): string {
  return relative(root, file.path) || file.displayPath;
}

function lastMatch(text: string, pattern: RegExp): string | undefined {
  return [...text.matchAll(pattern)].at(-1)?.[0];
}

export async function inspectInstructions(files: InstructionFile[], projectRoot: string): Promise<Inspection> {
  const overrides: Override[] = [];
  const warnings: Warning[] = [];
  let previousManager: string | undefined;
  let previousTest: string | undefined;

  for (const file of files) {
    const manager = lastMatch(file.content, managers);
    const testCommand = lastMatch(file.content, testCommands);
    if (manager && previousManager && manager !== previousManager) overrides.push({ kind: "package-manager", from: previousManager, to: manager, source: source(file, projectRoot) });
    if (testCommand && previousTest && testCommand !== previousTest) overrides.push({ kind: "test-command", from: previousTest, to: testCommand, source: source(file, projectRoot) });
    previousManager = manager ?? previousManager;
    previousTest = testCommand ?? previousTest;

    const references = new Set<string>();
    for (const match of file.content.matchAll(markdownLinks)) references.add(match[1].split("#", 1)[0]);
    for (const match of file.content.matchAll(inlinePaths)) references.add(match[1]);
    for (const reference of references) {
      if (!reference || reference.startsWith("#") || /^[a-z]+:\/\//i.test(reference) || isAbsolute(reference)) continue;
      const path = resolve(dirname(file.path), reference);
      if (path.startsWith(resolve(projectRoot)) && !(await exists(path))) warnings.push({ kind: "missing-reference", message: `${reference} does not exist`, source: source(file, projectRoot) });
    }

    for (const match of file.content.matchAll(packageCommands)) {
      const script = match[2];
      const packagePath = await findNearestPackageJson(dirname(file.path), projectRoot);
      if (!packagePath || !(await hasPackageScript(packagePath, script))) warnings.push({ kind: "missing-package-script", message: `\`${match[0]}\` is not defined in package.json`, source: source(file, projectRoot) });
    }
  }
  return { overrides, warnings };
}
```

- [ ] **Step 5: Verify inspection and full test suite**

Run: `npm test && npm run build`

Expected: all tests pass. Adjust regexes only to satisfy the explicit v0.1 patterns; do not introduce a Markdown parser.

- [ ] **Step 6: Commit**

```bash
git add src/package-json.ts src/inspect.ts test/inspect.test.ts
git commit -m "feat: inspect instruction contracts"
```

## Task 4: Render Explain Output And Stable JSON

**Files:**
- Create: `src/output.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: `CodexMap`, `Inspection`
- Produces: `formatSize(bytes: number): string`
- Produces: `renderExplain(map: CodexMap, inspection: Inspection): string`
- Produces: `toExplainJson(map: CodexMap, inspection: Inspection): object`

- [ ] **Step 1: Add an end-to-end JSON test using a temporary repository**

```ts
test("explain --json emits stable parseable output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "harness-map-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "AGENTS.md"), "Use pnpm");
  const stdout: string[] = [];

  const code = await run(["explain", "src/Home.tsx", "--json"], {
    stdout: (value) => stdout.push(value),
    stderr: () => undefined,
  }, { processCwd: root, home: join(root, "home") });
  const value = JSON.parse(stdout.join(""));

  assert.equal(code, 0);
  assert.equal(value.agent, "codex");
  assert.equal(value.budgetBytes, 32768);
  assert.deepEqual(Object.keys(value), ["agent", "target", "cwd", "budgetBytes", "effectiveBytes", "overBudget", "instructions", "overrides", "warnings"]);
});
```

Also add the required imports from `node:fs/promises`, `node:os`, and `node:path` to `test/cli.test.ts`. Extend `run` with a third optional environment argument:

```ts
export interface CliEnv { processCwd: string; home: string }
```

- [ ] **Step 2: Run the JSON test and confirm failure**

Run: `npx tsx --test test/cli.test.ts`

Expected: FAIL because `explain` is still unknown.

- [ ] **Step 3: Implement output functions**

```ts
// src/output.ts
import { relative } from "node:path";

import type { CodexMap } from "./codex.js";
import type { Inspection } from "./inspect.js";

export function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function toExplainJson(map: CodexMap, inspection: Inspection): object {
  return {
    agent: map.agent,
    target: relative(map.projectRoot, map.target),
    cwd: map.cwd,
    budgetBytes: map.budgetBytes,
    effectiveBytes: map.effectiveBytes,
    overBudget: map.overBudget,
    instructions: map.instructions.map(({ content: _content, ...file }) => file),
    overrides: inspection.overrides,
    warnings: inspection.warnings,
  };
}

export function renderExplain(map: CodexMap, inspection: Inspection): string {
  const lines = [`Effective instructions for:`, relative(map.projectRoot, map.target), ""];
  for (const file of map.instructions) lines.push(`${file.precedence}. ${file.displayPath}`, `   - ${formatSize(file.bytes)}`, "");
  lines.push(`Effective size: ${formatSize(map.effectiveBytes)} / ${formatSize(map.budgetBytes)}`);
  if (inspection.overrides.length) lines.push("", "Overrides:", ...inspection.overrides.map((item) => `- ${item.kind === "package-manager" ? "Package manager" : "Test command"}: ${item.from} -> ${item.to}`));
  if (inspection.warnings.length) lines.push("", "Warnings:", ...inspection.warnings.map((item) => `- ${item.message}`));
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Dispatch `explain` using `node:util.parseArgs`**

Replace the unknown-command-only body after the help branch with parsing that:

```ts
const [command, ...tokens] = argv;
if (command === "explain") {
  const { values, positionals } = parseArgs({
    args: tokens,
    allowPositionals: true,
    options: {
      agent: { type: "string", default: "codex" },
      cwd: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (values.agent !== "codex") throw new Error(`Unsupported agent: ${values.agent}`);
  if (positionals.length !== 1) throw new Error("explain requires exactly one file");
  const target = resolve(env.processCwd, positionals[0]);
  const effectiveCwd = values.cwd ? resolve(env.processCwd, values.cwd) : dirname(target);
  const map = await discoverCodex({ cwd: effectiveCwd, target, home: env.home });
  const inspection = await inspectInstructions(map.instructions, map.projectRoot);
  io.stdout(values.json ? `${JSON.stringify(toExplainJson(map, inspection), null, 2)}\n` : renderExplain(map, inspection));
  return 0;
}
```

Add exact imports for `homedir`, `dirname`, `parseArgs`, `discoverCodex`, `inspectInstructions`, and output functions. Default `env` is `{ processCwd: process.cwd(), home: homedir() }`. Wrap command parsing in `try/catch`, print `Error: <message>`, and return exit code `1` for invalid arguments.

- [ ] **Step 5: Verify terminal output, JSON, tests, and build**

Run: `npm test && npm run build && node dist/cli.js explain README.md --json`

Expected: tests pass; JSON parses; output contains `agent`, `instructions`, `overrides`, and `warnings`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/output.ts test/cli.test.ts
git commit -m "feat: explain effective instructions"
```

## Task 5: Add Tree, Budget, And Doctor Commands

**Files:**
- Modify: `src/codex.ts`
- Modify: `src/output.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Produces: `discoverInstructionFiles(root: string): Promise<InstructionFile[]>`
- `tree`: all `AGENTS.md` and `AGENTS.override.md` files below project root, excluding `.git` and `node_modules`.
- `budget`: discovered file sizes plus any file individually over `32768` bytes.
- `doctor`: repository-wide missing references, missing scripts, and individually over-budget files.

- [ ] **Step 1: Write one command-contract test per command**

Add a table-driven test that invokes `tree --json`, `budget --json`, and `doctor --json` in the same temporary repository. Assert:

```ts
assert.deepEqual(tree.command, "tree");
assert.equal(tree.files.some((item: { displayPath: string }) => item.displayPath === "./AGENTS.md"), true);
assert.deepEqual(budget.command, "budget");
assert.equal(typeof budget.totalBytes, "number");
assert.deepEqual(doctor.command, "doctor");
assert.equal(Array.isArray(doctor.warnings), true);
```

Use a local helper that captures stdout and parses JSON. Do not snapshot formatting.

- [ ] **Step 2: Run command tests and confirm failure**

Run: `npx tsx --test test/cli.test.ts`

Expected: FAIL with `Unknown command: tree`.

- [ ] **Step 3: Implement recursive repository discovery**

Use `node:fs/promises.readdir({ withFileTypes: true })`. Recursively visit directories, skip `.git` and `node_modules`, select both instruction filenames for repository inventory, read UTF-8 byte sizes, and sort by path. This inventory intentionally differs from effective-path discovery: it shows both files because `tree`, `budget`, and `doctor` diagnose repository state.

The exact signature must be:

```ts
export async function discoverInstructionFiles(root: string): Promise<InstructionFile[]>
```

Set `kind: "project"`, `precedence: 0`, and `displayPath` relative to root. Reuse the existing `load` helper.

- [ ] **Step 4: Add small renderer objects**

Add three JSON builders in `src/output.ts`:

```ts
export function toTreeJson(files: InstructionFile[]): object
export function toBudgetJson(files: InstructionFile[], budgetBytes?: number): object
export function toDoctorJson(warnings: Warning[]): object
```

Their stable top-level shapes are:

```ts
{ command: "tree", files: files.map(({ content: _content, ...file }) => file) }
{ command: "budget", budgetBytes, totalBytes, files: [...], overBudgetFiles: [...] }
{ command: "doctor", warnings }
```

For terminal mode, render compact line lists from the same objects; do not add colors or a formatting dependency.

- [ ] **Step 5: Dispatch all three commands**

For each command, resolve the project root with `findProjectRoot(env.processCwd)`, call `discoverInstructionFiles`, then:

- `tree`: render inventory.
- `budget`: render sizes and individual over-budget files.
- `doctor`: call `inspectInstructions(files, root)`, append `instruction-over-budget` warnings, render warnings.

Accept only `--json` for these commands. Unknown flags return exit code `1`.

- [ ] **Step 6: Verify all commands**

Run: `npm test && npm run build`

Run: `node dist/cli.js tree`

Run: `node dist/cli.js budget --json`

Run: `node dist/cli.js doctor`

Expected: all commands exit `0`; JSON parses; no network access occurs.

- [ ] **Step 7: Commit**

```bash
git add src/codex.ts src/output.ts src/cli.ts test/cli.test.ts
git commit -m "feat: add repository diagnostics"
```

## Task 6: Make The Package Publishable And Document Reality

**Files:**
- Create: `LICENSE`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: npm tarball containing `dist`, `README.md`, and `LICENSE` only.
- Produces: README commands matching the actual CLI.

- [ ] **Step 1: Add MIT license and package metadata**

Use the standard MIT license with copyright `2026 harness-map contributors`. Add repository, bugs, homepage, keywords, and `prepack: "npm run check"` fields to `package.json`. Point repository URLs at `https://github.com/codemakim/harness-map`.

- [ ] **Step 2: Update README installation and development sections**

Add exact working commands:

```sh
npx harness-map explain apps/web/src/pages/Home.tsx
npx harness-map tree
npx harness-map budget
npx harness-map doctor
```

Document Node.js `>=20`, `--json`, `--cwd`, Codex-only status, zero AI/network calls, and current root fallback: nearest `.git` ancestor, otherwise the supplied working directory.

- [ ] **Step 3: Verify executable and tarball contents**

Run: `npm run check`

Expected: build and all tests pass.

Run: `npm pack --dry-run`

Expected: tarball includes `dist/cli.js`, declaration files, `README.md`, `LICENSE`, and `package.json`; it excludes `src`, `test`, and planning documents.

Run: `node dist/cli.js --help`

Expected: exit `0` and all four v0.1 commands shown.

- [ ] **Step 4: Inspect final diff and commit**

Run: `git diff --check && git status -sb`

Expected: no whitespace errors and only intended v0.1 files changed.

```bash
git add LICENSE README.md package.json package-lock.json
git commit -m "docs: prepare v0.1 release"
```

## Final Verification

- [ ] Run `npm clean-install` from the lockfile.
- [ ] Run `npm run check` and confirm zero failures.
- [ ] Run `npm pack --dry-run` and inspect the file list.
- [ ] Run all four commands in terminal and JSON modes against this repository.
- [ ] Confirm `rg -n "compare|claude|cursor|copilot" src test` has no implementation for deferred adapters.
- [ ] Confirm `rg -n "fetch\(|https?://|openai|anthropic" src` finds no network or AI calls.
- [ ] Review `git diff master...HEAD` before publish or PR creation.

## Self-Review Result

- Spec coverage: all four v0.1 commands, Codex precedence, global instructions, 32 KiB budget, references, package scripts, terminal output, and JSON output have explicit tasks.
- Deferred scope: `compare`, other agents, package splitting, scoring, security audit, and web UI are absent.
- Dependency check: zero runtime dependencies; only TypeScript tooling is added.
- Known v0.1 boundary: project root is the nearest `.git` ancestor; configurable Codex fallback filenames are not modeled until a concrete need appears.
