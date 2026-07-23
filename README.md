# harness-map

[![CI](https://github.com/codemakim/harness-map/actions/workflows/ci.yml/badge.svg)](https://github.com/codemakim/harness-map/actions/workflows/ci.yml)

Show what instructions an agent actually reads for a file.

`harness-map` is a local CLI for debugging agent harness context. Given a file
path, it reconstructs the instruction files that apply to that path, the order
they are read in, the effective size budget, and the simple drift that humans
usually miss.

```sh
harness-map explain apps/web/src/pages/Home.tsx --agent codex
```

```text
Effective instructions for:
apps/web/src/pages/Home.tsx

1. ~/.codex/AGENTS.md
   - 1.2 KiB

2. ./AGENTS.md
   - 4.8 KiB

3. ./apps/web/AGENTS.md
   - 2.1 KiB

4. ./apps/web/src/AGENTS.override.md
   - 0.9 KiB

Total visible size: 9.0 KiB
Project budget: 7.8 KiB / 32.0 KiB

Overrides:
- Package manager: npm -> pnpm
- Test command: npm test -> pnpm test:web

Warnings:
- docs/frontend-conventions.md does not exist
- `pnpm test:web` is not defined in package.json
```

## Why

Agent harnesses are no longer one prompt. They are a stack of surfaces:
global files, project files, nested overrides, adapter-specific discovery,
precedence rules, context limits, and execution contracts.

That stack is powerful, but hard to inspect. A developer looking at
`apps/web/src/pages/Home.tsx` should be able to answer one question quickly:

> What will this agent actually see before it edits this file?

`harness-map` exists to answer that question without calling an AI model and
without touching the network.

## Install

Requires Node.js 20 or newer.

```sh
npx harness-map explain apps/web/src/pages/Home.tsx
npx harness-map explain apps/web/src/pages/Home.tsx --agent claude
```

The CLI reads local files only. It makes no AI or network calls.

## Usage

```sh
npx harness-map tree [--agent codex|claude]
npx harness-map explain apps/web/src/pages/Home.tsx [--agent codex|claude]
npx harness-map budget [--agent codex|claude]
npx harness-map doctor [--agent codex|claude]
npx harness-map scan [--agent codex|claude]
npx harness-map compare [--agents codex,claude]
npx harness-map diff [<before> <after>] [--json]
npx harness-map observe <file> --from <log> [--json]
npx harness-map check [--json]
npx harness-map sync --from codex --to claude [--dry-run|--write] [--json]
```

Add `--json` to any command for machine-readable output. `explain` also accepts
`--cwd <dir>`. The default agent is `codex`.

The Claude adapter discovers user and project `CLAUDE.md` files,
`CLAUDE.local.md`, and recursive `.claude/rules/**/*.md` rules. It applies
`paths` frontmatter to the target file and expands `@file` imports up to four
hops. Claude instruction files have no hard size budget, so `budget` reports
their discovered size without enforcing a limit.

`scan` checks Git-tracked and unignored project files, then groups files that
receive the same effective instruction stack. Terminal output shows five file
examples per context; JSON output includes every file.

`compare` runs Codex and Claude against the same project files, then groups
files by their paired contexts and reports structural drift in instruction
files, visible size, and budget behavior.

`diff` compares effective Codex and Claude context across Git history. With no
revisions it compares `HEAD` with the current worktree; with two revisions it
compares those snapshots. Output groups affected files by coverage state,
instruction sources, effective size, truncation, and budget changes. Temporary
checkouts stay local and the source repository is not modified.

`observe` compares the Claude adapter's expected paths with paths emitted by
Claude Code's `InstructionsLoaded` hook. Add a local hook after installing
`harness-map` in the project:

```json
{
  "hooks": {
    "InstructionsLoaded": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --no-install harness-map observe --record \"${CLAUDE_PROJECT_DIR}/.harness-map/claude-observations.jsonl\""
          }
        ]
      }
    ]
  }
}
```

Put this in `.claude/settings.local.json`, add `.harness-map/` to
`.gitignore`, then start a new Claude Code session and let it access the target
file. Compare the latest recorded session:

```sh
npx harness-map observe src/game.ts \
  --from .harness-map/claude-observations.jsonl
```

The recorder stores only whitelisted instruction metadata: session ID, working
directory, instruction path, scope, load reason, matching globs, and lazy-load
relationships. It discards transcript paths, prompts, permission mode, and
instruction content. `InstructionsLoaded` is asynchronous, so wait for hook
completion before comparing. A matched result proves path discovery only, not
that the model followed the instructions.

`check` reports only actionable coverage gaps and broken references. It exits
with status `1` when errors exist and `0` for clean, warning-only, or
unconfigured projects, making it suitable for CI.

`sync --from codex --to claude` previews minimal `CLAUDE.md` bridge files for
uncovered `AGENTS.md` files. Each bridge contains only a local `@AGENTS.md`
import. Dry-run is the default. Pass `--write` to create every validated bridge;
an existing target prevents all writes and exits with status `1`.

`harness-map` reads `CODEX_HOME`, then `config.toml` from the active Codex home.
It applies `project_doc_fallback_filenames`, `project_doc_max_bytes`, and
`project_root_markers`. An explicitly empty `project_root_markers` list limits
project discovery to the effective working directory.

## v0.5 Scope

Current adapters: Codex and Claude Code.

Codex:

- Discover `AGENTS.md`
- Prefer `AGENTS.override.md` over `AGENTS.md` in the same scope
- Merge one instruction file per directory from parent directory to target directory
- Show actual application order
- Calculate effective instruction size
- Respect the default 32 KiB instruction budget
- Read Codex discovery settings from `config.toml`
- Report truncated and budget-skipped project instructions

Claude Code:

- Discover user, project, and nested `CLAUDE.md` files
- Discover `CLAUDE.local.md` files
- Load recursive user and project `.claude/rules/**/*.md` rules
- Apply rule `paths` frontmatter to the target path
- Expand relative, absolute, and home-relative `@file` imports up to four hops
- Report discovered size without inventing a hard budget

Both adapters:

- Group project files by effective instruction context with `scan`
- Compare Codex and Claude contexts across the project with `compare`
- Diff effective context across Git revisions or against the worktree
- Compare expected Claude paths with observed `InstructionsLoaded` events
- Fail CI on actionable coverage gaps and broken references with `check`
- Preview or write missing Codex-to-Claude instruction bridges with `sync`
- Warn on referenced files that do not exist
- Warn on documented `npm` / `pnpm` scripts that are missing from `package.json`
- Support terminal and JSON output
- Make no AI calls
- Make no network calls

## Commands

```sh
harness-map tree [--agent codex|claude]
harness-map explain <file> [--agent codex|claude]
harness-map budget [--agent codex|claude]
harness-map doctor [--agent codex|claude]
harness-map scan [--agent codex|claude]
harness-map compare [--agents codex,claude]
harness-map diff [<before> <after>] [--json]
harness-map observe --record <log>
harness-map observe <file> --from <log> [--json]
harness-map check [--json]
harness-map sync --from codex --to claude [--dry-run|--write] [--json]
```

## Not AgentLint

AgentLint scores harness quality and checks bad configuration, security risks,
and documentation quality. `harness-lint` turns repeated AI mistakes into
executable lint rules.

`harness-map` does not start with scoring.

It reconstructs the effective harness for one path:

> At this path, what does this agent actually read?

That makes it a harness debugger, not a harness grader.

## Future Shape

```text
packages/
  core/
  adapter-codex/
  adapter-claude/
  adapter-cursor/
  adapter-copilot/
```

Later, `compare` can expose drift across agents:

```text
Codex reads:   4 instruction files, 12.4 KiB
Claude reads:  3 instruction files, 18.7 KiB
Cursor reads:  6 rule files, 21.2 KiB

Drift:
- Codex requires pnpm
- Claude documentation still says npm
- Cursor has no payment security rule
```

## Development

```sh
npm clean-install
npm run check
```

Runtime dependencies are `smol-toml` for Codex config parsing, `yaml` for
Claude rule frontmatter, and `minimatch` for Claude path rules.
