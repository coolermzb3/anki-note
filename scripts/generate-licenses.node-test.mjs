import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  mkdirSync(join(root, ".codex-temp"), { recursive: true });
  const dir = mkdtempSync(join(root, ".codex-temp/license-test-"));
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("package.json", JSON.stringify({ dependencies: { parent: "1.0.0" } }));
  write("LICENSE", "Project license");
  write("THIRD_PARTY_NOTICES.md", "Asset credits");
  write("licenses/third-party/font-example-LICENSE.txt", "Font permission");
  write("public/models/vocal-pitch/FCPE-LICENSE.txt", "FCPE permission");
  write("public/models/vocal-pitch/SwiftF0-LICENSE.txt", "SwiftF0 permission");
  write("node_modules/parent/package.json", JSON.stringify({ name: "parent", version: "1.0.0", license: "MIT", dependencies: { child: "1.0.0" } }));
  write("node_modules/parent/LICENSE", "Parent permission");
  write("node_modules/child/package.json", JSON.stringify({ name: "child", version: "1.0.0", license: "BSD-3-Clause" }));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(root, "scripts/generate-licenses.mjs"), join(dir, "scripts/generate-licenses.mjs"));
  return { dir, write, run: () => spawnSync(process.execPath, [join(dir, "scripts/generate-licenses.mjs")], { encoding: "utf8" }) };
}

test("publishes project, transitive, NOTICE, font and model license texts deterministically", () => {
  const { dir, write, run } = fixture();
  write("node_modules/child/LICENSE", "Child permission");
  write("node_modules/child/NOTICE", "Child attribution");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const path = join(dir, "public/legal/THIRD_PARTY_LICENSES.txt");
  const first = readFileSync(path, "utf8");
  for (const text of ["Parent permission", "Child permission", "Child attribution", "Font permission", "FCPE permission", "SwiftF0 permission", "Asset credits"]) {
    assert.ok(first.includes(text), text);
  }
  assert.equal(readFileSync(join(dir, "public/legal/AGPL-3.0.txt"), "utf8"), "Project license");
  assert.equal(run().status, 0);
  assert.equal(readFileSync(path, "utf8"), first);
});

test("fails instead of silently omitting an unlicensed transitive dependency", () => {
  const result = fixture().run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing license text for child@1\.0\.0/);
});
