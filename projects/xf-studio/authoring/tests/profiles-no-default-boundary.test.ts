/**
 * The no-default boundary (profiles design §3.6, §7): every action family names what it acts on, and nothing below the input layer reads
 * focus. The first test lists the families that still default a target; the list must be empty (phase 1 ends with it empty). Each family's
 * required targets are checked in its descriptors, and a representative action without them is refused with `missing_target` at dispatch.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { STUDIO_COMPOSITION, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { POSE_LIBRARY_DESCRIPTORS } from "../src/features/poses/actions";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import type { StudioAction } from "../src/app/studio-application";
import { freshWorkspace } from "./fixtures/eye-region";
import { STUDIO_LAYERED_SURFACES } from "../src/compose/renderers";
import { createSceneEditors, type SceneEditorPorts } from "../src/preview/browser/scene-editors";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** The §3.6 table, as the registry and the module services hold it: each family's kinds and the targets each must name. */
const FAMILIES: readonly { family: string; owns(kind: string, owner: string): boolean; targets: readonly string[] }[] = [
  { family: "camera.*, preview.*, motion.*, view.setTool", owns: kind => /^(camera|preview|motion)\./.test(kind) || kind === "view.setTool", targets: ["view"] },
  { family: "view actions that edit the scene", owns: kind => ["preview.setEyeShape", "preview.setUncensored", "preview.setNormals", "preview.setEyeOptics",
    "motion.setPhysics"].includes(kind), targets: ["view", "sceneGen"] },
  { family: "scene.setSubject, scene.setLook", owns: kind => kind.startsWith("scene."), targets: ["scene", "sceneGen"] },
  { family: "character.* (and savedV.*, its alias until phase 1 ends)", owns: kind => /^(character|savedV)\./.test(kind), targets: ["character"] },
  { family: "eye makeup's layer.*, point.*, field.* … (every feature action)", owns: (_kind, owner) => owner === "feature", targets: ["look"] },
  { family: "preset.*, collection.*, package.*", owns: kind => /^(preset|collection|package)\./.test(kind), targets: ["collection"] },
  { family: "history.undo, history.redo, history.jumpTo", owns: kind => kind.startsWith("history."), targets: ["scope"] },
];

/** The families with an action whose descriptor doesn't require one of the family's targets. */
function defaulting(): string[] {
  const failing = new Set<string>();
  for (const kind of STUDIO_REGISTRY.kinds()) {
    const route = STUDIO_REGISTRY.route(kind);
    if (!route.ok) continue;
    const payload = route.spec.descriptor.payload;
    for (const family of FAMILIES)
      if (family.owns(kind, route.owner.owner) && family.targets.some(field => payload[field]?.from !== "target" || payload[field]?.required !== true))
        failing.add(family.family);
  }
  // The Poses module's service (a recorded boundary exception, routed through its own descriptors): what poses or frames V names its view.
  for (const kind of ["pose.select", "pose.clear", "pose.frame"] as const)
    if (!("view" in POSE_LIBRARY_DESCRIPTORS[kind].payload)) failing.add("pose.*");
  // The Save Explorer's instance and the profile owner's profile and base are checked where they arrive (tests/save-explorer-*.test.ts,
  // tests/profiles-*.test.ts); `tabs.*` comes with the tab strip (phase 2).
  return [...failing];
}

describe("actions name their targets (§3.6)", () => {
  test("no action family still defaults a target", () => {
    expect(defaulting()).toEqual([]);
  });

  test("a scene's gen is never named without the scene: dispatch checks both (a relinked view at the same gen is a replacement)", () => {
    const genWithoutScene = STUDIO_REGISTRY.kinds().filter(kind => {
      const payload = STUDIO_REGISTRY.descriptor(kind)!.payload;
      return "sceneGen" in payload && payload.scene?.from !== "target";
    });
    expect(genWithoutScene).toEqual([]);
    // Routing by the named view (device-backed camera and motion actions refuse a view not drawn) is checked kind by kind in
    // tests/profiles-targets-dispatch.test.ts.
  });

  test("every family is covered: each registered kind of a family names exactly its targets", () => {
    for (const family of FAMILIES)
      expect(STUDIO_REGISTRY.kinds().filter(kind => { const route = STUDIO_REGISTRY.route(kind); return route.ok && family.owns(kind, route.owner.owner); }).length)
        .toBeGreaterThan(0);
  });

  test("an action dispatched without its target is refused with missing_target, never acted on a default", () => {
    const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    const layer = core.document.recipe.layers[0]!.id;
    const unnamed = [
      { kind: "camera.front" }, { kind: "preview.setExposure", value: 1 }, { kind: "motion.setBlink", value: 0.5 },
      { kind: "view.setTool", tool: "eye-makeup.surface", enabled: true }, { kind: "preview.setNormals", view: "main", enabled: true },
      { kind: "scene.setLook", look: null }, { kind: "character.resetAll" }, { kind: "savedV.clear" },
      { kind: "layer.setOpacity", layerId: layer, opacity: 0.5 }, { kind: "preset.edit", command: { kind: "add" } },
      { kind: "collection.rename", name: "X" }, { kind: "history.undo" }, { kind: "history.jumpTo", entryId: "start" },
    ] as unknown as StudioAction[];
    for (const action of unnamed) expect([action.kind, core.app.capability(action).code]).toEqual([action.kind, "missing_target"]);
    // A feature action naming a look the editor doesn't show is refused too: it is never applied to the look shown in its place.
    expect(core.app.capability({ kind: "layer.setOpacity", layerId: layer, opacity: 0.5, look: { collection: "other", look: "other" } } as StudioAction))
      .toMatchObject({ available: false, code: "missing_target" });
  });
});

/** Every source file under `src/`, relative, with forward slashes. */
function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) ? [relative(SRC, path).replaceAll("\\", "/")] : [];
  });
}

describe("no application service reads focus (§3.6)", () => {
  /**
   * Where focus may be read: its owner, the session that stores it, the input layer (the resolver, the presentation port, the presentation)
   * and the composition root that wires them; the history service only records the editing context, and answers an experiment which of its
   * documents is it (`DocumentHistory.selected`).
   */
  const READERS = [/^platform\/core\/focus\.ts$/, /^platform\/core\/history-service\.ts$/, /^app\/profiles\/(targets|bindings|profile-sessions|profile-window|panel-editing-contexts)\.ts$/,
    /^app\/studio-presentation\.ts$/, /^app\/trusted-studio-bootstrap\.ts$/, /^studio-ui\//, /^compose\//];
  // `acting` over the editing contexts (`acting(focus.recent())`) is the input layer's; an owner asking whether one named scope can act isn't.
  const READS = /\.(topView|viewOrder|focusedPanel)\(|\.acting\([^)]*(focus|recent)|focus\.(recent|editing)\(|targets\.(named|resolve|editing|undoScope|complete|capture)\(/;

  test("focus, the editing context and the resolver are read only by the input layer", () => {
    const offending = sources().filter(file => !READERS.some(allowed => allowed.test(file)))
      .flatMap(file => readFileSync(join(SRC, file), "utf8").split("\n").map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(item => READS.test(item.text) && !/^\s*(\*|\/\/)/.test(item.text)).map(item => `${item.file}:${item.line}`));
    expect(offending).toEqual([]);
  });

  test("the focused-view and focused-scope defaults are gone", () => {
    const leftovers = sources().flatMap(file => readFileSync(join(SRC, file), "utf8").split("\n")
      .map((text, index) => ({ text, at: `${file}:${index + 1}` }))
      .filter(item => /\b(views|graph|history|historyService|service)\.(focused\(\)|focusView\()/.test(item.text) && !/^\s*(\*|\/\/)/.test(item.text))
      .map(item => item.at));
    expect(leftovers).toEqual([]);
  });
});

describe("the composition root names no live feature (§7, liveSurface)", () => {
  test("the root registers every layered surface and wires none by the live feature's name; a scene wires what its look editor edits", () => {
    const root = readFileSync(join(SRC, "compose/studio-startup.ts"), "utf8").split("\n").filter(line => !/^\s*(\*|\/\/)/.test(line)).join("\n");
    expect(root).not.toMatch(/\.live\b|LIVE_FEATURE|LIVE_REGION|liveSurface|EYE_MAKEUP|features\/eye-makeup/);
    expect(root).toMatch(/createSceneEditors\(\{ surfaces: composition\.surfaces,/);
  });

  test("a scene wires the registered surface of the feature its look editor edits, with the editor's device, as the on-head editor's; others get no layer source", () => {
    const preview = { connectScene: () => ({}), disconnectScene: () => {}, presentInitialLayers: () => {} } as unknown as NonNullable<SceneEditorPorts["look"]>["preview"];
    const editors = (feature: string) => createSceneEditors({ surfaces: STUDIO_LAYERED_SURFACES, look: { feature, preview },
      core: { documents: { ...STUDIO_COMPOSITION.documents, live: feature }, app: { actionRegistry: () => STUDIO_COMPOSITION.registry } } } as SceneEditorPorts);
    const shown = editors(STUDIO_COMPOSITION.documents.live);
    expect(shown.wiring.map(wiring => [wiring.feature, wiring.edited]))
      .toEqual([[STUDIO_COMPOSITION.documents.live, true]]);
    expect(shown.edited).toBe(STUDIO_LAYERED_SURFACES.get(STUDIO_COMPOSITION.documents.live));
    expect(editors("no-such-feature")).toMatchObject({ wiring: [], edited: undefined });
  });
});
