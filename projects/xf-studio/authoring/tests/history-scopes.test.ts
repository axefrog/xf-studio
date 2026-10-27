import { expect, test } from "bun:test";
import { createHistoryService, lookScope, viewScope } from "../src/platform/core/history-service";
import { CONTROL_TRANSACTION } from "../src/platform/core/history-transaction";
import { historyCommandTitle } from "../src/studio-ui/history-model";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { profileContextStudio } from "./fixtures/profile-context-studio";

function changed(service: ReturnType<typeof createHistoryService>, id: string) {
  let value = 0;
  const scope = service.open(id, { read: () => value, apply: values => { value = values.x as number; return true; }, fingerprint: () => String(value) });
  scope.checkpoint(["x"], { label: "Change", actionKind: "test.change" }); value++;
  return { scope, value: () => value, set: (next: number) => { value = next; } };
}

test("recent scopes are detached, newest first and capped at eight including current; reads allocate and publish nothing", () => {
  const h = createHistoryService();
  const scopes = Array.from({ length: 11 }, (_, i) => changed(h, lookScope({ collection: "c", look: String(i) })));
  let events = 0; const off = h.subscribe(() => events++);
  const focus = h.focus.snapshot(), histories = scopes.map(s => s.scope.data());
  const rows = h.recentScopes(id => ({ label: `Named ${id.slice(id.lastIndexOf("/") + 1)}` }));
  expect(rows.map(r => r.scope)).toEqual(Array.from({ length: 8 }, (_, i) => `look:c/${10 - i}`));
  expect(rows[0]).toMatchObject({ current: true, label: "Named 10", owner: { kind: "look", collection: "c", look: "10" }, hasHistory: true, capability: { available: true } });
  expect(rows.slice(1).every(r => !r.current)).toBe(true);
  (rows[0]!.owner as { look: string }).look = "changed";
  expect(h.recentScopes()[0]!.owner).toEqual({ kind: "look", collection: "c", look: "10" });
  expect(h.focus.snapshot()).toEqual(focus); expect(scopes.map(s => s.scope.data())).toEqual(histories); expect(events).toBe(0);
  expect(h.selectScope("look:c/0")).toBe(false); expect(h.scope("doc:unknown")).toBeUndefined(); off();
});

test("withdrawn documents keep a named unavailable row; offering/withdrawing and ordinary focus never select or open history", () => {
  const h = createHistoryService(); changed(h, "look:c/l");
  h.documents.record("hair:g", "Evening groom", { id: "cut", label: "Cut", actionKind: "hair.cut" }, { before: 0, after: 1 });
  const off = h.participants(() => [{ id: "hair:g", dispatch: () => true }]);
  expect(h.recentScopes()[0]).toMatchObject({ scope: "doc:hair:g", label: "Evening groom", owner: { kind: "document", id: "hair:g" }, current: true, capability: { available: true } });
  const before = h.focus.recent(); off(); h.focus.focusPanel("history"); h.focus.focusView("other"); h.focus.showTab("elsewhere");
  expect(h.focus.recent()).toEqual(before);
  const rows = h.recentScopes();
  expect(rows[0]).toMatchObject({ current: false, capability: { available: false, code: "unavailable" } });
  expect(rows[0]!.capability.reason).toContain("experiment"); expect(rows[1]!.current).toBe(true);
  expect(h.selectScope("doc:hair:g")).toBe(false);
  h.documents.focus("never-recorded"); const unknown = h.scope("doc:never-recorded");
  expect(h.recentScopes().some(r => r.scope === "doc:never-recorded")).toBe(false); expect(h.scope("doc:never-recorded")).toBe(unknown);
});

test("a busy adjustment blocks scope selection atomically and settles after commit and cancel", () => {
  const h = createHistoryService(), a = changed(h, "look:c/a"), b = changed(h, "look:c/b");
  const focus = h.focus.recent(), before = b.scope.data();
  const adjustment = a.scope.begin(["x"], CONTROL_TRANSACTION);
  expect(h.recentScopes().every(row => row.capability.code === "busy")).toBe(true);
  expect(h.selectScope(b.scope.id)).toBe(false); expect(h.focus.recent()).toEqual(focus); expect(b.scope.data()).toEqual(before);
  adjustment.cancel(); expect(h.selectScope(a.scope.id)).toBe(true);
  const next = b.scope.begin(["x"], CONTROL_TRANSACTION); next.commit();
  expect(h.selectCapability(b.scope.id)).toEqual({ available: true });
});

test("external reset keeps an explanatory row, refuses old selection and resumes following after a fresh edit", () => {
  const h = createHistoryService(), a = changed(h, "look:c/a"), b = changed(h, "look:c/b");
  a.scope.clear(); const focus = h.focus.recent();
  expect(h.recentScopes().find(r => r.scope === a.scope.id)).toMatchObject({ hasHistory: false, capability: { available: false, code: "stale", reason: "History was cleared by an external change." } });
  expect(h.selectScope(a.scope.id)).toBe(false); expect(h.focus.recent()).toEqual(focus); expect(b.value()).toBe(1);
  const cancelled = a.scope.begin(["x"], CONTROL_TRANSACTION); cancelled.cancel();
  expect(h.selectCapability(a.scope.id)).toMatchObject({ available: false, code: "stale" });
  const kept = a.scope.begin(["x"], CONTROL_TRANSACTION); a.set(3);
  kept.applied(true, () => ({ label: "Fresh change", actionKind: "fresh" })); kept.commit();
  expect(h.recentScopes()[0]).toMatchObject({ scope: a.scope.id, current: true, capability: { available: true } });
});

test("retiring a target keeps metadata only; selecting never recreates its scope", () => {
  const h = createHistoryService(), a = changed(h, "look:c/a");
  h.close(a.scope.id);
  expect(h.recentScopes()[0]).toMatchObject({ scope: a.scope.id, hasHistory: true, capability: { available: false, code: "missing_target" } });
  expect(h.selectScope(a.scope.id)).toBe(false); expect(h.scope(a.scope.id)).toBeUndefined();
});

test("closing untouched scopes does not evict a retired scope still in recent history", () => {
  const h = createHistoryService(), a = changed(h, "look:c/a");
  h.close(a.scope.id);
  for (let i = 0; i < 8; i++) { const id = `look:c/untouched-${i}`; h.open(id, { read: () => 0, apply: () => true }); h.close(id); }
  expect(h.focus.recent()).toEqual([a.scope.id]);
  expect(h.recentScopes()).toMatchObject([{ scope: a.scope.id, hasHistory: true }]);
  // Retirement follows the actual recent list, so falling out of that list really does release the metadata.
  for (let i = 0; i < 8; i++) { const edited = changed(h, `look:c/edited-${i}`); h.close(edited.scope.id); }
  expect(h.recentScopes()).toHaveLength(8);
  h.focus.edited(a.scope.id);
  expect(h.recentScopes().some(row => row.scope === a.scope.id)).toBe(false);
});

test("retiring an externally cleared scope preserves its row without claiming history remains", () => {
  const h = createHistoryService(), a = changed(h, "look:c/a");
  a.scope.clear();
  expect(h.recentScopes()[0]).toMatchObject({ scope: a.scope.id, hasHistory: false });
  h.close(a.scope.id);
  expect(h.recentScopes()[0]).toMatchObject({ scope: a.scope.id, hasHistory: false, capability: { available: false } });
});

test("a failed participant publication rolls back its registration instead of leaking a provider", () => {
  const h = createHistoryService(); h.documents.focus("hair:g");
  const off = h.subscribe(() => { throw Error("subscriber failed"); });
  expect(() => h.participants(() => [{ id: "hair:g", dispatch: () => true }])).toThrow("subscriber failed");
  off(); expect(h.acting(h.focus.recent())).toBeNull();
});

test("empty histories are not offered or selectable; a view's existing history can be selected without moving it", () => {
  const h = createHistoryService();
  h.open("look:c/empty", { read: () => 0, apply: () => true }); h.focus.edited("look:c/empty");
  expect(h.recentScopes()).toEqual([]); expect(h.selectCapability("look:c/empty").available).toBe(false);
  const view = changed(h, viewScope("p")); h.focus.edited(view.scope.id); changed(h, "look:c/a");
  const before = view.scope.data();
  expect(h.selectScope(view.scope.id)).toBe(true);
  expect(h.recentScopes()[0]).toMatchObject({ label: "View and lighting", owner: { kind: "view", id: "p" }, current: true });
  expect(view.scope.data()).toEqual(before); expect(view.value()).toBe(1);
});

test("scope selection is navigation in a read-only workspace and does not grant editing permission", async () => {
  const w = await profileContextStudio();
  try {
    const eye = w.port.feature("eye-makeup"), layerId = eye.view().recipe().layers[0]!.id;
    expect(eye.dispatch({ kind: "layer.setOpacity", layerId, opacity: 0.4 }).ok).toBe(true);
    const scope = lookScope(w.looks[0]!), data = w.history.scope(scope)!.data();
    w.core.app.attach({ access: { refusal: () => ({ available: false, code: "unavailable", reason: "This workspace is read-only." }) } });
    expect(w.port.authoring.dispatch({ kind: "history.selectScope", scope })).toMatchObject({ ok: true });
    expect(w.port.authoring.dispatch({ kind: "history.undo", scope })).toMatchObject({ ok: false, code: "unavailable" });
    expect(w.history.scope(scope)!.data()).toEqual(data);
  } finally { await w.dispose(); }
});

test("registered selection navigates only: named header/keyboard Undo, focus and edit following keep their existing meaning", async () => {
  const w = await profileContextStudio();
  try {
    const a = w.bind("presets--shared").context.current(), b = w.bind("presets--unseen").context.current();
    const originalOpacity = a.feature("eye-makeup").view().recipe().layers[0]!.opacity;
    const edit = (port: typeof a, opacity: number) => {
      const eye = port.feature("eye-makeup"), layerId = eye.view().recipe().layers[0]!.id;
      expect(eye.dispatch({ kind: "layer.setOpacity", layerId, opacity }).ok).toBe(true);
    };
    edit(a, 0.2); edit(b, 0.8);
    const scopeA = lookScope(w.looks[0]!), scopeB = lookScope(w.looks[2]!), graph = JSON.stringify(w.session.session().views);
    const before = [scopeA, scopeB, viewScope(w.session.profile)].map(id => w.history.scope(id)!.data());
    const tab = w.session.focus.shownTab()!, pins = w.session.instances(tab), counters = w.counters();
    expect(w.port.authoring.dispatch({ kind: "history.selectScope", scope: scopeA })).toMatchObject({ ok: true });
    expect(w.port.focus.editing()).toEqual({ scope: scopeA, name: "Look 0-0" });
    expect(w.port.panels.historyScope("history")).toBe(scopeA);
    expect(historyCommandTitle("undo", w.port.authoring.capability({ kind: "history.undo" }), w.port.authoring.history().undo?.label,
      "Ctrl+Z", w.port.focus.editing()?.name)).toContain("Changes to Look 0-0.");
    w.port.focus.panel("history"); w.port.focus.view(w.session.session().views.views[1]!.id);
    expect(w.port.focus.editing()?.scope).toBe(scopeA);
    expect([scopeA, scopeB, viewScope(w.session.profile)].map(id => w.history.scope(id)!.data())).toEqual(before);
    expect(w.session.instances(tab)).toEqual(pins); expect(w.counters()).toEqual(counters); expect(JSON.stringify(w.session.session().views)).toBe(graph);
    expect(w.port.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
    expect(a.feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(originalOpacity);
    expect(b.feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.8);
    edit(b, 0.6); expect(w.port.focus.editing()?.scope).toBe(scopeB);
    expect(STUDIO_REGISTRY.descriptor("history.selectScope")).toMatchObject({ effect: "workspace", undo: "none", payload: { scope: { required: true, from: "target" } } });
  } finally { await w.dispose(); }
});

test("a removed look's row carries its P3-vi recovery status, rejects selection and returns on owner Restore", async () => {
  const w = await profileContextStudio();
  try {
    const port = w.bind("presets--unseen").context.current(), ref = w.looks[2]!, scope = lookScope(ref), eye = port.feature("eye-makeup");
    eye.dispatch({ kind: "layer.setOpacity", layerId: eye.view().recipe().layers[0]!.id, opacity: 0.4 });
    expect(port.library.dispatch({ kind: "preset.edit", command: { kind: "remove", id: ref.look } }).ok).toBe(true);
    const before = w.history.focus.recent(), rows = w.port.authoring.historyScopes(), removed = rows.find(r => r.scope === scope)!;
    expect(removed).toMatchObject({ label: "Look 1-0", owner: { kind: "look", ...ref }, status: { state: "removed", restore: { available: true } }, capability: { available: false, code: "missing_target" } });
    expect(w.port.authoring.dispatch({ kind: "history.selectScope", scope })).toMatchObject({ ok: false, code: "missing_target" });
    expect(w.history.focus.recent()).toEqual(before);
    expect(port.library.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
    expect(w.port.authoring.historyScopes().find(r => r.scope === scope)).toMatchObject({ status: { state: "present" }, capability: { available: true } });
  } finally { await w.dispose(); }
});

test("a real unseen control adjustment blocks selection through the root and preserves both look histories", async () => {
  const w = await profileContextStudio();
  try {
    const a = w.bind("presets--shared").context.current(), b = w.bind("presets--unseen").context.current();
    for (const port of [a, b]) { const eye = port.feature("eye-makeup"); eye.dispatch({ kind: "layer.setOpacity", layerId: eye.view().recipe().layers[0]!.id, opacity: 0.4 }); }
    const eye = b.feature("eye-makeup"), id = eye.view().recipe().layers[0]!.id;
    expect(b.authoring.controlBegin("unseen", id)).toBe(true);
    const focus = w.history.focus.recent(), data = w.history.scope(lookScope(w.looks[0]!))!.data();
    expect(w.port.authoring.historyScopes().every(row => row.capability.code === "busy")).toBe(true);
    expect(w.port.authoring.dispatch({ kind: "history.selectScope", scope: lookScope(w.looks[0]!) })).toMatchObject({ ok: false, code: "busy" });
    expect(w.history.focus.recent()).toEqual(focus); expect(w.history.scope(lookScope(w.looks[0]!))!.data()).toEqual(data);
    b.authoring.controlCancel("unseen");
    expect(w.port.authoring.dispatch({ kind: "history.selectScope", scope: lookScope(w.looks[0]!) }).ok).toBe(true);
  } finally { await w.dispose(); }
});
