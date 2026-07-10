import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function findNearestPackageJson(
  startDirectory: string,
  projectRoot: string,
): Promise<string | undefined> {
  let current = resolve(startDirectory);
  const root = resolve(projectRoot);

  while (true) {
    const candidate = join(current, "package.json");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue toward the project root.
    }

    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function hasPackageScript(packagePath: string, script: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(packagePath, "utf8"));
    if (!value || typeof value !== "object") return false;
    const scripts = (value as { scripts?: unknown }).scripts;
    return Boolean(scripts && typeof scripts === "object" && script in scripts);
  } catch {
    return false;
  }
}
