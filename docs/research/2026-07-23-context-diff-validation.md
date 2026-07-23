# Context Diff Value Validation

## Goal

Test whether effective-context history adds enough value beyond `git diff`,
`harness-map check`, and `harness-map sync` to justify a new command.

## Evidence

- Searched 15 local repositories and found 45 commits that changed supported
  instruction files.
- Reconstructed the parent and result snapshots for five representative commits
  without modifying the original repositories.
- Compared per-file instruction sources, effective bytes, coverage state,
  `check` findings, and dry-run bridge proposals.

| Repository and commit | Effective result | Incremental value |
| --- | --- | --- |
| `blog` `195f960577` | 269 files changed from coverage-gap to shared | Low: `check` already showed the coverage error disappearing |
| `life-agent` `797a1724f0` | 99 common files changed; bridge proposals increased from 1 to 7 | Medium: scope growth was clearer, but `check` already listed all affected sources |
| `life-agent` `997a8a8ee9` | 41 files became shared and 70 became coverage-gap | Medium: useful history, but the resulting 70-file regression already failed `check` |
| `tactical-auto-battler` `16a2c867fe` | 239 files received smaller instruction content | Low: no coverage or actionable finding changed |
| `tactical-auto-battler` `f873b580b3` | 244 files received small content additions | Low: blast radius was predictable and `check` stayed clean |

## Decision

Implement a bounded `harness-map diff` command as a product experiment.

The initial evidence does not prove that history is more actionable than
`check` or `sync`. It does show that history explains blast radius and mixed
coverage transitions much faster than reconstructing snapshots by hand.
The implementation therefore stays narrow: deterministic context sources,
coverage state, effective bytes, truncation, and budget state only. No semantic
comparison, AI calls, or network calls.

The command should earn further investment through real use. If it does not
change review or debugging decisions, keep it small rather than building richer
history analysis around it.

## Implementation Check

The bounded implementation reproduced `life-agent` commit `997a8a8ee9`:

- 111 common files changed effective context;
- 41 files moved from independent instructions to shared root instructions;
- 70 files moved from independent instructions to a coverage gap;
- 5 project files were added and 9 were removed.

This matches the earlier hand-built reconstruction while exposing the mixed
improvement and regression in one command.

## Observed Context Spike

Claude Code officially documents the `InstructionsLoaded` hook with absolute
instruction paths, load reasons, matching globs, trigger paths, and parent
include paths. The event is asynchronous and has no decision control.

The bounded spike adds:

- `harness-map observe --record <log>` for sanitized JSONL capture;
- `harness-map observe <file> --from <log>` for latest-session path comparison;
- no instruction content, prompts, transcript paths, or permission data;
- no AI or network calls from `harness-map`.

An actual Claude Code 2.1.138 process loaded the root `CLAUDE.md` from
`tactical-auto-battler` and invoked the recorder before model execution. External
API access was redirected to an unreachable localhost address during the test.
Comparing the captured session against
`src/__tests__/action-card-badges.spec.ts` produced one expected path, one
observed path, and no drift.

This validates session-start observation. Nested traversal, path-glob, include,
and compaction events still need repeated real-session evidence before
`observe` can become a CI gate. Keep it experimental and informational until
then.
