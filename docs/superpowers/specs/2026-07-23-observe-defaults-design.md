# Observe Defaults Design

## Goal

Make observed-context comparison usable without adding files to the target
repository or generating Claude settings.

## Interface

```sh
harness-map observe record
harness-map observe <file>
```

`record` stores the sanitized hook event in a project-specific log below
`~/.harness-map/observations/`. Comparison reads the same log automatically.

Explicit paths remain available:

```sh
harness-map observe record --output <log>
harness-map observe <file> --from <log>
```

The unpublished `observe --record <log>` spelling remains accepted for
compatibility but is omitted from help.

## Log Selection

The hook recorder uses `CLAUDE_PROJECT_DIR` when available, otherwise the
nearest Git root from the event working directory. The log filename is the
first 16 hexadecimal characters of a SHA-256 hash of the resolved project root.
Comparison derives the same path from the Claude adapter's project root.

This avoids repository changes, path collisions, and disclosure of project
names in log filenames. Log contents keep the existing sanitized schema and
owner-only creation permissions.

## Errors

Missing default logs report the resolved path through the existing CLI error
boundary. Empty or malformed logs retain their current explicit errors.

## Testing

- Verify stable, distinct project log paths.
- Record and compare without explicit paths.
- Preserve explicit output/input paths.
- Run the full build and test suite.
