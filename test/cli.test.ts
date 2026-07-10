import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.js";

test("prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(["--help"], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });

  assert.equal(code, 0);
  assert.match(stdout.join(""), /harness-map explain <file>/);
  assert.deepEqual(stderr, []);
});
