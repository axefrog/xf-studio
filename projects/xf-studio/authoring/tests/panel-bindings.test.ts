import { expect, test } from "bun:test";
import { PanelActions } from "../src/app/profiles/panel-actions";
import type { PanelAction } from "../src/app/profiles/panel-actions";
import type { PanelBinding } from "../src/app/profiles/profile-session";
import type { PanelContext } from "../src/platform/api/subjects";
import type { ViewRecord } from "../src/platform/api/view-graph";
import type { BindingTargetOption, PanelBindingSnapshot } from "../src/app/profiles/panel-bindings";
import { resolveBinding, type BindingWorld } from "../src/app/profiles/bindings";
import { viewScope } from "../src/platform/core/history-service";
import { fragmentOfTab, substitutionOf, fillOf, instantiateFragment } from "../src/app/profiles/layout-fragment";
import { CollectionOwner } from "../src/library/collection-owner";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { expectCaptureStable } from "./fixtures/capture-ownership";
import { PanelEditingContexts } from "../src/app/profiles/panel-editing-contexts";
import type { FileWriter, StudioFileOperations } from "../src/app/studio-file-operations";

type Studio = Awaited<ReturnType<typeof profileContextStudio>>;
const viewRecords = (w: Studio) => w.session.session().views.views as readonly (ViewRecord & { tab: string })[];
type BindingAction = Extract<PanelAction, { kind: "panels.setBinding" }>;
const pinned = (target: Extract<PanelBinding, { policy: "pinned" }>["target"]): Extract<PanelBinding, { policy: "pinned" }> => ({ policy: "pinned", target });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const candidate = (snapshot: PanelBindingSnapshot, binding: PanelBinding) => snapshot.candidates.find(row => same(row.binding, binding))!;
const capture = (w: Studio, instance = "presets--shared") => { const life = new AbortController(); return { life, snapshot: w.port.panels.bindings!.capture(instance, life.signal) }; };
const state = (w: Studio) => JSON.stringify({ session: w.session.session(), timeline: w.history.scope(viewScope(w.session.profile))!.timeline() });
function later(w: Studio, action: BindingAction) {
  let finish!: () => void;
  const result = new Promise<void>(done => { finish = done; }).then(() => w.port.authoring.dispatch(action));
  return { finish, result };
}

test("binding snapshots are detached reads: names/statuses match their owners and no data/preview/capture is acquired", async () => {
  const w = await profileContextStudio();
  try {
    const before = state(w), wants = w.authoring.contexts.held(), counters = w.counters();
    const snapshot = w.port.panels.bindings!.snapshot("presets--unseen"), ref = w.looks[2]!;
    expect(snapshot.current).toMatchObject({ binding: pinned({ look: ref }), name: "Look 1-0", named: true });
    const row = candidate(snapshot, pinned({ look: ref }));
    expect(row).toMatchObject({ name: "Look 1-0", parent: "Collection 1", current: true, status: { state: "present" }, capability: { available: true } });
    (row.binding.target as { look: { look: string } }).look.look = "mutated";
    expect(w.session.panel("presets--unseen")!.binding).toEqual(pinned({ look: ref }));
    expect(w.authoring.contexts.held()).toEqual(wants); expect(w.counters()).toEqual(counters); expect(state(w)).toBe(before);
    expect(w.targets.held()).toBe(0); expect(w.panelActions.heldBindingChoices()).toBe(0);
  } finally { await w.dispose(); }
});

test("candidate kinds and dispatch obey each declared context, including a generic subject owner", async () => {
  const w = await profileContextStudio();
  try {
    const ref = { kind: "location", id: "harbor" }, look = w.looks[0]!, view = viewRecords(w)[0]!, tab = view.tab;
    const world: BindingWorld = { views: { [view.id]: { tab, scene: view.scene } }, scenes: { [view.scene]: { kind: "location", subject: ref, look, gen: 0 } }, focus: {},
      subject: () => ({ state: "present", owner: { kind: "location", id: "harbor" }, label: "Kabuki waterfront" }),
      look: () => ({ state: "present", owner: { kind: "look", id: "fixture" }, label: "Night look" }) };
    const options: BindingTargetOption[] = [{ binding: pinned({ view: view.id }), name: "Harbor view" }, { binding: pinned({ scene: view.scene }), name: "Harbor scene" },
      { binding: pinned({ subject: ref }), name: world.subject(ref).label! }, { binding: pinned({ look }), name: "Night look" }];
    const cases: [PanelContext, number[]][] = [[{ kind: "view" }, [0]], [{ kind: "scene" }, [0, 1]], [{ kind: "subject", subjects: ["location"] }, [0, 1, 2]], [{ kind: "look" }, [0, 1, 3]], [{ kind: "profile" }, []]];
    for (const [context, accepted] of cases) {
      const actions = new PanelActions(w.session, { types: () => [{ id: "presets", context }], world: () => world, factory: () => null, bindingTargets: () => options });
      const snapshot = actions.bindings().snapshot("presets--shared");
      expect(snapshot.candidates.map(row => row.name)).toEqual(accepted.map(i => options[i]!.name));
      for (const [i, option] of options.entries()) {
        const capability = actions.capability({ kind: "panels.setBinding", destination: w.session.panelTarget("presets--shared"), binding: option.binding });
        expect(capability.available).toBe(accepted.includes(i));
        if (accepted.includes(i)) expect(resolveBinding(world, { tab, context, binding: option.binding }).state).toBe("resolved");
      }
    }
  } finally { await w.dispose(); }
});

test("named constraints have the same reason/code in candidates and atomic command refusals", async () => {
  const w = await profileContextStudio();
  try {
    const option = { binding: pinned({ look: w.looks[0]! }), name: "Look 0-0" };
    const actions = new PanelActions(w.session, { types: () => [{ id: "presets", context: { kind: "look" } }], world: () => w.targets.world(), factory: () => null,
      bindingTargets: () => [option], rules: [{ id: "test.installation-ready", applies: context => context.kind === "look", check: () => ({ available: false, code: "busy", reason: "Wait for the installation catalogue." }) }] });
    const row = actions.bindings().snapshot("presets--shared").candidates[0]!;
    expect(row.rules.find(rule => rule.id === "test.installation-ready")?.capability).toEqual({ available: false, code: "busy", reason: "Wait for the installation catalogue." });
    expect(row.capability).toEqual({ available: false, code: "busy", reason: "Wait for the installation catalogue." });
    const before = state(w);
    expect(() => actions.dispatch({ kind: "panels.setBinding", destination: w.session.panelTarget("presets--shared"), binding: option.binding })).toThrow("Wait for the installation catalogue.");
    expect(state(w)).toBe(before);
  } finally { await w.dispose(); }
});

test("candidate owner states retain their names and recovery reasons instead of calling every missing target deleted", async () => {
  const w = await profileContextStudio();
  try {
    for (const ownerState of ["removed", "purged", "pending", "unavailable"] as const) {
      const world = w.targets.world(), binding = pinned({ look: w.looks[0]! }), reason = `Owner reports ${ownerState}`;
      const actions = new PanelActions(w.session, { types: () => [{ id: "presets", context: { kind: "look" } }], world: () => ({ ...world,
        look: () => ({ state: ownerState, owner: { kind: "look", id: "fixture" }, label: "Retained owner name", reason }) }), factory: () => null,
        bindingTargets: () => [{ name: "Retained owner name", binding }] });
      const row = actions.bindings().snapshot("presets--shared").candidates[0]!;
      expect(row.status).toMatchObject({ state: ownerState, label: "Retained owner name" });
      expect(row.capability).toEqual({ available: false, code: ownerState === "pending" ? "not_ready" : ownerState === "unavailable" ? "unavailable" : "missing_target", reason });
    }
  } finally { await w.dispose(); }
});

test("follow focus stays tab-local; explicit pins can choose a named view in another tab", async () => {
  const w = await profileContextStudio();
  const opened: AbortController[] = [];
  try {
    const tab = w.session.panel("presets--follow")!.tab, other = w.session.duplicate(tab), foreign = viewRecords(w).find(view => view.tab === other)!;
    w.session.focus.focusView(foreign.id);
    expect(w.port.panels.bindings!.snapshot("presets--follow").current.target.view).not.toBe(foreign.id);
    const menu = capture(w, "presets--follow"); opened.push(menu.life);
    const row = candidate(menu.snapshot, pinned({ view: foreign.id }));
    expect(row.outsideTab).toBe(true); expect(row.tabs?.[0]?.id).toBe(other); expect(row.name.length).toBeGreaterThan(0);
    const shown = w.session.tabId(), views = w.session.graph.viewIds();
    expect(w.port.authoring.dispatch(row.action!).ok).toBe(true);
    expect(w.targets.resolve("presets--follow").target?.view).toBe(foreign.id); expect(w.session.tabId()).toBe(shown); expect(w.session.graph.viewIds()).toEqual(views);
    const follow = capture(w, "presets--follow"); opened.push(follow.life);
    expect(w.port.authoring.dispatch(follow.snapshot.follow.action!).ok).toBe(true);
    expect(w.targets.resolve("presets--follow").target?.view).not.toBe(foreign.id);
  } finally { opened.forEach(life => life.abort()); await w.dispose(); }
});

test("no-candidate data is named and non-mutating, with Follow focus still an explicit policy choice", async () => {
  const w = await profileContextStudio();
  try {
    const actions = new PanelActions(w.session, { types: () => [{ id: "presets", context: { kind: "look" } }], world: () => ({ ...w.targets.world(), views: {}, scenes: {}, focus: {} }), factory: () => null, bindingTargets: () => [] });
    const before = state(w), snapshot = actions.bindings().snapshot("presets--follow");
    expect(snapshot.candidates).toEqual([]); expect(snapshot.noCandidate).toMatchObject({ available: false, code: "missing_target" });
    expect(snapshot.noCandidate?.reason).toContain("No compatible target"); expect(snapshot.current.resolution.state).toBe("empty");
    expect(snapshot.follow.capability.available).toBe(true); expect(state(w)).toBe(before);
  } finally { await w.dispose(); }
});

test("detached subjects keep resolving existing pins but leave new choices and invalidate an open choice", async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  try {
    const instance = "character--target0", pin = pinned({ subject: { kind: "character", id: w.vs[0]! } });
    const snapshot = w.port.panels.bindings!.capture(instance, life.signal), action = candidate(snapshot, pin).action!;
    expect(action).toBeDefined();
    expect((await w.services.profiles.dispatch({ kind: "profile.removeSubject", profile: w.session.profile,
      base: w.services.profiles.profile(w.session.profile)!.revision, subject: { kind: "character", id: w.vs[0]! } })).ok).toBe(true);
    const after = w.port.panels.bindings!.snapshot(instance), before = state(w);
    expect(candidate(after, pin)).toBeUndefined(); expect(after.current.resolution.state).toBe("resolved");
    expect(after.current.name).toBe(w.targets.world().subject({ kind: "character", id: w.vs[0]! }).label!);
    expect(w.port.authoring.dispatch(action)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
  } finally { life.abort(); await w.dispose(); }
});

test("a direct look pin needs no view and is one recorded binding step", async () => {
  const w = await profileContextStudio(); let life: AbortController | undefined;
  try {
    for (const view of w.session.graph.viewIds()) w.session.closeView(view);
    const menu = capture(w, "presets--unseen"); life = menu.life;
    const action = candidate(menu.snapshot, pinned({ look: w.looks[0]! })).action!;
    const scope = w.history.scope(viewScope(w.session.profile))!, before = scope.state().depth;
    expect(w.port.authoring.dispatch(action).ok).toBe(true);
    expect(w.session.graph.viewIds()).toEqual([]); expect(w.session.panel("presets--unseen")!.binding).toEqual(pinned({ look: w.looks[0]! }));
    expect(scope.state().depth).toBe(before + 1); expect(scope.undo()).toBe(true);
    expect(w.session.panel("presets--unseen")!.binding).toEqual(pinned({ look: w.looks[2]! }));
  } finally { life?.abort(); await w.dispose(); }
});

test("a directly pinned Presets selection re-pins through the registry without changing any scene", async () => {
  const w = await profileContextStudio();
  try {
    const bound = w.bind("presets--unseen").context, scenes = JSON.stringify(w.session.session().views.scenes), scope = w.history.scope(viewScope(w.session.profile))!, before = scope.state().depth;
    expect(bound.current().authoring.dispatch({ kind: "scene.setLook", look: w.looks[0]! }).ok).toBe(true);
    expect(w.session.panel("presets--unseen")!.binding).toEqual(pinned({ look: w.looks[0]! }));
    expect(scope.state().depth).toBe(before + 1); expect(JSON.stringify(w.session.session().views.scenes)).toBe(scenes);
  } finally { await w.dispose(); }
});

test("removed look candidates carry P3-vi Restore facts and disabled choices refuse without changing the binding", async () => {
  const w = await profileContextStudio(); let life: AbortController | undefined;
  try {
    const menu = capture(w); life = menu.life; const ref = w.looks[2]!, old = candidate(menu.snapshot, pinned({ look: ref })).action!;
    const own = w.bind("presets--unseen").context.current();
    expect(own.library.dispatch({ kind: "preset.edit", command: { kind: "remove", id: ref.look } }).ok).toBe(true);
    const row = candidate(w.port.panels.bindings!.snapshot("presets--shared"), pinned({ look: ref }));
    expect(row).toMatchObject({ name: "Look 1-0", status: { state: "removed", restore: { available: true } }, capability: { available: false, code: "missing_target" } });
    const before = state(w); expect(w.port.authoring.dispatch(old)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
  } finally { life?.abort(); await w.dispose(); }
});

test("a dangling direct pin can Follow focus without requiring its removed old look to exist", async () => {
  const w = await profileContextStudio(); let life: AbortController | undefined;
  try {
    const own = w.bind("presets--unseen").context;
    expect(own.current().library.dispatch({ kind: "preset.edit", command: { kind: "remove", id: w.looks[2]!.look } }).ok).toBe(true);
    const menu = capture(w, "presets--unseen"); life = menu.life;
    expect(menu.snapshot.current).toMatchObject({ name: "Look 1-0", named: true, resolution: { state: "dangling" } });
    const scenes = JSON.stringify(w.session.session().views.scenes);
    expect(own.current().authoring.dispatch(menu.snapshot.follow.action!).ok).toBe(true);
    expect(w.session.panel("presets--unseen")!.binding).toEqual({ policy: "follow-focus" });
    expect(JSON.stringify(w.session.session().views.scenes)).toBe(scenes);
  } finally { life?.abort(); await w.dispose(); }
});

test("captured actions are plain data: key order is irrelevant and changing the named candidate is refused", async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  try {
    const snapshot = w.port.panels.bindings!.capture("presets--shared", life.signal), action = candidate(snapshot, pinned({ look: w.looks[2]! })).action!;
    const before = state(w), changed = { ...action, binding: pinned({ look: w.looks[1]! }) };
    expect(w.port.authoring.dispatch(changed)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
    expect(w.port.authoring.dispatch({ choice: action.choice, binding: action.binding, destination: action.destination, kind: action.kind }).ok).toBe(true);
  } finally { life.abort(); await w.dispose(); }
});

for (const mutation of ["focus", "rebind", "scene", "abort", "close"] as const) test(`async binding choice after ${mutation} stays captured or refuses atomically`, async () => {
  const w = await profileContextStudio(); let life: AbortController | undefined;
  try {
    const menu = capture(w); life = menu.life;
    const view = viewRecords(w)[1]!, action = candidate(menu.snapshot, pinned({ view: view.id })).action!, pending = later(w, action);
    if (mutation === "focus") w.session.focus.focusView(viewRecords(w)[2]!.id);
    if (mutation === "rebind") { const destination = () => w.session.panelTarget("presets--shared");
      w.port.authoring.dispatch({ kind: "panels.setBinding", destination: destination(), binding: { policy: "follow-focus" } });
      w.port.authoring.dispatch({ kind: "panels.setBinding", destination: destination(), binding: pinned({ look: w.looks[0]! }) }); }
    if (mutation === "scene") w.session.setLook(view.scene, w.looks[2]!);
    if (mutation === "abort") life.abort();
    if (mutation === "close") w.session.close(w.session.panel("presets--shared")!.tab);
    const before = state(w); pending.finish(); const result = await pending.result;
    if (mutation === "focus") { expect(result.ok).toBe(true); expect(w.session.panel("presets--shared")!.binding).toEqual(pinned({ view: view.id })); }
    else { expect(result).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before); }
  } finally { life?.abort(); await w.dispose(); }
});

test("an external look revision invalidates an async choice while acknowledgements alone do not", async () => {
  const w = await profileContextStudio(); const lives: AbortController[] = []; let other: DocumentOutbox | undefined;
  try {
    const menu = capture(w); lives.push(menu.life); const ref = w.looks[2]!, action = candidate(menu.snapshot, pinned({ look: ref })).action!;
    await w.settle(); expect(w.port.authoring.capability(action).available).toBe(true);
    const pending = later(w, action);
    other = new DocumentOutbox(w.transport, memoryOutboxStorage()); other.open();
    const owner = new CollectionOwner({ documents: w.transport, outbox: other }); await owner.load();
    expect(owner.updateLook(ref, { name: "Changed elsewhere" }).ok).toBe(true); expect(await other.settle()).toBe(true);
    await w.outbox.check();
    const before = state(w); pending.finish(); expect(await pending.result).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
    const fresh = capture(w); lives.push(fresh.life); expect(candidate(fresh.snapshot, pinned({ look: ref })).name).toBe("Changed elsewhere");
  } finally { lives.forEach(life => life.abort()); other?.stop(); await w.dispose(); }
});

test("a local owner revision also invalidates a choice without treating acknowledgement as an edit", async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  try {
    const ref = w.looks[2]!, snapshot = w.port.panels.bindings!.capture("presets--shared", life.signal), action = candidate(snapshot, pinned({ look: ref })).action!;
    expect(w.services.collections.updateLook(ref, { name: "Renamed here" }).ok).toBe(true);
    const before = state(w);
    expect(w.port.authoring.dispatch(action)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
  } finally { life.abort(); await w.dispose(); }
});

for (const field of ["binding", "target"] as const) test(`captured candidate ${field} data cannot redirect the private revision validation`, async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  try {
    const ref = w.looks[2]!, peer = w.looks[0]!;
    expect(w.services.collections.targetStatus(peer).revision).toBe(w.services.collections.targetStatus(ref).revision);
    const snapshot = w.port.panels.bindings!.capture("presets--shared", life.signal), row = candidate(snapshot, pinned({ look: ref })), action = row.action!;
    expect(w.port.authoring.capability(action).available).toBe(true);
    expect(w.services.collections.updateLook(ref, { name: "Changed after capture" }).ok).toBe(true);
    expect(w.port.authoring.capability(action)).toMatchObject({ available: false, code: "missing_target" });
    const exposed = field === "binding" ? (row.binding.target as { look: typeof ref }).look : row.target.look!;
    expectCaptureStable(() => ({ capability: w.port.authoring.capability(action), action }), () => Object.assign(exposed, peer));
    const before = state(w);
    expect(action.binding).toEqual(pinned({ look: ref }));
    expect(w.port.authoring.capability(action)).toMatchObject({ available: false, code: "missing_target" });
    expect(w.port.authoring.dispatch(action)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(before);
  } finally { life.abort(); expect(w.targets.held()).toBe(0); expect(w.panelActions.heldBindingChoices()).toBe(0); await w.dispose(); }
});

for (const path of ["captureNamed", "capture", "capture(undefined)", "captureView", "bindingCapture"] as const)
  test(`capture ownership: ${path} cannot be redirected from removed A to live B`, async () => {
    const w = await profileContextStudio(); const life = new AbortController();
    try {
      const fromView = path === "captureView" || path === "capture(undefined)", ref = structuredClone(w.looks[fromView ? 0 : 2]!), peer = w.looks[1]!;
      const view = viewRecords(w)[0]!.id; w.session.focus.focusView(view);
      const inputLook = { ...ref }, input = pinned({ look: inputLook });
      const held = path === "bindingCapture" ? undefined : path === "captureNamed" ? w.targets.captureNamed({ look: inputLook }, life.signal, "presets--shared")
        : path === "captureView" ? w.targets.captureView(view, life.signal) : w.targets.capture(path === "capture" ? "presets--unseen" : undefined, life.signal);
      const check = held ? () => w.targets.current(held) : w.targets.bindingCapture("presets--shared", input, life.signal);
      expect(check().available).toBe(true);
      const collection = w.services.collections.collection(ref.collection)!;
      expect(w.services.collections.dispatch({ kind: "collection.removeLook", collection: ref.collection, base: collection.revision, look: ref.look }).ok).toBe(true);
      expect(check()).toMatchObject({ available: false, code: "missing_target" });
      expectCaptureStable(() => ({ capability: check(), named: held?.named, data: held?.data }),
        () => Object.assign((input.target as { look: typeof ref }).look, peer),
        ...held ? [() => Object.assign(held.named.look!, peer), () => Object.assign(held.data.target.look!, peer),
          () => Object.assign(held.data.revisions, Object.fromEntries(Object.keys(held.data.revisions).map(key => [key, -1])))] : []);
      if (held) expect(held.named.look).toEqual(ref);
      expect(Object.isFrozen(input.target)).toBe(false); // The constructor owns a copy; it never freezes the caller's data.
    } finally { life.abort(); expect(w.targets.held()).toBe(0); await w.dispose(); }
  });

test("context-menu capture owns caller named data and deep-freezes its returned destination", async () => {
  const w = await profileContextStudio();
  try {
    const input = { look: { ...w.looks[2]! } }, context = w.core.app.contextFor({ kind: "collection" }, input);
    expectCaptureStable(() => context, () => Object.assign(input.look, w.looks[0]!), () => Object.assign(context.named.look!, w.looks[1]!));
    expect(Object.isFrozen(input.look)).toBe(false);
  } finally { await w.dispose(); }
});

for (const path of ["panel", "panel capture", "root capture"] as const) test(`editing capture ownership: ${path} keeps its named look`, async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  try {
    const panel = w.bind("presets--unseen").context.current(), port = path === "panel" ? panel : (path === "panel capture" ? panel : w.port).capture!(life.signal);
    const exposed = port.authoring.contextFor({ kind: "collection" }), original = exposed.named.look!;
    expectCaptureStable(() => port.authoring.contextFor({ kind: "collection" }).named,
      () => Object.assign(exposed.named.look!, w.looks.find(ref => !same(ref, original))!));
  } finally { life.abort(); await w.dispose(); }
});

test("cached profile snapshots cannot be mutated through their nested membership", async () => {
  const w = await profileContextStudio();
  try {
    const profiles = w.services.profiles, list = profiles.list(), row = list.find(profile => profile.id === w.session.profile)!;
    expectCaptureStable(() => profiles.list(), () => Object.assign(row.subjects[0]!, { id: "changed" }),
      () => { (row.collections as string[]).splice(0); });
    expect(row.subjects).toEqual(profiles.profile(row.id)!.subjects);
  } finally { await w.dispose(); }
});

test("editing/file capture owns target data even across its adapter callback and scene port", async () => {
  const w = await profileContextStudio(); const life = new AbortController();
  type Input = Parameters<ConstructorParameters<typeof PanelEditingContexts<HTMLElement>>[0]["create"]>[0];
  const inputs: Input[] = []; let held: ReturnType<Input["capture"]> | undefined;
  try {
    // Only adapter mechanics are stubbed: the real context, resolver, history and look owners perform all validation.
    const router = new PanelEditingContexts({ session: w.session, targets: w.targets, looks: w.neutralAuthoring.contexts, empty: w.neutralCore,
      context: () => ({ kind: "look" }), character: () => undefined,
      create: input => { inputs.push(input); return { port: w.port, writer: {} as FileWriter,
        files: { observeInput() {} } as unknown as StudioFileOperations, dispose() {} }; } });
    expect(router.acquire("presets--unseen", life.signal)).toBeDefined();
    const input = inputs[0]!, ref = { ...input.named.look! }; held = input.capture();
    const collection = w.services.collections.collection(ref.collection)!;
    expect(w.services.collections.dispatch({ kind: "collection.removeLook", collection: ref.collection, base: collection.revision, look: ref.look }).ok).toBe(true);
    expect(held.check()).toMatchObject({ available: false, code: "missing_target" });
    expectCaptureStable(() => ({ named: input.named, scene: input.scene.look(), capability: held!.check() }),
      () => Object.assign(input.named.look!, w.looks[0]!), () => Object.assign(input.scene.look()!, w.looks[0]!));
  } finally { held?.release(); life.abort(); await w.dispose(); }
});

test("withdrawal/return invalidates old choices and abort releases all choice and resolver captures", async () => {
  let available = true, generation = 0;
  const w = await profileContextStudio({ available: () => available, generation: () => generation });
  const life = new AbortController();
  try {
    const before = w.targets.held(), snapshot = w.port.panels.bindings!.capture("presets--shared", life.signal);
    const action = candidate(snapshot, pinned({ look: w.looks[2]! })).action!;
    available = false; generation++; available = true; generation++;
    const saved = state(w); expect(w.port.authoring.dispatch(action)).toMatchObject({ ok: false, code: "missing_target" }); expect(state(w)).toBe(saved);
    expect(w.panelActions.heldBindingChoices()).toBeGreaterThan(0);
    life.abort(); expect(w.panelActions.heldBindingChoices()).toBe(0); expect(w.targets.held()).toBe(before);
  } finally { life.abort(); await w.dispose(); }
});

test("readonly binding capability and dispatch preserve session/history with the same named refusal", async () => {
  const w = await profileContextStudio();
  try {
    const actions = new PanelActions(w.session, { types: () => [{ id: "presets", context: { kind: "look" } }], world: () => w.targets.world(), factory: () => null,
      bindingTargets: () => [{ name: "Look", binding: pinned({ look: w.looks[0]! }) }], access: () => ({ available: false, code: "unavailable", reason: "This workspace is read-only." }) });
    const snapshot = actions.bindings().snapshot("presets--shared"), before = state(w);
    expect(snapshot.candidates[0]!.capability).toEqual({ available: false, code: "unavailable", reason: "This workspace is read-only." });
    expect(() => actions.dispatch({ kind: "panels.setBinding", destination: w.session.panelTarget("presets--shared"), binding: pinned({ look: w.looks[0]! }) })).toThrow("read-only");
    expect(state(w)).toBe(before);
  } finally { await w.dispose(); }
});

test("U8 default-save disclosure names external pins, leaves live bindings intact and gates stale save callbacks", async () => {
  const w = await profileContextStudio();
  try {
    const tab = w.session.panel("presets--shared")!.tab, other = w.session.duplicate(tab), foreign = viewRecords(w).find(view => view.tab === other)!;
    for (const [instance, binding] of [["presets--shared", pinned({ view: foreign.id })], ["presets--unseen", pinned({ scene: foreign.scene })]] as const)
      expect(w.port.authoring.dispatch({ kind: "panels.setBinding", destination: w.session.panelTarget(instance), binding }).ok).toBe(true);
    const projection = w.port.tabs!.defaultSave!(tab), live = w.session.tab(tab)!.panels;
    expect(projection.capability.available).toBe(true); expect(projection.bindingChanges.map(change => change.reason)).toEqual(["external-view", "external-scene"]);
    expect(projection.bindingChanges.every(change => change.to.policy === "follow-focus")).toBe(true);
    w.session.show(other); // Saving remains captured to the named original tab.
    expect(w.port.authoring.dispatch({ kind: "tabs.saveAsDefault", tab, name: "Captured default", baseline: projection.baseline }).ok).toBe(true);
    expect(w.session.tab(tab)!.panels).toEqual(live);
    const saved = w.services.defaults.list().find(item => item.name === "Captured default")!;
    for (const change of projection.bindingChanges) {
      const index = live.filter(panel => panel.type === change.type).findIndex(panel => panel.id === change.instance);
      expect(saved.fragment.panels.filter(panel => panel.type === change.type)[index]!.binding).toBeUndefined();
    }
    const stale = w.port.tabs!.defaultSave!(tab), count = w.services.defaults.list().length;
    w.session.setPanelBinding(tab, "presets--unseen", pinned({ look: w.looks[2]! }));
    const before = state(w);
    expect(w.port.authoring.dispatch({ kind: "tabs.saveAsDefault", tab, name: "Stale disclosure", baseline: stale.baseline })).toMatchObject({ ok: false, code: "missing_target" });
    expect(w.services.defaults.list()).toHaveLength(count); expect(state(w)).toBe(before);
  } finally { await w.dispose(); }
});

test("U8 Leave empty substitution reports exactly the direct subject/look pins that become follow focus", async () => {
  const w = await profileContextStudio();
  try {
    const tab = w.session.panel("presets--shared")!.tab, fragment = fragmentOfTab(w.session.session(), tab)!, before = JSON.stringify(fragment);
    const substitution = substitutionOf(fragment, { subjects: [], looks: [], scenes: [] });
    if ("issue" in substitution) throw Error(substitution.issue);
    const direct = fragment.panels.filter(panel => panel.binding?.policy === "pinned" && (panel.binding.look || panel.binding.subject));
    expect(substitution.bindingChanges.map(change => change.panel)).toEqual(direct.map(panel => panel.key));
    expect(substitution.bindingChanges.some(change => change.reason === "empty-subject")).toBe(true);
    expect(substitution.bindingChanges.some(change => change.reason === "empty-look")).toBe(true);
    let id = 0;
    const content = instantiateFragment(fragment, fillOf(substitution), { freshId: kind => `${kind}-${++id}`, freshInstance: type => `${type}--fresh${++id}` }, { name: "Empty" });
    for (const change of substitution.bindingChanges) expect(content.panels[fragment.panels.findIndex(panel => panel.key === change.panel)]!.binding).toBeUndefined();
    expect(JSON.stringify(fragment)).toBe(before);
  } finally { await w.dispose(); }
});

test("U8 default-save disclosure excludes omitted view panes and matches the saved fragment", async () => {
  const w = await profileContextStudio({ viewPanels: true });
  try {
    const tab = w.session.panel("view--scene0")!.tab;
    w.session.closeView("main");
    const source = w.session.tab(tab)!, disclosure = w.port.tabs!.defaultSave!(tab);
    expect(source.panels.some(panel => panel.id === "view--scene0")).toBe(true);
    expect(w.port.authoring.dispatch({ kind: "tabs.saveAsDefault", tab, name: "After closing main", baseline: disclosure.baseline }).ok).toBe(true);
    const fragment = w.services.defaults.list().find(item => item.name === "After closing main")!.fragment;
    expect(fragment.views).toHaveLength(2); expect(fragment.panels.some(panel => panel.type === "view")).toBe(false);
    const changed = source.panels.filter(panel => panel.type !== "view").flatMap((panel, index) =>
      panel.binding?.policy === "pinned" && fragment.panels[index]!.binding?.policy !== "pinned" ? [panel.id] : []);
    expect(changed).toContain("presets--scene0");
    expect(disclosure.bindingChanges.map(change => change.instance)).toEqual(changed);
    expect(disclosure.bindingChanges.some(change => change.instance === "view--scene0")).toBe(false);
    expect(w.session.tab(tab)!.panels).toEqual(source.panels);
  } finally { await w.dispose(); }
});

test("U8 a scene link changing the disclosed external pins invalidates the save baseline", async () => {
  const w = await profileContextStudio();
  try {
    const view = viewRecords(w)[0]!, tab = view.tab, other = w.session.duplicate(tab), foreign = viewRecords(w).find(view => view.tab === other)!;
    w.session.setPanelBinding(tab, "presets--shared", pinned({ scene: foreign.scene }));
    const disclosure = w.port.tabs!.defaultSave!(tab);
    expect(disclosure.bindingChanges).toHaveLength(1);
    w.session.graph.link(view.id, "scene", foreign.id);
    expect(w.port.tabs!.defaultSave!(tab).bindingChanges.some(change => change.instance === "presets--shared")).toBe(false);
    const before = state(w), count = w.services.defaults.list().length;
    expect(w.port.authoring.dispatch({ kind: "tabs.saveAsDefault", tab, name: "Old scene disclosure", baseline: disclosure.baseline })).toMatchObject({ ok: false, code: "missing_target" });
    expect(state(w)).toBe(before); expect(w.services.defaults.list()).toHaveLength(count);
  } finally { await w.dispose(); }
});
