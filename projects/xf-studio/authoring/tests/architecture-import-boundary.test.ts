import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { sourceText } from "./fixtures/source-files";
import { COMPUTED, imports, importUses, resolveFrom } from "./fixtures/import-scan";
import { codeOnly, pageGlobals, PAGE_GLOBALS } from "./fixtures/code-scan";

/** A module's text, read once per test process (tests/fixtures/source-files.ts). */
const source = (name: string) => sourceText(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
/**
 * Browser globals that DOM-free code must not read: the window and its storage, the navigator,
 * network access, `globalThis` (a way around the others) and the document. Comments and strings
 * are not stripped, so keep these words out of such modules' prose.
 */
const BROWSER_GLOBALS = /\b(?:window|localStorage|sessionStorage|navigator|globalThis)\b|(?<![.\w])fetch\s*\(|(?<!\.)\bdocument\.(?:getElementById|querySelector|createElement|body|addEventListener)/;

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

test("trusted application and presentation services keep browser devices outside their import boundary", () => {
  const trusted = ["studio-application", "studio-presentation", "trusted-authoring-core",
    "trusted-studio-bootstrap", "trusted-preview-services", "collection-application",
    "studio-file-operations", "authoring-preview-coordinator", "glitter-measurements", "engines/layered-makeup/makeup-dependencies"];
  for (const name of trusted) {
    const code = source(name);
    for (const dependency of imports(code))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(three(?:\/|$)|\.\/(?:studio-main|studio-startup|browser-|scene|platform\/scene\/|uv-editor|surface-editor|raster-client|collection-transport))/);
    expect(code, `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
  }
});

test("install detection keeps parsing pure and host access in its adapter", () => {
  for (const name of ["install-detection", "mo2-instance", "install-detection-actions", "framework-versions",
    "mo2-placement", "pe-version"]) {
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os)|\.\/(?:install-detection-host|install-detection-server|browser-|studio-(?:main|startup)$|scene|platform\/scene\/|studio-ui))/);
  }
  // The action layer and browser device reach the host only through a typed transport.
  expect(imports(source("install-detection-actions")).filter(path => !path.startsWith("./"))).toEqual([]);
  expect(imports(source("browser-install-detection-device"))).toEqual(["./install-detection-actions"]);
});

// Dependencies point inward. Presentation modules (the `studio-ui/` tree and any
// `*-ui` module) and browser entry points may import the core, never the reverse.
// `context-menu` is presentation policy.
const presentation = (path: string) => /^\.\/(?:[\w-]+-ui|studio-ui\/.*|context-menu)$/.test(path);
const entries = new Set(["studio-main", "studio-startup"]);

test("core modules never import presentation modules or browser entry points", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const modules = readdirSync(new URL("../src/", import.meta.url))
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .map(file => file.slice(0, -3));
  const core = modules.filter(name => !presentation(`./${name}`) && !entries.has(name));
  expect(core).toContain("recipe-schema");
  expect(core).toContain("studio-application");
  const violations = core.flatMap(name => imports(source(name))
    .filter(path => presentation(path) || entries.has(path.replace(/^\.\//, "")))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

test("the package builder keeps resource definitions pure and external processes in its adapters", () => {
  // Pure definitions: no file, process or compiler access.
  expect(imports(source("package-resources"))).toEqual(["node:crypto", "./package-bake", "./engines/layered-makeup/plate-uv-window"]);
  // The plate-local UV window is pure arithmetic over WolvenKit JSON.
  expect(imports(source("engines/layered-makeup/plate-uv-window"))).toEqual([]);
  // Orchestration reaches WolvenKit only through the PackageResourceTools port.
  for (const name of ["package-resource-builder", "package-build-service", "package-bake"])
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(/^(node:child_process|\.\/process-tree)$/);
  // Every WolvenKit command runs through the one shared runner, which alone starts the process.
  for (const name of ["package-build-wolvenkit", "eye-plate-wolvenkit", "game-asset-export-wolvenkit", "verifier-wolvenkit"]) {
    expect(imports(source(name))).toContain("./wolvenkit-cli");
    expect(imports(source(name))).not.toContain("./process-tree");
  }
  expect(imports(source("wolvenkit-cli"))).toContain("./process-tree");
  // The resolver fetcher and the grading-LUT host too (PREV-29, PREV-30): no process of their own.
  for (const name of ["resolver-host", "grading-lut-host"]) {
    expect(imports(source(name))).toContain("./wolvenkit-cli");
    expect(imports(source(name))).not.toContain("./process-tree");
    expect(imports(source(name))).not.toContain("node:child_process");
    expect(source(name), `${name} starts a process`).not.toMatch(/\bBun\.spawn/);
  }
});

test("the character resolver keeps its rules pure and all host access in resolver-host", () => {
  const pure = ["depot-path", "red-json", "resolution-evidence", "archive-precedence", "archivexl-config", "cco-model",
    "rdar-index", "resource-graph", "character-resolver"];
  for (const name of pure) {
    const code = source(name);
    for (const dependency of imports(code))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os|path)|\.\/(?:resolver-host|source-discovery|install-detection-host|browser-|studio-(?:main|startup)$|scene|platform\/scene\/|studio-ui))/);
    expect(code, `${name} reaches the host`).not.toMatch(/\bBun\.(?:spawn|file|write)|\bprocess\.env\b/);
  }
});

test("the 3D preview derivation keeps definitions pure and WolvenKit in its one adapter", () => {
  const io = /^(node:(?:fs|child_process|os)|\.\/(?:process-tree|game-asset-export-wolvenkit|browser-|scene|platform\/scene\/|studio-ui))/;
  for (const name of ["preview-core-recipe", "preview-core-maps", "preview-core-materials", "preview-core-assemble", "glb", "render-detail", "preview-preparation",
    "wolvenkit-setup", "wolvenkit-release"])
    for (const dependency of imports(source(name))) expect(dependency, `${name} imports ${dependency}`).not.toMatch(io);
  // The service reaches WolvenKit only through the generic export port.
  for (const dependency of imports(source("preview-core-service")))
    expect(dependency, `preview-core-service imports ${dependency}`).not.toMatch(/^(node:child_process|\.\/process-tree|\.\/game-asset-export-wolvenkit)$/);
  expect(imports(source("game-asset-export-wolvenkit"))).toContain("./wolvenkit-cli");
  // The renderer loads the core head only through the typed record loader.
  expect(source("platform/scene/scene-host")).not.toContain('fetch("/assets/head.glb")');
  expect(imports(source("platform/scene/scene-host"))).toContain("../../core-detail-loader");
});

test("WolvenKit setup keeps its policy in the service and the network, archive and process work in adapters", () => {
  // The renderer side and the pinned release are pure; the service reaches IO only through its adapters.
  for (const name of ["wolvenkit-setup", "wolvenkit-release"])
    for (const dependency of imports(source(name))) expect(dependency, `${name} imports ${dependency}`).not.toMatch(/^node:/);
  const service = imports(source("wolvenkit-setup-host"));
  for (const adapter of ["./tool-download", "./zip-extract", "./dotnet-runtime", "./wolvenkit-cli"]) expect(service).toContain(adapter);
  for (const dependency of service) expect(dependency).not.toMatch(/^(node:child_process|\.\/process-tree|\.\/browser-|\.\/studio-ui)/);
  expect(source("wolvenkit-setup-host")).not.toMatch(/\bfetch\(/);
});

test("the eye plate reaches the launch route only through its head-source port", () => {
  // The head-source policy is pure: resolver rules in, JSON documents in, no host access.
  for (const dependency of imports(source("eye-plate-head-source")))
    expect(dependency, `eye-plate-head-source imports ${dependency}`).not.toMatch(
      /^(node:(?:fs|child_process|os|path)|\.\/(?:resolver-host|source-discovery|process-tree|eye-plate-wolvenkit|eye-plate-head-resolver))$/);
  // The application service owns the policy; discovery, indexes and WolvenKit stay in adapters.
  for (const dependency of imports(source("eye-plate-service")))
    expect(dependency, `eye-plate-service imports ${dependency}`).not.toMatch(
      /^(node:child_process|\.\/(?:resolver-host|source-discovery|process-tree|eye-plate-wolvenkit|eye-plate-head-resolver))$/);
  expect(imports(source("eye-plate-head-resolver"))).toContain("./resolver-host");
});

// Feature-module platform §7: `platform/`, `engines/`, `features/` and `compose/` (the step-5 moves put
// the layered-makeup engine in `engines/layered-makeup/` and eye makeup's view in `features/eye-makeup/view/`).
// The rules run over a source tree: the files on disk, or the same files with probes appended, so each rule is
// also shown to fail on the violations a review injected (CORE-77, CORE-78).
type Tree = { readonly names: readonly string[]; text(name: string): string };
const walk = (dir: string): string[] => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(new URL(`../src/${dir}/`, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${dir}/${entry.name.slice(0, -3)}`] : []);
};
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
/** A module's imports as src-relative module names (`platform/api`, `recipe-actions`), or bare package names. */
const resolvedIn = (tree: Tree, name: string) => imports(tree.text(name)).map(path => resolveFrom(name, path));
const resolved = (name: string) => resolvedIn(DISK, name);
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
      const name = modules.has(path) ? path : modules.has(`${path}/index`) ? `${path}/index` : path;
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

/**
 * The platform rule (§7 rule 5): platform code outside the scene host imports only the platform, and the scene port names Three by
 * type only (CORE-88); the api index never re-exports the port, so a feature's core never sees Three.
 */
function platformViolations(tree: Tree): string[] {
  const pure = tree.names.filter(name => name.startsWith("platform/") && !name.startsWith("platform/scene/"));
  return pure.flatMap(name => [
    ...resolvedIn(tree, name).filter(path => !path.startsWith("platform/") || path.startsWith("platform/scene/"))
      .filter(path => !(name === "platform/api/scene" && path === "three")).map(path => `${name} -> ${path}`),
    ...valueImportsOf(tree, name, /^three(?:\/|$)/).map(path => `${name} -> ${path} (value)`),
    ...(name === "platform/api/index" && /["']\.\/scene["']/.test(tree.text(name)) ? [`${name} re-exports platform/api/scene`] : []),
  ]);
}

test("platform code imports only the platform: nothing from features, engines, compose or legacy src", () => {
  const platform = walk("platform");
  expect(platform).toContain("platform/api/index");
  expect(platform).toContain("platform/core/registry");
  expect(platform).toContain("platform/scene/feature-renderers");
  expect(platformViolations(DISK)).toEqual([]);
  expect(source("platform/api/scene")).toMatch(/import type \* as THREE from "three"/);
  for (const name of platform.filter(name => !name.startsWith("platform/scene/")))
    expect(source(name), `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
});

/**
 * The legacy `src/` modules the scene host (platform/scene) still builds on: the renderer and device modules that stay at the top of
 * `src/` until they move under platform/scene (a recorded exception, ui-architecture-boundary.md "scene host"). Nothing else in src.
 */
const SCENE_DEVICE_MODULES = new Set<string>([
  // Renderer and GPU devices: the stage, lights, display, camera input, skinning and the head's materials.
  "browser-grading-lut-device", "lighting-preset-stage", "linear-display", "studio-light-rig", "viewport-backdrop", "head-camera-input",
  "device-pixel-ratio", "skin", "eye-material", "layered-material", "render-scheduler",
  // The character context's loaders, adapters and placement, and their record types and codes.
  "core-detail-loader", "character-detail-loader", "character-material-adapters", "head-skin-placement", "render-detail", "render-templates",
  "detail-limits", "head-load-error", "scene-evidence",
  // The rig's motion and facial shapes.
  "idle-animation", "game-blink", "preview-motion", "face-morphs",
  // Pure helpers and types: camera framing and depth, viewport sizes, the stage theme, studio light values, hair profile encoding, the save's V.
  "camera-depth", "camera-framing", "viewport-size", "stage-backdrop", "studio-lighting", "hair-colour-model", "save-reader",
]);
/**
 * What the device modules build on in turn, reached only through them (types included): the materials, lights and grading they
 * compose, the binding catalogue the camera input resolves presses with, and the pure record readers under them (CORE-86).
 */
const SCENE_SUPPORT_MODULES = new Set<string>([
  "brow-material", "decal-underlay", "face-decal-material", "hair-shading", "head-surface", "skin-material",
  "creator-lighting", "creator-lighting-rig", "grading-lut", "studio-environment", "game-blink-messages", "input-bindings",
  "red-json", "depot-path", "archive-precedence", "resolution-evidence",
]);
/** What nothing the scene host reaches may be: a feature, an engine, the composition, the UI, an entry point, or an application service. */
const SCENE_UNREACHABLE = /^(?:features\/|engines\/|compose\/|studio-ui\/|studio-(?:main|startup|application|presentation)$|platform\/(?:core|export)\/|authoring-|collection-|trusted-|workspace-|[\w-]+-(?:actions|service|host|server)$|node:|bun:)/;
const sceneAllowed = (path: string) => path.startsWith("platform/api/") || path.startsWith("platform/scene/") || path === "three" ||
  path.startsWith("three/addons/") || SCENE_DEVICE_MODULES.has(path);

/**
 * The scene host rule (§7, step 7; CORE-86): it imports the platform, Three and its listed device modules only, and everything it
 * reaches through them, types included, is a listed device or support module; never a feature, engine, compose, the UI or an
 * application service, even by type.
 */
function sceneViolations(tree: Tree): string[] {
  return tree.names.filter(name => name.startsWith("platform/scene/")).flatMap(name => [
    ...resolvedIn(tree, name).filter(path => !sceneAllowed(path)).map(path => `${name} -> ${path}`),
    ...[...reachIn(tree, name)].filter(path => !(sceneAllowed(path) || SCENE_SUPPORT_MODULES.has(path)) || SCENE_UNREACHABLE.test(path))
      .map(path => `${name} ->* ${path}`),
  ]);
}

test("the scene host imports the platform, Three and its listed device modules only; never a feature, engine, compose or the UI", () => {
  expect(sceneViolations(DISK)).toEqual([]);
  // The lists name modules that exist and are none of the unreachable kinds.
  for (const name of [...SCENE_DEVICE_MODULES, ...SCENE_SUPPORT_MODULES]) {
    expect(DISK.names, name).toContain(name);
    expect(name).not.toMatch(SCENE_UNREACHABLE);
  }
  // Each support module is still reached (the list only shrinks as modules move under platform/scene).
  const reached = new Set(walk("platform/scene").flatMap(name => [...reachIn(DISK, name)]));
  expect([...SCENE_SUPPORT_MODULES].filter(name => !reached.has(name))).toEqual([]);
});

/** Pure shared helpers any engine or feature core may use. */
const PURE_HELPERS = new Set(["read-only", "validation-issues"]);
/** The scene's shared material modules an engine renderer may build on (they move under `platform/scene` in step 9). */
const SCENE_MATERIALS = new Set(["skin", "skin-material", "face-decal-material", "linear-display"]);
/** What those materials build on in turn, reached only through them: record types, template priorities and the display's grading (CORE-86). */
const SCENE_MATERIAL_SUPPORT = new Set(["render-detail", "render-templates", "grading-lut", "creator-lighting", "red-json", "depot-path",
  "archive-precedence", "resolution-evidence"]);
/** What a renderer (an engine's or a feature's `render/`) may reach beyond its feature's core: the port, engines, Three and the scene's materials. */
const rendererMayReach = (path: string) => path.startsWith("platform/api/") || path.startsWith("engines/") || path === "three" ||
  path.startsWith("three/addons/") || PURE_HELPERS.has(path) || SCENE_MATERIALS.has(path) || SCENE_MATERIAL_SUPPORT.has(path);
const isRenderer = (name: string) => /^(?:engines|features)\/[\w-]+\/render\//.test(name);
const isView = (name: string) => /^features\/[\w-]+\/view\//.test(name);
/** Platform internals no feature reaches, even through other modules: only `platform/api` is a feature's. */
const PLATFORM_INTERNALS = /^platform\/(?:core|scene|export)(?:\/|$)/;

/**
 * The engine rules (§1 layout, CORE-78): an engine imports only engines, `platform/api` and the pure helpers; only an
 * engine's `render/` imports Three and the scene's shared materials; no other engine module reaches a renderer or Three,
 * even through other modules; and the pure engine reads no page or host global.
 */
function engineViolations(tree: Tree): string[] {
  return tree.names.filter(name => name.startsWith("engines/")).flatMap(name => {
    const render = isRenderer(name);
    const direct = resolvedIn(tree, name).filter(path => !(path.startsWith("engines/") || path.startsWith("platform/api") ||
      PURE_HELPERS.has(path) || render && (path === "three" || SCENE_MATERIALS.has(path)))).map(path => `${name} -> ${path}`);
    // A renderer reaches only engines, the port, Three and the scene's materials, types included (CORE-86).
    if (render) return [...direct, ...[...reachIn(tree, name)].filter(path => !rendererMayReach(path)).map(path => `${name} ->* ${path}`)];
    const reached = [...reachIn(tree, name)].filter(path => isRenderer(path) || /^three(?:\/|$)/.test(path)).map(path => `${name} ->* ${path}`);
    return [...direct, ...reached, ...pageGlobals(tree.text(name)).map(global => `${name} reads ${global}`)];
  });
}

/**
 * Legacy src modules a feature's core may still import, each with the step that removes it (the list only shrinks;
 * a test fails when an entry is no longer imported). Everything else a feature core imports is the platform API, an
 * engine (not its renderer), a pure helper or its own folder.
 */
const FEATURE_CORE_LEGACY = new Map([
  ["recipe-schema", "eye makeup's recipe-file lineage and model registry: moves into features/eye-makeup with the exporter " +
    "(step 8), once the library store, file operations and package pipeline read eye makeup's part through its codec"],
  ["history-labels", "eye makeup's Undo labels: move into features/eye-makeup once the authoring document labels steps through " +
    "the registered specs (step 9)"],
  ["eye-makeup-model", "eye makeup's action and state types: move into features/eye-makeup once StudioApplication and the " +
    "presentation port take them from the registry (step 9)"],
  ["eye-makeup-descriptors", "eye makeup's descriptors: move into features/eye-makeup once the application and presentation " +
    "read descriptors only from the registry (step 9)"],
]);
/** What a feature's core must never reach, directly or through other modules: devices, presentation, composition, Node, Three. */
const CORE_UNREACHABLE = /^(?:three(?:\/|$)|node:|bun:|studio-(?:main|startup)$|browser-|scene$|studio-ui\/|compose\/|features\/[\w-]+\/(?:view|render|export)\/)/;

/**
 * The feature rules (§7 rules 1, 2 and 4, CORE-77): a feature imports no other feature, no platform internals, no
 * composition and no entry point or device; its core imports only its allowlist, never its view, and reaches no platform
 * internals, device, Node or Three even through other modules, and reads no page or host global; its view's code
 * (value imports) reaches no platform internals either.
 */
function featureViolations(tree: Tree): string[] {
  const presentation = (path: string) => /^(?:studio-ui\/|context-menu$|[\w-]+-ui$)/.test(path);
  const entryOrDevice = (path: string) => /^(?:studio-(?:main|startup)$|browser-|scene$)/.test(path);
  return tree.names.filter(name => name.startsWith("features/")).flatMap(name => {
    const own = name.split("/").slice(0, 2).join("/"), view = isView(name), render = isRenderer(name);
    const direct = resolvedIn(tree, name).filter(path =>
      path.startsWith("platform/") && !path.startsWith("platform/api") ||
      path.startsWith("features/") && !path.startsWith(`${own}/`) && path !== own ||
      // The feature's core never reaches its own view or renderer; only the composition joins them.
      !view && path.startsWith(`${own}/view`) || !render && path.startsWith(`${own}/render`) ||
      // Only a feature's renderer uses Three.
      /^three(?:\/|$)/.test(path) && !render ||
      path.startsWith("compose/") || !view && presentation(path) || entryOrDevice(path) || /^(?:node|bun):/.test(path) ||
      // The core's allowlist.
      !view && !render && !(path.startsWith(`${own}/`) || path === own || path.startsWith("platform/api") ||
        path.startsWith("engines/") && !isRenderer(path) || PURE_HELPERS.has(path) || FEATURE_CORE_LEGACY.has(path)))
      .map(path => `${name} -> ${path}`);
    if (render) return direct;
    const reached = [...reachIn(tree, name, view)].filter(path => PLATFORM_INTERNALS.test(path) || !view && CORE_UNREACHABLE.test(path))
      .map(path => `${name} ->* ${path}`);
    const globals = view ? [] : pageGlobals(tree.text(name)).map(global => `${name} reads ${global}`);
    return [...direct, ...reached, ...globals];
  });
}

test("feature modules import the platform only through platform/api and never another feature, the UI or compose", () => {
  const features = walk("features");
  expect(features).toContain("features/eye-makeup/index");
  expect(features).toContain("features/eye-makeup/view/index");
  expect(features).toContain("features/eye-makeup/render/index");
  expect(featureViolations(DISK)).toEqual([]);
});

test("a feature's core imports only its allowlist, and the legacy list only shrinks (CORE-77)", () => {
  const core = DISK.names.filter(name => name.startsWith("features/") && !isView(name) && !isRenderer(name));
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
  // A device module the host builds on reaches an application service, and a scene material reaches an engine, by type only.
  const scene = sceneViolations(probed({
    "head-camera-input": `import type { StudioAction as __Probe } from "./studio-application";`,
    "skin-material": `import type { Layer as __Probe } from "./engines/layered-makeup/recipe";`,
  }));
  expect(scene).toContain("platform/scene/scene-host ->* studio-application");
  expect(scene).toContain("platform/scene/character-renderer ->* engines/layered-makeup/recipe");
  expect(scene).not.toContain("platform/scene/scene-host -> studio-application");
  // A new direct import outside the lists.
  expect(sceneViolations(probed({ "platform/scene/head-rig": `import type { AuthoringDocument as __Probe } from "../../authoring-document";` })))
    .toContain("platform/scene/head-rig -> authoring-document");
  // A scene material eye makeup's renderer builds on reaches the authoring core; an engine renderer reaches the host.
  const renderer = rendererViolations(probed({ "skin-material": `import type { AuthoringDocument as __Probe } from "./authoring-document";` }));
  expect(renderer).toContain("features/eye-makeup/render/index ->* authoring-document");
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
    `import { createRasterClient as __probeRaster } from "../../raster-client";`,
    `import { AuthoringDocument as __probeDoc } from "../../authoring-document";`,
    `export const __probeD = () => document.createElement("canvas");`, `import * as __T from "three";`].join("\n") }));
  for (const violation of ["features/eye-makeup/core -> raster-client", "features/eye-makeup/core -> authoring-document",
    "features/eye-makeup/core -> three", "features/eye-makeup/core ->* three", "features/eye-makeup/core reads document.",
    "features/eye-makeup/core ->* platform/core/look-history"]) expect(feature).toContain(violation);
  // CORE-87: a template-literal import reaches a device; a computed one could load anything.
  const hidden = featureViolations(probed({ "features/eye-makeup/core": [
    "export const __probeT = () => import(`../../raster-client`);", "export const __probeC = (name: string) => import(name);"].join("\n") }));
  expect(hidden).toContain("features/eye-makeup/core -> raster-client");
  expect(hidden).toContain(`features/eye-makeup/core -> ${COMPUTED}`);
  // The leak the review found: a legacy module that reaches the look history through editor-actions, even by type.
  const leak = featureViolations(probed({ "history-labels": `import type { HistoryEntryId as __Probe } from "./editor-actions";` }));
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

/** Composition roots: the browser entry points. Hosts outside `src/` (servers, desktop, tools and tests) are roots too. */
const roots = new Set(["studio-main", "studio-startup"]);

test("only composition roots import compose/: every other module receives the registries as arguments (CORE-29)", () => {
  const violations = every().filter(name => !name.startsWith("compose/") && !roots.has(name))
    .flatMap(name => resolved(name).filter(path => path.startsWith("compose/")).map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
  // The roots do import it: the composition reaches the app only through them.
  expect(resolved("studio-startup")).toContain("compose/studio-registry");
});

test("no module outside the composition reaches a feature, directly or through other modules", () => {
  const violations = every().filter(name => !name.startsWith("compose/") && !name.startsWith("features/") && !roots.has(name))
    .flatMap(name => [...reach(name)].filter(path => path.startsWith("features/") || path.startsWith("compose/"))
      .map(path => `${name} ->* ${path}`));
  expect(violations).toEqual([]);
  // The walk is transitive: the root reaches the feature through compose/, the application never does.
  expect(reach("studio-startup")).toContain("features/eye-makeup/index");
  expect(reach("studio-application")).not.toContain("compose/studio-registry");
});

// UI architecture boundary, exception 13 (docs/diagnostics.md): diagnostics' pure half runs on the page and the host alike; its host
// half and the page's device are constructed only by composition roots (DIAG-10).
const DIAGNOSTICS_PURE = ["model", "redact", "report", "actions", "page-sink", "resolution-trace"].map(name => `diagnostics/${name}`);
const DIAGNOSTICS_HOST = ["host-log", "host-endpoint", "host-report", "host-roots", "mod-identity", "trace-window", "zip", "browser-device"]
  .map(name => `diagnostics/${name}`);

test("diagnostics' pure half is DOM- and host-free, and only composition roots import its endpoint and browser device (DIAG-10)", () => {
  expect(every().filter(name => name.startsWith("diagnostics/")).sort()).toEqual([...DIAGNOSTICS_PURE, ...DIAGNOSTICS_HOST].sort());
  for (const name of DIAGNOSTICS_PURE) {
    const loads = [...reachIn(DISK, name, true)].filter(path => path.startsWith("node:") || path === "bun" || DIAGNOSTICS_HOST.includes(path));
    expect(loads, `${name} loads host code`).toEqual([]);
    expect(pageGlobals(source(name)), `${name} reads page or host globals`).toEqual([]);
  }
  const importers = (target: string) => every().filter(name => resolved(name).includes(target));
  // The servers and the desktop host (outside src/) construct the endpoint; in src/, nothing does.
  expect(importers("diagnostics/host-endpoint")).toEqual([]);
  expect(importers("diagnostics/browser-device")).toEqual(["studio-startup"]);
  const outside = (path: string) => sourceText(fileURLToPath(new URL(`../${path}`, import.meta.url)));
  expect(imports(outside("server.ts"))).toContain("./src/diagnostics/host-endpoint");
  expect(imports(outside("desktop/server.ts"))).toContain("../src/diagnostics/host-endpoint");
  // The rule fails on the violations it names: a pure module loading the file system or the host log, or reading the window.
  const leak = probed({ "diagnostics/report": `import { readFileSync as __probe } from "node:fs";`, "diagnostics/actions": `import { hostFailure as __probe } from "./host-log";` });
  expect([...reachIn(leak, "diagnostics/report", true)]).toContain("node:fs");
  expect([...reachIn(leak, "diagnostics/actions", true)]).toContain("diagnostics/host-log");
  expect(pageGlobals(`${source("diagnostics/redact")}\nconst __probe = window.location;`)).toContain("window");
});
