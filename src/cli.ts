#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadCodexConfig } from "./codex-config.js";
import {
  discoverCodex,
  discoverInstructionFiles,
  findProjectRoot,
} from "./codex.js";
import { inspectInstructions, type Warning } from "./inspect.js";
import {
  formatSize,
  renderBudget,
  renderDoctor,
  renderExplain,
  renderTree,
  toBudgetJson,
  toDoctorJson,
  toExplainJson,
  toTreeJson,
} from "./output.js";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliEnv {
  processCwd: string;
  home: string;
  codexHome?: string;
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
  env: CliEnv = {
    processCwd: process.cwd(),
    home: homedir(),
    codexHome: process.env.CODEX_HOME,
  },
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.stdout(help);
    return 0;
  }

  const [command, ...tokens] = argv;

  try {
    const config = await loadCodexConfig({ userHome: env.home, codexHome: env.codexHome });
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
      const map = await discoverCodex({ cwd, target, config });
      const inspection = await inspectInstructions(map.instructions, map.projectRoot);
      io.stdout(
        values.json
          ? `${JSON.stringify(toExplainJson(map, inspection), null, 2)}\n`
          : renderExplain(map, inspection),
      );
      return 0;
    }

    if (["tree", "budget", "doctor"].includes(command)) {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: { json: { type: "boolean", default: false } },
      });
      if (positionals.length) throw new Error(`${command} does not accept positional arguments`);

      const root = await findProjectRoot(env.processCwd, config.rootMarkers);
      const files = await discoverInstructionFiles(root, config.fallbackFilenames);
      let terminal: string;
      let json: object;

      if (command === "tree") {
        terminal = renderTree(files);
        json = toTreeJson(files);
      } else if (command === "budget") {
        terminal = renderBudget(files, config.maxBytes);
        json = toBudgetJson(files, config.maxBytes);
      } else {
        const inspection = await inspectInstructions(files, root);
        const warnings: Warning[] = [
          ...inspection.warnings,
          ...files
            .filter((file) => file.bytes > config.maxBytes)
            .map((file) => ({
              kind: "instruction-over-budget" as const,
              message: `${file.displayPath} exceeds the ${formatSize(config.maxBytes)} instruction budget`,
              source: file.displayPath,
            })),
        ];
        terminal = renderDoctor(warnings);
        json = toDoctorJson(warnings);
      }

      io.stdout(values.json ? `${JSON.stringify(json, null, 2)}\n` : terminal);
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Error: ${message}\n`);
    return 1;
  }
}
