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
/** Each feature's view folder (`features/<id>/view/`): presentation under the same rules as studio-ui (platform §7 rule 4). */
const views = readdirSync(join(root, "features")).map(id => join(root, "features", id, "view"))
  .filter(dir => { try { return statSync(dir).isDirectory(); } catch { return false; } });
/** The presentation's modules: the shell and every feature's view, each with the folders it may import freely. */
const presentation = () => [...files(ui).map(file => ({ file, own: [ui] })), ...views.flatMap(view => files(view).map(file => ({ file, own: [ui, view] })))];
/**
 * Value imports the presentation may take from outside studio-ui: pure helpers
 * with no state or I/O. Everything else from the core must be `import type`.
 * Exceptions are recorded in research/authoring/ui-architecture-boundary.md.
 */
const valueAllowlist = new Map<string, string[]>([
  ["context-menu", ["allowsNativeTextMenu"]],
  ["ui-preferences", ["effectiveTheme", "recoverDockLayout"]],
  ["mod-branding", ["EYE_MAKEUP_MOD"]],
  // The pure input binding catalogue: hint/cursor/label derivation and key matching.
  ["input-bindings", ["bindingReference", "chordLabel", "chordsLabel", "cursorFor", "editingReference", "KEY_BINDINGS", "keyBinding",
    "keyBindingById", "modifierKey", "modifiersOf", "panelModifiersHeld", "pointerBinding", "shortcutLabel", "TARGET_LABELS", "targetTip", "viewportHints"]],
]);

test("studio-ui and feature views import only types from the core plus a documented allowlist of pure helpers", () => {
  expect(views.map(view => relative(root, view).replaceAll("\\", "/"))).toContain("features/eye-makeup/view");
  const problems: string[] = [];
  for (const { file, own } of presentation()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(type\s+)?\{?([^}]*?)\}?\s*from\s+"([^"]+)";/gms)) {
      const [, typeOnly, names, specifier] = match;
      const target = resolve(file, "..", specifier);
      if (own.some(dir => target.startsWith(dir))) continue;
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

test("the presentation never imports the composition root, trusted services or live document modules", () => {
  const banned = /from "(?:\.\.\/)+(studio-main|studio-startup|trusted-[a-z-]+|authoring-document|authoring-geometry|scene|collection-service|collection-application|studio-file-operations|browser-[a-z-]+|compose\/[a-z-]+)"/;
  for (const { file } of presentation()) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n").filter(line => banned.test(line) && !line.startsWith("import type"));
    expect({ file: relative(root, file), lines }).toEqual({ file: relative(root, file), lines: [] });
  }
});

test("the one composition root hands the view only the public presentation port", () => {
  const source = readFileSync(join(root, "studio-startup.ts"), "utf8");
  expect(source).toContain("bootstrap.mount(publicPort => { port = publicPort; mountStudio(publicPort, root, STUDIO_VIEW_COMPOSITION); })");
  expect((source.match(/mountStudio\(/g) ?? []).length).toBe(1);
  const importers = files(root).filter(file => !file.startsWith(ui) && readFileSync(file, "utf8").includes("studio-ui/app"));
  expect(importers.map(file => relative(root, file))).toEqual(["studio-startup.ts"]);
  // Host differences arrive as a typed host object, never as page globals or data attributes.
  for (const name of ["studio-startup.ts", "studio-main.ts"])
    expect(readFileSync(join(root, name), "utf8")).not.toMatch(/\bdataset\b|xfDesktop|xfs-desktop/);
});

test("a feature view acts only through its own facade (UI-52)", async () => {
  const { STUDIO_REGISTRY } = await import("../src/compose/studio-registry");
  const problems: string[] = [];
  for (const view of views) {
    const feature = relative(join(root, "features"), view).split(/[\\/]/)[0];
    for (const file of files(view)) {
      const source = readFileSync(file, "utf8"), where = relative(root, file).replaceAll("\\", "/");
      // The port's application-wide surface (`port.authoring`) is not the view's: dispatch, capability, limits, choices
      // and per-target capability go through the feature's facade (`rt.eyeMakeup`, `port.feature(id)`).
      if (/\bauthoring\s*\./.test(source)) problems.push(`${where} uses port.authoring`);
      if (/\brt\.addLayerCapability\b/.test(source)) problems.push(`${where} asks the shell for a feature capability`);
      // The shell's dispatch is for platform actions the view offers (add a preset, Undo); never for the feature's own kinds.
      for (const match of source.matchAll(/\brt\.dispatch\(\s*\{\s*kind:\s*"([^"]+)"/g)) {
        const route = STUDIO_REGISTRY.route(match[1]);
        if (!route.ok) problems.push(`${where} dispatches unknown ${match[1]}`);
        else if (route.owner.id === feature || (route.owner as { owner?: string }).owner === "feature") problems.push(`${where} dispatches ${match[1]} past its facade`);
      }
      if (/\brt\.dispatch\((?!\s*\{\s*kind:\s*")/.test(source)) problems.push(`${where} dispatches a computed action through the shell`);
    }
  }
  expect(problems).toEqual([]);
  // The helper the views use is the facade's own dispatch.
  const actions = readFileSync(join(root, "features", "eye-makeup", "view", "actions.ts"), "utf8");
  expect(actions).toContain("rt.report(action.kind, facade.dispatch(action), options)");
});
