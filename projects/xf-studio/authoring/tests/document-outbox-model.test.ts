/**
 * The outbox against a reference model (profiles design §2.2), in seeded random runs. The model is the outbox's rules stated plainly, in
 * memory and slowly: no keys, stamps, storage or repair. A run drives the real outbox (window A, over the real document store) and the
 * model with the same random sequence of edits on one and several documents, immutable puts and commands that require them, sends,
 * acknowledgements, stale answers, lost answers and failed sends, Keep mine, Use theirs and Keep both, revision checks, restarts that read
 * the keys back in a shuffled order, kills between any two key writes, and a second window (B) writing the same documents.
 *
 * After every step:
 * - A's visible state (every document's value, which entries are pending and which are in conflict) equals the model's; after a kill it
 *   equals the model's state either before or after the step the kill interrupted (each key write is atomic, a step's are not);
 * - every request A sends is one the model expects to be sendable, with the values the model holds for it (A1, A2);
 * - no conflict is against A's own write: some revision past the entry's base was written by another window;
 * - every reference to an immutable document in the library resolves.
 * At the end, once everything is delivered and every conflict resolved: every save's promise has settled, A sees what the library holds,
 * and nothing A recorded is lost (the library holds A's last value for every document A wrote last).
 *
 * A failing run prints its seed and the step: `XFS_OUTBOX_SEED=<seed> bun test tests/document-outbox-model.test.ts` replays it.
 */
import { expect, test } from "bun:test";
import { DocumentOutbox, type OutboxEntry } from "../src/platform/core/document-outbox";
import { documentKey, type DocumentRef, type TransactAnswer, type TransactRequest } from "../src/platform/api/document-commands";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";

type Value = { w: string; n: number; ref?: string } | { blob: string };
const DOCS = ["d0", "d1", "d2", "d3"].map(id => ({ kind: "doc", id }));
const BLOBS = ["b0", "b1", "b2"].map(id => ({ kind: "blob", id }));
const immutable = (kind: string) => kind === "blob";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function random(seed: number) {
  let state = seed >>> 0;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
}

// ---------------------------------------------------------------------------------------------------------------------
// The model: the outbox's rules, plainly.

type MBase = number | { after: string };
type MEntry = { id: string; writes: { key: string; base: MBase; value: unknown }[]; frozen: boolean; state: "queued" | "conflict";
  theirs?: Record<string, { revision: number; value: unknown } | null>; requires: string[]; put: boolean };
type Model = { entries: MEntry[]; baseline: Record<string, { revision: number; value: unknown }> };
const clone = (model: Model): Model => structuredClone(model);
const touching = (model: Model, key: string) => model.entries.filter(entry => entry.writes.some(write => write.key === key));
const lastFor = (model: Model, key: string) => touching(model, key).at(-1);
const baseFor = (model: Model, key: string): MBase => { const last = lastFor(model, key); return last ? { after: last.id } : model.baseline[key]?.revision ?? 0; };
function visible(model: Model, key: string): unknown {
  const last = lastFor(model, key);
  return last ? last.writes.find(write => write.key === key)!.value : model.baseline[key]?.value;
}
const repoint = (model: Model, from: string, to: (key: string) => MBase) => {
  for (const entry of model.entries) for (const write of entry.writes) if (typeof write.base === "object" && write.base.after === from) write.base = to(write.key);
};
/** A command recorded: the id the real outbox gave it, or a coalesce into an earlier one. */
function modelCommit(model: Model, id: string, edits: { key: string; value: unknown }[], requires: string[]): "new" | "coalesced" {
  if (edits.length === 1) {
    const last = lastFor(model, edits[0]!.key);
    if (last && last.writes.length === 1 && !last.put && (!last.frozen || last.state === "conflict")) {
      last.writes[0]!.value = edits[0]!.value;
      last.requires = [...new Set([...last.requires, ...requires])];
      return "coalesced";
    }
  }
  model.entries.push({ id, writes: edits.map(edit => ({ key: edit.key, base: baseFor(model, edit.key), value: edit.value })), frozen: false, state: "queued",
    requires: [...new Set(requires)], put: false });
  return "new";
}
function sendable(model: Model, entry: MEntry): boolean {
  if (entry.state !== "queued" || entry.writes.some(write => typeof write.base !== "number")) return false;
  return entry.requires.every(key => !touching(model, key).length && (model.baseline[key]?.revision ?? 0) > 0);
}
function modelAck(model: Model, id: string, revisions: Readonly<Record<string, number>>, current?: Record<string, { revision: number; value: unknown } | null>) {
  const entry = model.entries.find(item => item.id === id)!;
  model.entries = model.entries.filter(item => item !== entry);
  for (const write of entry.writes) {
    const revision = revisions[write.key]!;
    if (revision >= (model.baseline[write.key]?.revision ?? 0)) model.baseline[write.key] = { revision, value: current?.[write.key] ? current[write.key]!.value : write.value };
  }
  repoint(model, id, key => revisions[key] ?? 0);
}
function modelStale(model: Model, id: string, current: Record<string, { revision: number; value: unknown } | null>) {
  const entry = model.entries.find(item => item.id === id)!;
  if (entry.put) { modelAck(model, id, Object.fromEntries(entry.writes.map(write => [write.key, current[write.key]?.revision ?? 0])), current); return; }
  entry.state = "conflict"; entry.theirs = current;
  if (entry.writes.length !== 1) return;
  const key = entry.writes[0]!.key;
  for (const other of [...model.entries]) {
    if (other === entry || other.writes.length !== 1 || other.writes[0]!.key !== key) continue;
    const base = other.writes[0]!.base;
    if (typeof base === "object" && base.after === id) {
      entry.writes[0]!.value = other.writes[0]!.value;
      entry.requires = [...new Set([...entry.requires, ...other.requires])];
      model.entries = model.entries.filter(item => item !== other);
      repoint(model, other.id, () => ({ after: id }));
    }
  }
}
function modelTheirs(model: Model, entry: MEntry) {
  for (const write of entry.writes) { const now = entry.theirs?.[write.key]; model.baseline[write.key] = { revision: now?.revision ?? 0, value: now?.value }; }
  repoint(model, entry.id, key => entry.writes.find(write => write.key === key)?.base ?? 0);
  model.entries = model.entries.filter(item => item !== entry);
}
/** What the real outbox shows, in the model's terms. */
function signature(read: (key: string) => unknown, entries: readonly { id: string; state: string; bases: [string, MBase][] }[], keys: readonly string[]) {
  return JSON.stringify({ visible: keys.map(key => [key, read(key) ?? null]), entries: entries.map(entry => [entry.id, entry.state, entry.bases]) });
}
const modelSignature = (model: Model, keys: readonly string[]) => signature(key => visible(model, key),
  model.entries.map(entry => ({ id: entry.id, state: entry.state, bases: entry.writes.map(write => [write.key, write.base] as [string, MBase]) })), keys);

// ---------------------------------------------------------------------------------------------------------------------
// One run.

type Sent = { window: string; life: number; request: TransactRequest; resolve(answer: TransactAnswer): void; reject(error: Error): void };

/** What the runs exercised (printed once): every kind of event must come up. */
const seen: Record<string, number> = {};
const count = (name: string) => { seen[name] = (seen[name] ?? 0) + 1; };
async function run(seed: number, steps: number) {
  const rng = random(seed), documents = storeDocuments(), store = documents.store;
  const keys = [...DOCS, ...BLOBS].map(documentKey);
  /** Who wrote each revision of each document (the false-conflict check). */
  const writers = new Map<string, string[]>();
  const queue: Sent[] = [], retries: { window: string; run(): void }[] = [];
  const failures: string[] = [];
  const trace: string[] = [];
  const fail = (step: number, message: string) => { failures.push(`seed ${seed}, step ${step}: ${message}` + (process.env.XFS_OUTBOX_TRACE ? [""].concat(trace.slice(-60)).join(String.fromCharCode(10)) : "")); };
  const deliver = (sent: Sent, mode: "ok" | "lose" | "fail") => {
    queue.splice(queue.indexOf(sent), 1);
    if (mode === "fail") { count("deliver fail"); sent.reject(Error("The host didn't answer.")); return null; }
    const answer = store.transact(sent.request);
    trace.push(`deliver ${mode} ${sent.window}${sent.life} ${sent.request.id} -> ${JSON.stringify(answer)}`);
    if (answer.ok && !answer.replayed) for (const write of sent.request.writes) {
      const list = writers.get(documentKey(write)) ?? []; list[answer.revisions[documentKey(write)]!] = sent.window; writers.set(documentKey(write), list);
    }
    count(`answer ${answer.ok ? answer.replayed ?? "ok" : answer.reason}`); count(`deliver ${mode}`);
    if (mode === "lose") sent.reject(Error("The answer was lost.")); else sent.resolve(answer);
    return answer;
  };
  let sentStep = 0, adopting = false;
  const deferred: TransactRequest[] = [];
  /** A sends only what the model holds as sendable, with the model's values; from here it is frozen (A1). */
  const checkSend = (request: TransactRequest) => {
        const entry = model.entries.find(item => item.id === request.id);
        if (!entry) fail(sentStep, `A sent ${request.id}, which the model doesn't hold`);
        else {
          if (!sendable(model, entry)) fail(sentStep, `A sent ${request.id}, which the model doesn't hold as sendable`);
          if (!same(request.writes.map(write => [documentKey(write), write.base, write.value]), entry.writes.map(write => [write.key, write.base, write.value])))
            fail(sentStep, `A sent ${request.id} with other bases or values than the model's: ${JSON.stringify(request.writes.map(write => [write.id, write.base, write.value]))} against ${JSON.stringify(entry.writes.map(write => [write.key, write.base, write.value]))}; model ${JSON.stringify(model.entries.map(item => [item.id, item.state, item.writes.map(write => [write.key, write.base])]))}`);
          entry.frozen = true;
        }
  };
  const transport = (window: string, life: () => number): DocumentStorePort => ({ ...documents,
    transact: request => new Promise((resolve, reject) => {
      const mine = life();
      // While a killed A restarts, which side of the interrupted step it is on isn't known yet: its sends are checked once it is.
      if (window === "A" && mine === lifeNow()) { if (adopting) deferred.push(structuredClone(request)); else checkSend(request); }
      trace.push(`send ${window}${mine} ${request.id} ${JSON.stringify(request.writes.map(write => [write.id, write.base, write.value]))}`);
      queue.push({ window, life: mine, request: structuredClone(request), resolve, reject });
    }) });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  // Window A: the outbox under test, its storage, and the model.
  const storage = memoryOutboxStorage();
  let life = 0, model: Model = { entries: [], baseline: {} };
  const lifeNow = () => life;
  const waits: { id: string; done: boolean }[] = [];
  let a!: DocumentOutbox;
  const openA = () => {
    life++;
    const mine = life;
    // A restart reads the keys back in any order.
    const load = storage.load.bind(storage);
    const shuffled = { ...storage, load: () => { const entries = [...load()]; for (let i = entries.length - 1; i > 0; i--) { const j = rng.int(i + 1); [entries[i], entries[j]] = [entries[j]!, entries[i]!]; } return new Map(entries); },
      write: storage.write.bind(storage) };
    a = new DocumentOutbox(transport("A", () => mine), shuffled, { immutable, newId: () => `a${seed}-${mine}-${Math.floor(rng.next() * 1e9).toString(36)}`,
      schedule: (_ms, task) => { const item = { window: "A", run: task }; retries.push(item); return { cancel: () => { const at = retries.indexOf(item); if (at >= 0) retries.splice(at, 1); } }; } });
    // An owner reads its documents from the library before anything else.
    for (const ref of keys.map(refOf)) { const now = store.get(ref.kind, ref.id); a.hold(ref, now ? { revision: now.revision, value: now.value } : null); }
    // A check the outbox makes by itself (the host answered again after failing) is a change from elsewhere the model hears of too.
    a.subscribe(event => {
      if (event.kind !== "external" || mine !== life) return;
      for (const ref of event.refs) { const now = store.get(ref.kind, ref.id)!; model.baseline[documentKey(ref)] = { revision: now.revision, value: now.value }; }
    });
    a.open();
    // Every change the restarted page holds has a caller waiting for it again (an owner's save, re-asked).
    for (const entry of a.pendingEntries()) track(entry);
    // The model: what was stored stays, every entry may have been sent, and the owner's read is the baseline.
    for (const entry of model.entries) entry.frozen = true;
    for (const key of keys) { const ref = refOf(key), now = store.get(ref.kind, ref.id); model.baseline[key] = { revision: now?.revision ?? 0, value: now?.value }; }
  };
  const refOf = (key: string): DocumentRef => ({ kind: key.split("/")[0]!, id: key.slice(key.indexOf("/") + 1) });
  const realSignature = () => signature(key => a.document(refOf(key))?.value,
    a.pendingEntries().map(entry => ({ id: entry.id, state: entry.state, bases: entry.writes.map(write => [documentKey(write), write.base] as [string, MBase]) })), keys);
  const track = (entry: OutboxEntry | null) => {
    if (!entry || waits.some(item => item.id === entry.id && !item.done)) return;
    const item = { id: entry.id, done: false };
    waits.push(item);
    void a.settled(entry.id).then(() => { item.done = true; });
  };

  // Window B: a second window on the same documents, resolving its conflicts as a person would (Keep mine).
  const storageB = memoryOutboxStorage();
  const b = new DocumentOutbox(transport("B", () => 0), storageB, { immutable, newId: () => `b${seed}-${Math.floor(rng.next() * 1e9).toString(36)}`,
    schedule: (_ms, task) => { const item = { window: "B", run: task }; retries.push(item); return { cancel: () => { const at = retries.indexOf(item); if (at >= 0) retries.splice(at, 1); } }; } });
  for (const ref of DOCS) b.hold(ref, null);
  b.open();
  b.subscribe(event => { if (event.kind === "conflict") queueMicrotask(() => { if (b.conflicts().some(item => item.id === event.entry.id)) b.keepMine(event.entry.id); }); });

  openA();
  let counter = 0;
  const value = (window: string, ref?: string): Value => ({ w: window, n: ++counter, ...(ref ? { ref } : {}) });

  /** Runs a step's work on A, with the model's expectation; a kill may interrupt it (then the state after a restart is either side). */
  const onA = async (step: number, work: () => void, killable: boolean) => {
    const before = clone(model);
    const kill = killable && rng.next() < 0.08;
    trace.push(`step ${step}${kill ? " (kill)" : ""}`);
    if (kill) storage.killAfter(rng.int(3), () => a.stop());
    try { work(); } catch (error) { if (!a.status().stopped) throw error; }
    await settle();
    storage.killAfter(Infinity);
    if (!a.status().stopped) return;
    count("kill");
    // Killed: A restarts from what reached its keys.
    await restartKilled(step, before);
  };
  /** A killed A restarts; its state is the model's after the interrupted step, or before it (each key write is atomic, a step's aren't). */
  const restartKilled = async (step: number, before: Model, between: Model[] = [], acked?: { id: string; revisions: Readonly<Record<string, number>> }) => {
    const candidates = [model, ...between, before];
    adopting = true;
    openA();
    await settle();
    const real = realSignature();
    const fresh = (candidate: Model) => {
      for (const entry of candidate.entries) entry.frozen = true;
      for (const key of keys) { const ref = refOf(key), now = store.get(ref.kind, ref.id); candidate.baseline[key] = { revision: now?.revision ?? 0, value: now?.value }; }
      return candidate;
    };
    let match = candidates.map(fresh).find(candidate => modelSignature(candidate, keys) === real);
    if (!match && acked && between[0]) {
      // Part-way through an acknowledgement each successor's key may or may not have been rewritten yet: based after the acknowledged
      // entry, or on the revision it was acknowledged at. Both mean the same once its replay is answered by its receipt.
      const normal = (text: string) => { const value = JSON.parse(text);
        for (const entry of value.entries) entry[2] = entry[2].map(([key, base]: [string, MBase]) => [key, typeof base === "object" && base.after === acked.id ? acked.revisions[key] : base]);
        return JSON.stringify(value); };
      if (normal(real) === normal(modelSignature(between[0], keys))) {
        match = between[0];
        for (const entry of a.pendingEntries()) {
          const mine = match.entries.find(item => item.id === entry.id);
          if (mine) for (const write of mine.writes) write.base = structuredClone(entry.writes.find(item => documentKey(item) === write.key)!.base);
        }
      }
    }
    if (match) { model = match; count(`adopted ${candidates.indexOf(match) === 0 ? "after" : candidates.indexOf(match) === candidates.length - 1 ? "before" : "between"}`); }
    else {
      const diff = (text: string) => { const a1 = JSON.parse(real), b1 = JSON.parse(text);
        return JSON.stringify({ visible: a1.visible.filter((item: unknown, i: number) => !same(item, b1.visible[i])), mine: a1.entries.filter((item: unknown) => !b1.entries.some((other: unknown) => same(item, other))),
          model: b1.entries.filter((item: unknown) => !a1.entries.some((other: unknown) => same(item, other))) }); };
      fail(step, `after a kill A differs from every candidate: ${candidates.map(candidate => diff(modelSignature(candidate, keys))).join(" | ")}`);
    }
    adopting = false;
    for (const request of deferred.splice(0)) checkSend(request);
  };

  for (let step = 0; step < steps && !failures.length; step++) {
    sentStep = step;
    const roll = rng.next();
    if (roll < 0.22) {
      // A edits one document.
      const ref = rng.pick(DOCS), next = value("A");
      await onA(step, () => {
        const entry = a.commit("edit", [{ ...ref, value: next }]);
        if (modelCommit(model, entry.id, [{ key: documentKey(ref), value: next }], []) === "coalesced" && !model.entries.some(item => item.id === entry.id))
          fail(step, `A coalesced into ${entry.id}, which the model doesn't hold`);
        track(entry);
      }, true);
    } else if (roll < 0.29) {
      // A edits two documents in one command.
      const [one, two] = [rng.pick(DOCS), rng.pick(DOCS)];
      if (one!.id === two!.id) continue;
      const edits = [{ ...one!, value: value("A") }, { ...two!, value: value("A") }];
      await onA(step, () => {
        const entry = a.commit("pair", edits);
        modelCommit(model, entry.id, edits.map(edit => ({ key: documentKey(edit), value: edit.value })), []);
        track(entry);
      }, true);
    } else if (roll < 0.35) {
      // A puts an immutable document (content-addressed: its value is its ID) and records a command that references it.
      const blob = rng.pick(BLOBS), ref = rng.pick(DOCS), next = value("A", blob.id);
      await onA(step, () => {
        const put = a.put(blob, { blob: blob.id });
        if (put) model.entries.push({ id: put.id, writes: [{ key: documentKey(blob), base: 0, value: { blob: blob.id } }], frozen: false, state: "queued", requires: [], put: true });
        else if (visible(model, documentKey(blob)) === undefined) fail(step, "A put nothing for a document it doesn't hold");
        track(put);
      }, true);
      // The command naming it is a command of its own: a kill may fall between the two.
      await onA(step, () => {
        const entry = a.commit("edit", [{ ...ref, value: next }], { requires: [blob] });
        modelCommit(model, entry.id, [{ key: documentKey(ref), value: next }], [documentKey(blob)]);
        track(entry);
      }, true);
    } else if (roll < 0.46) {
      // B edits.
      const ref = rng.pick(DOCS.slice(0, 3));
      b.commit("edit", [{ ...ref, value: value("B") }]);
      await settle();
    } else if (roll < 0.74) {
      // The host answers a request, loses its answer, or never gets it.
      if (!queue.length) continue;
      const sent = rng.pick(queue), mode = rng.next() < 0.8 ? "ok" : rng.next() < 0.5 ? "lose" : "fail";
      const live = sent.window === "A" && sent.life === life;
      const before = clone(model);
      const answer = deliver(sent, mode);
      if (answer && !answer.ok && answer.reason === "stale" && live) {
        // No conflict against A's own write: a revision past the base was written by another window.
        const foreign = sent.request.writes.some(write => {
          const list = writers.get(documentKey(write)) ?? [], now = answer.current[documentKey(write)]?.revision ?? 0;
          for (let revision = write.base + 1; revision <= now; revision++) if (list[revision] !== "A") return true;
          return false;
        });
        if (!foreign && !sent.request.writes.every(write => immutable(write.kind))) fail(step, `A's ${sent.request.id} went stale against its own writes`);
      }
      if (answer && live && mode === "ok") {
        const kill = rng.next() < 0.08;
        if (kill) storage.killAfter(rng.int(3), () => a.stop());
        if (answer.ok) modelAck(model, sent.request.id, answer.revisions);
        else if (answer.reason === "stale") modelStale(model, sent.request.id, { ...answer.current });
        await settle();
        storage.killAfter(Infinity);
        // A kill part-way through an acknowledgement may leave the entry under a key not yet rewritten, its successors already rebased
        // under another: it is sent again and answered by its receipt.
        const acked = before.entries.find(entry => entry.id === sent.request.id);
        const between: Model[] = [];
        if (answer.ok && acked) {
          const partial = clone(model);
          partial.entries.splice(before.entries.indexOf(acked), 0, structuredClone(acked));
          between.push(partial);
        }
        if (a.status().stopped) { count("kill during an answer"); await restartKilled(step, before, between, answer.ok ? { id: sent.request.id, revisions: answer.revisions } : undefined); }
      }
      await settle();
    } else if (roll < 0.8) {
      // Resends after a failure.
      for (const item of retries.splice(0)) item.run();
      await settle();
    } else if (roll < 0.88) {
      // A resolves a conflict.
      const conflict = a.conflicts()[0];
      if (!conflict) continue;
      const how = rng.pick(["mine", "theirs", "both"] as const);
      count(`resolve ${how}`);
      const entry = model.entries.find(item => item.id === conflict.id);
      if (!entry || entry.state !== "conflict") { fail(step, `A's conflict ${conflict.id} isn't the model's`); break; }
      await onA(step, () => {
        if (how === "mine") {
          const fresh = a.keepMine(conflict.id);
          const replacement: MEntry = { ...structuredClone(entry), id: fresh.id, state: "queued", frozen: false, theirs: undefined,
            writes: entry.writes.map(write => ({ key: write.key, base: entry.theirs?.[write.key]?.revision ?? 0, value: write.value })) };
          model.entries = model.entries.map(item => item === entry ? replacement : item);
          repoint(model, entry.id, () => ({ after: fresh.id }));
        } else if (how === "theirs") {
          a.useTheirs(conflict.id);
          modelTheirs(model, entry);
        } else {
          const copy = a.keepBoth(conflict.id, mine => mine.map(edit => ({ ...edit, id: `${edit.id}~${counter}` })));
          const writes = entry.writes.map(write => ({ key: `${write.key}~${counter}`, value: write.value }));
          modelTheirs(model, entry);
          model.entries.push({ id: copy.id, writes: writes.map(write => ({ ...write, base: baseFor(model, write.key) })), frozen: false, state: "queued",
            requires: [...entry.requires], put: false });
          for (const write of writes) if (!keys.includes(write.key)) { keys.push(write.key); model.baseline[write.key] = { revision: 0, value: undefined }; }
          track(copy);
        }
      }, true);
    } else if (roll < 0.92) {
      // A revision check (A7).
      await a.check();
      await settle();
    } else if (roll < 0.95) {
      // A restarts (the window reloads, nothing torn).
      count("restart"); a.stop(); await settle(); openA(); await settle();
    } else continue;

    // Invariants after every step.
    const real = realSignature(), expected = modelSignature(model, keys);
    if (real !== expected) {
      const a1 = JSON.parse(real), b1 = JSON.parse(expected);
      fail(step, `A differs from the model: ${JSON.stringify({ visible: a1.visible.filter((item: unknown, i: number) => !same(item, b1.visible[i])),
        mine: a1.entries.filter((item: unknown) => !b1.entries.some((other: unknown) => same(item, other))),
        model: b1.entries.filter((item: unknown) => !a1.entries.some((other: unknown) => same(item, other))) })}`);
    }
    for (const ref of DOCS) {
      const ref2 = (store.get<Value>(ref.kind, ref.id)?.value as { ref?: string } | undefined)?.ref;
      if (ref2 && !store.get("blob", ref2)) fail(step, `${ref.id} references ${ref2}, which the library doesn't hold`);
    }
  }

  // Quiescence: everything delivered, every conflict resolved (Keep mine), A checks once more.
  for (let round = 0; round < 400 && !failures.length; round++) {
    for (const item of retries.splice(0)) item.run();
    await settle();
    const sent = queue[0];
    if (sent) {
      const live = sent.window === "A" && sent.life === life;
      const answer = deliver(sent, "ok");
      if (answer && live) { if (answer.ok) modelAck(model, sent.request.id, answer.revisions); else if (answer.reason === "stale") modelStale(model, sent.request.id, { ...answer.current }); }
      await settle();
      continue;
    }
    const conflict = a.conflicts()[0];
    if (conflict) {
      const entry = model.entries.find(item => item.id === conflict.id)!;
      const fresh = a.keepMine(conflict.id);
      model.entries = model.entries.map(item => item === entry ? { ...structuredClone(entry), id: fresh.id, state: "queued", frozen: false, theirs: undefined,
        writes: entry.writes.map(write => ({ key: write.key, base: entry.theirs?.[write.key]?.revision ?? 0, value: write.value })) } : item);
      repoint(model, entry.id, () => ({ after: fresh.id }));
      await settle();
      continue;
    }
    if (!a.pendingEntries().length && !b.pendingEntries().length && !queue.length) break;
  }
  if (!failures.length) {
    if (a.pendingEntries().length || b.pendingEntries().length) fail(steps, `not quiet: A holds ${a.pendingEntries().length}, B ${b.pendingEntries().length}`);
    await a.check();
    await settle();
    for (const key of keys) {
      const ref = refOf(key), held = store.get(ref.kind, ref.id)?.value;
      if (!same(a.document(ref)?.value, held)) fail(steps, `A shows ${JSON.stringify(a.document(ref)?.value)} for ${key}, the library ${JSON.stringify(held)}`);
      if (!same(visible(model, key), held)) fail(steps, `the model shows ${JSON.stringify(visible(model, key))} for ${key}, the library ${JSON.stringify(held)}`);
    }
    const open = waits.filter(item => !item.done);
    if (open.length) fail(steps, `${open.length} save promise(s) never settled (${open.map(item => item.id).join(", ")})`);
  }
  b.stop(); a.stop();
  return failures;
}

const pinned = process.env.XFS_OUTBOX_SEED;
const SEEDS = pinned ? [Number(pinned)] : Array.from({ length: Number(process.env.XFS_OUTBOX_RUNS ?? 100) }, (_, i) => 1000 + i * 7919);
const STEPS = 500;
test(`the outbox matches its reference model over ${SEEDS.length} seeded runs (kills, restarts in any key order, two windows)`, async () => {
  const all: string[] = [];
  let steps = 0;
  for (const seed of SEEDS) { const failures = await run(seed, STEPS); steps += STEPS; if (failures.length) { all.push(failures[0]!); console.log(failures[0]); } }
  console.log(JSON.stringify({ seeds: SEEDS.length, steps, seen }));
  expect(all).toEqual([]);
  if (!pinned) for (const name of ["kill", "kill during an answer", "adopted after", "adopted before", "restart", "resolve mine", "resolve theirs", "resolve both",
    "answer stale", "answer receipt", "answer equal", "deliver lose", "deliver fail"]) expect(seen[name] ?? 0, name).toBeGreaterThan(0);
}, 600_000);
