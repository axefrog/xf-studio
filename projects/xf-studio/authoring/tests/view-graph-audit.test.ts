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
 * Modules that spell a fixed viewport-kind union (`"head" | "uv"`, `"uv" | "surface"`): the attachment's two hosts, the gesture
 * sources, the binding scopes and the adapter messages. Phase 1 replaces them with view IDs and module-registered view kinds.
 */
const FIXED_VIEWPORT_KINDS = ["authoring-gestures", "browser-viewport-device", "input-bindings", "presentation-status", "studio-startup",
  "studio-ui/panels/viewports", "viewport-adapter", "viewport-attachment"];
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
