/**
 * Ratchets for the view-graph migration (research/authoring/view-graph-design.md). Each list records where the code still assumes
 * one 3D viewport, one flat editor or a fixed set of viewport tools. A list may only shrink: a new entry fails, and an entry that no
 * longer matches fails too, so each list is kept exact as the migration phases remove them. These are tripwires, not the design.
 */
import { expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFiles, sourceText } from "./fixtures/source-files";
import { imports, resolveFrom } from "./fixtures/import-scan";
import { codeOnly } from "./fixtures/code-scan";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
/** Every src module as a src-relative name without its extension (`platform/scene/scene-host`). */
const modules = () => sourceFiles(SRC, /\.ts$/).filter(path => !path.endsWith(".d.ts"))
  .map(path => relative(SRC, path).replace(/\\/g, "/").replace(/\.ts$/, ""));
const text = (name: string) => sourceText(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

/**
 * Modules outside `platform/scene/` that import the scene host (by value or type). The host is one renderer, one scene, one camera,
 * one light rig and one subject; the design splits it into scene, view and graph runtimes behind the scene port. Phase 3 empties this
 * list except for the browser viewport device, which becomes the graph renderer's device.
 */
const SCENE_HOST_IMPORTERS = ["browser-character-detail-device", "browser-scene-preview-ports", "browser-viewport-device", "surface-editor"];

/**
 * Modules that spell a fixed viewport-kind union (`"head" | "uv"`, `"uv" | "surface"`). Phase 1 keyed the attachment, the editor
 * adapter, the gesture sources and the adapter messages by view and host IDs; what is left are the binding scopes (a view kind
 * `view3d` scope and module-registered flat views, P6) and the head panel's key description.
 */
const FIXED_VIEWPORT_KINDS = ["input-bindings", "studio-ui/panels/viewports"];
const VIEWPORT_KIND_UNION = /"head"\s*\|\s*"uv"|"uv"\s*\|\s*"surface"|"surface"\s*\|\s*"uv"/;

/**
 * Shell presentation modules that name eye makeup's viewport tools (Surface controls, Plate wireframe) by action kind. Phase 2 makes
 * them eye makeup's view-tool contribution, so the head toolbar, its context menu, the palette and Camera & light derive them.
 */
const SHELL_NAMES_FEATURE_TOOLS = ["studio-ui/app", "studio-ui/panels/preview", "studio-ui/panels/viewports", "studio-ui/style-guide/reference",
  "studio-ui/target-menus"];
const FEATURE_TOOL_KINDS = /preview\.setSurfaceControls|preview\.setWire\b/;

test("only the listed modules outside platform/scene import the scene host (view-graph ratchet)", () => {
  const importers = modules().filter(name => !name.startsWith("platform/scene/"))
    .filter(name => imports(text(name)).some(specifier => resolveFrom(name, specifier) === "platform/scene/scene-host"));
  expect(sorted(importers)).toEqual(sorted(SCENE_HOST_IMPORTERS));
});

test("only the listed modules spell a fixed viewport-kind union (view-graph ratchet)", () => {
  expect(sorted(modules().filter(name => VIEWPORT_KIND_UNION.test(text(name))))).toEqual(sorted(FIXED_VIEWPORT_KINDS));
});

test("only the listed shell modules name eye makeup's viewport tools (view-graph ratchet)", () => {
  const shell = modules().filter(name => name.startsWith("studio-ui/"));
  expect(sorted(shell.filter(name => FEATURE_TOOL_KINDS.test(text(name))))).toEqual(sorted(SHELL_NAMES_FEATURE_TOOLS));
});

test("the ratchet patterns match what they are meant to", () => {
  expect(VIEWPORT_KIND_UNION.test(`type K = "head" | "uv";`)).toBe(true);
  expect(VIEWPORT_KIND_UNION.test(`type S = "uv" | "surface" | "preview";`)).toBe(true);
  expect(VIEWPORT_KIND_UNION.test(`type V = ViewId;`)).toBe(false);
  expect(FEATURE_TOOL_KINDS.test(`{ kind: "preview.setWire", enabled }`)).toBe(true);
  expect(FEATURE_TOOL_KINDS.test(`{ kind: "preview.setWireframe" }`)).toBe(false);
});

/*
 * Boundary rules (view-graph-design.md §6.3), each shown to fail on an injected violation. The ratchets above shrink phase by phase;
 * these hold from the phase that established them.
 */

/**
 * Rule 4 (from P1): feature renderers are view-independent. The scene port names no camera, light rig or view type, so a renderer
 * never depends on what draws it; its only per-view input will be the `viewTools` hook (P3).
 */
const VIEW_TYPES_IN_PORT = /\b(?:Camera|PerspectiveCamera|OrbitControls|Light(?:ing|Rig)\w*|ViewId|ViewRecord|ViewGraph\w*|subscribeLighting|lighting)\b/;
const portViolations = (source: string) => [...codeOnly(source).matchAll(new RegExp(VIEW_TYPES_IN_PORT, "g"))].map(match => match[0]);

test("rule 4: the scene port names no camera, light rig or view type (P1)", () => {
  expect(portViolations(text("platform/api/scene"))).toEqual([]);
  expect(portViolations(`export interface SceneHostPort { lighting(): LightingView; camera: THREE.PerspectiveCamera; view: ViewId }`))
    .toEqual(["lighting", "LightingView", "PerspectiveCamera", "ViewId"]);
  // Prose may still say what the host owns.
  expect(portViolations(`/** The host owns the camera and lights. */ export type X = 1;`)).toEqual([]);
});

/**
 * Rule 5 (from P1): camera, light, display and tool state has one owner, the view graph service. No other module keeps its own
 * copy: nothing assigns these fields on a service's state object (as `PreviewActions` did before P1).
 */
const OWNED_FIELD_WRITE = /\bthis\.(?:state|config|preview)\.(?:camera|exposure|lightAngle|lightingPreset|studioLights|creatorLighting|surface|wire|brows|lashes|hair|piercings|body)\s*(?:=[^=]|\[)/;
const ownerViolations = (sources: Record<string, string>) => Object.entries(sources).filter(([, source]) => OWNED_FIELD_WRITE.test(codeOnly(source))).map(([name]) => name);

test("rule 5: only the view graph service stores camera, light, display and tool state (P1)", () => {
  expect(ownerViolations(Object.fromEntries(modules().map(name => [name, text(name)])))).toEqual([]);
  expect(ownerViolations({ "preview-actions": `class P { run() { this.state.lightingPreset = "creator"; } }`,
    "other": `class Q { read() { return this.state.exposure === 1; } }` })).toEqual(["preview-actions"]);
  // The graph service is the owner, and preview actions read it.
  expect(text("preview-actions")).toMatch(/private readonly graph: ViewGraph/);
});
