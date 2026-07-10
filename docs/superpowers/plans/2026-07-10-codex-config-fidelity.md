# Codex Config Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce Codex instruction discovery from the active Codex home, user config, configured root markers and fallbacks, and exact project byte budget.

**Architecture:** Add one config reader using `smol-toml`, then pass a validated `CodexConfig` into discovery. Keep config parsing, discovery/budget logic, and rendering independently testable.

**Tech Stack:** Node.js 20+, TypeScript, `smol-toml`, `node:test`.

## Global Constraints

- Work directly on `master`.
- TDD for every behavior change.
- Only one runtime dependency: `smol-toml`.
- No AI or network calls at runtime.
- Other repositories under `/Users/jhkim/Project` are read-only dogfooding targets.

---

### Task 1: Read And Validate Codex Config

**Files:**
- Create: `src/codex-config.ts`
- Create: `test/codex-config.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

```ts
interface CodexConfig {
  codexHome: string;
  configPath: string;
  fallbackFilenames: string[];
  maxBytes: number;
  rootMarkers: string[];
}

loadCodexConfig(options: {
  userHome: string;
  codexHome?: string;
}): Promise<CodexConfig>
```

- [ ] Add failing tests for defaults, explicit `CODEX_HOME`, valid TOML fields, malformed TOML, and invalid supported field types.
- [ ] Run `npx tsx --test test/codex-config.test.ts`; expect failures because the module does not exist.
- [ ] Install `smol-toml` and implement the minimum parser/validator.
- [ ] Re-run the focused test and `npm run check`; expect all passing.
- [ ] Commit with `feat: read Codex discovery config`.

### Task 2: Apply Fallback Filenames And Root Markers

**Files:**
- Modify: `src/codex.ts`
- Modify: `src/cli.ts`
- Modify: `test/codex.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**

```ts
findProjectRoot(startDir: string, markers: string[]): Promise<string>

discoverCodex(options: {
  cwd: string;
  target: string;
  config: CodexConfig;
}): Promise<CodexMap>
```

- [ ] Add failing tests for fallback order, duplicate/blank fallbacks, custom markers, no marker found, and an empty marker list.
- [ ] Change the existing blank project override test: first existing override wins even when empty; regular `AGENTS.md` does not apply.
- [ ] Run focused tests; verify behavior failures, not syntax failures.
- [ ] Pass validated config into discovery and use configured candidate names and markers.
- [ ] Re-run focused tests and `npm run check`.
- [ ] Commit with `feat: apply Codex discovery config`.

### Task 3: Reproduce Project Budget Truncation

**Files:**
- Modify: `src/codex.ts`
- Modify: `src/output.ts`
- Modify: `test/codex.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**

```ts
interface InstructionFile {
  bytes: number;
  effectiveBytes: number;
  truncated: boolean;
}

interface CodexMap {
  effectiveBytes: number;
  projectEffectiveBytes: number;
  skippedInstructions: InstructionFile[];
}
```

- [ ] Add failing tests proving global bytes do not consume project budget, the final project file is byte-truncated, invalid UTF-8 is decoded lossily, and later files are skipped.
- [ ] Run focused tests and confirm expected assertion failures.
- [ ] Implement parent-to-child remaining-byte accounting matching `codex-rs/core/src/agents_md.rs`.
- [ ] Render total visible bytes separately from project budget usage; expose original/effective/truncated/skipped data in JSON.
- [ ] Re-run focused tests and `npm run check`.
- [ ] Commit with `feat: reproduce Codex instruction budget`.

### Task 4: CLI Errors, Documentation, And Dogfooding

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `docs/specs/2026-07-09-v0.1-design.md`
- Modify: `test/cli.test.ts`

- [ ] Add failing CLI tests for `CODEX_HOME`, malformed config exit `1`, and stable JSON keys.
- [ ] Thread `process.env.CODEX_HOME` through `CliEnv`; include config path in parse/validation errors.
- [ ] Document active config fields, project-only budget, truncation, and current config-layer non-goals.
- [ ] Run `npm clean-install`, `npm run check`, and `npm pack --dry-run`.
- [ ] Run `explain`, `tree`, `budget`, and `doctor` read-only across several repositories under `/Users/jhkim/Project`.
- [ ] Inspect `git diff --check` and commit with `docs: document Codex config fidelity`.
- [ ] Push `master` after fresh verification.

## Completion Check

- Every new behavior has observed RED then GREEN evidence.
- Config defaults match Codex: `[]`, `32768`, `[".git"]`.
- Runtime dependency count is one.
- Existing v0.1 commands remain compatible except corrected budget semantics and added JSON fields.
- Invalid config cannot silently produce a misleading map.
