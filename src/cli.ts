#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { discoverCodex } from "./codex.js";
import { inspectInstructions } from "./inspect.js";
import { renderExplain, toExplainJson } from "./output.js";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliEnv {
  processCwd: string;
  home: string;
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
  env: CliEnv = { processCwd: process.cwd(), home: homedir() },
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.stdout(help);
    return 0;
  }

  const [command, ...tokens] = argv;

  try {
    if (command === "explain") {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: {
          agent: { type: "string", default: "codex" },
          cwd: { type: "string" },
          json: { type: "boolean", default: false },
        },
      });

      if (values.agent !== "codex") throw new Error(`Unsupported agent: ${values.agent}`);
      if (positionals.length !== 1) throw new Error("explain requires exactly one file");

      const target = resolve(env.processCwd, positionals[0]);
      const cwd = values.cwd ? resolve(env.processCwd, values.cwd) : dirname(target);
      const map = await discoverCodex({ cwd, target, home: env.home });
      const inspection = await inspectInstructions(map.instructions, map.projectRoot);
      io.stdout(
        values.json
          ? `${JSON.stringify(toExplainJson(map, inspection), null, 2)}\n`
          : renderExplain(map, inspection),
      );
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Error: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
