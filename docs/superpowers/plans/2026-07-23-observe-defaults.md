# Observe Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and compare Claude observations without requiring a repository-local log path.

**Architecture:** Derive an owner-private log path from the resolved project root and user home. Add a positional `record` mode while preserving explicit path options and the unpublished legacy recorder spelling.

**Tech Stack:** Node.js 20+, TypeScript, ESM, `node:test`, Node `crypto`.

## Global Constraints

- Do not modify target repositories or Claude settings.
- Store default logs below `~/.harness-map/observations/`.
- Do not expose project names in default log filenames.
- Preserve sanitized JSONL contents and owner-only creation permissions.
- Preserve explicit log path support.

---

### Task 1: Add Project-Specific Observe Defaults

**Files:**
- Modify: `src/observe.ts`
- Modify: `src/cli.ts`
- Modify: `test/observe.test.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produce: `defaultObservationLogPath(userHome: string, projectRoot: string): string`
- Accept: `harness-map observe record [--output <log>]`
- Accept: `harness-map observe <file> [--from <log>]`
- Preserve: `harness-map observe --record <log>`

- [x] Add failing tests proving default paths are stable, distinct, below the user home, and used by record and compare.
- [x] Run `node --import tsx --test test/observe.test.ts test/cli.test.ts` and verify the new assertions fail.
- [x] Implement SHA-256 project log naming and default CLI path selection.
- [x] Update help and README examples to use the short commands while documenting explicit overrides.
- [x] Run `npm run check` and verify all tests pass.
- [x] Commit and push as `feat: add defaults for observed context`.
