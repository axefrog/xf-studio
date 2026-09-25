import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
const imports = (text: string) => [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);

test("trusted application and presentation services keep browser devices outside their import boundary", () => {
  const trusted = ["studio-application", "studio-presentation", "trusted-authoring-core",
    "trusted-studio-bootstrap", "trusted-preview-services", "collection-application",
    "studio-file-operations", "authoring-preview-coordinator", "glitter-measurements", "makeup-dependencies"];
  for (const name of trusted) {
    const code = source(name);
    for (const dependency of imports(code))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(three(?:\/|$)|\.\/(?:studio-main|studio-startup|browser-|scene|uv-editor|surface-editor|raster-client|collection-transport))/);
    expect(code, `${name} reads browser globals`).not.toMatch(
      /\b(?:window|localStorage)\.|(?<!\.)\bdocument\.(?:getElementById|querySelector|createElement|body|addEventListener)/);
  }
});

test("install detection keeps parsing pure and host access in its adapter", () => {
  for (const name of ["install-detection", "mo2-instance", "install-detection-actions", "framework-versions",
    "mo2-placement", "pe-version"]) {
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os)|\.\/(?:install-detection-host|install-detection-server|browser-|studio-(?:main|startup)$|scene|studio-ui))/);
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
  expect(core).toContain("recipe-actions");
  expect(core).toContain("studio-application");
  const violations = core.flatMap(name => imports(source(name))
    .filter(path => presentation(path) || entries.has(path.replace(/^\.\//, "")))
    .map(path => `${name} -> ${path}`));
  expect(violations).toEqual([]);
});

test("the package builder keeps resource definitions pure and external processes in its adapters", () => {
  // Pure definitions: no file, process or compiler access.
  expect(imports(source("package-resources"))).toEqual(["node:crypto", "./package-bake", "./plate-uv-window"]);
  // The plate-local UV window is pure arithmetic over WolvenKit JSON.
  expect(imports(source("plate-uv-window"))).toEqual([]);
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
});

test("the character resolver keeps its rules pure and all host access in resolver-host", () => {
  const pure = ["depot-path", "red-json", "resolution-evidence", "archive-precedence", "archivexl-config", "cco-model",
    "rdar-index", "resource-graph", "character-resolver"];
  for (const name of pure) {
    const code = source(name);
    for (const dependency of imports(code))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os|path)|\.\/(?:resolver-host|source-discovery|install-detection-host|browser-|studio-(?:main|startup)$|scene|studio-ui))/);
    expect(code, `${name} reaches the host`).not.toMatch(/\bBun\.(?:spawn|file|write)|\bprocess\.env\b/);
  }
});

test("the 3D preview derivation keeps definitions pure and WolvenKit in its one adapter", () => {
  const io = /^(node:(?:fs|child_process|os)|\.\/(?:process-tree|game-asset-export-wolvenkit|browser-|scene|studio-ui))/;
  for (const name of ["preview-core-recipe", "preview-core-maps", "preview-core-materials", "preview-core-assemble", "glb", "render-detail", "preview-preparation",
    "wolvenkit-setup", "wolvenkit-release"])
    for (const dependency of imports(source(name))) expect(dependency, `${name} imports ${dependency}`).not.toMatch(io);
  // The service reaches WolvenKit only through the generic export port.
  for (const dependency of imports(source("preview-core-service")))
    expect(dependency, `preview-core-service imports ${dependency}`).not.toMatch(/^(node:child_process|\.\/process-tree|\.\/game-asset-export-wolvenkit)$/);
  expect(imports(source("game-asset-export-wolvenkit"))).toContain("./wolvenkit-cli");
  // The renderer loads the core head only through the typed record loader.
  expect(source("scene")).not.toContain('fetch("/assets/head.glb")');
  expect(imports(source("scene"))).toContain("./core-detail-loader");
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
