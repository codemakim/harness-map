# Codex Config Fidelity Design

## Goal

Make `harness-map explain` reproduce Codex instruction discovery using the
active Codex home, user config, root markers, fallback filenames, and project
instruction byte limit.

## Source Of Truth

Match the current OpenAI Codex implementation in
`codex-rs/core/src/agents_md.rs` and `codex-rs/core/config.schema.json`.

## Configuration

Add `smol-toml` as the only runtime dependency.

Resolve Codex home in this order:

1. `CODEX_HOME`
2. `<user-home>/.codex`

Read `<codex-home>/config.toml`. Support these top-level fields:

- `project_doc_fallback_filenames: string[]`, default `[]`
- `project_doc_max_bytes: non-negative integer`, default `32768`
- `project_root_markers: string[]`, default `[".git"]`

An empty root marker list disables parent traversal. Invalid TOML or invalid
supported field types return an error naming `config.toml`; silent fallback
would make the reconstructed result untrustworthy.

Profiles, managed config layers, project config layers, and command-line Codex
config overrides are deferred.

## Discovery

Global discovery checks only the Codex home:

1. `AGENTS.override.md`
2. `AGENTS.md`

Project discovery checks each directory from the configured project root to
the effective working directory:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. configured fallback filenames in order, ignoring duplicates and blanks

Select the first existing file per directory. If that selected file is empty,
it contributes no instructions and discovery does not fall through to the next
filename. If no configured root marker is found, inspect only the effective
working directory.

## Budget

`project_doc_max_bytes` applies only to project instructions. Global guidance
is model-visible but does not consume this project budget.

Read project files parent-to-child. When a file exceeds the remaining budget,
include only the remaining bytes and mark it truncated. Once no budget
remains, do not apply later project files, but report them as skipped so the
developer can see what Codex missed.

Each instruction record exposes:

- original `bytes`
- model-visible `effectiveBytes`
- `truncated`

The result also exposes `skippedInstructions`. Terminal output shows total
model-visible size separately from project budget usage.

## Errors

- Missing `config.toml`: use defaults.
- Invalid config: exit `1` with file path and parser or validation message.
- Unreadable instruction file: preserve the existing command error behavior.
- Invalid UTF-8 after byte truncation: match Codex lossy UTF-8 decoding.

## Tests

Use temporary repositories and Codex homes to cover:

- `CODEX_HOME` selection
- configured fallback order
- custom and empty root markers
- custom project budget
- final-file byte truncation and later-file skipping
- global bytes excluded from project budget
- malformed TOML and invalid field types
- stable terminal and JSON output

After unit and CLI tests, run read-only dogfooding across several repositories
under `/Users/jhkim/Project`.

## Non-Goals

- No Claude, Cursor, or Copilot adapters.
- No profile or managed configuration merging.
- No config editing.
- No network or AI calls.
