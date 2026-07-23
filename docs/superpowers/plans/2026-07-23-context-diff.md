# Context Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which project files receive different effective Codex or Claude context between Git revisions or between `HEAD` and the current worktree.

**Architecture:** Reuse the existing repository comparison engine for each side. Materialize Git revisions in temporary local shared clones, convert both `CompareResult` values into per-file snapshots, and group identical changes for terminal and JSON output.

**Tech Stack:** Node.js 20+, TypeScript, ESM, `node:test`, Git CLI, existing runtime dependencies.

## Global Constraints

- Work directly on `master`.
- Default to `HEAD` versus the current worktree.
- Accept exactly zero or two Git revision arguments.
- Compare only deterministic instruction sources, coverage state, effective bytes, truncation, and budget state.
- Make no AI or network calls.
- Do not modify the source repository or leave temporary clones behind.
- Preserve terminal and JSON output.

---

### Task 1: Add Effective Context Diff

**Files:**
- Create: `src/diff.ts`
- Create: `src/git-snapshot.ts`
- Modify: `src/cli.ts`
- Modify: `src/output.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`
- Modify: `docs/research/2026-07-23-context-diff-validation.md`

**Interfaces:**
- `withGitSnapshot(repositoryRoot, revision, callback)` supplies a temporary detached checkout and always removes it.
- `buildDiffResult(beforeLabel, afterLabel, before, after)` returns grouped per-file effective-context changes.
- `renderDiff(result)` renders the same result without semantic interpretation.

- [x] Add failing CLI tests for explicit revisions and default `HEAD` versus worktree.
- [x] Verify tests fail because `diff` is unknown.
- [x] Add temporary shared-clone revision discovery.
- [x] Add per-file comparison and grouping for states, sources, bytes, truncation, and budget.
- [x] Add terminal and JSON CLI output.
- [x] Reject one positional revision and non-Git repositories clearly.
- [x] Document the command and update the validation decision.
- [x] Run `npm run check`.
- [x] Dogfood one historical `life-agent` change without modifying that repository.
- [x] Commit and push with `feat: diff effective agent context`.
