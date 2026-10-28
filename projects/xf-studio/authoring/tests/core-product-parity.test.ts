/** Captured from 34f34b65 before slice 13a production edits. */
import { expect, test } from "bun:test";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { lookScope } from "../src/platform/core/history-service";
import { namedCore } from "./fixtures/named-targets";

test("product document/history and captured geometry match 34f34b65", () => {
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "fixture", scope: "look:local/local" }, STUDIO_COMPOSITION));
  try {
    const read = () => ({ snapshot: core.document.snapshot(), geometry: core.geometry.recipe(), view: { active: core.presentation.active,
      selected: core.presentation.selected, field: core.presentation.selectedField()?.id }, history: core.document.history.state() });
    const scope = core.document.history, recipe = core.geometry.recipe(), layer = core.geometry.layer()!, points = layer.points, fields = layer.fields;
    const point = points[0]!, field = fields[0]!;
    const states: unknown[] = [read()];
    expect(core.app.beginGesture("uv", layer.id)).toBe(true);
    expect(core.app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: point.u + .001 } })).toBe(true);
    const identity = { recipe: core.geometry.recipe() === recipe, layer: core.geometry.layer() === layer,
      points: layer.points === points, point: layer.points[0] === point, fields: layer.fields === fields, field: layer.fields[0] === field };
    expect(Object.values(identity).every(Boolean)).toBe(true);
    core.app.endGesture("uv"); states.push(read());
    expect(scope.undo()).toBe(true); states.push(read());
    expect(scope.redo()).toBe(true); states.push(read());
    expect(core.document.history).toBe(scope);
    expect(JSON.stringify({ states, identity }, null, 2).split("\n")).toMatchSnapshot();
  } finally { core.app.dispose(); core.document.dispose(); }
});

test("keyed sharing, drawn A/B/A and captured runs match 34f34b65", async () => {
  const s = await profileContextStudio();
  const life = new AbortController();
  try {
    const a = s.authoring.contexts.acquire(s.looks[0]!, life.signal)!.context;
    const peer = s.authoring.contexts.acquire(s.looks[0]!, life.signal)!.context;
    const b = s.authoring.contexts.acquire(s.looks[1]!, life.signal)!.context;
    const scope = a.document.history;
    const read = () => ({ a: { recipe: a.document.recipe, active: a.presentation.active, selected: a.presentation.selected, history: a.document.history.state() },
      b: { recipe: b.document.recipe, history: b.document.history.state() }, drawnA: s.authoring.drawn.ref()?.look === s.looks[0]!.look });
    const sharing = { document: a.document === peer.document, projection: a.geometry === peer.geometry, history: scope === peer.document.history,
      isolated: a.document !== b.document, scope: scope === s.history.scope(lookScope(s.looks[0]!)) };
    expect(Object.values(sharing).every(Boolean)).toBe(true);
    const states: unknown[] = [read()], layer = a.document.recipe.layers[0]!;
    expect(s.core.app.beginGesture("uv", layer.id, s.looks[0])).toBe(true);
    expect(s.core.app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: layer.points[0]!.u + .001 } })).toBe(true);
    s.authoring.drawn.show(s.looks[1]); states.push(read());
    s.authoring.drawn.show(s.looks[0]); states.push(read());
    const stale = s.core.app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: .123 } });
    expect(stale).toBe(false); expect(a.document.history).toBe(scope);
    // Scope IDs are separately checked above; random collection/look IDs never enter the golden.
    const normalized = JSON.stringify({ sharing, stale, states }, (key, value) => key === "scope" && typeof value === "string" ? "look-scope" : value, 2);
    expect(normalized.split("\n")).toMatchSnapshot();
  } finally { life.abort(); await s.dispose(); s.library.close(); }
});
