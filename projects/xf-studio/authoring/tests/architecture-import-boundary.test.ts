import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
/**
 * Every module specifier a source names: `import … from` and `export … from`, bare `import "…"`,
 * dynamic `import("…")` and inline type references `import("…").T` (CORE-43). Comments and strings
 * are not stripped, so keep such text out of prose.
 */
const IMPORT_FORMS = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const imports = (text: string) => [...text.matchAll(IMPORT_FORMS)].map(match => match[1] ?? match[2] ?? match[3]);
/**
 * Browser globals that DOM-free code must not read: the window and its storage, the navigator,
 * network access, `globalThis` (a way around the others) and the document. Comments and strings
 * are not stripped, so keep these words out of such modules' prose.
 */
const BROWSER_GLOBALS = /\b(?:window|localStorage|sessionStorage|navigator|globalThis)\b|(?<![.\w])fetch\s*\(|(?<!\.)\bdocument\.(?:getElementById|querySelector|createElement|body|addEventListener)/;

test("the import scan sees static, bare, dynamic and inline type imports (CORE-43)", () => {
  expect(imports([`import { a } from "./a";`, `export { b } from './b';`, `import "./c";`, `const d = await import("./d");`,
    `type E = import("./e").E;`, `let f: typeof import('node:fs');`, `import type { G } from "./g";`].join("\n")))
    .toEqual(["./a", "./b", "./c", "./d", "./e", "node:fs", "./g"]);
  expect(imports(`const later = importer("./x"); reimport ("./y");`)).toEqual([]);
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
const walk = (dir: string): string[] => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(new URL(`../src/${dir}/`, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${dir}/${entry.name.slice(0, -3)}`] : []);
};
/** A module's imports as src-relative module names (`platform/api`, `recipe-actions`), or bare package names. */
const resolved = (name: string) => imports(source(name)).map(path => {
  if (!path.startsWith(".")) return path;
  const parts = name.split("/").slice(0, -1);
  for (const part of path.split("/")) part === ".." ? parts.pop() : part !== "." && parts.push(part);
  return parts.join("/");
});
const every = () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const top = readdirSync(new URL("../src/", import.meta.url), { withFileTypes: true });
  return top.flatMap(entry => entry.isDirectory() ? walk(entry.name)
    : entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [entry.name.slice(0, -3)] : []);
};

test("platform code imports only the platform: nothing from features, engines, compose or legacy src", () => {
  const platform = walk("platform");
  expect(platform).toContain("platform/api/index");
  expect(platform).toContain("platform/core/registry");
  expect(platform).toContain("platform/scene/feature-renderers");
  // The scene host (platform/scene) is the platform's renderer: Three, the browser and the scene's device modules (below) are its own.
  const pure = platform.filter(name => !name.startsWith("platform/scene/"));
  const violations = pure.flatMap(name => resolved(name)
    // The scene port's types name Three objects (type-only; the api index does not re-export it, so a feature's core never sees Three).
    .filter(path => !path.startsWith("platform/") || path.startsWith("platform/scene/"))
    .filter(path => !(name === "platform/api/scene" && path === "three")).map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
  expect(source("platform/api/scene")).toMatch(/import type \* as THREE from "three"/);
  expect(source("platform/api/index")).not.toContain("./scene");
  for (const name of pure) expect(source(name), `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
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

test("the scene host imports the platform, Three and its listed device modules only; never a feature, engine, compose or the UI", () => {
  const scene = walk("platform/scene");
  const violations = scene.flatMap(name => resolved(name).filter(path => !(
    path.startsWith("platform/") || path === "three" || path.startsWith("three/addons/") || SCENE_DEVICE_MODULES.has(path)))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

test("feature modules import the platform only through platform/api and never another feature, the UI or compose", () => {
  const features = walk("features");
  expect(features).toContain("features/eye-makeup/index");
  expect(features).toContain("features/eye-makeup/view/index");
  expect(features).toContain("features/eye-makeup/render/index");
  /** A feature's view (`features/<id>/view/`) is presentation: it may use the shell's presentation toolkit and runtime. */
  const isView = (name: string) => /^features\/[\w-]+\/view\//.test(name);
  /** A feature's renderer (`features/<id>/render/`) may use Three. */
  const isRender = (name: string) => /^features\/[\w-]+\/render\//.test(name);
  const presentation = (path: string) => /^(?:studio-ui\/|context-menu$|[\w-]+-ui$)/.test(path);
  const entryOrDevice = (path: string) => /^(?:studio-(?:main|startup)$|browser-|scene$)/.test(path);
  const violations = features.flatMap(name => {
    const own = name.split("/").slice(0, 2).join("/");
    return resolved(name).filter(path =>
      path.startsWith("platform/") && !path.startsWith("platform/api") ||
      path.startsWith("features/") && !path.startsWith(`${own}/`) && path !== own ||
      // The feature's core never reaches its own view or renderer; only the composition joins them.
      !isView(name) && path.startsWith(`${own}/view`) || !isRender(name) && path.startsWith(`${own}/render`) ||
      path.startsWith("compose/") || !isView(name) && presentation(path) || entryOrDevice(path) ||
      (path === "three" || path.startsWith("three/")) && !isRender(name) || /^node:/.test(path))
      .map(path => `${name} -> ${path}`);
  });
  expect(violations).toEqual([]);
});

test("a feature renderer reaches the scene only through the scene port: platform/api, engines, Three and its own core", () => {
  const renderers = walk("features").filter(name => /^features\/[\w-]+\/render\//.test(name));
  expect(renderers).toContain("features/eye-makeup/render/index");
  const violations = renderers.flatMap(name => {
    const own = name.split("/").slice(0, 2).join("/");
    return resolved(name).filter(path => !(path.startsWith("platform/api/") || path.startsWith("engines/") || path === "three" ||
      path === own || path.startsWith(`${own}/`) && !path.startsWith(`${own}/view`))).map(path => `${name} -> ${path}`);
  });
  expect(violations).toEqual([]);
  // In particular never the host's internals.
  for (const name of renderers) expect(resolved(name).filter(path => path.startsWith("platform/scene"))).toEqual([]);
});

/** The scene's shared material modules an engine renderer may build on (they move to `platform/scene` with step 7). */
const SCENE_MATERIALS = new Set(["skin", "skin-material", "face-decal-material", "linear-display"]);
/** Pure shared helpers any engine may use. */
const PURE_HELPERS = new Set(["read-only", "validation-issues"]);

test("engines import no feature, UI, composition or platform internals; only their render/ uses Three", () => {
  const engines = walk("engines");
  expect(engines).toContain("engines/layered-makeup/recipe");
  expect(engines).toContain("engines/layered-makeup/render/plate-composite");
  const violations = engines.flatMap(name => {
    const render = /^engines\/[\w-]+\/render\//.test(name);
    return resolved(name).filter(path => !(
      path.startsWith("engines/") || path.startsWith("platform/api") || PURE_HELPERS.has(path) ||
      render && (path === "three" || SCENE_MATERIALS.has(path)))).map(path => `${name} -> ${path}`);
  });
  expect(violations).toEqual([]);
  // The pure engine reads no browser globals; renderers may (a canvas, the GPU). "window" is the engine's own word
  // for a UV rectangle (plate-uv-window.ts), so the page's window is caught through its members instead.
  const PAGE_MEMBERS = String.raw`\.(?:location|document|addEventListener|localStorage|requestAnimationFrame|open)\b`, PAGE_WINDOW = new RegExp(String.raw`\bwindow` + PAGE_MEMBERS);
  for (const name of engines.filter(name => !name.includes("/render/"))) {
    const code = source(name).replace(new RegExp(String.raw`\bwindow\b(?!` + PAGE_MEMBERS + ")", "g"), "");
    expect(code, `${name} reads browser globals`).not.toMatch(BROWSER_GLOBALS);
    expect(code, `${name} reads the page window`).not.toMatch(PAGE_WINDOW);
  }
});

test("studio-ui imports no engine: feature data reaches the shell only through the presentation port", () => {
  const violations = walk("studio-ui").flatMap(name => resolved(name).filter(path => path.startsWith("engines/"))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

test("the platform imports no engine", () => {
  expect(walk("platform").flatMap(name => resolved(name).filter(path => path.startsWith("engines/")))).toEqual([]);
});

/** Composition roots: the browser entry points. Hosts outside `src/` (servers, desktop, tools, tests) are roots too. */
const roots = new Set(["studio-main", "studio-startup"]);
/** Every src module a module reaches through its imports (type-only imports included), itself excluded. */
const reach = (start: string): Set<string> => {
  const modules = new Set(every()), seen = new Set<string>(), queue = [start];
  while (queue.length) {
    for (const path of resolved(queue.pop()!)) {
      const name = modules.has(path) ? path : modules.has(`${path}/index`) ? `${path}/index` : undefined;
      if (name && !seen.has(name)) { seen.add(name); queue.push(name); }
    }
  }
  return seen;
};

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
