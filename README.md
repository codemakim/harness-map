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
npx harness-map observe <file> [--from <log>] [--json]
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
            "command": "npx --no-install harness-map observe record"
          }
        ]
      }
    ]
  }
}
```

Put this in `.claude/settings.local.json`, then start a new Claude Code session
and let it access the target file. Compare the latest recorded session:

```sh
npx harness-map observe src/game.ts
```

Default logs live under `~/.harness-map/observations/`, keyed by a hash of the
project root. They do not modify the project or expose its name in the log
filename. Use `observe record --output <log>` and `observe <file> --from <log>`
when an explicit location is preferable.

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

## v0.6 Support Matrix

Current adapters: Codex and Claude Code.

| Capability | Codex | Claude Code |
| --- | --- | --- |
| User-level instructions | `~/.codex/AGENTS.md` or `AGENTS.override.md` | `~/.claude/CLAUDE.md` and user rules |
| Project instructions | `AGENTS.md` | `CLAUDE.md` and `.claude/CLAUDE.md` |
| Nested instructions | Parent-to-target `AGENTS.md` hierarchy | Parent-to-target `CLAUDE.md` hierarchy |
| Local precedence | `AGENTS.override.md` replaces `AGENTS.md` in the same directory | `CLAUDE.local.md` is loaded after shared instructions |
| Path-scoped rules | Not supported by Codex | `.claude/rules/**/*.md` with `paths` frontmatter |
| Imported instruction files | Not applicable | Relative, absolute, and home-relative `@file`, up to four hops |
| Instruction size | Enforces configured project byte budget; default 32 KiB | Reports discovered bytes; no hard budget is invented |
| Adapter configuration | Selected `config.toml` discovery and budget fields | Claude settings files are not interpreted |
| Runtime observation | Not available | `InstructionsLoaded` hook paths through `observe` |

### Command Support

| Command | Codex | Claude Code | Notes |
| --- | --- | --- | --- |
| `tree` | Yes | Yes | Inventory instruction sources |
| `explain <file>` | Yes | Yes | Reconstruct one file's effective context |
| `budget` | Yes | Yes | Claude reports size without a limit |
| `doctor` | Yes | Yes | Broken references and package scripts |
| `scan` | Yes | Yes | Group project files by effective context |
| `compare` | Yes | Yes | Always compares the Codex/Claude pair |
| `diff` | Yes | Yes | Compares paired effective context across Git snapshots |
| `check` | Yes | Yes | Checks paired coverage gaps and broken references |
| `sync` | Source | Target | Only `codex -> claude` bridge files are supported |
| `observe` | No | Yes | Requires Claude Code's `InstructionsLoaded` hook |

All supported commands have terminal and JSON output where documented.
`harness-map` itself makes no AI or network calls.

### Not Supported Yet

- Cursor, Copilot, Gemini CLI, or other agent adapters
- Claude managed instructions, auto memory, skills, subagents, MCP configuration,
  permissions, or general hook configuration
- Codex skills, MCP configuration, permissions, or runtime-loaded context
- Semantic equivalence, contradiction detection, instruction quality scoring,
  or proof that a model followed an instruction
- Claude-to-Codex sync or automatic rewriting of existing instruction files
- Automatic installation or modification of Claude Code hook settings

`observe` verifies loaded instruction paths, not instruction content or model
adherence. It is informational and does not currently fail CI.

## Commands

```sh
harness-map tree [--agent codex|claude]
harness-map explain <file> [--agent codex|claude]
harness-map budget [--agent codex|claude]
harness-map doctor [--agent codex|claude]
harness-map scan [--agent codex|claude]
harness-map compare [--agents codex,claude]
harness-map diff [<before> <after>] [--json]
harness-map observe record [--output <log>]
harness-map observe <file> [--from <log>] [--json]
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

Future adapters can extend `compare` beyond the current Codex/Claude pair:

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
