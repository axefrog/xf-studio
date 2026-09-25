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
        /^(three(?:\/|$)|\.\/(?:main|browser-|scene|uv-editor|surface-editor|raster-client|collection-transport))/);
    expect(code, `${name} reads browser globals`).not.toMatch(
      /\b(?:window|localStorage)\.|(?<!\.)\bdocument\.(?:getElementById|querySelector|createElement|body|addEventListener)/);
  }
});

test("the independent browser entry does not depend on legacy main or control modules", () => {
  const dependencies = imports(source("port-smoke"));
  expect(dependencies).not.toContain("./main");
  expect(dependencies.some(path => /\.\/(?:collection-ui|path-ui|control-edit-ui|motion-ui)$/.test(path))).toBe(false);
});

test("install detection keeps parsing pure and host access in its adapter", () => {
  for (const name of ["install-detection", "mo2-instance", "install-detection-actions", "framework-versions",
    "mo2-placement", "pe-version"]) {
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os)|\.\/(?:install-detection-host|install-detection-server|browser-|main$|scene|studio-ui))/);
  }
  // The action layer and browser device reach the host only through a typed transport.
  expect(imports(source("install-detection-actions")).filter(path => !path.startsWith("./"))).toEqual([]);
  expect(imports(source("browser-install-detection-device"))).toEqual(["./install-detection-actions"]);
});

// Dependencies point inward. Presentation modules (legacy `*-ui` controls, the
// `studio-ui/` tree) and browser entry points may import the core, never the
// reverse. `context-menu` is presentation policy shared by both shells.
const presentation = (path: string) => /^\.\/(?:[\w-]+-ui|studio-ui\/.*|context-menu)$/.test(path);
const entries = new Set(["main", "studio-main", "studio-startup", "port-smoke", "application-boundary-fixture"]);

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
  expect(imports(source("package-resources"))).toEqual(["node:crypto", "./package-bake"]);
  // Orchestration reaches WolvenKit only through the PackageResourceTools port.
  for (const name of ["package-resource-builder", "package-build-service", "package-bake"])
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(/^(node:child_process|\.\/process-tree)$/);
  for (const name of ["package-build-wolvenkit", "eye-plate-wolvenkit"])
    expect(imports(source(name))).toContain("./process-tree");
});

test("the character resolver keeps its rules pure and all host access in resolver-host", () => {
  const pure = ["depot-path", "red-json", "resolution-evidence", "archive-precedence", "archivexl-config", "cco-model",
    "rdar-index", "resource-graph", "character-resolver"];
  for (const name of pure) {
    const code = source(name);
    for (const dependency of imports(code))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os|path)|\.\/(?:resolver-host|source-discovery|install-detection-host|browser-|main$|scene|studio-ui))/);
    expect(code, `${name} reaches the host`).not.toMatch(/\bBun\.(?:spawn|file|write)|\bprocess\.env\b/);
  }
});

test("the 3D preview derivation keeps definitions pure and WolvenKit in its one adapter", () => {
  const io = /^(node:(?:fs|child_process|os)|\.\/(?:process-tree|game-asset-export-wolvenkit|browser-|scene|studio-ui))/;
  for (const name of ["preview-core-recipe", "preview-core-maps", "preview-core-materials", "preview-core-assemble", "glb", "render-detail", "preview-preparation"])
    for (const dependency of imports(source(name))) expect(dependency, `${name} imports ${dependency}`).not.toMatch(io);
  // The service reaches WolvenKit only through the generic export port.
  for (const dependency of imports(source("preview-core-service")))
    expect(dependency, `preview-core-service imports ${dependency}`).not.toMatch(/^(node:child_process|\.\/process-tree|\.\/game-asset-export-wolvenkit)$/);
  expect(imports(source("game-asset-export-wolvenkit"))).toContain("./process-tree");
  // The renderer loads the core head only through the typed record loader.
  expect(source("scene")).not.toContain('fetch("/assets/head.glb")');
  expect(imports(source("scene"))).toContain("./core-detail-loader");
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
