import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { EyeMakeupViewContext } from "../src/features/eye-makeup/view/actions";
import type { PanelController } from "../src/studio-ui/panels/collection";
import type { StudioRuntime } from "../src/studio-ui/runtime";
import type { FeatureViewFactory } from "../src/studio-ui/views/feature-view";
import type { EyeMakeupFacade } from "../src/studio-presentation";
import { importUses, imports, resolveFrom } from "./fixtures/import-scan";
import { sourceFiles, sourceText } from "./fixtures/source-files";

const root = resolve(import.meta.dir, "..", "src");
const ui = join(root, "studio-ui");
/** Every `.ts` file under `dir`, listed once per test process (tests/fixtures/source-files.ts). */
const files = (dir: string) => [...sourceFiles(dir)];
/** A file's text, read once per test process. */
const readFileSync = (path: string, _encoding?: "utf8") => sourceText(path);
/** A file's src-relative module name (`features/eye-makeup/view/layers`). */
const moduleOf = (file: string) => relative(root, file).replaceAll("\\", "/").replace(/\.ts$/, "");
/** Each feature's view folder (`features/<id>/view/`): presentation under the same rules as studio-ui (platform §7 rule 4). */
const views = readdirSync(join(root, "features")).map(id => join(root, "features", id, "view"))
  .filter(dir => { try { return statSync(dir).isDirectory(); } catch { return false; } });

/**
 * Value imports the presentation may take from the core: pure helpers with no state or I/O. Everything
 * else from the core must be `import type`. Exceptions are recorded in research/authoring/ui-architecture-boundary.md.
 */
const CORE_VALUES = new Map<string, readonly string[]>([
  ["context-menu", ["allowsNativeTextMenu"]],
  ["ui-preferences", ["effectiveTheme", "recoverDockLayout"]],
  ["mod-branding", ["EYE_MAKEUP_MOD"]],
  // The pure input binding catalogue: hint/cursor/label derivation and key matching.
  ["input-bindings", ["bindingReference", "chordLabel", "chordsLabel", "cursorFor", "editingReference", "KEY_BINDINGS", "keyBinding",
    "keyBindingById", "modifierKey", "modifiersOf", "panelModifiersHeld", "pointerBinding", "shortcutLabel", "TARGET_LABELS", "targetTip", "viewportHints"]],
]);
/**
 * What a feature's view may take by value from the shell (UI-73, UI-74): the stateless presentation toolkit
 * (`*`: any export) and a few named helpers. The shell's runtime, menus, palette, guidance, dock and the
 * context builder are not the view's: it reaches the shell only through its `FeatureViewContext`.
 */
const VIEW_TOOLKIT = new Map<string, readonly string[]>([
  ["studio-ui/controls", ["*"]], ["studio-ui/dom", ["*"]], ["studio-ui/icons", ["*"]], ["studio-ui/item-list", ["*"]],
  ["studio-ui/panels/viewports", ["contextMenuGate", "keyDescription"]],
  ["studio-ui/views/contribution", ["panelMeta"]],
  ["studio-ui/views/feature-view", ["featureView"]],
]);
/** Where a presentation module lives: the shell (all of studio-ui is its own) or a feature's view (only its folder). */
type Scope = { own: readonly string[]; allow: ReadonlyMap<string, readonly string[]> };
const SHELL: Scope = { own: ["studio-ui/"], allow: CORE_VALUES };
const viewScope = (view: string): Scope => ({ own: [`${view}/`], allow: new Map([...CORE_VALUES, ...VIEW_TOOLKIT]) });

/**
 * The value imports of one presentation module that its scope does not allow: every form counts (static
 * imports, value re-exports, `export *`, side-effect and dynamic imports, `require` and `import.meta.require`);
 * only `import type`, `export type` and inline type references are free.
 */
function valueImportProblems(module: string, source: string, scope: Scope): string[] {
  const problems: string[] = [];
  for (const use of importUses(source)) {
    if (use.typeOnly) continue;
    const target = resolveFrom(module, use.specifier);
    if (scope.own.some(dir => target.startsWith(dir))) continue;
    const allowed = scope.allow.get(target) ?? [];
    const extra = use.names.filter(name => !allowed.includes("*") && !allowed.includes(name));
    if (extra.length) problems.push(`${module} imports ${extra.join(", ")} from ${target}`);
  }
  for (const forbidden of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\(/, /new Worker\(/])
    if (forbidden.test(source)) problems.push(`${module} uses ${forbidden}`);
  return problems;
}
/** The presentation's modules: the shell and every feature's view, each with its scope. */
const presentation = () => [...files(ui).map(file => ({ file, scope: SHELL })),
  ...views.flatMap(view => files(view).map(file => ({ file, scope: viewScope(moduleOf(view)) })))];

test("the value-import scan sees every import form (UI-74)", () => {
  const scope = viewScope("features/eye-makeup/view"), module = "features/eye-makeup/view/probe";
  const scan = (code: string) => valueImportProblems(module, code, scope);
  // Probe F: a value re-export of an engine from a view.
  expect(scan(`export { parseRecipe as __probeF } from "../../../engines/layered-makeup/recipe";`))
    .toEqual([`${module} imports parseRecipe from engines/layered-makeup/recipe`]);
  expect(scan(`export * from "../../../studio-application";`)).toEqual([`${module} imports * from studio-application`]);
  // Probe E: a dynamic import of a trusted service, and the CommonJS and Bun forms.
  expect(scan(`const svc = await import("../../../collection-service");`)).toEqual([`${module} imports <dynamic> from collection-service`]);
  expect(scan(`const svc = require("../../../collection-service");`)).toEqual([`${module} imports <require> from collection-service`]);
  expect(scan(`const scene = import.meta.require("../../../scene");`)).toEqual([`${module} imports <require> from scene`]);
  expect(scan(`import "../../../scene";`)).toEqual([`${module} imports <side effect> from scene`]);
  expect(scan(`import * as recipe from "../../../engines/layered-makeup/recipe";`)).toEqual([`${module} imports * from engines/layered-makeup/recipe`]);
  expect(scan(`import Default, { shortcutLabel } from "../../../input-bindings";`)).toEqual([`${module} imports default from input-bindings`]);
  expect(scan(`import {\n  shortcutLabel,\n  collectionMenu,\n} from "../../../input-bindings";`)).toEqual([`${module} imports collectionMenu from input-bindings`]);
  // The shell's runtime-taking modules are not the view's toolkit.
  expect(scan(`import { viewportMenu } from "../../../studio-ui/target-menus";`)).toEqual([`${module} imports viewportMenu from studio-ui/target-menus`]);
  expect(scan(`import { StudioRuntime } from "../../../studio-ui/runtime";`)).toEqual([`${module} imports StudioRuntime from studio-ui/runtime`]);
  // Types, re-exported types, inline type references and the view's own folder are free; so is the toolkit.
  expect(scan([`import type { Layer } from "../../../engines/layered-makeup/recipe";`, `export type { Recipe } from "../../../engines/layered-makeup/recipe";`,
    `import { type Recipe, shortcutLabel } from "../../../input-bindings";`, `let t: typeof import("../../../scene");`,
    `type T = import("../../../scene").Scene;`, `export { EYE_MAKEUP_VIEW } from "./contribution";`,
    `import { h, setText } from "../../../studio-ui/dom";`, `import { featureView } from "../../../studio-ui/views/feature-view";`].join("\n"))).toEqual([]);
  // The specifier scan the architecture test shares sees the same forms.
  expect(imports(`const a = require("./a"); const b = import.meta.require("./b"); export { c } from "./c"; const r = requires("./x");`))
    .toEqual(["./a", "./b", "./c"]);
});

test("studio-ui and feature views import only types from the core plus documented allowlists of pure helpers", () => {
  expect(views.map(view => moduleOf(view))).toContain("features/eye-makeup/view");
  const problems = presentation().flatMap(({ file, scope }) => valueImportProblems(moduleOf(file), readFileSync(file, "utf8"), scope));
  expect(problems).toEqual([]);
  // Nothing in the presentation reaches three.js, by any import form.
  for (const { file } of presentation()) expect(imports(readFileSync(file, "utf8")).filter(path => /^three(\/|$)/.test(path)), moduleOf(file)).toEqual([]);
});

test("the presentation never imports the composition root, trusted services or live document modules", () => {
  const banned = /^(studio-main|studio-startup|trusted-[a-z-]+|authoring-document|authoring-geometry|scene|collection-service|collection-application|studio-file-operations|browser-[a-z-]+|compose\/[a-z-]+)$/;
  for (const { file } of presentation()) {
    const module = moduleOf(file);
    // Every value form (static, re-export, dynamic, require); types alone carry no service.
    const values = importUses(readFileSync(file, "utf8")).filter(use => !use.typeOnly)
      .map(use => resolveFrom(module, use.specifier)).filter(target => banned.test(target));
    expect({ module, values }).toEqual({ module, values: [] });
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

/**
 * The text backstop of the facade-only rule (UI-52, UI-73). The primary guarantee is the type: a feature's
 * panel factories receive a `FeatureViewContext` with no port, runtime or other facade (see the type probes
 * below). This catches what a cast (`as never`, `as any`) would slip past the types.
 */
function facadeProblems(where: string, source: string, route: (kind: string) => "platform" | "feature" | "unknown"): string[] {
  const problems: string[] = [];
  if (/\bStudioRuntime\b/.test(source)) problems.push(`${where} names the shell's runtime`);
  if (/\bport\b/.test(source)) problems.push(`${where} reaches the presentation port`);
  // Probe E took it through a local (`const shell = rt.port.authoring`), so the member access alone counts.
  if (/\.authoring\b|\bauthoring\s*\./.test(source)) problems.push(`${where} uses port.authoring`);
  if (/\.feature\s*\(|\bfeatures\s*\(/.test(source)) problems.push(`${where} looks up a feature's facade`);
  // `platform` is for platform actions the view offers (add a preset); never the feature's own kinds.
  for (const match of source.matchAll(/\.platform\(\s*\{\s*kind:\s*"([^"]+)"/g)) {
    const owner = route(match[1]);
    if (owner === "unknown") problems.push(`${where} dispatches unknown ${match[1]}`);
    else if (owner === "feature") problems.push(`${where} dispatches ${match[1]} past its facade`);
  }
  if (/\.platform\b(?!\(\s*\{\s*kind:\s*")|[{,]\s*platform\s*[,}:]/.test(source)) problems.push(`${where} passes the platform dispatch around or computes its action`);
  return problems;
}

test("a feature view acts only through its own facade (UI-52, UI-73)", async () => {
  const { STUDIO_REGISTRY } = await import("../src/compose/studio-registry");
  const route = (kind: string) => {
    const found = STUDIO_REGISTRY.route(kind);
    return !found.ok ? "unknown" as const : (found.owner as { owner?: string }).owner === "feature" ? "feature" as const : "platform" as const;
  };
  // The review's probes (UI-73): each is caught by the scans (and, without its casts, by the types).
  const probeE = `
    export async function __probeE(rt: StudioRuntime) {
      const shell = rt.port.authoring; shell.dispatch({ kind: "layer.edit", command: { kind: "add" } } as never);
      rt.port.feature("some-other-feature" as never);
    }
    export function __probeE2(ctx: EyeMakeupViewContext) {
      const d = ctx.platform.bind(ctx); d({ kind: "layer.edit", command: { kind: "add" } } as never);
      const { platform } = ctx;
    }`;
  expect(facadeProblems("probe", probeE, route)).toEqual(["probe names the shell's runtime", "probe reaches the presentation port",
    "probe uses port.authoring", "probe looks up a feature's facade", "probe passes the platform dispatch around or computes its action"]);
  expect(facadeProblems("probe", `const c = (ctx: EyeMakeupViewContext) => ctx.platform({ kind: "layer.edit", command: { kind: "add" } } as never);`, route))
    .toEqual(["probe dispatches layer.edit past its facade"]);
  expect(facadeProblems("probe", `ctx.platform({ kind: "nothing.here" } as never);`, route)).toEqual(["probe dispatches unknown nothing.here"]);
  expect(facadeProblems("probe", `ctx.platform({ kind: "preset.edit", command: { kind: "add" } });`, route)).toEqual([]);

  const problems = views.flatMap(view => files(view).map(file => facadeProblems(moduleOf(file), readFileSync(file, "utf8"), route))).flat();
  expect(problems).toEqual([]);
  // The context's dispatch is the facade's own.
  const context = readFileSync(join(ui, "views", "feature-context.ts"), "utf8");
  expect(context).toContain("rt.report(action.kind, facade.dispatch(action), options)");
});

/**
 * Type-level probes (UI-73): `bun run check` fails if any line under `@ts-expect-error` compiles, so these are
 * the structural half of the facade-only rule. Never called.
 */
export function typeProbes(ctx: EyeMakeupViewContext, facade: EyeMakeupFacade, fromRuntime: (rt: StudioRuntime) => PanelController) {
  // @ts-expect-error a view's context has no presentation port
  void ctx.port;
  // @ts-expect-error nor a lookup of another feature's facade
  void ctx.feature;
  // @ts-expect-error the context's dispatch takes only eye makeup's own kinds
  ctx.dispatch({ kind: "camera.front" });
  // @ts-expect-error the platform dispatch refuses a feature's kinds
  ctx.platform({ kind: "layer.edit", command: { kind: "add" } });
  const bound = ctx.platform.bind(ctx);
  // @ts-expect-error bound or not (probe E's `rt.dispatch.bind(rt)`)
  bound({ kind: "layer.edit", command: { kind: "add" } });
  // @ts-expect-error the facade takes only its own kinds too
  facade.dispatch({ kind: "preset.edit", command: { kind: "add" } });
  // @ts-expect-error a feature panel factory is handed its context, never the shell's runtime
  const factory: FeatureViewFactory<EyeMakeupFacade> = fromRuntime;
  // What the view may do compiles: its own kinds through the facade, a platform action through the shell.
  ctx.dispatch({ kind: "layer.edit", command: { kind: "add" } });
  ctx.platform({ kind: "preset.edit", command: { kind: "add" } });
  return factory;
}
