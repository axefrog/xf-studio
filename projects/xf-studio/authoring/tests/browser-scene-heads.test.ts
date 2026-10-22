/**
 * Profiles phase 4a-iv (experiment 043 §10): the window's scene runtime owner over the real head attachment and viewport device, with fake
 * scenes. A body switch supersedes: the V shown before stays drawn until the new head is built, the last choice is what ends up shown, a
 * superseded masculine core's preparation is stopped (D1), and a late build is disposed, never shown. The V's context outlives the heads:
 * it stays attached across a swap (no `not_ready` while a head loads), and a warm head is shown again at once.
 */
import { expect, test } from "bun:test";
import { createBrowserSceneHeads, type SceneHeadsPorts } from "../src/preview/browser/browser-scene-heads";
import type { CharacterScenePorts } from "../src/character/character-service";
import { CharacterContextActions } from "../src/character/character-context-actions";
import type { AttachedHead } from "../src/preview/browser/browser-head-attachment";
import { vHistory } from "./fixtures/character-steps";
import { creator, harness } from "./fixtures/fake-heads";

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

function owner(bodies: Record<string, "female" | "male">, failBuild: number[] = []) {
  const scene = { subject: Object.keys(bodies)[0]! };
  const gate = gates(), h = harness({ build: gate.build, failBuild }), people = characterOwner(bodies);
  const listeners = new Set<() => void>(), shown: (AttachedHead | undefined)[] = [], notices: string[] = [], pending: string[] = [];
  const prepared: { body: string; signal: AbortSignal }[] = [];
  let prepare: (body: string, signal: AbortSignal) => Promise<void> = async () => {};
  const heads = createBrowserSceneHeads({
    head: { ...h.ports },
    scenes: { drawn: () => "s1", subject: () => scene.subject, ensureSubject: async () => scene.subject,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    characters: people.port,
    prepareCore: (body, _pending, signal) => { prepared.push({ body, signal }); return prepare(body, signal); },
    pending: message => pending.push(message), notice: text => notices.push(text),
    shown: head => shown.push(head), previews: null,
  });
  return { h, gate, people, heads, shown, notices, pending, prepared, scene, listeners,
    setPrepare(next: typeof prepare) { prepare = next; },
    changeScene() { for (const listener of listeners) listener(); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("a superseding body switch shows the last choice: the female V stays drawn while the male head builds, and back to female the male build and its core preparation stop (D1)", async () => {
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
  // Back to female: the male build and his core's preparation stop; the female head is still the one shown.
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
