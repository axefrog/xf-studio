/**
 * Deterministic `xfas/workspace-1` fixtures, written as the stored JSON earlier builds produced
 * (feature-module platform §2, migration step 2). They are plain data built from fixed recipes,
 * so they do not depend on the reader under test. `tests/golden/workspace-v1-observable.json`
 * holds what the pre-migration code restored from them.
 */
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes, defaultFineSpeckleFlakes } from "../../src/direct-glint-settings";
import { defaultFlakes } from "../../src/finish";
import { defaultStudioIrregularFlakes } from "../../src/flake-field";
import { initialRecipe, newLayerTemplate, type Layer, type Recipe } from "../../src/recipe";

/** A fixed UUID from a small number (never random). */
export const fixedId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function layer(id: string, name: string, patch: Partial<Layer>, variant = 0): Layer {
  const base = newLayerTemplate(), shift = variant % 17;
  return { ...base, id, name, ...patch,
    points: base.points.map((point, i) => ({ ...point, u: point.u + shift * 0.001 * (i + 1), v: point.v + shift * 0.0007 })),
    fields: patch.fields ?? [{ id: `${id}-w1`, u: 0.36, v: 0.23, du: 0.004 * (shift % 3), dv: -0.002, radius: 0.05 },
      { id: `${id}-w2`, u: 0.4, v: 0.24, du: 0, dv: 0.003, radius: 0.03 }] };
}

/** Recipe 11: game-matched Glossy, Colour-shifting with its shift, classic Glitter and a Satin layer. */
export function opticsRecipe(tag: string, variant = 0): Recipe {
  return { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [
    layer(`${tag}-gloss`, "Gloss", { finish: "glossy", color: "#aa3355", optics: { model: "game-matched-1" } }, variant),
    layer(`${tag}-shift`, "Shift", { finish: "iridescent", color: "#335577",
      optics: { model: "game-matched-1", shift: { color: "#12ab34", strength: 0.35 + 0.01 * (variant % 10) } } }, variant + 1),
    layer(`${tag}-glit`, "Glitter", { finish: "glitter", color: "#ddcc88", flakes: { ...defaultFlakes(), density: 0.4 } }, variant + 2),
    layer(`${tag}-satin`, "Satin", { finish: "satin", color: "#806070", opacity: 0.6 }, variant + 3),
  ] };
}

/** Recipe 10: fine, irregular and direct Glitter models side by side. */
export function glitterRecipe(tag: string, variant = 0): Recipe {
  return { schema: "xfs/recipe-10", uv: "gltf-uv0-top-left", layers: [
    layer(`${tag}-fine`, "Fine", { finish: "glitter", flakes: defaultFineSpeckleFlakes() }, variant),
    layer(`${tag}-irr`, "Irregular", { finish: "glitter", flakes: defaultStudioIrregularFlakes() }, variant + 1),
    layer(`${tag}-dir`, "Direct", { finish: "glitter", flakes: { ...defaultDirectGlintFlakes(), strength: 7 } }, variant + 2),
    layer(`${tag}-matte`, "Matte", { finish: "matte", color: "#223344", enabled: false }, variant + 3),
  ] };
}

/** A many-layer recipe for the large workspace. */
export function wideRecipe(tag: string, layers: number, variant: number): Recipe {
  const finishes: Layer["finish"][] = ["matte", "regular", "metallic", "shimmer", "glitter"];
  return { schema: "xfs/recipe-7", uv: "gltf-uv0-top-left", layers: Array.from({ length: layers }, (_, i) =>
    layer(`${tag}-l${i}`, `Layer ${i + 1}`, { finish: finishes[i % finishes.length],
      color: `#${((i * 2654435761 + variant * 97) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}`,
      opacity: 0.5 + (i % 5) * 0.1, feather: 0.004 + (i % 4) * 0.001 }, variant + i)) };
}

/** An older recipe schema (recipe-3: warp fields, legacy pigment strength) as an older build stored it. */
export function recipe3(tag: string): unknown {
  const recipe = initialRecipe();
  return { schema: "xfs/recipe-3", uv: recipe.uv, layers: recipe.layers.map(({ strength: _s, pathMode: _p, softness: _f, ...rest }) => ({
    ...rest, id: `${tag}-${rest.id}`, points: rest.points.map(({ handles: _h, feather: _pf, ...point }) => point) })) };
}

const edited = (recipe: Recipe, step: number): Recipe => ({ ...recipe, layers: recipe.layers.map((entry, i) =>
  i === step % recipe.layers.length ? { ...entry, opacity: Math.round((0.3 + (step % 7) * 0.1) * 100) / 100 } : entry) });

const preview = { textureSize: 1024, camera: { position: [0, 1.7, 0.45], target: [0, 1.68, 0], fov: 30 }, eyeShape: 4,
  surface: false, wire: true, brows: false, lashes: true, hair: false, piercings: true, normals: false, eyeOptics: true,
  piercingStyle: "", piercingDefinition: "", exposure: 1.4, lightAngle: 300, blink: 0.25, blinkPlaying: false,
  lightingPreset: "studio", creatorLighting: { intensity: 1, cone: 1, exposure: 1 }, idle: false, idleTime: 0,
  idlePaused: false, idleBody: true, idleFace: false };

/** The small fixture: every stored field the ledger and invariants name, in one workspace. */
export function smallWorkspaceV1() {
  const [p1, p2, p3, r1, q1, q2, collection, previousCollection, olderCollection] = [1, 2, 3, 4, 5, 6, 10, 11, 12].map(fixedId);
  const a = opticsRecipe("a"), b = glitterRecipe("b"), removed = opticsRecipe("r", 3), recovered = glitterRecipe("q", 2);
  return {
    schema: "xfas/workspace-1",
    // Earlier builds kept a top-level editor copy; with a collection draft it is ignored.
    recipe: initialRecipe(), active: 2, selected: 1, history: [initialRecipe()], fieldSelection: {},
    uvView: { mode: "single", side: "high", u: 0.62, v: 0.24, span: 0.3, aspect: 1.6 },
    glitterChoices: {
      [`${p1}/a-glit`]: { irregular: { ...defaultStudioIrregularFlakes(), count: 200000 }, direct: defaultDirectGlintFlakes(),
        shift: { color: "#ff00aa", strength: 0.8 } },
      [`${p1}/a-gloss`]: { shift: { color: "#00ffaa", strength: 0.25 } },
      [`${p2}/b-fine`]: { classic: { ...defaultFlakes(), cells: 64 }, clustered: defaultClusteredGlintFlakes() },
      [`${r1}/r-glit`]: { fine: defaultFineSpeckleFlakes() },
      [`${q1}/q-irr`]: { classic: defaultFlakes() },
      "draft/layer-1": { direct: { ...defaultDirectGlintFlakes(), density: 0.5 } },
      // A preset no longer in this workspace (for example in a collection that can be opened again).
      [`${fixedId(99)}/gone`]: { shift: { color: "#010203", strength: 0.1 } },
    },
    preview,
    library: { selected: p1, name: "Old look", current: { id: p1, revision: 3 } },
    uiPreferences: { theme: "dark" },
    previewSetup: { autostart: false },
    // Retired sidebar-shell fields: ignored on restore.
    panels: { sidebar: 320, open: ["layers"] },
    collections: {
      collection: { schema: "xfas/collection-1", id: collection, name: "Fixture looks", presets: [
        { id: p1, name: "Optics", revision: 3, recipe: a },
        { id: p2, name: "Glitters", revision: 1, recipe: b },
        { id: p3, name: "Old schema", revision: 2, recipe: recipe3("c") },
      ] },
      revision: 4, selected: p2, expanded: true, filesOpen: true,
      editors: {
        [p1]: { active: 1, selected: 2, fieldSelection: { "a-shift": "a-shift-w2" }, history: [edited(a, 1), edited(a, 2), edited(a, 3)],
          historyTrimmed: true },
        [p2]: { active: 2, selected: 3, fieldSelection: { "b-dir": "b-dir-w2", missing: "x" }, history: [edited(b, 0), recipe3("h")] },
        // p3 has no stored editor memory.
      },
      removed: [{ preset: { id: r1, name: "Removed", revision: 5, recipe: removed }, index: 1,
        editor: { active: 3, selected: 1, history: [edited(removed, 1)], historyTrimmed: true } }],
      previous: {
        collection: { schema: "xfas/collection-1", id: previousCollection, name: "Earlier draft", presets: [
          { id: q1, name: "Recovered", revision: 2, recipe: recovered }, { id: q2, name: "Second", revision: 1, recipe: recipe3("d") }] },
        revision: 2, selected: q2,
        editors: { [q1]: { active: 1, selected: 0, history: [edited(recovered, 4)] }, [q2]: { active: 0, selected: 2, history: [] } },
        removed: [],
      },
      older: [{ collection: { schema: "xfas/collection-1", id: olderCollection, name: "Oldest draft", presets: [] },
        editors: {}, removed: [] }],
    },
  };
}

/** The editor before any collection existed (fresh install before the library answered). */
export function looseWorkspaceV1() {
  const recipe = glitterRecipe("z", 5);
  return {
    schema: "xfas/workspace-1", recipe, active: 2, selected: 3,
    history: [recipe3("h1"), edited(recipe, 1), edited(recipe, 2)], historyTrimmed: true,
    fieldSelection: { "z-dir": "z-dir-w2" },
    uvView: { mode: "both", side: "low", u: 0.5, v: 0.25, span: 0.6 },
    glitterChoices: { "draft/z-dir": { clustered: defaultClusteredGlintFlakes(), shift: { color: "#abcdef", strength: 0.5 } } },
    preview, library: { selected: "", name: "Untitled look" }, uiPreferences: {},
  };
}

/**
 * A large workspace: six presets of `layers` layers with long Undo histories, 20 removed
 * presets and four recovery drafts, all with histories (as a build without the budget wrote).
 */
export function largeWorkspaceV1(layers = 12, depth = 80) {
  let n = 100;
  const draft = (label: string, presets: number, historyDepth: number, removedCount: number) => {
    const ids = Array.from({ length: presets }, () => fixedId(n++));
    const recipes = ids.map((_, i) => wideRecipe(`${label}${i}`, layers, i + n));
    return {
      collection: { schema: "xfas/collection-1", id: fixedId(n++), name: `Large ${label}`,
        presets: ids.map((id, i) => ({ id, name: `${label} ${i + 1}`, revision: 1 + i, recipe: recipes[i] })) },
      revision: 7, selected: ids[Math.min(2, ids.length - 1)],
      editors: Object.fromEntries(ids.map((id, i) => [id, { active: i % layers, selected: i % 3,
        fieldSelection: { [`${label}${i}-l${i % layers}`]: `${label}${i}-l${i % layers}-w2` },
        history: Array.from({ length: historyDepth + (i === 0 ? 5 : 0) }, (_, step) => edited(recipes[i], step)) }])),
      removed: Array.from({ length: removedCount }, (_, i) => {
        const recipe = wideRecipe(`${label}rm${i}`, 3, i);
        return { preset: { id: fixedId(n++), name: `Removed ${i + 1}`, revision: 1, recipe }, index: i % presets,
          editor: { active: 1, selected: 0, history: [edited(recipe, i)] } };
      }),
    };
  };
  const current = draft("cur", 6, depth, 20);
  const recovery = [draft("rec", 2, 4, 1), draft("old", 2, 3, 0), draft("older", 1, 2, 0), draft("oldest", 1, 1, 0)];
  const choices: Record<string, unknown> = {};
  for (const preset of current.collection.presets)
    for (const entry of preset.recipe.layers.filter(item => item.finish === "glitter"))
      choices[`${preset.id}/${entry.id}`] = { irregular: defaultStudioIrregularFlakes(), fine: defaultFineSpeckleFlakes(),
        shift: { color: "#123456", strength: 0.5 } };
  return { schema: "xfas/workspace-1", recipe: initialRecipe(), active: 0, selected: 0, history: [], fieldSelection: {},
    uvView: { mode: "both", side: "low", u: 0.5, v: 0.25, span: 0.6 }, glitterChoices: choices, preview,
    library: { selected: "", name: "Large" }, uiPreferences: {},
    collections: { ...current, previous: recovery[0], older: recovery.slice(1) } };
}

/** The small fixture with a damaged removed preset and a damaged recovery draft (dropped with a warning). */
export function damagedWorkspaceV1() {
  const workspace = smallWorkspaceV1() as ReturnType<typeof smallWorkspaceV1> & { collections: { removed: unknown[]; older: unknown[] } };
  workspace.collections.removed.push({ preset: { id: fixedId(40), name: "Broken", revision: 1, recipe: { schema: "xfs/recipe-7" } },
    index: 0, editor: {} });
  workspace.collections.older.unshift({ collection: { schema: "xfas/collection-1", id: "not-a-uuid", name: "x", presets: [] },
    editors: {}, removed: [] });
  return workspace;
}
