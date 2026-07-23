import { appendFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { ClaudeMap } from "./claude.js";

const MEMORY_TYPES = ["User", "Project", "Local", "Managed"] as const;
const LOAD_REASONS = [
  "session_start",
  "nested_traversal",
  "path_glob_match",
  "include",
  "compact",
] as const;

type MemoryType = typeof MEMORY_TYPES[number];
type LoadReason = typeof LOAD_REASONS[number];

export interface ClaudeObservation {
  version: 1;
  agent: "claude";
  sessionId: string;
  cwd: string;
  filePath: string;
  memoryType: MemoryType;
  loadReason: LoadReason;
  globs?: string[];
  triggerFilePath?: string;
  parentFilePath?: string;
}

export interface ObservedContextResult {
  command: "observe";
  agent: "claude";
  target: string;
  sessionId: string;
  status: "matched" | "drift";
  matched: string[];
  expectedOnly: string[];
  observedOnly: string[];
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function member<T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}

function optionalStrings(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

export function parseClaudeHookEvent(input: unknown): ClaudeObservation {
  const value = object(input, "hook input");
  if (value.hook_event_name !== "InstructionsLoaded") {
    throw new Error("observe --record requires an InstructionsLoaded hook event");
  }
  return {
    version: 1,
    agent: "claude",
    sessionId: string(value.session_id, "session_id"),
    cwd: string(value.cwd, "cwd"),
    filePath: string(value.file_path, "file_path"),
    memoryType: member(value.memory_type, MEMORY_TYPES, "memory_type"),
    loadReason: member(value.load_reason, LOAD_REASONS, "load_reason"),
    ...(value.globs === undefined ? {} : { globs: optionalStrings(value.globs, "globs")! }),
    ...(value.trigger_file_path === undefined
      ? {}
      : { triggerFilePath: optionalString(value.trigger_file_path, "trigger_file_path")! }),
    ...(value.parent_file_path === undefined
      ? {}
      : { parentFilePath: optionalString(value.parent_file_path, "parent_file_path")! }),
  };
}

function parseObservation(input: unknown): ClaudeObservation {
  const value = object(input, "observation");
  if (value.version !== 1 || value.agent !== "claude") {
    throw new Error("unsupported observation format");
  }
  return {
    version: 1,
    agent: "claude",
    sessionId: string(value.sessionId, "sessionId"),
    cwd: string(value.cwd, "cwd"),
    filePath: string(value.filePath, "filePath"),
    memoryType: member(value.memoryType, MEMORY_TYPES, "memoryType"),
    loadReason: member(value.loadReason, LOAD_REASONS, "loadReason"),
    ...(value.globs === undefined ? {} : { globs: optionalStrings(value.globs, "globs")! }),
    ...(value.triggerFilePath === undefined
      ? {}
      : { triggerFilePath: optionalString(value.triggerFilePath, "triggerFilePath")! }),
    ...(value.parentFilePath === undefined
      ? {}
      : { parentFilePath: optionalString(value.parentFilePath, "parentFilePath")! }),
  };
}

export function parseObservationLog(text: string): ClaudeObservation[] {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return parseObservation(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid observation at line ${index + 1}: ${(error as Error).message}`);
    }
  });
}

export async function appendObservation(path: string, observation: ClaudeObservation): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(observation)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function buildObservedContext(
  map: ClaudeMap,
  observations: ClaudeObservation[],
): ObservedContextResult {
  const sessionId = observations.at(-1)?.sessionId;
  if (!sessionId) throw new Error("observation log is empty");
  const session = observations.filter((item) => item.sessionId === sessionId);
  const expected = new Map<string, string>();
  for (const file of map.instructions) {
    expected.set(resolve(file.path), file.displayPath);
    for (const imported of file.imports ?? []) {
      expected.set(resolve(imported.path), imported.displayPath);
    }
  }
  const relevant = new Set<string>();
  for (const item of session) {
    const path = resolve(item.filePath);
    if (
      item.loadReason === "session_start" ||
      item.loadReason === "compact" ||
      expected.has(path) ||
      (item.triggerFilePath && resolve(item.triggerFilePath) === resolve(map.target))
    ) {
      relevant.add(path);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of session) {
      const path = resolve(item.filePath);
      if (
        item.parentFilePath &&
        relevant.has(resolve(item.parentFilePath)) &&
        !relevant.has(path)
      ) {
        relevant.add(path);
        changed = true;
      }
    }
  }
  const observed = relevant;
  const matched = [...expected].filter(([path]) => observed.has(path)).map(([, display]) => display);
  const expectedOnly = [...expected].filter(([path]) => !observed.has(path)).map(([, display]) => display);
  const observedOnly = [...observed].filter((path) => !expected.has(path));

  return {
    command: "observe",
    agent: "claude",
    target: relative(map.projectRoot, map.target),
    sessionId,
    status: expectedOnly.length || observedOnly.length ? "drift" : "matched",
    matched,
    expectedOnly,
    observedOnly,
  };
}
