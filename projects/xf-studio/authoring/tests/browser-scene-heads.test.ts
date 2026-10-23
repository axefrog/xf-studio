/**
 * Profiles phase 4a-iv (experiment 043 §10): the window's scene runtime owner over the real head attachment and viewport device, with fake
 * scenes. A body switch supersedes: the V shown before stays drawn until the new head is built, the last choice is what ends up shown, a
 * superseded masculine core is no longer waited for (D1), and a late build is disposed, never shown. The V's context outlives the heads:
 * it stays attached across a swap (no `not_ready` while a head loads), and a warm head is shown again at once.
 */
import { expect, test } from "bun:test";
import { createBrowserSceneHeads, type SceneHeadsPorts } from "../src/preview/browser/browser-scene-heads";
import type { CharacterScenePorts } from "../src/character/character-service";
import { CharacterContextActions } from "../src/character/character-context-actions";
import type { ChoicePreviewPort } from "../src/character/choice-preview-service";
import type { AttachedHead } from "../src/preview/browser/browser-head-attachment";
import { vHistory } from "./fixtures/character-steps";
import { creator, harness } from "./fixtures/fake-heads";
import type { PreparationState } from "../src/preview/scene-residency";

/** A characters' owner holding each V's one context (made with the scene ports the heads owner offers). */
function characterOwner(bodies: Record<string, "female" | "male">) {
  const contexts = new Map<string, CharacterContextActions>(), offered: CharacterScenePorts[] = [];
  const steps = Object.fromEntries(Object.keys(bodies).map(id => [id, vHistory(id)]));
  const port: SceneHeadsPorts["characters"] = {
    context: (id, ports) => {
      let context = contexts.get(id);
      if (!context) {
        offered.push(ports);
        context = new CharacterContextActions({ ...ports, creator, history: steps[id]!.home }, { stored: { origin: "default", bodyGender: bodies[id], choices: [] } });
        contexts.set(id, context);
      }
      return context;
    },
    document: id => id in bodies ? {} as never : null,
    decoded: () => null,
  };
  return { port, contexts, offered, steps };
}

/** A gate per body: a build waits until its body's gate opens (or its signal aborts). */
function gates() {
  const open = { female: true, male: true }, waiting: { body: string; resolve: () => void }[] = [];
  return {
    open, release(body: "female" | "male") { open[body] = true; for (const item of waiting.splice(0)) if (item.body === body) item.resolve(); else waiting.push(item); },
    build: (body: "female" | "male", signal?: AbortSignal) => open[body] ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      waiting.push({ body, resolve });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
}

function owner(bodies: Record<string, "female" | "male">, failBuild: number[] = [], previews: SceneHeadsPorts["previews"] = null,
  views: Record<string, { scene: string; subject: string }> = {}, editors?: SceneHeadsPorts["editors"], document?: SceneHeadsPorts["document"]) {
  const scene = { subject: Object.keys(bodies)[0]! };
  const preparations: (PreparationState | null)[] = [];
  const gate = gates(), h = harness({ build: gate.build, failBuild }), people = characterOwner(bodies);
  const listeners = new Set<() => void>(), shown: (AttachedHead | undefined)[] = [], notices: string[] = [], pending: string[] = [];
  const prepared: { body: string; signal: AbortSignal }[] = [];
  const contextListeners = new Set<(event: "lost" | "restored") => void>();
  let prepare: (body: string, signal: AbortSignal) => Promise<void> = async () => {};
  const heads = createBrowserSceneHeads({
    head: { ...h.ports },
    scenes: { view: () => "main", of: view => view === "main" ? "s1" : views[view]?.scene,
      has: scene => scene === "s1" || Object.values(views).some(view => view.scene === scene),
      subject: id => Object.values(views).find(view => view.scene === id)?.subject ?? scene.subject, ensureSubject: async () => scene.subject,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    characters: people.port,
    prepareCore: (body, _pending, signal) => { prepared.push({ body, signal }); return prepare(body, signal); },
    pending: message => pending.push(message), notice: text => notices.push(text), preparation: state => preparations.push(state),
    shown: head => shown.push(head), previews, ...(editors ? { editors } : {}), ...(document ? { document } : {}),
    onContext: listener => { contextListeners.add(listener); return () => { contextListeners.delete(listener); }; },
  });
  return { h, gate, people, heads, shown, notices, pending, prepared, scene, listeners, preparations,
    setPrepare(next: typeof prepare) { prepare = next; },
    changeScene() { for (const listener of listeners) listener(); },
    loseContext() { for (const listener of contextListeners) listener("lost"); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("a superseding body switch shows the last choice: the female V stays drawn while the male head builds, and back to female the male build and its wait for his core stop (D1)", async () => {
  const o = owner({ v1: "female" });
  await o.heads.load();
  const female = o.heads.shown()!;
  expect(female.body).toBe("female");
  const context = female.characterContext;
  expect(o.h.attached.characterContext).toBe(context);
  // The V becomes masculine: his core is prepared (held here), and the female head stays drawn meanwhile.
  let preparing!: AbortSignal;
  o.setPrepare((_body, signal) => { preparing = signal; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))); });
  context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  expect(o.prepared.map(item => item.body)).toEqual(["male"]);
  expect(o.heads.shown()).toBe(female);
  expect(o.h.viewport.scene()).toBe(female.scene);
  // Creator changes are never refused while the other head loads: the V's context stays attached.
  expect(o.h.attached.characterContext).toBe(context);
  expect(o.heads.snapshot().building).toMatchObject({ key: "s1|v1|male" });
  // Back to female: the male build and its wait for his core stop; the female head is still the one shown.
  context.dispatch({ kind: "character.useDefault", bodyGender: "female" });
  await settle();
  expect(preparing.aborted).toBe(true);
  expect(o.heads.shown()).toBe(female);
  expect(o.heads.snapshot()).toMatchObject({ building: null, residents: [{ key: "s1|v1|female", state: "shown" }] });
  // Nothing of the male want was ever drawn or built.
  expect(o.h.drawn.map(slot => (slot as { body: string }).body)).toEqual(["female"]);
  expect(o.h.bodies).toEqual(["female"]);
  o.heads.dispose();
});

test("a body switch builds the new head hidden, keeps the old one drawn until it is ready, then swaps; the old one stays warm and is shown again at once", async () => {
  const o = owner({ v1: "female" });
  await o.heads.load();
  const female = o.heads.shown()!, context = female.characterContext;
  o.gate.open.male = false;
  context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  // Built hidden: the scene exists, nothing of it is drawn, the female V is still the one shown.
  expect(o.h.bodies).toEqual(["female", "male"]);
  expect(o.h.drawn).toHaveLength(1);
  expect(o.heads.shown()).toBe(female);
  o.gate.release("male");
  await settle();
  const male = o.heads.shown()!;
  expect(male.body).toBe("male");
  expect(o.h.viewport.scene()).toBe(male.scene);
  expect(o.h.attached).toMatchObject({ preview: male.preview, motion: male.motion, characterDetails: male.characterDetails, characterContext: context });
  expect(o.heads.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual(["s1|v1|female:warm", "s1|v1|male:shown"]);
  // The root heard each swap: the hidden head goes, the new one comes.
  expect(o.shown.slice(-2)).toEqual([undefined, male]);
  // Back to female: warm, so shown at once with no build; Undo works the same way.
  const builds = o.h.builds;
  context.dispatch({ kind: "character.useDefault", bodyGender: "female" });
  await settle();
  expect(o.heads.shown()).toBe(female);
  expect(o.h.builds).toBe(builds);
  o.people.steps.v1!.undo();
  await settle();
  expect(o.heads.shown()).toBe(male);
  // A lost context drops the warm head first; the shown one stays.
  o.loseContext();
  expect(o.heads.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual(["s1|v1|male:shown"]);
  expect(o.h.log).toContain("scene:dispose:1");
  o.heads.dispose();
  expect(o.h.host.canvases).toBe(0);
  expect(o.h.attached.characterContext).toBeUndefined();
});

test("no late result is ever shown: a head finishing after a newer want superseded it is disposed", async () => {
  const o = owner({ v1: "female", v2: "female" });
  await o.heads.load();
  const first = o.heads.shown()!;
  // V2 is wanted, but its build is held; V1 again before it lands.
  o.gate.open.female = false;
  o.scene.subject = "v2";
  o.changeScene();
  await settle();
  expect(o.heads.snapshot().building).toMatchObject({ key: "s1|v2|female" });
  o.scene.subject = "v1";
  o.changeScene();
  await settle();
  o.gate.release("female");
  await settle();
  expect(o.heads.shown()).toBe(first);
  expect(o.h.drawn).toHaveLength(1);
  // The second build stopped (its signal aborted while it waited), and nothing of it stayed.
  expect(o.h.host.canvases).toBe(1);
  o.heads.dispose();
});

test("each V keeps one context with its scene ports bound late: they reach the head showing that V, and do nothing while none does", async () => {
  const o = owner({ v1: "female", v2: "male" });
  await o.heads.load();
  const v1 = o.heads.shown()!;
  expect(o.people.offered).toHaveLength(1);
  const ports = o.people.offered[0]!;
  let retried = 0;
  v1.characterDetails.retry = async () => { retried++; };
  v1.characterDetails.failed = () => true;
  expect(ports.details!.failed()).toBe(true);
  ports.details!.retry();
  expect(retried).toBe(1);
  // V2 shown: V1's ports reach no head now.
  o.scene.subject = "v2";
  o.changeScene();
  await settle();
  expect(o.heads.shown()!.body).toBe("male");
  expect(o.h.attached.characterContext).toBe(o.people.contexts.get("v2"));
  expect(ports.details!.failed()).toBe(false);
  ports.details!.retry();
  expect(retried).toBe(1);
  // The contexts were made once each, and outlive the swaps.
  o.scene.subject = "v1";
  o.changeScene();
  await settle();
  expect(o.people.offered).toHaveLength(2);
  expect(o.h.attached.characterContext).toBe(o.people.contexts.get("v1"));
  o.heads.dispose();
});

test("the first load waits for the head that superseded it, and a failed first load rejects with nothing shown (the setup's Try again)", async () => {
  const o = owner({ v1: "female" });
  o.gate.open.female = false;
  const loading = o.heads.load();
  await settle();
  // While the first head builds, the V becomes masculine: the load resolves once his head is shown.
  o.people.contexts.get("v1")!.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  await loading;
  expect(o.heads.shown()!.body).toBe("male");
  o.heads.dispose();

  const failing = owner({ v1: "female" }, [1]);
  await expect(failing.heads.load()).rejects.toThrow("The head could not be read.");
  expect(failing.heads.shown()).toBeUndefined();
});

test("a later head that can't be built leaves the V shown before, with a plain notice", async () => {
  // The masculine head's scene (the second build) fails to build.
  const o = owner({ v1: "female" }, [2]);
  await o.heads.load();
  const female = o.heads.shown()!;
  female.characterContext.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  expect(o.heads.shown()).toBe(female);
  expect(o.notices).toEqual(["Your V couldn't be shown in the 3D view, so the V shown before stays. Change the V again to try once more."]);
  // The next change builds again.
  female.characterContext.dispatch({ kind: "character.useDefault", bodyGender: "female" });
  female.characterContext.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  expect(o.heads.shown()!.body).toBe("male");
  o.heads.dispose();
});

test("residency bounds the choice-preview devices too: four Vs with previews open leave only the resident Vs' devices alive, and a non-resident V's questions wait for its head", async () => {
  const devices: { made: number; disposed: number }[] = [];
  const device = (): ChoicePreviewPort => {
    const counts = { made: devices.length + 1, disposed: 0 };
    devices.push(counts);
    return { sources: async () => [], subject: async body => body, stored: async () => null, render: async () => ({ url: "u" }), dispose: () => { counts.disposed++; } };
  };
  const o = owner({ v1: "female", v2: "female", v3: "female", v4: "female" }, [], device);
  await o.heads.load();
  const alive = () => devices.filter(item => !item.disposed).length;
  const show = async (subject: string) => { o.scene.subject = subject; o.changeScene(); await settle(); };
  for (const subject of ["v1", "v2", "v3", "v4"]) {
    await show(subject);
    // The V's Character panel draws a preview: its device starts.
    await o.people.offered.at(-1)!.previews!.subject("female");
    expect(alive()).toBeLessThanOrEqual(2);
  }
  // Four devices were made over time; only the shown V's and the warm V's are alive.
  expect(devices).toHaveLength(4);
  expect(alive()).toBe(2);
  // Requesters of the two Vs no resident head shows keep asking: nothing is made, and their questions wait.
  const answered: string[] = [];
  for (const index of [0, 1]) void o.people.offered[index]!.previews!.stored(`k${index}`).then(() => answered.push(`v${index + 1}`));
  const aborted = new AbortController();
  const lookup = o.people.offered[0]!.previews!.sources({} as never, "o", "hair", [1], null, aborted.signal).catch(error => error.name);
  await settle();
  expect(devices).toHaveLength(4);
  expect(answered).toEqual([]);
  // A waiting question its requester gives up on ends at once.
  aborted.abort();
  expect(await lookup).toBe("AbortError");
  // v1 is shown again: its head is built, it is admitted within the budget (the least recent warm V's device goes first), and its question runs.
  await show("v1");
  expect(answered).toEqual(["v1"]);
  expect(devices).toHaveLength(5);
  expect(alive()).toBe(2);
  o.heads.dispose();
  expect(alive()).toBe(0);
});

test("a live turn survives its V's eviction: A's live preview, B, then C evict A, back to A and the new device draws A's turn again", async () => {
  type Log = string[];
  const devices: Log[] = [];
  const device = (): ChoicePreviewPort => {
    const log: Log = [];
    devices.push(log);
    let uploaded: unknown = null, ended = false;
    return { sources: async () => [], subject: async body => { log.push(`subject ${body}`); return body; }, stored: async () => null, render: async () => ({ url: "u" }),
      dispose: () => { ended = true; },
      live: {
        start: async source => { log.push("start"); uploaded = source; },
        // A worker without the source draws nothing (the reviewed failure: every later frame was null).
        frame: async () => { if (ended || !uploaded) throw Error("No source is uploaded."); log.push("frame"); return { bitmap: { close() {} } as unknown as ImageBitmap }; },
        stop: () => { uploaded = null; log.push("stop"); },
      } };
  };
  const o = owner({ a: "female", b: "female", c: "female" }, [], device);
  await o.heads.load();
  const show = async (subject: string) => { o.scene.subject = subject; o.changeScene(); await settle(); };
  const previews = o.people.offered[0]!.previews!, source = { parts: [] } as never;
  await previews.subject("female");
  await previews.live!.start(source);
  expect(await previews.live!.frame(0, false)).toBeTruthy();
  await show("b");
  await show("c");
  // A is evicted (C shown, B warm): its device ended, its context and its service's live turn stayed.
  expect(o.heads.snapshot().residents.map(item => item.key)).toEqual(["s1|b|female", "s1|c|female"]);
  await show("a");
  // A's next frame makes a new device, which gets the subject head and the live source back before it draws.
  expect(await previews.live!.frame(30, false)).toBeTruthy();
  // B and C drew no previews, so A's are the only devices: the first ended with A's eviction.
  expect(devices).toHaveLength(2);
  expect(devices[1]).toEqual(["subject female", "start", "frame"]);
  o.heads.dispose();
});

test("4a-v: a new head is prepared before it is shown, with the V shown before still drawn; its typed progress reaches the presentation and ends, with no notice", async () => {
  const o = owner({ v1: "female" });
  await o.heads.load();
  const female = o.heads.shown()!, context = female.characterContext;
  // The first load went through every stage too, with the pane told how far (nothing was shown meanwhile).
  expect(o.preparations.filter(Boolean).map(state => state!.key)).toContain("s1|v1|female");
  expect(o.preparations.at(-1)).toBeNull();
  // The male V's head: his core prepared by the host (held), then built and prepared, while the female V stays shown.
  let release!: () => void;
  o.setPrepare((_body, signal) => new Promise((resolve, reject) => { release = resolve; signal.addEventListener("abort", () => reject(signal.reason)); }));
  const preparedBefore = o.preparations.length, pendingBefore = o.pending.length;
  context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  expect(o.heads.shown()).toBe(female);
  expect(o.heads.preparation()).toMatchObject({ key: "s1|v1|male", stage: "core", warm: false });
  release();
  for (let i = 0; i < 20 && o.heads.shown() === female; i++) await settle();
  const male = o.heads.shown()!;
  expect(male.body).toBe("male");
  const states = o.preparations.slice(preparedBefore);
  const stages = [...new Set(states.filter(Boolean).map(state => state!.stage))];
  expect(stages[0]).toBe("core");
  expect(stages).toContain("details");
  expect(states.at(-1)).toBeNull();
  const fractions = states.filter(Boolean).map(state => state!.fraction);
  for (let i = 1; i < fractions.length; i++) expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
  // While another V was shown, the head pane's loading state wasn't touched, and the old one-off notice is gone.
  expect(o.pending.length).toBe(pendingBefore);
  expect(o.notices.filter(text => text.includes("stays until"))).toEqual([]);
  o.heads.dispose();
});

test("4a-vi: each view's on-head editor is mounted on the head shown for it, and unmounted before that head is hidden or drawn for another view", async () => {
  const views: Record<string, { scene: string; subject: string }> = {}, log: string[] = [];
  const o = owner({ v1: "female", v2: "female" }, [], null, views, { mount: (head, view) => {
    const id = head.scene.slot as unknown as { id: number };
    log.push(`mount:${id.id}:${view}`);
    return () => log.push(`unmount:${id.id}:${view}`);
  } });
  const graph = o.h.ports.graph!, side = graph.addView("main", {}, { label: "Side" }), twin = graph.addView("main", { scene: true }, { label: "Twin" });
  views[side] = { scene: "s2", subject: "v2" }; views[twin] = { scene: "s1", subject: "v1" };
  await o.heads.load();
  expect(log).toEqual(["mount:1:main"]);
  // Another view of the same scene: the same head, its editor mounted again for that view.
  await o.heads.show(twin);
  expect(log).toEqual(["mount:1:main", "unmount:1:main", "mount:1:" + twin]);
  // Another scene's view: the old head's editor goes before it is hidden, and the new head's is mounted for the view.
  await o.heads.show(side);
  expect(log.slice(3)).toEqual(["unmount:1:" + twin, "mount:2:" + side]);
  o.heads.dispose();
  expect(log.at(-1)).toBe("unmount:2:" + side);
});

/**
 * Per-view editing (experiment 044 P2-iii, decision D3) over the owner: a document that follows the drawn view's look, and a log of the
 * editor's mounts and of the layered surface's connections, so the order of a look switch can be read.
 */
function lookSwitching() {
  const views: Record<string, { scene: string; subject: string }> = {}, log: string[] = [], looks: Record<string, string> = { main: "A" };
  let edited = "A";
  const id = (head: AttachedHead) => (head.scene.slot as unknown as { id: number }).id;
  const o = owner({ v1: "female", v2: "female" }, [], null, views,
    { mount: (head, view) => { log.push(`mount:${id(head)}:${view}`); return () => log.push(`unmount:${id(head)}:${view}`); } },
    { shows: view => looks[view] === edited, follow: view => { edited = looks[view]!; log.push(`follow:${edited}`); } });
  // The fake layered surface's connections, logged by head.
  const preview = o.h.ports.layered[0]!.preview, { connectScene, disconnectScene } = preview;
  const headOf = (surface: unknown) => [...o.h.surfaces].find(([, item]) => item === surface)?.[0] as { slot: { id: number } } | undefined;
  preview.connectScene = surface => { log.push(`connect:${headOf(surface)?.slot.id}`); return connectScene(surface); };
  preview.disconnectScene = surface => { if (o.h.connected === surface) log.push(`hold:${headOf(surface)?.slot.id}`); disconnectScene(surface); };
  const side = o.h.ports.graph!.addView("main", {}, { label: "Side" });
  views[side] = { scene: "s2", subject: "v2" }; looks[side] = "B";
  return { o, log, side, edited: () => edited, looks, views };
}

test("P2-iii: a view of another look: the editor is settled, the head on screen holds its layers, and only then does the document switch; the target takes over with the new look", async () => {
  const { o, log, side, edited } = lookSwitching();
  await o.heads.load();
  const first = o.heads.shown()!;
  expect(log).toEqual(["connect:1", "mount:1:main"]);
  log.length = 0;
  o.gate.open.female = false;
  const shown = o.heads.show(side);
  // Before anything is built: the editor unmounted, then the head on screen holds what it shows, then the document shows look B.
  expect(log).toEqual(["unmount:1:main", "hold:1", "follow:B"]);
  expect(edited()).toBe("B");
  await settle();
  // While the side head is made ready, the head on screen draws with nothing connected: no surface follows look B's layers.
  expect(o.heads.shown()).toBe(first);
  expect(o.h.connected).toBeUndefined();
  expect(o.heads.shownView()).toBe(side);
  o.gate.release("female");
  await shown;
  const second = o.heads.shown()!;
  expect(second).not.toBe(first);
  expect(log.slice(3)).toEqual(["connect:2", "mount:2:" + side]);
  expect(o.h.connected).toBe(o.h.surfaces.get(second.scene));
  o.heads.dispose();
});

test("P2-iii: back before the takeover, the document shows the first look again and the head on screen follows it, with nothing built shown", async () => {
  const { o, log, side, edited } = lookSwitching();
  await o.heads.load();
  const first = o.heads.shown()!;
  o.gate.open.female = false;
  const away = o.heads.show(side);
  await settle();
  log.length = 0;
  await o.heads.show("main");
  await expect(away).rejects.toMatchObject({ name: "AbortError" });
  expect(log).toEqual(["follow:A", "connect:1", "mount:1:main"]);
  expect(edited()).toBe("A");
  expect(o.heads.shown()).toBe(first);
  expect(o.h.connected).toBe(o.h.surfaces.get(first.scene));
  expect(o.heads.snapshot()).toMatchObject({ building: null, residents: [{ key: "s1|v1|female", state: "shown" }] });
  o.gate.release("female");
  await settle();
  expect(o.heads.shown()).toBe(first);
  o.heads.dispose();
});

test("P2-iii: a view of the same look switches no document and keeps the head on screen connected until the takeover", async () => {
  const { o, log, side, looks } = lookSwitching();
  looks[side] = "A";
  await o.heads.load();
  log.length = 0;
  o.gate.open.female = false;
  const shown = o.heads.show(side);
  await settle();
  expect(log).toEqual(["unmount:1:main"]);
  expect(o.h.connected).toBe(o.h.surfaces.get(o.heads.shown()!.scene));
  o.gate.release("female");
  await shown;
  expect(log.slice(1)).toEqual(["hold:1", "connect:2", "mount:2:" + side]);
  o.heads.dispose();
});

test("P2-iii: nothing drawn keeps the head warm (drawn again with no build); a head whose view went is hidden at once, and its runtime goes once another is shown", async () => {
  const { o, side, views } = lookSwitching();
  await o.heads.load();
  const first = o.heads.shown()!, builds = o.h.builds;
  await o.heads.show(undefined);
  expect([o.heads.shown(), o.heads.shownView()]).toEqual([undefined, undefined]);
  expect(o.heads.snapshot().residents).toMatchObject([{ key: "s1|v1|female", state: "warm" }]);
  await o.heads.show("main");
  expect([o.heads.shown(), o.h.builds]).toEqual([first, builds]);
  // The side view is drawn, then its tab closes: its scene goes, and the window draws the main view again.
  await o.heads.show(side);
  const second = o.heads.shown()!;
  o.h.ports.graph!.closeView(side);
  delete views[side];
  o.gate.open.female = false;
  const back = o.heads.show("main");
  // The main view's head is warm: shown at once; the side head, hidden, goes with its scene.
  await back;
  await settle();
  expect(o.heads.shown()).toBe(first);
  expect(o.heads.snapshot().residents.map(item => item.key)).toEqual(["s1|v1|female"]);
  expect(o.h.log).toContain(`scene:dispose:${(second.scene.slot as unknown as { id: number }).id}`);
  o.heads.dispose();
});

test("P2-iii: closing a view during construction lets its surviving sibling use the shared build", async () => {
  const views: Record<string, { scene: string; subject: string }> = {};
  const o = owner({ v1: "female", v2: "female" }, [], null, views);
  try {
    const graph = o.h.ports.graph!;
    const first = graph.addView("main", {}, { label: "First" });
    const sibling = graph.addView(first, { scene: true }, { label: "Sibling" });
    views[first] = views[sibling] = { scene: "s2", subject: "v2" };
    await o.heads.load();
    const previous = o.heads.shown()!;
    o.gate.open.female = false;
    // Capture both outcomes immediately: the original requester must not roll the newer one back.
    const original = o.heads.show(first).then(() => "shown", error => error);
    await settle();
    expect(o.h.builds).toBe(2);
    expect(o.heads.shown()).toBe(previous);
    graph.closeView(first); delete views[first];
    const surviving = o.heads.show(sibling).then(() => "shown", error => error);
    expect(o.heads.snapshot().building).toMatchObject({ key: "s2|v2|female" });
    o.gate.release("female");
    expect(await surviving).toBe("shown");
    expect(await original).toBe("shown");
    expect(o.h.builds).toBe(2);
    expect(o.heads.shownView()).toBe(sibling);
    expect(o.heads.shown()!.preview.view()).toBe(sibling);
    expect(o.heads.shown()).not.toBe(previous);
    expect(o.heads.snapshot().residents).toMatchObject([
      { key: "s1|v1|female", state: "warm" }, { key: "s2|v2|female", state: "shown" },
    ]);
    expect(o.notices).toEqual([]);
  } finally { o.heads.dispose(); }
  expect(o.h.host.canvases).toBe(0);
});

test("4a-vi: each view routes to the runtime holding it: the drawn one, a warm one of its V and body, or none (loading, absent)", async () => {
  const views: Record<string, { scene: string; subject: string }> = {};
  const o = owner({ v1: "female", v2: "female", v3: "female" }, [], null, views);
  const graph = o.h.ports.graph!, side = graph.addView("main", {}, { label: "Side" }), third = graph.addView("main", {}, { label: "Third" });
  views[side] = { scene: "s2", subject: "v2" }; views[third] = { scene: "s3", subject: "v3" };
  expect(o.heads.runtimes.route("main")).toBeUndefined();
  await o.heads.load();
  const first = o.heads.shown()!;
  expect(o.heads.runtimes.route("main")).toMatchObject({ reach: "drawn", preview: first.preview, motion: first.motion });
  // Another view of the drawn scene reaches the shown head through its scene; a view of a scene nothing holds, the shown head's services
  // for graph edits only.
  const twin = graph.addView("main", { scene: true }, { label: "Twin" });
  views[twin] = { scene: "s1", subject: "v1" };
  expect(o.heads.runtimes.route(twin)).toMatchObject({ reach: "scene", preview: first.preview });
  expect(o.heads.runtimes.route(side)).toMatchObject({ reach: "absent", preview: first.preview });
  await o.heads.show(side);
  const second = o.heads.shown()!;
  expect(o.heads.runtimes.route(side)).toMatchObject({ reach: "drawn", preview: second.preview });
  // The main view's head is warm: its own services, never the shown head's.
  expect(o.heads.runtimes.route("main")).toMatchObject({ reach: "warm", preview: first.preview, motion: first.motion });
  // A view whose head is being made ready.
  o.gate.open.female = false;
  const loading = o.heads.show(third);
  await settle();
  expect(o.heads.runtimes.route(third)).toMatchObject({ reach: "loading", preview: second.preview });
  o.gate.release("female");
  await loading;
  expect(o.heads.runtimes.route("gone")).toBeUndefined();
  o.heads.dispose();
});

test("4a-vi: a head of the scene's V before a body switch holds the view no more: while the male head builds, a choice valid for him is checked against the stored ranges, not the female head's", async () => {
  const o = owner({ v1: "female" });
  await o.heads.load();
  const female = o.heads.shown()!;
  expect(o.heads.runtimes.route("main")).toMatchObject({ reach: "drawn", preview: female.preview });
  // The female head offers one eye shape (the fake scene's); the male head, still building, will offer his own.
  o.gate.open.male = false;
  female.characterContext.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  await settle();
  expect(o.heads.shown()).toBe(female);
  const route = o.heads.runtimes.route("main")!;
  expect(route.reach).toBe("loading");
  // Sol's reproduction: shape 5 is valid for the male head; the female head's options no longer decide it.
  const choice = { kind: "preview.setEyeShape" as const, view: "main", index: 5 };
  expect(route.preview.check(choice, route.reach)).toEqual({ available: true });
  expect(female.preview.check(choice, "drawn")).toMatchObject({ available: false, code: "invalid_value" });
  // Shown, the male head holds the view again.
  o.gate.release("male");
  await settle();
  const male = o.heads.shown()!;
  expect(male.body).toBe("male");
  expect(o.heads.runtimes.route("main")).toMatchObject({ reach: "drawn", preview: male.preview });
  // And the female head, warm, is no longer the view's: the V is male now.
  expect(o.heads.runtimes.route("main")!.preview).not.toBe(female.preview);
  o.heads.dispose();
});

test("4a-v: show(view) wants the head of that view's scene like any subject change; the head shown stays until it is ready, and a missing view is refused", async () => {
  const views: Record<string, { scene: string; subject: string }> = {};
  const o = owner({ v1: "female", v2: "female" }, [], null, views);
  // A second view of the graph, on a scene of its own.
  const side = o.h.ports.graph!.addView("main", {}, { label: "Side" });
  views[side] = { scene: "s2", subject: "v2" };
  await o.heads.load();
  const first = o.heads.shown()!;
  o.gate.open.female = false;
  const shown = o.heads.show(side);
  await settle();
  expect(o.heads.shown()).toBe(first);
  expect(o.heads.preparation()).toMatchObject({ scene: "s2", key: "s2|v2|female" });
  o.gate.release("female");
  await shown;
  expect(o.heads.shownView()).toBe(side);
  // The head shown draws that view (its preview follows its nodes).
  expect(o.heads.shown()!.preview.view()).toBe(side);
  expect(o.heads.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual(["s1|v1|female:warm", "s2|v2|female:shown"]);
  // Back to the main view: its head is warm, so it is shown at once.
  const builds = o.h.builds;
  await o.heads.show("main");
  expect(o.heads.shown()).toBe(first);
  expect(o.h.builds).toBe(builds);
  await expect(o.heads.show("gone")).rejects.toThrow("no longer exists");
  o.heads.dispose();
});

test("4a-v-b: a shown head asked for a lighting setup it isn't prepared for is prepared again while it stays shown, with its progress, and a want for another V supersedes it", async () => {
  const o = owner({ v1: "female" });
  await o.heads.load();
  const head = o.heads.shown()!, made = o.h.scenes.at(-1)!;
  let ready = true, release!: () => void;
  const prepares: unknown[] = [];
  made.known.prepared = () => ready;
  made.known.prepare = (options: { signal: AbortSignal; setups?: unknown }) => {
    prepares.push(options.setups);
    return new Promise<void>((resolve, reject) => { release = () => { ready = true; resolve(); }; options.signal.addEventListener("abort", () => reject(options.signal.reason)); });
  };
  const before = o.preparations.length;
  ready = false;
  made.unprepare();
  await settle();
  // The shown head's scene alone is prepared again (no details, no other setups), and it stays the one shown.
  expect(prepares).toEqual([undefined]);
  expect(o.heads.shown()).toBe(head);
  expect(o.heads.preparation()).toMatchObject({ key: "s1|v1|female", change: "shown", warm: true });
  release();
  for (let i = 0; i < 20 && o.heads.preparation(); i++) await settle();
  expect(o.heads.preparation()).toBeNull();
  expect(o.preparations.slice(before).filter(Boolean).every(state => state!.change === "shown")).toBe(true);
  expect(o.heads.shown()).toBe(head);
  // Asked again, then the V changes body: the new head's want supersedes the shown head's preparation.
  ready = false;
  made.unprepare();
  await settle();
  head.characterContext.dispatch({ kind: "character.useDefault", bodyGender: "male" });
  for (let i = 0; i < 40 && o.heads.shown() === head; i++) await settle();
  expect(o.heads.shown()?.body).toBe("male");
  o.heads.dispose();
});
