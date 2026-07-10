import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCodexConfig } from "../src/codex-config.js";

test("uses Codex discovery defaults when config.toml is missing", async (t) => {
  const userHome = await mkdtemp(join(tmpdir(), "harness-map-config-"));
  t.after(() => rm(userHome, { recursive: true, force: true }));

  const config = await loadCodexConfig({ userHome });

  assert.equal(config.codexHome, join(userHome, ".codex"));
  assert.equal(config.configPath, join(userHome, ".codex/config.toml"));
  assert.deepEqual(config.fallbackFilenames, []);
  assert.equal(config.maxBytes, 32768);
  assert.deepEqual(config.rootMarkers, [".git"]);
});

test("uses an explicit Codex home and parses supported fields", async (t) => {
  const userHome = await mkdtemp(join(tmpdir(), "harness-map-home-"));
  const codexHome = await mkdtemp(join(tmpdir(), "harness-map-codex-"));
  t.after(() => Promise.all([
    rm(userHome, { recursive: true, force: true }),
    rm(codexHome, { recursive: true, force: true }),
  ]));
  await writeFile(
    join(codexHome, "config.toml"),
    [
      'project_doc_fallback_filenames = ["TEAM.md", "", "TEAM.md", ".agents.md"]',
      "project_doc_max_bytes = 65536",
      'project_root_markers = [".hg", "package.json"]',
    ].join("\n"),
  );

  const config = await loadCodexConfig({ userHome, codexHome });

  assert.equal(config.codexHome, codexHome);
  assert.deepEqual(config.fallbackFilenames, ["TEAM.md", ".agents.md"]);
  assert.equal(config.maxBytes, 65536);
  assert.deepEqual(config.rootMarkers, [".hg", "package.json"]);
});

test("reports malformed TOML with its path", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "harness-map-codex-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const configPath = join(codexHome, "config.toml");
  await writeFile(configPath, "project_doc_max_bytes = [");

  await assert.rejects(
    loadCodexConfig({ userHome: codexHome, codexHome }),
    (error: Error) => error.message.includes(configPath),
  );
});

test("rejects invalid supported field types", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "harness-map-codex-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, "config.toml"), 'project_doc_max_bytes = "large"');

  await assert.rejects(
    loadCodexConfig({ userHome: codexHome, codexHome }),
    /project_doc_max_bytes must be a non-negative safe integer/,
  );
});

for (const [name, value] of [
  ["float", "1.0"],
  ["negative integer", "-1"],
  ["unsafe integer", "9007199254740992"],
] as const) {
  test(`rejects ${name} project_doc_max_bytes`, async (t) => {
    const codexHome = await mkdtemp(join(tmpdir(), "harness-map-codex-"));
    t.after(() => rm(codexHome, { recursive: true, force: true }));
    await writeFile(join(codexHome, "config.toml"), `project_doc_max_bytes = ${value}`);

    await assert.rejects(
      loadCodexConfig({ userHome: codexHome, codexHome }),
      /project_doc_max_bytes must be a non-negative safe integer/,
    );
  });
}
