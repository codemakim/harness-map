#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  claudeInspectionFiles,
  discoverClaude,
  discoverClaudeInstructionFiles,
} from "./claude.js";
import { buildCheckResult } from "./check.js";
import { groupCompareMaps, type CompareResult } from "./compare.js";
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
  renderCheck,
  renderCompare,
  renderDoctor,
  renderExplain,
  renderScan,
  renderSync,
  renderTree,
  toBudgetJson,
  toDoctorJson,
  toExplainJson,
  toTreeJson,
} from "./output.js";
import { groupScanMaps, scanTargets } from "./scan.js";
import { buildSyncPlan, writeSyncPlan } from "./sync.js";

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
  harness-map explain <file> [--agent codex|claude] [--cwd <dir>] [--json]
  harness-map tree [--agent codex|claude] [--json]
  harness-map budget [--agent codex|claude] [--json]
  harness-map doctor [--agent codex|claude] [--json]
  harness-map scan [--agent codex|claude] [--json]
  harness-map compare [--agents codex,claude] [--json]
  harness-map check [--json]
  harness-map sync --from codex --to claude [--dry-run|--write] [--json]
`;

interface ComparisonRun {
  result: CompareResult;
  root: string;
  codexFiles: Awaited<ReturnType<typeof discoverInstructionFiles>>;
  claudeFiles: Awaited<ReturnType<typeof discoverClaudeInstructionFiles>>;
}

async function discoverComparison(env: CliEnv): Promise<ComparisonRun> {
  const config = await loadCodexConfig({ userHome: env.home, codexHome: env.codexHome });
  const codexRoot = await findProjectRoot(env.processCwd, config.rootMarkers);
  const claudeRoot = await findProjectRoot(env.processCwd);
  if (codexRoot !== claudeRoot) throw new Error("Codex and Claude project roots differ");
  const codexFiles = await discoverInstructionFiles(codexRoot, config.fallbackFilenames);
  const claudeFiles = await discoverClaudeInstructionFiles(claudeRoot, env.home);
  const items = [];
  for (const target of await scanTargets(codexRoot, [...codexFiles, ...claudeFiles])) {
    const [codex, claude] = await Promise.all([
      discoverCodex({ cwd: dirname(target.path), target: target.path, config }),
      discoverClaude({ cwd: dirname(target.path), target: target.path, userHome: env.home }),
    ]);
    items.push({ relativePath: target.relativePath, codex, claude });
  }
  return {
    result: groupCompareMaps(codexRoot, items),
    root: codexRoot,
    codexFiles,
    claudeFiles,
  };
}

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

      if (values.agent !== "codex" && values.agent !== "claude") {
        throw new Error(`Unsupported agent: ${values.agent}`);
      }
      if (positionals.length !== 1) throw new Error("explain requires exactly one file");

      const target = resolve(env.processCwd, positionals[0]);
      const cwd = values.cwd ? resolve(env.processCwd, values.cwd) : dirname(target);
      const map = values.agent === "claude"
        ? await discoverClaude({ cwd, target, userHome: env.home })
        : await discoverCodex({
            cwd,
            target,
            config: await loadCodexConfig({ userHome: env.home, codexHome: env.codexHome }),
          });
      const inspection = await inspectInstructions(map.instructions, map.projectRoot);
      io.stdout(
        values.json
          ? `${JSON.stringify(toExplainJson(map, inspection), null, 2)}\n`
          : renderExplain(map, inspection),
      );
      return 0;
    }

    if (command === "compare") {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: {
          agents: { type: "string", default: "codex,claude" },
          json: { type: "boolean", default: false },
        },
      });
      if (positionals.length) throw new Error("compare does not accept positional arguments");
      const agents = values.agents.split(",").map((agent) => agent.trim());
      if (agents.length !== 2 || new Set(agents).size !== 2 || !agents.includes("codex") || !agents.includes("claude")) {
        throw new Error("compare currently supports --agents codex,claude");
      }

      const { result } = await discoverComparison(env);
      io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : renderCompare(result));
      return 0;
    }

    if (command === "check") {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: { json: { type: "boolean", default: false } },
      });
      if (positionals.length) throw new Error("check does not accept positional arguments");
      const comparison = await discoverComparison(env);
      const [codexInspection, claudeInspection] = await Promise.all([
        inspectInstructions(comparison.codexFiles, comparison.root),
        inspectInstructions(claudeInspectionFiles(comparison.claudeFiles, comparison.root), comparison.root),
      ]);
      const result = buildCheckResult(
        comparison.result,
        [...codexInspection.warnings, ...claudeInspection.warnings],
      );
      io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : renderCheck(result));
      return result.errors.length ? 1 : 0;
    }

    if (command === "sync") {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: {
          from: { type: "string" },
          to: { type: "string" },
          "dry-run": { type: "boolean", default: false },
          write: { type: "boolean", default: false },
          json: { type: "boolean", default: false },
        },
      });
      if (positionals.length) throw new Error("sync does not accept positional arguments");
      if (values.from !== "codex" || values.to !== "claude") {
        throw new Error("sync currently supports --from codex --to claude");
      }
      if (values["dry-run"] && values.write) throw new Error("sync accepts only one of --dry-run or --write");
      const plan = await buildSyncPlan((await discoverComparison(env)).result);
      const result = values.write ? await writeSyncPlan(plan) : plan;
      io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : renderSync(result));
      return result.conflicts.length ? 1 : 0;
    }

    if (["tree", "budget", "doctor", "scan"].includes(command)) {
      const { values, positionals } = parseArgs({
        args: tokens,
        allowPositionals: true,
        options: {
          agent: { type: "string", default: "codex" },
          json: { type: "boolean", default: false },
        },
      });
      if (positionals.length) throw new Error(`${command} does not accept positional arguments`);
      if (values.agent !== "codex" && values.agent !== "claude") {
        throw new Error(`Unsupported agent: ${values.agent}`);
      }

      const config = values.agent === "codex"
        ? await loadCodexConfig({ userHome: env.home, codexHome: env.codexHome })
        : undefined;
      const root = await findProjectRoot(env.processCwd, config?.rootMarkers);
      const files = values.agent === "claude"
        ? await discoverClaudeInstructionFiles(root, env.home)
        : await discoverInstructionFiles(root, config?.fallbackFilenames);

      if (command === "scan") {
        const items = [];
        for (const target of await scanTargets(root, files)) {
          const map = values.agent === "claude"
            ? await discoverClaude({ cwd: dirname(target.path), target: target.path, userHome: env.home })
            : await discoverCodex({ cwd: dirname(target.path), target: target.path, config: config! });
          items.push({ relativePath: target.relativePath, map });
        }
        const result = groupScanMaps(values.agent, root, items);
        io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : renderScan(result));
        return 0;
      }

      const budgetBytes = config?.maxBytes ?? null;
      let terminal: string;
      let json: object;

      if (command === "tree") {
        terminal = renderTree(files);
        json = toTreeJson(files, values.agent);
      } else if (command === "budget") {
        terminal = renderBudget(files, budgetBytes);
        json = toBudgetJson(files, budgetBytes, values.agent);
      } else {
        const inspection = await inspectInstructions(
          values.agent === "claude" ? claudeInspectionFiles(files, root) : files,
          root,
        );
        const warnings: Warning[] = [
          ...inspection.warnings,
          ...(budgetBytes === null ? [] : files
            .filter((file) => file.bytes > budgetBytes)
            .map((file) => ({
              kind: "instruction-over-budget" as const,
              message: `${file.displayPath} exceeds the ${formatSize(budgetBytes)} instruction budget`,
              source: file.displayPath,
            }))),
        ];
        terminal = renderDoctor(warnings);
        json = toDoctorJson(warnings, values.agent);
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
