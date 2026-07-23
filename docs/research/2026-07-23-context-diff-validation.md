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

Do not implement `harness-map diff` now.

The validation found one strong explanatory example, but no case where the
historical view supplied an action that the current `check` or `sync` result
could not support. This misses the requirement for two or three
decision-changing examples.

## Next Candidate

Run a bounded Claude Code observed-context spike using the
`InstructionsLoaded` hook.

Proceed only if the spike can:

- capture root, nested, imported, and path-scoped instruction paths reliably;
- compare observed paths with harness-map's expected paths;
- store only local event metadata, never instruction or transcript content;
- work without patching Claude Code or relying on undocumented internals.

If those checks fail, stop rather than expanding adapters or adding semantic
analysis.
