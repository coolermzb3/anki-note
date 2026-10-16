import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");
const supplemental = join(root, "licenses/third-party");
const output = join(root, "public/legal");
const manifest = JSON.parse(read(join(root, "package.json")));
const seen = new Set();
const sections = [];
const fallbacks = {
  "onnxruntime-web@1.27.0": "onnxruntime-1.27.0-LICENSE.txt",
  "onnxruntime-common@1.27.0": "onnxruntime-1.27.0-LICENSE.txt",
  "guid-typescript@1.0.9": "guid-typescript-1.0.9-NOTICE.txt",
  "fft.js@4.0.4": "fft.js-4.0.4-LICENSE.txt",
};

function collect(name, from) {
  let directory = from;
  while (!existsSync(join(directory, "node_modules", name, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot resolve license dependency: ${name}`);
    directory = parent;
  }
  const packageRoot = realpathSync(join(directory, "node_modules", name));
  if (seen.has(packageRoot)) return;
  seen.add(packageRoot);
  const pkg = JSON.parse(read(join(packageRoot, "package.json")));
  const id = `${pkg.name}@${pkg.version}`;
  const bundledVersions = { "onnxruntime-web": "1.27.0", vexflow: "5.0.0" };
  if (bundledVersions[pkg.name] && bundledVersions[pkg.name] !== pkg.version) {
    throw new Error(`Review bundled third-party notices after upgrading ${id}.`);
  }
  const files = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /licen[sc]e|notice|copying/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const texts = files.map((file) => `${file}\n\n${read(join(packageRoot, file))}`);
  if (!texts.length) {
    if (!fallbacks[id]) throw new Error(`Missing license text for ${id}; review and add a versioned fallback.`);
    texts.push(read(join(supplemental, fallbacks[id])));
  }
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  sections.push({ id, text: `${id}\nDeclared license: ${pkg.license}\nSource: ${repository || `https://www.npmjs.com/package/${pkg.name}`}\n\n${texts.join("\n\n")}` });
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) collect(dependency, packageRoot);
}

for (const name of Object.keys(manifest.dependencies).sort()) {
  // The React Vite plugin is a build tool, not browser runtime code.
  if (name !== "@vitejs/plugin-react") collect(name, root);
}

for (const file of readdirSync(supplemental).sort()) {
  if (/^font-|ThirdPartyNotices|^Salamander-/.test(file)) {
    sections.push({ id: file, text: `${file}\n\n${read(join(supplemental, file))}` });
  }
}
for (const file of ["FCPE-LICENSE.txt", "SwiftF0-LICENSE.txt"]) {
  sections.push({ id: file, text: `${file}\n\n${read(join(root, "public/models/vocal-pitch", file))}` });
}

mkdirSync(output, { recursive: true });
copyFileSync(join(root, "LICENSE"), join(output, "AGPL-3.0.txt"));
copyFileSync(join(root, "THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
writeFileSync(join(output, "THIRD_PARTY_LICENSES.txt"), [
  "ScoreTone third-party licenses",
  "Generated from installed runtime dependencies (including transitive dependencies), bundled fonts and models.",
  "This inventory may include dependencies removed by tree shaking. Third-party terms remain in effect.",
  read(join(root, "THIRD_PARTY_NOTICES.md")),
  ...sections.sort((a, b) => a.id.localeCompare(b.id, "en")).map(({ text }) => text),
].join("\n\n" + "=".repeat(80) + "\n\n"));
console.log(`Generated third-party license bundle: ${seen.size} runtime packages, fonts and models.`);
