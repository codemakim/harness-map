import assert from "node:assert/strict";
import test from "node:test";

import type { ClaudeMap } from "../src/claude.js";
import {
  buildObservedContext,
  defaultObservationLogPath,
  parseClaudeHookEvent,
  parseObservationLog,
} from "../src/observe.js";

const map: ClaudeMap = {
  agent: "claude",
  target: "/project/src/game.ts",
  cwd: "/project/src",
  projectRoot: "/project",
  budgetBytes: null,
  effectiveBytes: 12,
  projectEffectiveBytes: 12,
  overBudget: false,
  instructions: [
    {
      path: "/project/CLAUDE.md",
      displayPath: "./CLAUDE.md",
      bytes: 8,
      effectiveBytes: 12,
      content: "root\nnested",
      sourceContent: "@rules/shared.md",
      kind: "project",
      precedence: 1,
      truncated: false,
      imports: [
        {
          path: "/project/rules/shared.md",
          displayPath: "./rules/shared.md",
          bytes: 6,
          depth: 1,
        },
      ],
    },
  ],
  skippedInstructions: [],
};

test("derives a stable private log name for each project", () => {
  const first = defaultObservationLogPath("/home/me", "/projects/first");
  const repeated = defaultObservationLogPath("/home/me", "/projects/first");
  const second = defaultObservationLogPath("/home/me", "/projects/second");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^\/home\/me\/\.harness-map\/observations\/[a-f0-9]{16}\.jsonl$/);
  assert.equal(first.includes("first"), false);
});

test("sanitizes a Claude InstructionsLoaded hook event", () => {
  const observation = parseClaudeHookEvent({
    session_id: "session-1",
    transcript_path: "/private/transcript.jsonl",
    cwd: "/project",
    permission_mode: "default",
    hook_event_name: "InstructionsLoaded",
    file_path: "/project/CLAUDE.md",
    memory_type: "Project",
    load_reason: "session_start",
  });

  assert.deepEqual(observation, {
    version: 1,
    agent: "claude",
    sessionId: "session-1",
    cwd: "/project",
    filePath: "/project/CLAUDE.md",
    memoryType: "Project",
    loadReason: "session_start",
  });
  assert.equal(JSON.stringify(observation).includes("transcript"), false);
  assert.equal(JSON.stringify(observation).includes("permission"), false);
});

test("rejects unrelated or malformed hook events", () => {
  assert.throws(
    () => parseClaudeHookEvent({
      session_id: "session-1",
      cwd: "/project",
      hook_event_name: "PreToolUse",
      file_path: "/project/CLAUDE.md",
      memory_type: "Project",
      load_reason: "session_start",
    }),
    /InstructionsLoaded/,
  );
  assert.throws(
    () => parseClaudeHookEvent({
      session_id: "session-1",
      cwd: "/project",
      hook_event_name: "InstructionsLoaded",
      memory_type: "Project",
      load_reason: "session_start",
    }),
    /file_path/,
  );
});

test("compares the latest observed session with expected Claude paths", () => {
  const observations = parseObservationLog([
    JSON.stringify({
      version: 1,
      agent: "claude",
      sessionId: "old",
      cwd: "/project",
      filePath: "/project/old.md",
      memoryType: "Project",
      loadReason: "session_start",
    }),
    JSON.stringify({
      version: 1,
      agent: "claude",
      sessionId: "latest",
      cwd: "/project",
      filePath: "/project/CLAUDE.md",
      memoryType: "Project",
      loadReason: "session_start",
    }),
    JSON.stringify({
      version: 1,
      agent: "claude",
      sessionId: "latest",
      cwd: "/project",
      filePath: "/project/extra.md",
      memoryType: "Managed",
      loadReason: "include",
      parentFilePath: "/project/CLAUDE.md",
    }),
    JSON.stringify({
      version: 1,
      agent: "claude",
      sessionId: "latest",
      cwd: "/project",
      filePath: "/project/other/CLAUDE.md",
      memoryType: "Project",
      loadReason: "nested_traversal",
      triggerFilePath: "/project/other/file.ts",
    }),
  ].join("\n"));

  const result = buildObservedContext(map, observations);

  assert.equal(result.sessionId, "latest");
  assert.deepEqual(result.matched, ["./CLAUDE.md"]);
  assert.deepEqual(result.expectedOnly, ["./rules/shared.md"]);
  assert.deepEqual(result.observedOnly, ["/project/extra.md"]);
  assert.equal(result.status, "drift");
});
