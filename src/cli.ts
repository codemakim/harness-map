#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const help = `Usage:
  harness-map explain <file> [--agent codex] [--cwd <dir>] [--json]
  harness-map tree [--json]
  harness-map budget [--json]
  harness-map doctor [--json]
`;

export async function run(
  argv: string[],
  io: CliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.stdout(help);
    return 0;
  }

  io.stderr(`Unknown command: ${argv[0]}\n${help}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
