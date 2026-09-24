import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
const imports = (text: string) => [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);

test("trusted application and presentation services keep browser devices outside their import boundary", () => {
  const trusted = ["studio-application", "studio-presentation", "trusted-authoring-core",
    "trusted-studio-bootstrap", "trusted-preview-services", "collection-application",
    "studio-file-operations", "authoring-preview-coordinator"];
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
  for (const name of ["install-detection", "mo2-instance", "install-detection-actions"]) {
    for (const dependency of imports(source(name)))
      expect(dependency, `${name} imports ${dependency}`).not.toMatch(
        /^(node:(?:fs|child_process|os)|\.\/(?:install-detection-host|install-detection-server|browser-|main$|scene|studio-ui))/);
  }
  // The action layer and browser device reach the host only through a typed transport.
  expect(imports(source("install-detection-actions")).filter(path => !path.startsWith("./"))).toEqual([]);
  expect(imports(source("browser-install-detection-device"))).toEqual(["./install-detection-actions"]);
});
