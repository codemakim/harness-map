# Actionable Coverage Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one 30-minute task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `harness-map` from a context viewer into a deterministic tool that finds agent coverage gaps, explains affected files, proposes safe fixes, and blocks regressions in CI.

**Architecture:** Keep Codex and Claude discovery unchanged. Build an actionable finding layer on top of `compare`, then expose it through `check` and a conservative `sync` command. Global user instructions remain visible but do not count as project drift. No AI or network calls.

**Tech Stack:** Node.js 20+, TypeScript, ESM, `node:test`, existing `smol-toml`, `yaml`, and `minimatch` dependencies.

## Current Evidence

- `life-agent`: Codex has 8 contexts, Claude has 1; 70 files miss nested `AGENTS.md` coverage in Claude.
- `github-pages/blog`: Codex and Claude each have 2 contexts; Claude imports the corresponding `AGENTS.md`, so current filename-based drift is a false positive.
- `tactical-auto-battler`: both agents have one repository-wide context; independent instruction sources exist, but structural comparison cannot judge semantic conflict.
- `project-ricochet` and 10 other repositories: no project instruction files, so there is little harness to analyze.
- Across 15 repositories, current commands completed in a few seconds; performance is not the blocker.

## Global Constraints

- Work directly on `master` in one reviewed commit per task.
- Each task should fit one roughly 30-minute session.
- Use TDD for behavior changes and run `npm run check` before each commit.
- Preserve terminal and JSON output.
- Never modify dogfood repositories while testing.
- Never overwrite an existing instruction file.
- Keep AI calls, network calls, scoring, and semantic prose comparison out of scope.

---

## Task 1: Replace Structural Noise With Coverage Findings

**Files:**
- Modify: `src/compare.ts`
- Modify: `src/output.ts`
- Modify: `test/cli.test.ts`

**Deliverable:** `compare` distinguishes environment context, shared imports, real project coverage gaps, and independent instruction sources.

- [x] Add failing fixtures for a Claude `@AGENTS.md` mirror, a missing nested Claude bridge, global-only Codex instructions, and no project instructions.
- [x] Add instruction `kind` and import provenance to compare snapshots without exposing instruction content.
- [x] Exclude global user files from project drift; show them under an informational environment section.
- [x] Classify imported `AGENTS.md` as a shared source instead of `Claude only` / `Codex only` drift.
- [x] Report affected file counts for nested coverage gaps.
- [x] Render explicit states: `shared`, `coverage-gap`, `independent`, and `unconfigured`.
- [x] Run `npm run check` and dogfood `life-agent`, `blog`, `tactical-auto-battler`, and `project-ricochet` read-only.
- [x] Accept only if `life-agent` reports 70 affected files and `blog` no longer reports mirrored files as drift.
- [x] Commit with `feat: report actionable coverage drift`.

## Task 2: Add A CI-Ready `check` Command

**Files:**
- Create: `src/check.ts`
- Modify: `src/cli.ts`
- Modify: `src/output.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`

**Deliverable:** `harness-map check` prints only actionable findings and provides stable CI exit behavior.

- [x] Write failing tests for clean, coverage-gap, missing-reference, and unconfigured repositories.
- [x] Define finding levels: `error`, `warning`, and `info`.
- [x] Emit `error` for agent coverage gaps and broken concrete references.
- [x] Emit `info` when neither agent has project instructions; do not fail solely for being unconfigured.
- [x] Return exit `1` when any error exists and exit `0` otherwise.
- [x] Add JSON fields `errors`, `warnings`, `info`, and `affectedFiles`.
- [x] Document `harness-map check [--json]` and exit codes.
- [x] Run `npm run check` and verify the shell exit code against temporary repositories.
- [x] Commit with `feat: add harness coverage check`.

## Task 3: Add Safe Bridge Planning With `sync --dry-run`

**Files:**
- Create: `src/sync.ts`
- Modify: `src/cli.ts`
- Modify: `src/output.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`

**Deliverable:** The CLI proposes minimal Claude bridge files for uncovered nested Codex instructions without changing disk state.

- [ ] Write failing tests for nested `AGENTS.md`, an existing `CLAUDE.md`, imports, and conflicting target files.
- [ ] Support only `sync --from codex --to claude --dry-run` in this task.
- [ ] Propose `<directory>/CLAUDE.md` containing a minimal local `@AGENTS.md` import.
- [ ] Skip directories already covered through an existing Claude entrypoint or rule.
- [ ] Refuse ambiguous roots and report existing-file conflicts.
- [ ] Include proposed path, source path, and affected file count in terminal and JSON output.
- [ ] Dogfood against `life-agent` read-only and verify the proposal matches its real coverage gaps.
- [ ] Commit with `feat: plan Claude instruction bridges`.

## Task 4: Add Explicit `sync --write`

**Files:**
- Modify: `src/sync.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`

**Deliverable:** Users can apply the exact reviewed dry-run plan with conservative filesystem behavior.

- [ ] Write failing tests proving no overwrite, no partial write after validation failure, and idempotent reruns.
- [ ] Require the explicit `--write` flag; keep dry-run as the default behavior.
- [ ] Validate every target before writing any file.
- [ ] Create only missing bridge files and never edit existing `AGENTS.md` or `CLAUDE.md` files.
- [ ] Print created paths and the command needed to verify with `harness-map check`.
- [ ] Test only with temporary repositories; do not apply writes to user projects automatically.
- [ ] Commit with `feat: write safe instruction bridges`.

## Task 5: Validate Product Value And Release

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Deliverable:** A release candidate proven useful on the local repository set, or a documented stop decision.

- [ ] Run `compare` and `check` read-only across all 15 local Git repositories.
- [ ] Record true findings, false positives, unconfigured repositories, command duration, and exit codes.
- [ ] Require zero false coverage errors for `github-pages/blog`.
- [ ] Require one clear actionable coverage finding for `life-agent`, including affected files and a safe dry-run fix.
- [ ] Require useful unconfigured output for `project-ricochet` without treating it as an error.
- [ ] Stop feature expansion if these acceptance checks fail; do not add Cursor or semantic analysis to hide weak signal.
- [ ] If checks pass, bump the minor version, verify tarball installation, publish npm, tag Git, and create a GitHub Release.
- [ ] Commit release preparation with `chore(release): prepare v0.5.0`.

## Deferred

- Cursor, Copilot, and additional adapters.
- AI-based semantic comparison of prose.
- Package-manager and test-command semantic drift beyond deterministic extraction.
- Scores, dashboards, and hosted services.
- Editing existing instruction content.

## Definition Of Success

```text
$ harness-map check

ERROR Claude misses nested instructions
- 70 files affected
- examples/AGENTS.md
- plugins/AGENTS.md
- scripts/AGENTS.md
- tools/public/AGENTS.md
- vault/AGENTS.md

Fix preview:
harness-map sync --from codex --to claude --dry-run
```

The tool is successful when this result is accurate, reproducible, CI-enforceable, and fixable without manually tracing instruction discovery.
