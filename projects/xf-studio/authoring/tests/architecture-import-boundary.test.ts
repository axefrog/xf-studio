import { expect, setDefaultTimeout, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { sourceText } from "./fixtures/source-files";
import { COMPUTED, imports, importUses, resolveFrom } from "./fixtures/import-scan";
import { codeOnly, withoutComments, pageGlobals, PAGE_GLOBALS } from "./fixtures/code-scan";

// Whole-tree scans: the first test to read every module can pass 20 s while other suites load the machine.
setDefaultTimeout(60_000);

/** A module's text, read once per test process (tests/fixtures/source-files.ts). */
const source = (name: string) => sourceText(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
/**
 * Browser globals that DOM-free code must not read: the window and its storage, the navigator,
 * network access, `globalThis` (a way around the others) and the document. Comments and strings
 * are not stripped, so keep these words out of such modules' prose.
 */
const BROWSER_GLOBALS = /\b(?:window|localStorage|sessionStorage|navigator|globalThis)\b|(?<![.\w])fetch\s*\(|(?<!\.)\bdocument\.(?:getElementById|querySelector|createElement|body|addEventListener)/;

// The rules run over a source tree: the files on disk, or the same files with probes appended, so each rule is also shown to fail
// on the violations a review injected (CORE-77, CORE-78).
type Tree = { readonly names: readonly string[]; text(name: string): string };
const walk = (dir: string): string[] => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(new URL(`../src/${dir}/`, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [`${dir}/${entry.name.slice(0, -3)}`] : []);
};
/** Every src module, as a src-relative name without its extension (`platform/api/index`, `app/studio-application`). */
const every = () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const top = readdirSync(new URL("../src/", import.meta.url), { withFileTypes: true });
  return top.flatMap(entry => entry.isDirectory() ? walk(entry.name)
    : entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [entry.name.slice(0, -3)] : []);
};
const DISK: Tree = { names: every(), text: source };
/** The tree on disk with `probes` appended to the named modules. */
const probed = (probes: Readonly<Record<string, string>>): Tree =>
  ({ names: DISK.names, text: name => probes[name] === undefined ? DISK.text(name) : `${DISK.text(name)}\n${probes[name]}` });
/** A module's imports as src-relative module names (`platform/api`, `app/studio-application`), or bare package names. */
const resolvedIn = (tree: Tree, name: string) => imports(tree.text(name)).map(path => resolveFrom(name, path));
const resolved = (name: string) => resolvedIn(DISK, name);
test("slice 8 removes runtime makeup projections and forbids new shell callers", () => {
  const reads = (text: string, member: string) => {
    const code = codeOnly(text);
    return new RegExp(`\\.\\s*${member}\\b`).test(code) ||
      new RegExp(`\\[\\s*(["'])${member}\\1\\s*\\]`).test(withoutComments(text)) ||
      new RegExp(`\\{[^{}]*\\b${member}\\b[^{}]*\\}\\s*(?:=|:)`).test(code);
  };
  const callers = (tree: Tree, member: string) => tree.names.filter(name => name.startsWith("studio-ui/") && name !== "studio-ui/runtime" &&
    reads(tree.text(name), member)).sort();
  expect(codeOnly(DISK.text("studio-ui/runtime"))).not.toMatch(/\b(?:eyeMakeup|EyeMakeupFacade)\b|\bget\s+(?:editor|finishes)\b/);
  expect(callers(DISK, "editor")).toEqual([]);
  expect(callers(DISK, "finishes")).toEqual([]);
  expect(callers(probed({ "studio-ui/target-menus": "const alias = rt; alias.editor.recipe();" }), "editor"))
    .toContain("studio-ui/target-menus");
  for (const code of ['const { editor: alias } = rt;', 'const alias = rt["finishes"];'])
    expect(callers(probed({ "studio-ui/target-menus": code }), code.includes("finishes") ? "finishes" : "editor"))
      .toContain("studio-ui/target-menus");
  for (const name of ["studio-ui/runtime", "studio-ui/target-menus", "studio-ui/input-hints"])
    expect(codeOnly(DISK.text(name))).not.toMatch(/\.\s*(?:recipe|layer|selectedField|revision)\s*\(/);
  expect(resolved("app/studio-context-targets").some(path => path.startsWith("engines/"))).toBe(false);
});

test("the makeup construction bundle is removed (CORE-03 slice 6)", () => {
  expect(DISK.names).not.toContain("app/authoring/makeup-editing");
  expect(DISK.names.filter(name => resolved(name).includes("app/authoring/makeup-editing"))).toEqual([]);
});

test("registered makeup application publication is composed once, with no ID routing in the application (CORE-03)", () => {
  expect(DISK.names.filter(name => resolved(name).includes("app/authoring/makeup-application")).sort())
    .toEqual(["compose/studio-registry"]);
  expect(DISK.text("app/studio-application")).not.toContain('owner("eye-makeup")');
  expect(DISK.text("app/studio-application")).not.toContain('"eye-makeup": {');
  expect(DISK.text("app/studio-presentation")).not.toMatch(/info\.id\s*!?==\s*"eye-makeup"/);
});
/** A module's imports with whether each is type-only, as src-relative module names. */
const usesIn = (tree: Tree, name: string) => importUses(tree.text(name)).map(use => ({ path: resolveFrom(name, use.specifier), typeOnly: use.typeOnly }));
/** A resolved import as the module it names (`x` or `x/index`), when it names one in the tree. */
const moduleIn = (tree: Tree, path: string) => tree.names.includes(path) ? path : tree.names.includes(`${path}/index`) ? `${path}/index` : path;
/**
 * Every src module and bare package a module reaches through its imports, itself excluded: type-only imports
 * included, or with `values` only the imports that load code at run time.
 */
function reachIn(tree: Tree, start: string, values = false): Set<string> {
  const modules = new Set(tree.names), seen = new Set<string>(), queue = [start];
  while (queue.length) {
    const from = queue.pop()!;
    const paths = values ? importUses(tree.text(from)).filter(use => !use.typeOnly).map(use => resolveFrom(from, use.specifier))
      : resolvedIn(tree, from);
    for (const path of paths) {
      const name = moduleIn(tree, path);
      if (seen.has(name)) continue;
      seen.add(name);
      if (modules.has(name)) queue.push(name);
    }
  }
  return seen;
}
const reach = (start: string) => new Set([...reachIn(DISK, start)].filter(name => DISK.names.includes(name)));
/** A module's value imports of a bare package (the imports that load it at run time), for the type-only rules. */
const valueImportsOf = (tree: Tree, name: string, specifier: RegExp) =>
  importUses(tree.text(name)).filter(use => !use.typeOnly && specifier.test(use.specifier)).map(use => use.specifier);

test("the import scan sees static, bare, dynamic, inline type and require imports (CORE-43, UI-74)", () => {
  expect(imports([`import { a } from "./a";`, `export { b } from './b';`, `import "./c";`, `const d = await import("./d");`,
    `type E = import("./e").E;`, `let f: typeof import('node:fs');`, `import type { G } from "./g";`,
    `const h = require("./h");`, `const i = import.meta.require("./i");`].join("\n")))
    .toEqual(["./a", "./b", "./c", "./d", "./e", "node:fs", "./g", "./h", "./i"]);
  expect(imports(`const later = importer("./x"); reimport ("./y"); prerequire("./z"); x.import("./w"); import();`)).toEqual([]);
});

test("the import scan sees template-literal specifiers and records computed imports, which no module has (CORE-87)", () => {
  expect(imports(["const a = await import(`./a`);", "const b = require(`./b`);", "const c = import.meta.require(`./c`);",
    "type D = import(`./d`).D;"].join("\n"))).toEqual(["./a", "./b", "./c", "./d"]);
  // An argument that is not one literal loads something no scan can name.
  for (const text of ["await import(name)", "require(dir + \"/x\")", "import(`./x/${n}`)", "import(/* chunk */ \"./d\")", "require (\n  load())",
    "import(\"./a\" + suffix)"]) expect(imports(text), text).toEqual([COMPUTED]);
  expect(importUses("const m = await import(name);")).toEqual([{ specifier: COMPUTED, typeOnly: false, names: ["<computed>"] }]);
  expect(importUses("const t = import(`./t`);")).toEqual([{ specifier: "./t", typeOnly: false, names: ["<dynamic>"] }]);
  // No source module loads code the boundary scans cannot see.
  expect(every().filter(name => imports(source(name)).includes(COMPUTED))).toEqual([]);
});

test("the import scan resolves .js and .mjs specifiers and sees modules loaded by URL, such as workers (CORE-90)", () => {
  expect(imports([`import { a } from "./a.js";`, `export * from "../b.mjs";`, `const w = new Worker(new URL("./w.ts", import.meta.url), { type: "module" });`,
    `const s = new SharedWorker(new URL(` + "`./s.js`" + `, import.meta.url));`, `const t = new Worker("./t.ts");`,
    `const served = new Worker("/build/raster-worker.js", { type: "module" });`, `const page = new URL("/x", location.href);`].join("\n")))
    .toEqual(["./a.js", "../b.mjs", "./w.ts", "./s.js", "./t.ts"]);
  expect(["./a.js", "./a.mjs", "./a.ts", "./a", "../x/b.js", "three/addons/loaders/GLTFLoader.js"].map(path => resolveFrom("features/eye-makeup/core", path)))
    .toEqual(["features/eye-makeup/a", "features/eye-makeup/a", "features/eye-makeup/a", "features/eye-makeup/a", "features/x/b", "three/addons/loaders/GLTFLoader.js"]);
  expect(importUses(`const w = new Worker(new URL("./w.ts", import.meta.url));`)).toEqual([{ specifier: "./w.ts", typeOnly: false, names: ["<url>"] }]);
  // The one worker the source loads by URL is seen now.
  expect(resolved("native/native-decode")).toContain("native/native-decode-worker");
});

test("the feature rules fail on a .js specifier and on a worker loaded by URL, directly and transitively (CORE-90)", () => {
  const js = featureViolations(probed({ "features/eye-makeup/core": `import { createRasterClient as __probe } from "../../legacy/eye-makeup/browser/raster-client.js";` }));
  expect(js).toContain("features/eye-makeup/core -> legacy/eye-makeup/browser/raster-client");
  const worker = featureViolations(probed({ "features/eye-makeup/core":
    `export const __probe = () => new Worker(new URL("../../legacy/eye-makeup/browser/raster-worker.ts", import.meta.url));` }));
  expect(worker).toContain("features/eye-makeup/core -> legacy/eye-makeup/browser/raster-worker");
  // Behind a helper the core imports by its .js name, a worker that is a browser device: the transitive rule follows both.
  const behind = featureViolations(probed({ "features/eye-makeup/limits": `export const __probe = () => new Worker(new URL("../../app/browser/browser-file-device.mjs", import.meta.url));`,
    "features/eye-makeup/core": `import { __probe as __limits } from "./limits.js";` }));
  expect(behind).toContain("features/eye-makeup/limits -> app/browser/browser-file-device");
  expect(behind).toContain("features/eye-makeup/core ->* app/browser/browser-file-device");
  const view = featureViolations(probed({ "features/eye-makeup/view/layers": `import { LookHistory as __Probe } from "../../../platform/core/look-history.js";` }));
  expect(view).toContain("features/eye-makeup/view/layers -> platform/core/look-history");
  expect(view).toContain("features/eye-makeup/view/layers ->* platform/core/look-history");
  expect(featureViolations(DISK)).toEqual([]);
});

test("pure-code scans read code only and see every page or host global (CORE-78)", () => {
  // Comments, strings, templates and regular expressions are blanked; the line structure stays.
  const code = codeOnly([`const a = "window.x"; // window.y`,
    "const b = /window\\./g, c = `document.${x}`; /* self.z */ const d = 1 / 2 / 3;"].join("\n"));
  expect(code).not.toMatch(PAGE_GLOBALS);
  expect(code.split("\n")).toHaveLength(2);
  expect(code).toContain("const d = 1 / 2 / 3;");
  // Every way the reviewer's probe read a global (CORE-78), and the others the rule names.
  for (const text of ["const w = window;", "window.devicePixelRatio", "(window as any).innerWidth", "self.indexedDB",
    "document.cookie", "Bun.env.X", "process.env.Y", "globalThis.x", "navigator.language", "localStorage.getItem('k')",
    "await fetch('/x')", "const { window } = scope;", "typeof window"]) expect(pageGlobals(text), text).not.toEqual([]);
  // A UV window is data: a property, a member or parameter annotation, or a string.
  for (const text of ["t.window.u0", "type T = { window: UvWindow; w?: number }", "function f(window?: UvWindow) {}",
    `const k = { kind: "window" };`, "const uvWindow = 1, windowed = 2;", "this.fetcher.fetch(x)", "request.document.body", "options.self.x"])
    expect(pageGlobals(text), text).toEqual([]);
});

test("the browser-globals check catches every global it names (CORE-37)", () => {
  for (const code of ["window.x", "localStorage.getItem('k')", "sessionStorage.setItem('k', 'v')", "navigator.userAgent",
    "globalThis.localStorage", "await fetch('/api')", "document.body"]) expect(code).toMatch(BROWSER_GLOBALS);
  for (const code of ["this.fetcher.fetch(x)", "request.document.body", "prefetch(x)", "const windowed = 1"])
    expect(code).not.toMatch(BROWSER_GLOBALS);
});

// ---------- Layers by folder (docs/source-layout-plan.md) ----------
// A subsystem's pure and application code sits at its root; three kinds of folder hold what is not portable: `host/` (Bun-only:
// files, processes, the OS, SQLite, endpoints), `browser/` (page devices: DOM, fetch, workers) and `render/` (Three renderer modules).

/** Host folders: any `host/`, the platform's export host and persistence, a feature's exporter and verifier, the native reader, the host composition. */
const isHost = (name: string) => /(?:^|\/)host\/|^platform\/(?:export|persistence)\/|^features\/[\w-]+\/(?:export|verify)\/|^native\//.test(name) ||
  name === "compose/exporters";
const isDevice = (name: string) => /(?:^|\/)browser\//.test(name);
const isRenderModule = (name: string) => /(?:^|\/)render\//.test(name);
const isPresentation = (name: string) => /^studio-ui\/|^features\/[\w-]+\/view\//.test(name);
const isStudy = (name: string) => name.startsWith("studies/");
/** Pure and application code: everything outside the kind folders, the presentation, the composition, the scene host and the studies. */
const isPure = (name: string) => !isHost(name) && !isDevice(name) && !isRenderModule(name) && !isPresentation(name) && !isStudy(name) &&
  !name.startsWith("compose/") && !name.startsWith("platform/scene/");
/** Imports that reach files, processes, the OS or Bun's own APIs. */
const HOST_SPECIFIER = /^(?:node:(?:fs|fs\/promises|child_process|os|async_hooks|url|worker_threads|net|http|https)|bun:[\w-]+|bun)$/;
/** Host APIs a module calls or reads without importing them. Run it on `codeOnly` text. */
const HOST_CALLS = /\bBun\s*\.\s*(?:spawn|spawnSync|file|write|serve|env)\b|\bprocess\s*\.\s*env\b/;
/** The page's entry points: the localhost root, the composition root, the workers and the study page. */
const BROWSER_ENTRIES = ["compose/studio-main", "compose/studio-startup", "legacy/eye-makeup/browser/raster-worker",
  "character/browser/choice-preview-worker", "studies/render-fidelity-study"];

/** Rules 1 to 7 and 10 of the source layout plan, each violation tagged with its rule. */
function layerViolations(tree: Tree): string[] {
  const out: string[] = [];
  for (const name of tree.names) {
    const uses = usesIn(tree, name).map(use => ({ ...use, path: moduleIn(tree, use.path) }));
    const host = isHost(name), device = isDevice(name), renderer = isRenderModule(name), pure = isPure(name);
    // 1. Host access only in host folders.
    if (!host) {
      for (const use of uses) if (HOST_SPECIFIER.test(use.path)) out.push(`R1 ${name} -> ${use.path}`);
      for (const call of codeOnly(tree.text(name)).match(new RegExp(HOST_CALLS.source, "g")) ?? []) out.push(`R1 ${name} calls ${call.replace(/\s+/g, "")}`);
    }
    for (const use of uses) {
      const tag = `${name} -> ${use.path}${use.typeOnly ? " (type)" : ""}`;
      // 2. Pure and browser code never imports host code, not even a type.
      if (!host && isHost(use.path)) out.push(`R2 ${tag}`);
      // 4. Three only where rendering is (pure code may name it by type).
      if (/^three(?:\/|$)/.test(use.path) && !use.typeOnly && !(renderer || device || isStudy(name) || name.startsWith("platform/scene/"))) out.push(`R4 ${tag}`);
      // 5. Devices are wired by the roots and other devices.
      if (isDevice(use.path) && !(device || name.startsWith("compose/") || isStudy(name))) out.push(`R5 ${tag}`);
      // 6. Renderer modules are for renderers, devices, the scene host and the studies.
      if (isRenderModule(use.path) && !/^(?:engines|features)\//.test(use.path) &&
        !(renderer || device || isStudy(name) || name.startsWith("platform/scene/") || name.startsWith("compose/"))) out.push(`R6 ${tag}`);
      // 7. Pure modules load no scene host, composition or presentation.
      if (pure && (use.path.startsWith("platform/scene/") || use.path.startsWith("compose/") || isPresentation(use.path))) out.push(`R7 ${tag}`);
      // 10. Studies are leaves.
      if (isStudy(use.path) && !isStudy(name)) out.push(`R10 ${tag}`);
    }
  }
  // 3. The page never loads host code.
  for (const entry of BROWSER_ENTRIES) for (const path of reachIn(tree, entry, true))
    if (isHost(path) || /^(?:node|bun):|^bun$/.test(path)) out.push(`R3 ${entry} ->* ${path}`);
  return out;
}

test("the layers hold by folder: host code stays in host folders, devices and renderers where they are wired (rules 1 to 7, 10)", () => {
  // The kinds name real folders.
  for (const name of ["host/wolvenkit-cli", "library/host/library-store", "preview/browser/browser-viewport-device",
    "materials/render/skin-material", "app/studio-application"]) expect(DISK.names, name).toContain(name);
  expect(isHost("host/wolvenkit-cli") && isHost("platform/persistence/document-store") && isHost("features/save-explorer/host/saves-server")).toBe(true);
  expect(isPure("app/studio-application") && isPure("character/cc-catalogue") && isPure("engines/layered-makeup/recipe")).toBe(true);
  expect(isPure("character/host/cc-catalogue-host") || isPure("preview/render/linear-display") || isPure("compose/studio-startup")).toBe(false);
  expect(layerViolations(DISK)).toEqual([]);
});

test("the layer rules fail on what they name", () => {
  const probes = layerViolations(probed({
    "app/ui-preferences": `import { readFileSync as __probe } from "node:fs";\nconst __env = process.env.X;`,
    "library/collection-service": `import type { LibraryStore as __Probe } from "./host/library-store";`,
    "app/studio-application": `import { VortexHost as __probe } from "../installation/host/vortex-host";`,
    "character/cc-catalogue": `import * as __THREE from "three";`,
    "app/studio-presentation": `import { attachViewportDevice as __probe } from "../preview/browser/browser-viewport-device";`,
    "animation/motion-actions": `import type { PoseClip as __Probe } from "./render/pose-clip";\nimport { h as __h } from "../studio-ui/dom";`,
    "app/project-links": `import { measureBrow as __probe } from "../studies/brow-study-metrics";`,
  }));
  for (const violation of ["R1 app/ui-preferences -> node:fs", "R1 app/ui-preferences calls process.env",
    "R2 library/collection-service -> library/host/library-store (type)", "R2 app/studio-application -> installation/host/vortex-host",
    "R3 compose/studio-startup ->* installation/host/vortex-host", "R4 character/cc-catalogue -> three",
    "R5 app/studio-presentation -> preview/browser/browser-viewport-device", "R6 animation/motion-actions -> animation/render/pose-clip (type)",
    "R7 animation/motion-actions -> studio-ui/dom", "R10 app/project-links -> studies/brow-study-metrics"]) expect(probes).toContain(violation);
});

test("trusted application and presentation services read no browser globals", () => {
  const trusted = ["app/studio-application", "app/studio-presentation", "app/trusted-authoring-core", "app/trusted-studio-bootstrap",
    "app/trusted-preview-services", "library/collection-application", "app/studio-file-operations", "legacy/eye-makeup/preview/authoring-preview-coordinator",
    "legacy/eye-makeup/glitter-measurements", "engines/layered-makeup/makeup-dependencies"];
  // The import side is the layer rules' (rule 7 covers every pure module); these modules are also pure.
  for (const name of trusted) {
    expect(isPure(name), name).toBe(true);
    expect(source(name), `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
  }
});

test("install detection reaches the host only through a typed transport", () => {
  // The action layer imports no package or built-in, and the browser device only the actions.
  expect(imports(source("installation/install-detection-actions")).filter(path => !path.startsWith("."))).toEqual([]);
  expect(resolved("installation/browser/browser-install-detection-device")).toEqual(["installation/install-detection-actions"]);
});

test("the package builder keeps resource definitions pure and external processes in its adapters", () => {
  // Pure definitions: no file, process or compiler access.
  expect(resolved("legacy/eye-makeup/export/package-resources")).toEqual(["node:crypto", "legacy/eye-makeup/export/preset-collection",
    "engines/layered-makeup/plate-uv-window", "platform/api"]);
  // The plate-local UV window is pure arithmetic over WolvenKit JSON.
  expect(imports(source("engines/layered-makeup/plate-uv-window"))).toEqual([]);
  // Orchestration reaches WolvenKit only through the PackageResourceTools port.
  for (const name of ["legacy/eye-makeup/export/host/package-resource-builder", "platform/export/product-builder", "features/eye-makeup/export/index",
    "legacy/eye-makeup/export/host/package-bake"])
    for (const dependency of resolved(name)) expect(dependency, `${name} imports ${dependency}`).not.toMatch(/^(node:child_process|host\/process-tree)$/);
  // Every WolvenKit command runs through the one shared runner, which alone starts the process.
  for (const name of ["legacy/eye-makeup/export/host/package-build-wolvenkit", "legacy/eye-makeup/plate/host/eye-plate-wolvenkit",
    "game/host/game-asset-export-wolvenkit", "legacy/eye-makeup/export/host/verifier-wolvenkit"]) {
    expect(resolved(name)).toContain("host/wolvenkit-cli");
    expect(resolved(name)).not.toContain("host/process-tree");
  }
  expect(resolved("host/wolvenkit-cli")).toContain("host/process-tree");
  // The resolver fetcher and the grading-LUT host too (PREV-29, PREV-30): no process of their own.
  for (const name of ["game/host/resolver-host", "preview/host/grading-lut-host"]) {
    expect(resolved(name)).toContain("host/wolvenkit-cli");
    expect(resolved(name)).not.toContain("host/process-tree");
    expect(resolved(name)).not.toContain("node:child_process");
    expect(source(name), `${name} starts a process`).not.toMatch(/\bBun\.spawn/);
  }
});

test("the 3D preview derivation reaches WolvenKit only through its one adapter", () => {
  // The service reaches WolvenKit only through the generic export port.
  for (const dependency of resolved("preview/host/preview-core-service"))
    expect(dependency, `preview-core-service imports ${dependency}`).not.toMatch(/^(node:child_process|host\/process-tree|game\/host\/game-asset-export-wolvenkit)$/);
  expect(resolved("game/host/game-asset-export-wolvenkit")).toContain("host/wolvenkit-cli");
  // The renderer loads the core head only through the typed record loader.
  expect(source("platform/scene/scene-host")).not.toContain('fetch("/assets/head.glb")');
  expect(resolved("platform/scene/scene-host")).toContain("character/render/core-detail-loader");
});

test("WolvenKit setup keeps its policy in the service and the network, archive and process work in adapters", () => {
  // The renderer side and the pinned release are pure; the service reaches IO only through its adapters.
  for (const name of ["setup/wolvenkit-setup", "setup/wolvenkit-release"])
    for (const dependency of imports(source(name))) expect(dependency, `${name} imports ${dependency}`).not.toMatch(/^node:/);
  const service = resolved("setup/host/wolvenkit-setup-host");
  for (const adapter of ["setup/host/tool-download", "setup/host/zip-extract", "setup/host/dotnet-runtime", "host/wolvenkit-cli"]) expect(service).toContain(adapter);
  for (const dependency of service) expect(dependency).not.toMatch(/^(node:child_process|host\/process-tree)$/);
  expect(source("setup/host/wolvenkit-setup-host")).not.toMatch(/\bfetch\(/);
});

test("the eye plate reaches the launch route only through its head-source port", () => {
  // The application service owns the policy; discovery, indexes and WolvenKit stay in adapters.
  for (const dependency of resolved("legacy/eye-makeup/plate/host/eye-plate-service"))
    expect(dependency, `eye-plate-service imports ${dependency}`).not.toMatch(
      /^(node:child_process|game\/host\/(?:resolver-host|source-discovery)|host\/process-tree|legacy\/eye-makeup\/plate\/host\/(?:eye-plate-wolvenkit|eye-plate-head-resolver))$/);
  expect(resolved("legacy/eye-makeup/plate/host/eye-plate-head-resolver")).toContain("game/host/resolver-host");
});

// Dependencies point inward. Presentation modules (the `studio-ui/` tree and each feature's `view/`) and the composition may import
// the core, never the reverse.
test("core modules never import presentation modules or the composition", () => {
  const core = DISK.names.filter(name => !isPresentation(name) && !name.startsWith("compose/"));
  expect(core).toContain("legacy/eye-makeup/recipe-schema");
  expect(core).toContain("app/studio-application");
  const violations = core.flatMap(name => resolved(name).filter(path => isPresentation(path) || path.startsWith("compose/"))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

/**
 * The platform rule (§7 rule 5): platform code outside the scene host imports only the platform, and the scene port names Three by
 * type only (CORE-88); the api index never re-exports the port, so a feature's core never sees Three.
 */
function platformViolations(tree: Tree): string[] {
  const pure = tree.names.filter(name => name.startsWith("platform/") && !name.startsWith("platform/scene/"));
  // The export host (platform/export, host only) alone uses Node; the api and core never import it (§7 rule 6).
  const host = (name: string) => name.startsWith("platform/export/");
  // Host persistence (platform/persistence: the library files' durability, backups and the document store) alone uses Bun's
  // SQLite and Node's files, and no other platform module imports it: the page reaches stored documents through the api's port.
  const persistence = (name: string) => name.startsWith("platform/persistence/");
  return pure.flatMap(name => [
    ...resolvedIn(tree, name).filter(path => !path.startsWith("platform/") || path.startsWith("platform/scene/") ||
      !host(name) && host(path) || !persistence(name) && persistence(path))
      .filter(path => !(host(name) && /^node:(?:crypto|fs|path)$/.test(path)))
      .filter(path => !(persistence(name) && /^(?:bun:sqlite|node:(?:fs|path))$/.test(path)))
      .filter(path => !(name === "platform/api/scene" && path === "three")).map(path => `${name} -> ${path}`),
    ...valueImportsOf(tree, name, /^three(?:\/|$)/).map(path => `${name} -> ${path} (value)`),
    ...(name === "platform/api/index" && /["']\.\/scene["']/.test(tree.text(name)) ? [`${name} re-exports platform/api/scene`] : []),
  ]);
}

test("only host persistence uses SQLite and files, and no other platform module imports it", () => {
  expect(walk("platform")).toContain("platform/persistence/document-store");
  const probes: Record<string, string>[] = [
    { "platform/core/experiments": `import { Database } from "bun:sqlite";` },
    { "platform/core/registry": `import { DocumentStore } from "../persistence/document-store";` },
    { "platform/persistence/document-store": `import { x } from "../../features/eye-makeup";` },
  ];
  for (const probe of probes) expect(platformViolations(probed(probe)).length, JSON.stringify(probe)).toBeGreaterThan(0);
});

test("no feature, composition or presentation module imports host persistence (the page uses the document store's port)", () => {
  const page = (name: string) => /^(?:features|compose|studio-ui)\//.test(name);
  const importers = (tree: Tree) => tree.names.filter(page).filter(name => resolvedIn(tree, name).some(path => path.startsWith("platform/persistence/")));
  expect(importers(DISK)).toEqual([]);
  expect(importers(probed({ "features/eye-makeup/index": `import { DocumentStore } from "../../platform/persistence/document-store";` })))
    .toEqual(["features/eye-makeup/index"]);
});

test("platform code imports only the platform: nothing from features, engines, compose or the rest of src", () => {
  const platform = walk("platform");
  expect(platform).toContain("platform/api/index");
  expect(platform).toContain("platform/core/registry");
  expect(platform).toContain("platform/scene/feature-renderers");
  expect(platformViolations(DISK)).toEqual([]);
  expect(source("platform/api/scene")).toMatch(/import type \* as THREE from "three"/);
  for (const name of platform.filter(name => !name.startsWith("platform/scene/"))) {
    // The shared pure dock model has persisted `window` fields and locally bound variables of that name.
    // The lexical scan rejects actual global access while distinguishing those data keys and locals.
    if (name === "platform/core/dock-layout") expect(pageGlobals(source(name)), name).toEqual([]);
    else expect(source(name), `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
  }
});

/** The subsystems whose root (pure) and `render/` modules the scene host builds on: materials, the character, motion, the preview and saves. */
const SCENE_SIDE = /^(?:materials|character|animation|preview|saves)\/(?:render\/)?[\w-]+$/;
/** What the scene host imports directly: the platform's port and its own folder, Three, and the scene side's root and render modules. */
const sceneAllowed = (path: string) => path.startsWith("platform/api/") || path.startsWith("platform/scene/") || path === "three" ||
  path.startsWith("three/addons/") || SCENE_SIDE.test(path);
/** What it may reach through them, types included: those, the game's and the formats' pure readers, and the input binding catalogue. */
const sceneMayReach = (path: string) => sceneAllowed(path) || /^(?:game|formats)\/[\w-]+$/.test(path) || path === "app/input-bindings";
/** What nothing the scene host reaches may be: a feature, an engine, the composition, the UI, the platform's internals, host code, a device, a service. */
const SCENE_UNREACHABLE = /^(?:features\/|engines\/|compose\/|studio-ui\/|platform\/(?:core|export|persistence)\/|node:|bun)|(?:^|\/)(?:host|browser)\/|(?:^|\/)[\w-]+-(?:actions|service|host|server)$/;

/**
 * The scene host rule (§7, step 7; CORE-86), by folder: it imports the platform's port, Three and the scene side's root and render modules,
 * and everything it reaches through them, types included, is one of those, a game or format reader or the input bindings; never a
 * feature, engine, compose, the UI, host code, a device or an application service, even by type.
 */
function sceneViolations(tree: Tree): string[] {
  return tree.names.filter(name => name.startsWith("platform/scene/")).flatMap(name => [
    ...resolvedIn(tree, name).filter(path => !sceneAllowed(path)).map(path => `${name} -> ${path}`),
    ...[...reachIn(tree, name)].filter(path => !sceneMayReach(path) || SCENE_UNREACHABLE.test(path)).map(path => `${name} ->* ${path}`),
  ]);
}

test("the scene host imports the platform, Three and the scene side only; never a feature, engine, compose, the UI, host code or a device", () => {
  expect(sceneViolations(DISK)).toEqual([]);
  // The scene side is real: the host builds on modules of every subsystem the rule names.
  const direct = new Set(walk("platform/scene").flatMap(name => resolved(name)).filter(path => SCENE_SIDE.test(path)).map(path => path.split("/")[0]));
  expect([...direct].sort()).toEqual(["animation", "character", "materials", "preview", "saves"]);
});

/** The scene's shared materials an engine renderer may build on: the material adapters and the display path they draw into. */
const isSceneMaterial = (path: string) => path.startsWith("materials/render/") || path === "preview/render/linear-display";
/** Pure modules those materials read, outside the materials and the game's readers: render records, grading and the creator's light. */
const SCENE_MATERIAL_SUPPORT = new Set(["character/render-detail", "preview/grading-lut", "preview/creator-lighting"]);
/** What a renderer (an engine's or a feature's `render/`) may reach beyond its feature's core: the port, engines, Three and the scene's materials. */
const rendererMayReach = (path: string) => path.startsWith("platform/api/") || path.startsWith("engines/") || path === "three" ||
  path.startsWith("three/addons/") || path.startsWith("materials/") || isSceneMaterial(path) || /^game\/[\w-]+$/.test(path) ||
  SCENE_MATERIAL_SUPPORT.has(path);
const isRenderer = (name: string) => /^(?:engines|features)\/[\w-]+\/render\//.test(name);
const isView = (name: string) => /^features\/[\w-]+\/view\//.test(name);
/** A feature's host-only folders: its exporter and its independent verifier (feature-module platform §6, §7 rules 2, 3). */
const isExporter = (name: string) => /^features\/[\w-]+\/export\//.test(name);
const isVerifier = (name: string) => /^features\/[\w-]+\/verify\//.test(name);
/** A feature's host endpoints (`features/<id>/host/`: read-only routes both hosts mount, e.g. the Save Explorer's saves listing). */
const isHostFolder = (name: string) => /^features\/[\w-]+\/host\//.test(name);
/**
 * Legacy modules a feature's exporter may still import: the eye-makeup package pipeline it wraps, each with the
 * condition that removes it (the list only shrinks; a test fails when an entry is no longer imported). They move into
 * features/eye-makeup/export once nothing outside the composition reaches them (the CORE-29 rule).
 */
const EXPORTER_LEGACY = new Map([
  ["legacy/eye-makeup/recipe-schema", "eye makeup's recipe-file lineage: moves into the feature once the library store and file operations read its part through the codec"],
  ["legacy/eye-makeup/export/package-filter", "the partial-export filter: moves once the collection service stops describing results with it"],
  ["legacy/eye-makeup/export/package-resources", "resource definitions: move with the resource builder"],
  ["legacy/eye-makeup/export/host/package-resource-builder", "the resource builder: moves once the plate prerequisite no longer reads its plate stems"],
  ["legacy/eye-makeup/export/host/package-build-wolvenkit", "the builder's WolvenKit adapter: moves with the resource builder (the CLI composes it)"],
  ["legacy/eye-makeup/export/package-action", "the preset identity and plate record types: move once the collection panel reads them through the facade"],
  ["legacy/eye-makeup/export/preset-collection", "the collection view and plan: move once the collection service and store stop reading them"],
  ["legacy/eye-makeup/export/archive-inventory", "the pre-pack path gate: moves with the resource builder"],
  ["legacy/eye-makeup/plate/host/eye-plate-service", "the plate cache manifest and record: moves with the plate prerequisite (host-side eye-plate modules, step 9)"],
  ["legacy/eye-makeup/export/host/plate-uv-footprint-io", "the plate footprint file reader: moves with the plate prerequisite"],
  ["legacy/eye-makeup/export/plate-reach", "the plate reach record type: moves with the partial-export filter"],
]);
/** Platform internals no feature reaches, even through other modules: only `platform/api` is a feature's. */
// The dock's pure data engine is shared with session operations and re-exported by studio-ui/dock/layout (P3-i).
// Direct feature imports of platform/core are still refused by the rule below.
const PLATFORM_INTERNALS = /^platform\/(?!core\/dock-layout$)(?:core|scene|export)(?:\/|$)/;

/**
 * The engine rules (§1 layout, CORE-78): an engine imports only engines and `platform/api`; only an engine's `render/` imports Three
 * and the scene's shared materials; no other engine module reaches a renderer or Three, even through other modules; and the pure
 * engine reads no page or host global.
 */
function engineViolations(tree: Tree): string[] {
  return tree.names.filter(name => name.startsWith("engines/")).flatMap(name => {
    const render = isRenderer(name);
    const direct = resolvedIn(tree, name).filter(path => !(path.startsWith("engines/") || path.startsWith("platform/api") ||
      render && (path === "three" || isSceneMaterial(path)))).map(path => `${name} -> ${path}`);
    // A renderer reaches only engines, the port, Three and the scene's materials, types included (CORE-86).
    if (render) return [...direct, ...[...reachIn(tree, name)].filter(path => !rendererMayReach(path)).map(path => `${name} ->* ${path}`)];
    const reached = [...reachIn(tree, name)].filter(path => isRenderer(path) || /^three(?:\/|$)/.test(path)).map(path => `${name} ->* ${path}`);
    return [...direct, ...reached, ...pageGlobals(tree.text(name)).map(global => `${name} reads ${global}`)];
  });
}

/**
 * Legacy modules a feature's core may still import, each with the step that removes it (the list only shrinks;
 * a test fails when an entry is no longer imported). Everything else a feature core imports is the platform API, an
 * engine (not its renderer) or its own folder.
 */
const FEATURE_CORE_LEGACY = new Map([
  ["legacy/eye-makeup/recipe-schema", "eye makeup's recipe-file lineage and model registry: moves into features/eye-makeup with the exporter " +
    "(step 8), once the library store, file operations and package pipeline read eye makeup's part through its codec"],
  ["legacy/eye-makeup/history-labels", "eye makeup's Undo labels: move into features/eye-makeup once the authoring document labels steps through " +
    "the registered specs (step 9)"],
  ["legacy/eye-makeup/eye-makeup-model", "eye makeup's action and state types: move into features/eye-makeup once StudioApplication and the " +
    "presentation port take them from the registry (step 9)"],
  ["legacy/eye-makeup/mod-branding", "XF Eye Artistry's names (its export info's brand and selector label): move into features/eye-makeup once install " +
    "detection, the framework check and the collection panel read them through the export info (step 9)"],
  ["legacy/eye-makeup/eye-makeup-descriptors", "eye makeup's descriptors: move into features/eye-makeup once the application and presentation " +
    "read descriptors only from the registry (step 9)"],
]);
/** What a feature's core must never reach, directly or through other modules: devices, renderers, host code, presentation, composition, Node, Three. */
const CORE_UNREACHABLE = /^(?:three(?:\/|$)|node:|bun:|studio-ui\/|compose\/|features\/[\w-]+\/(?:view|export|verify)\/)|(?:^|\/)(?:browser|render|host)\//;

/**
 * The feature rules (§7 rules 1, 2 and 4, CORE-77): a feature imports no other feature, no platform internals, no
 * composition and no device; its core imports only its allowlist, never its view, and reaches no platform
 * internals, device, Node or Three even through other modules, and reads no page or host global; its view's code
 * (value imports) reaches no platform internals either.
 */
function featureViolations(tree: Tree): string[] {
  return tree.names.filter(name => name.startsWith("features/")).flatMap(name => {
    const own = name.split("/").slice(0, 2).join("/"), view = isView(name), render = isRenderer(name);
    if (isExporter(name) || isVerifier(name) || isHostFolder(name)) return hostFeatureViolations(tree, name, own);
    const direct = resolvedIn(tree, name).filter(path =>
      path.startsWith("platform/") && !path.startsWith("platform/api") ||
      path.startsWith("features/") && !path.startsWith(`${own}/`) && path !== own ||
      // The feature's core never reaches its own view or renderer; only the composition joins them.
      !view && path.startsWith(`${own}/view`) || !render && path.startsWith(`${own}/render`) ||
      // Only a feature's renderer uses Three.
      /^three(?:\/|$)/.test(path) && !render ||
      path.startsWith("compose/") || !view && path.startsWith("studio-ui/") || isDevice(path) || /^(?:node|bun):/.test(path) ||
      // The core's allowlist.
      !view && !render && !(path.startsWith(`${own}/`) || path === own || path.startsWith("platform/api") ||
        path.startsWith("engines/") && !isRenderer(path) || FEATURE_CORE_LEGACY.has(path)))
      .map(path => `${name} -> ${path}`);
    if (render) return direct;
    const reached = [...reachIn(tree, name, view)].filter(path => PLATFORM_INTERNALS.test(path) || !view && CORE_UNREACHABLE.test(path))
      .map(path => `${name} ->* ${path}`);
    const globals = view ? [] : pageGlobals(tree.text(name)).map(global => `${name} reads ${global}`);
    return [...direct, ...reached, ...globals];
  });
}

/** A feature's own core module (not its view, renderer, exporter or verifier). */
const ownCoreModule = (own: string, path: string) => (path === own || path.startsWith(`${own}/`)) &&
  !isView(path) && !isRenderer(path) && !isExporter(path) && !isVerifier(path) && !isHostFolder(path);
/**
 * The host folders' rules (§7 rules 2 and 3): a feature's exporter imports only `platform/api`, engines (not their
 * renderers), its own core and exporter, Node and its legacy list; its verifier imports only `platform/api`, Node, its
 * own verifier folder and its core's export info, and reaches no exporter, engine or legacy pipeline module, even
 * through other modules. Neither reaches platform internals, devices, the UI or the composition.
 */
function hostFeatureViolations(tree: Tree, name: string, own: string): string[] {
  const exporter = isExporter(name), host = isHostFolder(name);
  const direct = resolvedIn(tree, name).filter(path => !(path.startsWith("platform/api") || /^node:(?:crypto|fs|path|os)$/.test(path) ||
    (host ? path.startsWith(`${own}/host/`) || ownCoreModule(own, path) || path.startsWith("engines/") && !isRenderer(path)
      : exporter ? path.startsWith(`${own}/export/`) || ownCoreModule(own, path) || path.startsWith("engines/") && !isRenderer(path) ||
        EXPORTER_LEGACY.has(path)
        : path.startsWith(`${own}/verify/`) || path === `${own}/export-info`))).map(path => `${name} -> ${path}`);
  const reached = [...reachIn(tree, name)].filter(path => PLATFORM_INTERNALS.test(path) ||
    /^(?:three(?:\/|$)|studio-ui\/|compose\/)/.test(path) || isDevice(path) ||
    path.startsWith("features/") && !path.startsWith(`${own}/`) ||
    (host ? isView(path) || isRenderer(path) || isExporter(path) || isVerifier(path)
      : exporter ? isVerifier(path) || isView(path) || isRenderer(path) || isHostFolder(path)
        : isExporter(path) || path.startsWith("engines/") || EXPORTER_LEGACY.has(path))).map(path => `${name} ->* ${path}`);
  return [...direct, ...reached];
}

test("feature modules import the platform only through platform/api and never another feature, the UI or compose", () => {
  const features = walk("features");
  expect(features).toContain("features/eye-makeup/index");
  expect(features).toContain("features/eye-makeup/view/index");
  expect(features).toContain("features/eye-makeup/render/index");
  expect(featureViolations(DISK)).toEqual([]);
});

test("a feature's exporter and verifier keep to their folders' rules, and the exporter's legacy list only shrinks (§7 rules 2, 3)", () => {
  expect(walk("features")).toContain("features/eye-makeup/export/index");
  expect(walk("features")).toContain("features/eye-makeup/verify/index");
  const used = new Set(DISK.names.filter(isExporter).flatMap(name => resolved(name)));
  expect([...EXPORTER_LEGACY.keys()].filter(name => !used.has(name))).toEqual([]);
  // The rules fail on the violations they name: a verifier reaching its exporter or an engine compiler, an exporter reaching the UI.
  const probes = hostFeatureViolations(probed({ "features/eye-makeup/verify/index": `import { EYE_MAKEUP_EXPORTER as __probe } from "../export";` }),
    "features/eye-makeup/verify/index", "features/eye-makeup");
  expect(probes).toContain("features/eye-makeup/verify/index ->* features/eye-makeup/export/index");
  expect(probes).toContain("features/eye-makeup/verify/index ->* engines/layered-makeup/preset-compiler");
  const compiler = hostFeatureViolations(probed({ "features/eye-makeup/verify/texture-checks":
    `import { compilePreset as __probe } from "../../../engines/layered-makeup/preset-compiler";` }), "features/eye-makeup/verify/texture-checks", "features/eye-makeup");
  expect(compiler).toContain("features/eye-makeup/verify/texture-checks -> engines/layered-makeup/preset-compiler");
  const ui = hostFeatureViolations(probed({ "features/eye-makeup/export/index": `import { h as __probe } from "../../../studio-ui/dom";` }),
    "features/eye-makeup/export/index", "features/eye-makeup");
  expect(ui).toContain("features/eye-makeup/export/index -> studio-ui/dom");
});

test("a feature's host endpoints import only the platform API, engines, their own core and Node, and reach no view or legacy module", () => {
  expect(walk("features")).toContain("features/save-explorer/host/saves-server");
  const host = "features/save-explorer/host/saves-server", own = "features/save-explorer";
  expect(hostFeatureViolations(DISK, host, own)).toEqual([]);
  // The rule fails on what it names: a host module importing the UI, a host adapter outside its feature, its own view or a child process.
  const probe = (code: string) => hostFeatureViolations(probed({ [host]: code }), host, own);
  expect(probe(`import { h as __probe } from "../../../studio-ui/dom";`)).toContain(`${host} -> studio-ui/dom`);
  expect(probe(`import { createWindowsDetectionHost as __probe } from "../../../installation/host/install-detection-host";`))
    .toContain(`${host} -> installation/host/install-detection-host`);
  expect(probe(`import { explorerPanel as __probe } from "../view/panel";`)).toContain(`${host} ->* features/save-explorer/view/panel`);
  expect(probe(`import { execFile as __probe } from "node:child_process";`)).toContain(`${host} -> node:child_process`);
  // A feature's core never reaches its host folder.
  expect(featureViolations(probed({ "features/save-explorer/actions": `import { listSaves as __probe } from "./host/saves-server";` })))
    .toContain("features/save-explorer/actions ->* features/save-explorer/host/saves-server");
});

test("the browser bundle reaches no exporter, verifier or export host (§7 rule 6)", () => {
  const browser = [...reach("compose/studio-startup"), ...reach("compose/studio-main")];
  expect(browser.filter(path => isExporter(path) || isVerifier(path) || isHostFolder(path) || path.startsWith("platform/export/") || path === "compose/exporters")).toEqual([]);
  // Only the host composition lists exporters; the browser composition lists none.
  expect(reach("compose/exporters")).toContain("features/eye-makeup/export/index");
});

test("a feature's core imports only its allowlist, and the legacy list only shrinks (CORE-77)", () => {
  const core = DISK.names.filter(name => name.startsWith("features/") && !isView(name) && !isRenderer(name) && !isExporter(name) && !isVerifier(name));
  const used = new Set(core.flatMap(name => resolved(name)));
  expect([...FEATURE_CORE_LEGACY.keys()].filter(name => !used.has(name))).toEqual([]);
  // What the legacy modules pull in stays inside the rules too: they reach no platform internals, devices or globals.
  for (const legacy of FEATURE_CORE_LEGACY.keys()) {
    expect([...reachIn(DISK, legacy)].filter(path => PLATFORM_INTERNALS.test(path) || CORE_UNREACHABLE.test(path)), legacy).toEqual([]);
    expect(pageGlobals(source(legacy)), legacy).toEqual([]);
  }
  // Eye makeup's core no longer reaches the look history through editor-actions (the pure layer actions are the engine's).
  expect(reach("features/eye-makeup/index")).not.toContain("platform/core/look-history");
});

/**
 * The feature renderer rule (§5, step 7; CORE-86): a feature's `render/` imports only `platform/api`, engines, Three and its own
 * feature's core, and what it reaches beyond what its core reaches (the core has its own rules) is only the port, engines, Three and the
 * scene's materials, types included: never `platform/scene`, a device, an application service or another feature.
 */
function rendererViolations(tree: Tree): string[] {
  return tree.names.filter(name => /^features\/[\w-]+\/render\//.test(name)).flatMap(name => {
    const own = name.split("/").slice(0, 2).join("/");
    const ownCore = (path: string) => (path === own || path.startsWith(`${own}/`)) && !/\/(?:view|render|export|verify)(?:\/|$)/.test(path.slice(own.length));
    const direct = resolvedIn(tree, name).filter(path => !(path.startsWith("platform/api/") || path.startsWith("engines/") || path === "three" ||
      ownCore(path) || path.startsWith(`${own}/render/`))).map(path => `${name} -> ${path}`);
    const core = new Set(tree.names.filter(ownCore).flatMap(module => [module, ...reachIn(tree, module)]));
    const reached = [...reachIn(tree, name)].filter(path => !core.has(path) && !path.startsWith(`${own}/render/`) && !rendererMayReach(path))
      .map(path => `${name} ->* ${path}`);
    return [...direct, ...reached];
  });
}

test("a feature renderer reaches the scene only through the scene port: platform/api, engines, Three and its own core", () => {
  const renderers = walk("features").filter(name => /^features\/[\w-]+\/render\//.test(name));
  expect(renderers).toContain("features/eye-makeup/render/index");
  expect(rendererViolations(DISK)).toEqual([]);
  // In particular never the host's internals, even through other modules.
  for (const name of renderers) expect([...reachIn(DISK, name)].filter(path => path.startsWith("platform/scene"))).toEqual([]);
});

test("the scene host and feature renderer rules fail on injected transitive leaks, and platform/api names Three by type only (CORE-86, CORE-88)", () => {
  // A renderer module the host builds on reaches an application service, and a scene material reaches an engine, by type only.
  const scene = sceneViolations(probed({
    "preview/render/head-camera-input": `import type { StudioAction as __Probe } from "../../app/studio-application";`,
    "materials/render/skin-material": `import type { Layer as __Probe } from "../../engines/layered-makeup/recipe";`,
  }));
  expect(scene).toContain("platform/scene/scene-host ->* app/studio-application");
  expect(scene).toContain("platform/scene/character-renderer ->* engines/layered-makeup/recipe");
  expect(scene).not.toContain("platform/scene/scene-host -> app/studio-application");
  // A new direct import outside the scene side, and a reach into host code or a device.
  expect(sceneViolations(probed({ "platform/scene/head-rig": `import type { AuthoringDocument as __Probe } from "../../app/authoring/authoring-document";` })))
    .toContain("platform/scene/head-rig -> app/authoring/authoring-document");
  const kinds = sceneViolations(probed({ "character/render-detail": [`import type { CcCatalogueHost as __Probe } from "./host/cc-catalogue-host";`,
    `import type { BrowserDevice as __Device } from "./browser/browser-cc-catalogue-device";`].join("\n") }));
  expect(kinds).toContain("platform/scene/scene-host ->* character/host/cc-catalogue-host");
  expect(kinds).toContain("platform/scene/scene-host ->* character/browser/browser-cc-catalogue-device");
  // A scene material eye makeup's renderer builds on reaches the authoring core; an engine renderer reaches the host.
  const renderer = rendererViolations(probed({ "materials/render/skin-material": `import type { AuthoringDocument as __Probe } from "../../app/authoring/authoring-document";` }));
  expect(renderer).toContain("features/eye-makeup/render/index ->* app/authoring/authoring-document");
  const engine = [...engineViolations(probed({ "engines/layered-makeup/render/plate-blend": `import type { HeadRig as __Probe } from "../../../platform/scene/head-rig";` })),
    ...rendererViolations(probed({ "engines/layered-makeup/render/plate-blend": `import type { HeadRig as __Probe } from "../../../platform/scene/head-rig";` }))];
  expect(engine).toContain("engines/layered-makeup/render/plate-blend -> platform/scene/head-rig");
  expect(engine).toContain("engines/layered-makeup/render/makeup-stack ->* platform/scene/head-rig");
  expect(engine).toContain("features/eye-makeup/render/index ->* platform/scene/head-rig");
  // CORE-88: a value import of Three in the scene port, and the api index re-exporting it.
  const platform = platformViolations(probed({ "platform/api/scene": `import * as __THREE from "three";`,
    "platform/api/index": `export * from "./scene";` }));
  expect(platform).toContain("platform/api/scene -> three (value)");
  expect(platform).toContain("platform/api/index re-exports platform/api/scene");
});

test("engines import no feature, UI, composition or platform internals; only their render/ uses Three (CORE-78)", () => {
  const engines = walk("engines");
  expect(engines).toContain("engines/layered-makeup/recipe");
  expect(engines).toContain("engines/layered-makeup/render/plate-composite");
  expect(engineViolations(DISK)).toEqual([]);
});

test("the engine and feature rules fail on the review's probes (CORE-77, CORE-78)", () => {
  // Probe A: a pure engine module pulls its renderer (and Three) in. Probe B: page and host globals.
  const engine = engineViolations(probed({ "engines/layered-makeup/recipe": [
    `import { createMakeupStack as __probeStack } from "./render/makeup-stack";`,
    "export const __probeB = () => { const w = window; return [w.location.href, self.indexedDB, document.cookie, " +
      "(window as any).innerWidth, window.devicePixelRatio, Bun.env.X, process.env.Y]; };"].join("\n") }));
  for (const violation of ["engines/layered-makeup/recipe ->* engines/layered-makeup/render/makeup-stack", "engines/layered-makeup/recipe ->* three",
    // Every module that uses the recipe now reaches the renderer too.
    "engines/layered-makeup/preset-compiler ->* engines/layered-makeup/render/makeup-stack",
    "engines/layered-makeup/recipe reads window", "engines/layered-makeup/recipe reads self.", "engines/layered-makeup/recipe reads document.",
    "engines/layered-makeup/recipe reads Bun.env", "engines/layered-makeup/recipe reads process.env"]) expect(engine).toContain(violation);
  expect(engine.filter(violation => violation === "engines/layered-makeup/recipe reads window")).toHaveLength(3);
  // Probe D: a feature core reaches a browser device, a trusted service, the DOM and Three.
  const feature = featureViolations(probed({ "features/eye-makeup/core": [
    `import { createRasterClient as __probeRaster } from "../../legacy/eye-makeup/browser/raster-client";`,
    `import { AuthoringDocument as __probeDoc } from "../../app/authoring/authoring-document";`,
    `export const __probeD = () => document.createElement("canvas");`, `import * as __T from "three";`].join("\n") }));
  for (const violation of ["features/eye-makeup/core -> legacy/eye-makeup/browser/raster-client", "features/eye-makeup/core -> app/authoring/authoring-document",
    "features/eye-makeup/core -> three", "features/eye-makeup/core ->* three", "features/eye-makeup/core reads document.",
    "features/eye-makeup/core ->* platform/core/look-history"]) expect(feature).toContain(violation);
  // CORE-87: a template-literal import reaches a device; a computed one could load anything.
  const hidden = featureViolations(probed({ "features/eye-makeup/core": [
    "export const __probeT = () => import(`../../legacy/eye-makeup/browser/raster-client`);", "export const __probeC = (name: string) => import(name);"].join("\n") }));
  expect(hidden).toContain("features/eye-makeup/core -> legacy/eye-makeup/browser/raster-client");
  expect(hidden).toContain(`features/eye-makeup/core -> ${COMPUTED}`);
  // The leak the review found: a legacy module that reaches the look history through editor-actions, even by type.
  const leak = featureViolations(probed({ "legacy/eye-makeup/history-labels": `import type { HistoryEntryId as __Probe } from "./editor-actions";` }));
  expect(leak).toContain("features/eye-makeup/index ->* platform/core/look-history");
  // A view's code reaching platform internals by value.
  const view = featureViolations(probed({ "features/eye-makeup/view/layers": `import { LookHistory as __Probe } from "../../../platform/core/look-history";` }));
  expect(view).toContain("features/eye-makeup/view/layers -> platform/core/look-history");
  expect(view).toContain("features/eye-makeup/view/layers ->* platform/core/look-history");
});

test("studio-ui imports no engine: feature data reaches the shell only through the presentation port", () => {
  const violations = walk("studio-ui").flatMap(name => resolved(name).filter(path => path.startsWith("engines/"))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

test("the platform imports no engine", () => {
  expect(walk("platform").flatMap(name => resolved(name).filter(path => path.startsWith("engines/")))).toEqual([]);
});

// Composition: `compose/` holds the composition lists and the browser roots (`studio-main`, `studio-startup`). Hosts outside `src/`
// (servers, desktop, tools and tests) are roots too.
test("only the composition imports compose/: every other module receives the registries as arguments (CORE-29)", () => {
  const violations = every().filter(name => !name.startsWith("compose/"))
    .flatMap(name => resolved(name).filter(path => path.startsWith("compose/")).map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
  // The root does import it: the composition reaches the app only through it.
  expect(resolved("compose/studio-startup")).toContain("compose/studio-registry");
});

test("no module outside the composition reaches a feature, directly or through other modules", () => {
  const violations = every().filter(name => !name.startsWith("compose/") && !name.startsWith("features/"))
    .flatMap(name => [...reach(name)].filter(path => path.startsWith("features/") || path.startsWith("compose/"))
      .map(path => `${name} ->* ${path}`));
  expect(violations).toEqual([]);
  // The walk is transitive: the root reaches the feature through compose/, the application never does.
  expect(reach("compose/studio-startup")).toContain("features/eye-makeup/index");
  expect(reach("app/studio-application")).not.toContain("compose/studio-registry");
});

// UI architecture boundary, exception 13 (docs/diagnostics.md): diagnostics' pure half runs on the page and the host alike; its host
// half (`diagnostics/host/`) and the page's device (`diagnostics/browser/`) are constructed only by composition roots (DIAG-10).
test("diagnostics' pure half is DOM- and host-free, and only composition roots import its endpoint and browser device (DIAG-10)", () => {
  const diagnostics = every().filter(name => name.startsWith("diagnostics/"));
  const pure = diagnostics.filter(name => isPure(name));
  expect(pure).toContain("diagnostics/model");
  expect(diagnostics.filter(name => !isPure(name) && !isHost(name) && !isDevice(name))).toEqual([]);
  for (const name of pure) {
    const loads = [...reachIn(DISK, name, true)].filter(path => path.startsWith("node:") || path === "bun" || isHost(path));
    expect(loads, `${name} loads host code`).toEqual([]);
    expect(pageGlobals(source(name)), `${name} reads page or host globals`).toEqual([]);
  }
  const importers = (target: string) => every().filter(name => resolved(name).includes(target));
  // The servers and the desktop host (outside src/) construct the endpoint; in src/, nothing does.
  expect(importers("diagnostics/host/host-endpoint")).toEqual([]);
  expect(importers("diagnostics/browser/browser-device")).toEqual(["compose/studio-startup"]);
  const outside = (path: string) => sourceText(fileURLToPath(new URL(`../${path}`, import.meta.url)));
  expect(imports(outside("server.ts"))).toContain("./src/diagnostics/host/host-endpoint");
  expect(imports(outside("desktop/server.ts"))).toContain("../src/diagnostics/host/host-endpoint");
  // The rule fails on the violations it names: a pure module loading the file system or the host log, or reading the window.
  const leak = probed({ "diagnostics/report": `import { readFileSync as __probe } from "node:fs";`,
    "diagnostics/actions": `import { hostFailure as __probe } from "./host/host-log";` });
  expect([...reachIn(leak, "diagnostics/report", true)]).toContain("node:fs");
  expect([...reachIn(leak, "diagnostics/actions", true)]).toContain("diagnostics/host/host-log");
  expect(pageGlobals(`${source("diagnostics/redact")}\nconst __probe = window.location;`)).toContain("window");
});

test("the local setup's host readiness and page service share their codes through a contract, not each other (DESK-14)", () => {
  expect(resolved("setup/host/local-settings-readiness")).not.toContain("setup/local-setup-actions");
  expect(resolved("setup/host/local-settings-readiness")).toContain("setup/local-readiness-codes");
  expect(resolved("setup/local-setup-actions")).toContain("setup/local-readiness-codes");
  expect(resolved("setup/local-readiness-codes")).toEqual([]);
});

test("the page's host devices share one request helper and import no other device (UPD-03)", () => {
  for (const device of ["setup/browser/browser-update-check-device", "setup/browser/browser-desktop-app-device"]) {
    expect(resolved(device)).toContain("setup/browser/browser-host-request");
    expect(resolved(device).filter(name => isDevice(name) && name !== "setup/browser/browser-host-request")).toEqual([]);
  }
  expect(resolved("setup/browser/browser-host-request")).toEqual([]);
});
