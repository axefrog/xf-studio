import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "src");
const ui = join(root, "studio-ui");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}
/**
 * Value imports the presentation may take from outside studio-ui: pure helpers
 * with no state or I/O. Everything else from the core must be `import type`.
 * Exceptions are recorded in research/authoring/ui-architecture-boundary.md.
 */
const valueAllowlist = new Map<string, string[]>([
  ["context-menu", ["allowsNativeTextMenu"]],
  ["ui-preferences", ["effectiveTheme", "recoverDockLayout"]],
  ["uv-view", ["uvAspect"]],
  ["flake-field", ["FLAKE_LIMITS", "REGION_FLAKE_STUDY_LIMITS"]],
]);

test("studio-ui imports only types from the core plus a documented allowlist of pure helpers", () => {
  const problems: string[] = [];
  for (const file of files(ui)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(type\s+)?\{?([^}]*?)\}?\s*from\s+"([^"]+)";/gms)) {
      const [, typeOnly, names, specifier] = match;
      const target = resolve(file, "..", specifier);
      if (target.startsWith(ui)) continue;
      const module = relative(root, target).replaceAll("\\", "/");
      if (typeOnly) continue;
      const values = names.split(",").map(name => name.trim()).filter(name => name && !name.startsWith("type "));
      const allowed = valueAllowlist.get(module) ?? [];
      const extra = values.filter(name => !allowed.includes(name.split(/\s+as\s+/)[0]));
      if (extra.length) problems.push(`${relative(root, file)} imports ${extra.join(", ")} from ${module}`);
    }
    for (const forbidden of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\(/, /new Worker\(/, /from "three"/])
      if (forbidden.test(source)) problems.push(`${relative(root, file)} uses ${forbidden}`);
  }
  expect(problems).toEqual([]);
});

test("the presentation never imports trusted composition, legacy shell or live document modules", () => {
  const banned = /from "\.\.\/(\.\.\/)?(main|studio-main|trusted-[a-z-]+|authoring-document|authoring-geometry|scene|collection-service|collection-application|studio-file-operations|browser-[a-z-]+)"/;
  for (const file of files(ui)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n").filter(line => banned.test(line) && !line.startsWith("import type"));
    expect({ file: relative(root, file), lines }).toEqual({ file: relative(root, file), lines: [] });
  }
});

test("the composition root hands the view only the public presentation port", () => {
  const source = readFileSync(join(root, "studio-main.ts"), "utf8");
  expect(source).toContain("bootstrap.mount(publicPort => { port = publicPort; mountStudio(publicPort, root); })");
  expect((source.match(/mountStudio\(/g) ?? []).length).toBe(1);
  const importers = files(root).filter(file => !file.startsWith(ui) && readFileSync(file, "utf8").includes("studio-ui/app"));
  expect(importers.map(file => relative(root, file))).toEqual(["studio-main.ts"]);
});
