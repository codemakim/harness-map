import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse } from "smol-toml";

export interface CodexConfig {
  codexHome: string;
  configPath: string;
  fallbackFilenames: string[];
  maxBytes: number;
  rootMarkers: string[];
}

export interface LoadCodexConfigOptions {
  userHome: string;
  codexHome?: string;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

export async function loadCodexConfig(options: LoadCodexConfigOptions): Promise<CodexConfig> {
  const codexHome = resolve(options.codexHome ?? join(options.userHome, ".codex"));
  const configPath = join(codexHome, "config.toml");
  let text: string;

  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { codexHome, configPath, fallbackFilenames: [], maxBytes: 32768, rootMarkers: [".git"] };
    }
    throw new Error(`${configPath}: ${(error as Error).message}`);
  }

  try {
    const value = parse(text, { integersAsBigInt: true });
    const fallbackValue = value.project_doc_fallback_filenames;
    const maxValue = value.project_doc_max_bytes;
    const markerValue = value.project_root_markers;
    const fallbackFilenames = fallbackValue === undefined
      ? []
      : [...new Set(stringArray(fallbackValue, "project_doc_fallback_filenames").map((name) => name.trim()).filter(Boolean))];
    if (
      maxValue !== undefined &&
      (typeof maxValue !== "bigint" || maxValue < 0n || maxValue > BigInt(Number.MAX_SAFE_INTEGER))
    ) {
      throw new Error("project_doc_max_bytes must be a non-negative safe integer");
    }
    const rootMarkers = markerValue === undefined
      ? [".git"]
      : stringArray(markerValue, "project_root_markers");

    return {
      codexHome,
      configPath,
      fallbackFilenames,
      maxBytes: maxValue === undefined ? 32768 : Number(maxValue),
      rootMarkers,
    };
  } catch (error) {
    throw new Error(`${configPath}: ${(error as Error).message}`);
  }
}
