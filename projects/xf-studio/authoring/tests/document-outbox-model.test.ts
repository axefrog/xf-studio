/**
 * The outbox against a reference specification (profiles design §2.2), in seeded random runs.
 *
 * **The specification** is written in its own terms, with none of the outbox's structures: per document, the value the library
 * acknowledged; an ordered list of pending intents (each the values one command writes, the immutable documents it requires and the
 * callers waiting on it); conflicts as explicit records holding the library's values. Its rules are the design's, stated plainly: an edit
 * joins the newest intent on its document while that intent is unsent or in conflict; an intent waits for every earlier intent on its
 * documents; an answer removes it and gives the next intent on each document its base; a stale answer makes it a conflict and folds the
 * single-document intents behind it into it; Keep mine, Use theirs and Keep both; a revision check takes newer values of documents with no
 * intent. The visible value of a document is its last intent's value, else the acknowledged one.
 *
 * **A run** drives the real outbox (window A) over the real document store, and the specification, through the same random sequence:
 * edits on one and several documents; immutable puts (by A, and concurrently by window B) and commands that require them; sends,
 * acknowledgements, stale answers, lost answers and failed sends; Keep mine, Use theirs and Keep both; revision checks whose answers come
 * late; window B's edits; storage writes that fail; clean restarts that read the keys back in a shuffled order; and kills after any number
 * of key writes, during a step or during the opening and repair that follow one, repeatedly. In the desktop mode the outbox's storage is
 * the desktop adapter, and each host write of a key is its own step, which lands or fails.
 *
 * **After every step:**
 * - A's visible values and its pending intents and conflicts equal the specification's. After a kill, they equal one of the states the
 *   specification allows for the interrupted step, computed from the specification alone: its state before the step, after it, or (for an
 *   acknowledgement) after it with the acknowledged intent still to be replayed;
 * - every request A sends is one the specification holds as sendable, with the base and values it gives it;
 * - no conflict is against A's own write;
 * - every document A doesn't report unprotected recovers from the durable storage (memory, or the desktop host's copy) with its visible
 *   value;
 * - every caller's outcome, once it has one, is the specification's (acknowledged, dropped, or stopped by a restart), coalesced callers
 *   each counted;
 * - every reference to an immutable document in the library resolves, Keep both copies included.
 * At the end, with everything delivered and every conflict resolved, every caller has its outcome and A, the specification and the library
 * agree.
 *
 * A failing run prints its mode, seed and step: `XFS_OUTBOX_SEED=<seed> [XFS_OUTBOX_MODE=local|desktop] [XFS_OUTBOX_TRACE=1]` replays it.
 */
import { expect, test } from "bun:test";
import { DocumentOutbox, type OutboxEntry, type OutboxOutcome } from "../src/platform/core/document-outbox";
import { type CurrentDocument, documentKey, type DocumentRef, type TransactAnswer, type TransactRequest } from "../src/platform/api/document-commands";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { desktopOutboxStorage } from "../src/app/browser/outbox-storage";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";

const DOCS = ["d0", "d1", "d2", "d3"].map(id => ({ kind: "doc", id }));
const BLOBS = ["b0", "b1", "b2"].map(id => ({ kind: "blob", id }));
const immutable = (kind: string) => kind === "blob";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const refOf = (key: string): DocumentRef => ({ kind: key.slice(0, key.indexOf("/")), id: key.slice(key.indexOf("/") + 1) });

function random(seed: number) {
  let state = seed >>> 0;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
}

// ---------------------------------------------------------------------------------------------------------------------
// The specification.

type Caller = { id: number; expected: OutboxOutcome | null; actual: OutboxOutcome | null };
type Intent = {
  id: string;
  /** The values it writes, in the command's order. */
  writes: [string, unknown][];
  put: boolean;
  requires: string[];
  conflict: { theirs: Record<string, CurrentDocument> } | null;
  /** Sent at least once (it can no longer take an edit, unless it is a conflict). */
  sent: boolean;
  /** The base each document is sent over: known once every earlier intent on that document has an answer; null until then. */
  bases: Record<string, number | null>;
  /** The library already holds it (its answer was lost): it is replayed, and answered by its receipt. */
  committed: Record<string, number> | null;
  callers: Caller[];
};
type Spec = { docs: Record<string, { revision: number; value: unknown }>; intents: Intent[] };
const keysOf = (intent: Intent) => intent.writes.map(([key]) => key);
const touching = (spec: Spec, key: string) => spec.intents.filter(intent => keysOf(intent).includes(key));
function visible(spec: Spec, key: string): unknown {
  const last = touching(spec, key).at(-1);
  return last ? last.writes.find(([item]) => item === key)![1] : spec.docs[key]?.value;
}
/** The next intent after `index` on `key`. */
const nextOn = (spec: Spec, index: number, key: string) => spec.intents.slice(index + 1).find(intent => keysOf(intent).includes(key));
function record(spec: Spec, id: string, edits: [string, unknown][], requires: string[], caller: Caller): "joined" | "new" {
  if (edits.length === 1) {
    const last = touching(spec, edits[0]![0]).at(-1);
    if (last && last.writes.length === 1 && !last.put && (!last.sent || last.conflict)) {
      last.writes[0]![1] = edits[0]![1];
      last.requires = [...new Set([...last.requires, ...requires])];
      last.callers.push(caller);
      return "joined";
    }
  }
  spec.intents.push({ id, writes: edits.map(([key, value]) => [key, value]), put: false, requires: [...new Set(requires)], conflict: null, sent: false, committed: null,
    bases: Object.fromEntries(edits.map(([key]) => [key, touching(spec, key).length ? null : spec.docs[key]?.revision ?? 0])), callers: [caller] });
  return "new";
}
/**
 * Whether an intent may be sent now (over its bases). An immutable document it requires must be in the library: put by this page and
 * answered, or by anyone (it never changes once there, so a page may learn of it by asking).
 */
function sendable(spec: Spec, intent: Intent, inLibrary: (key: string) => boolean): boolean {
  if (intent.conflict) return false;
  const at = spec.intents.indexOf(intent);
  for (const key of keysOf(intent)) {
    if (intent.bases[key] === null) return false;
    if (spec.intents.slice(0, at).some(earlier => keysOf(earlier).includes(key) && !earlier.committed)) return false;
  }
  return intent.requires.every(key => ((spec.docs[key]?.revision ?? 0) > 0 || inLibrary(key)) && touching(spec, key).every(other => other.committed));
}
const settle = (callers: Caller[], outcome: OutboxOutcome) => { for (const caller of callers) caller.expected = outcome; };
function acknowledge(spec: Spec, id: string, revisions: Readonly<Record<string, number>>, current?: Readonly<Record<string, CurrentDocument>>) {
  const at = spec.intents.findIndex(intent => intent.id === id), intent = spec.intents[at]!;
  for (const [key, value] of intent.writes) {
    const next = nextOn(spec, at, key);
    if (next && next.bases[key] === null) next.bases[key] = revisions[key]!;
    if (revisions[key]! >= (spec.docs[key]?.revision ?? 0)) spec.docs[key] = { revision: revisions[key]!, value: current?.[key] ? current[key]!.value : value };
  }
  spec.intents.splice(at, 1);
  settle(intent.callers, "acknowledged");
}
function lost(spec: Spec, id: string, revisions: Readonly<Record<string, number>>) {
  const at = spec.intents.findIndex(intent => intent.id === id), intent = spec.intents[at]!;
  intent.committed = { ...revisions };
  for (const [key] of intent.writes) { const next = nextOn(spec, at, key); if (next && next.bases[key] === null) next.bases[key] = revisions[key]!; }
}
function stale(spec: Spec, id: string, current: Readonly<Record<string, CurrentDocument>>) {
  const intent = spec.intents.find(item => item.id === id)!;
  if (intent.put) { acknowledge(spec, id, Object.fromEntries(intent.writes.map(([key]) => [key, current[key]?.revision ?? 0])), current); return; }
  intent.conflict = { theirs: { ...current } };
  if (intent.writes.length !== 1) return;
  // Single-document intents behind it on its document fold into its "mine", up to the first that writes several documents.
  const key = intent.writes[0]![0];
  for (;;) {
    const next = nextOn(spec, spec.intents.indexOf(intent), key);
    if (!next || next.writes.length !== 1 || next.put) break;
    intent.writes[0]![1] = next.writes[0]![1];
    intent.requires = [...new Set([...intent.requires, ...next.requires])];
    intent.callers.push(...next.callers);
    spec.intents.splice(spec.intents.indexOf(next), 1);
  }
}
function keepMine(spec: Spec, id: string, freshId: string) {
  const intent = spec.intents.find(item => item.id === id)!;
  const theirs = intent.conflict!.theirs;
  Object.assign(intent, { id: freshId, conflict: null, sent: false, committed: null,
    bases: Object.fromEntries(intent.writes.map(([key]) => [key, theirs[key]?.revision ?? 0])) });
}
/** Use theirs (and the first half of Keep both): the documents take theirs; the next intents go over the stale bases, to go stale too. */
function useTheirs(spec: Spec, id: string) {
  const at = spec.intents.findIndex(item => item.id === id), intent = spec.intents[at]!;
  for (const [key] of intent.writes) {
    const now = intent.conflict!.theirs[key];
    spec.docs[key] = { revision: now?.revision ?? 0, value: now?.value };
    const next = nextOn(spec, at, key);
    if (next && next.bases[key] === null) next.bases[key] = intent.bases[key]!;
  }
  spec.intents.splice(at, 1);
  settle(intent.callers, "dropped");
  return intent;
}
/** A restart: every stored intent may have been sent; the owner reads every document from the library; callers start again. */
function restarted(spec: Spec, library: (key: string) => { revision: number; value: unknown }, nextCaller: () => Caller): Spec {
  const copy: Spec = structuredClone(spec);
  for (const key of Object.keys(copy.docs)) copy.docs[key] = library(key);
  for (const intent of copy.intents) { intent.sent = true; intent.callers = [nextCaller()]; }
  return copy;
}
const specSignature = (spec: Spec, keys: readonly string[]) => JSON.stringify({ visible: keys.map(key => [key, visible(spec, key) ?? null]),
  intents: spec.intents.map(intent => [intent.id, intent.conflict ? "conflict" : "queued"]) });

// ---------------------------------------------------------------------------------------------------------------------
// One run.

type Sent = { window: string; life: number; request: TransactRequest; resolve(answer: TransactAnswer): void; reject(error: Error): void };
type Lookup = { kind: "revisions" | "read"; refs: readonly DocumentRef[]; resolve(value: unknown): void };
type HostWrite = { life: number; key: string; text: string | null; resolve(): void; reject(error: Error): void };
/** What the runs exercised (printed once): every kind of event must come up. */
const seen: Record<string, number> = {};
const count = (name: string) => { seen[name] = (seen[name] ?? 0) + 1; };

async function run(mode: "local" | "desktop", seed: number, steps: number): Promise<string[]> {
  const rng = random(seed), documents = storeDocuments(), store = documents.store;
  const keys = [...DOCS, ...BLOBS].map(documentKey);
  const writers = new Map<string, string[]>();
  const queue: Sent[] = [], lookups: Lookup[] = [], hostWrites: HostWrite[] = [], retries: (() => void)[] = [];
  const failures: string[] = [], trace: string[] = [];
  let stepNow = 0;
  const fail = (message: string) => { if (failures.length < 3) failures.push(`${mode} seed ${seed}, step ${stepNow}: ${message}` +
    (process.env.XFS_OUTBOX_TRACE ? [""].concat(trace.slice(-50)).join(String.fromCharCode(10)) : "")); };
  const library = (key: string) => { const ref = refOf(key), now = store.get(ref.kind, ref.id); return { revision: now?.revision ?? 0, value: now?.value }; };
  const ticks = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

  // The host, the transports and the late revision checks.
  const deliver = (sent: Sent, how: "ok" | "lose" | "fail") => {
    queue.splice(queue.indexOf(sent), 1);
    if (how === "fail") { count("send failed"); sent.reject(Error("The host didn't answer.")); return null; }
    const answer = store.transact(sent.request);
    trace.push(`deliver ${how} ${sent.window}${sent.life} ${sent.request.id} ${JSON.stringify(answer)}`);
    count(`answer ${answer.ok ? answer.replayed ?? "ok" : answer.reason}`);
    if (answer.ok && !answer.replayed) for (const write of sent.request.writes) {
      const list = writers.get(documentKey(write)) ?? []; list[answer.revisions[documentKey(write)]!] = sent.window; writers.set(documentKey(write), list);
    }
    if (how === "lose") { count("answer lost"); sent.reject(Error("The answer was lost.")); } else sent.resolve(answer);
    return answer;
  };
  let spec: Spec = { docs: Object.fromEntries(keys.map(key => [key, { revision: 0, value: undefined }])), intents: [] };
  let life = 0, adopting = false, a!: DocumentOutbox;
  const deferred: TransactRequest[] = [];
  const checkSend = (request: TransactRequest) => {
    const intent = spec.intents.find(item => item.id === request.id);
    if (!intent) { fail(`A sent ${request.id}, which the specification doesn't hold`); return; }
    if (!sendable(spec, intent, key => library(key).revision > 0)) fail(`A sent ${request.id}, which the specification doesn't hold as sendable`);
    const expected = intent.writes.map(([key, value]) => [key, intent.bases[key], value]);
    if (!same(request.writes.map(write => [documentKey(write), write.base, write.value]), expected))
      fail(`A sent ${request.id} as ${JSON.stringify(request.writes.map(write => [documentKey(write), write.base, write.value]))}, the specification ${JSON.stringify(expected)}`);
    intent.sent = true;
  };
  const transport = (window: string, lifeOf: () => number): DocumentStorePort => ({ ...documents,
    transact: request => new Promise((resolve, reject) => {
      const mine = lifeOf();
      trace.push(`send ${window}${mine} ${request.id} ${JSON.stringify(request.writes.map(write => [write.id, write.base, write.value]))}`);
      if (window === "A" && mine === life) { if (adopting) deferred.push(structuredClone(request)); else checkSend(request); }
      queue.push({ window, life: mine, request: structuredClone(request), resolve, reject });
    }),
    // A revision check's two reads come back whenever the run lets them.
    revisions: refs => new Promise(resolve => { lookups.push({ kind: "revisions", refs, resolve }); }),
    read: refs => new Promise(resolve => { lookups.push({ kind: "read", refs, resolve }); }) });
  /** Values a delivered read gave, which a check may then take (A7). */
  const readValues = new Map<string, CurrentDocument>();

  // Window A's storage: memory (local) or the desktop adapter (its WebView copy and the host's, each host write its own step).
  const memory = memoryOutboxStorage();
  const webview = new Map<string, string>();
  const host = new Map<string, string>();
  const webviewStorage = { get length() { return webview.size; }, key: (i: number) => [...webview.keys()][i] ?? null, getItem: (key: string) => webview.get(key) ?? null,
    setItem: (key: string, text: string) => { if (memory.fail) throw new DOMException("Full.", "QuotaExceededError"); webview.set(key, text); }, removeItem: (key: string) => { webview.delete(key); } };
  let callerIds = 0;
  const callers: Caller[] = [];
  const caller = (): Caller => { const item: Caller = { id: ++callerIds, expected: null, actual: null }; callers.push(item); return item; };
  const watch = (entry: OutboxEntry | null, item: Caller) => { if (entry) void a.settled(entry.id).then(outcome => { item.actual = outcome; }); };

  const openA = () => {
    life++;
    const mine = life;
    let storage;
    if (mode === "local") {
      const load = memory.load.bind(memory);
      storage = { ...memory, write: memory.write.bind(memory), load: () => { const entries = [...load()];
        for (let i = entries.length - 1; i > 0; i--) { const j = rng.int(i + 1); [entries[i], entries[j]] = [entries[j]!, entries[i]!]; } return new Map(entries); } };
    } else storage = desktopOutboxStorage(webviewStorage, "desktop", "launch", Object.fromEntries(host), (key, text) =>
      new Promise<void>((resolve, reject) => { hostWrites.push({ life: mine, key, text, resolve, reject }); }));
    a = new DocumentOutbox(transport("A", () => mine), storage, { immutable, newId: () => `a${mine}-${Math.floor(rng.next() * 1e9).toString(36)}`,
      schedule: (_ms, task) => { retries.push(task); return { cancel: () => { const at = retries.indexOf(task); if (at >= 0) retries.splice(at, 1); } }; } });
    for (const key of keys) { const now = library(key); a.hold(refOf(key), now.revision ? now : null); }
    // A check the outbox makes by itself (the host answered again after failing) is a change from elsewhere, as one asked for.
    a.subscribe(event => {
      if (event.kind !== "external" || mine !== life) return;
      for (const ref of event.refs) {
        const key = documentKey(ref), read = readValues.get(key);
        if (!read || touching(spec, key).length || read.revision <= (spec.docs[key]?.revision ?? 0)) fail(`A took ${key} from a check the specification doesn't allow`);
        else spec.docs[key] = { revision: read.revision, value: read.value };
      }
    });
    a.open();
  };
  /** The specification after a restart; every intent the restarted page holds has a caller waiting for it again. */
  const adopt = (next: Spec) => {
    for (const intent of next.intents) { const entry = a.pendingEntries().find(item => item.id === intent.id); if (entry) watch(entry, intent.callers[0]!); }
    spec = next;
  };
  /** A's state as the specification states it. */
  const real = () => JSON.stringify({ visible: keys.map(key => [key, a.document(refOf(key))?.value ?? null]),
    intents: a.pendingEntries().map(entry => [entry.id, entry.state]) });
  /** A was killed: it restarts (perhaps dying again while it opens and repairs); its state must be one the specification allows. */
  const recover = async (allowed: Spec[]) => {
    for (let attempt = 0; ; attempt++) {
      adopting = true;
      const crash = mode === "local" && attempt < 4 && rng.next() < 0.6;
      if (crash) memory.killAfter(rng.int(4), () => a.stop());
      openA();
      await ticks();
      memory.killAfter(Infinity);
      if (a.status().stopped) { count("killed while opening"); continue; }
      const now = real(), candidates = allowed.map(candidate => restarted(candidate, library, () => ({ id: 0, expected: null, actual: null })));
      const match = candidates.find(candidate => specSignature(candidate, keys) === now);
      adopting = false;
      if (!match) { fail(`after a kill A shows ${now}; the specification allows ${candidates.map(candidate => specSignature(candidate, keys)).join(" or ")}`); return; }
      count(`recovered ${["after", "between", "before"][candidates.indexOf(match) === 0 ? 0 : candidates.indexOf(match) === candidates.length - 1 ? 2 : 1]}`);
      for (const intent of match.intents) intent.callers = [caller()];
      adopt(match);
      for (const request of deferred.splice(0)) checkSend(request);
      return;
    }
  };
  /** A step's work on A, which a kill may interrupt after any number of key writes. */
  const onA = async (work: () => void, between: Spec[] = [], killRate = 0.2) => {
    const before = structuredClone(spec), waiting = spec.intents.flatMap(intent => intent.callers);
    const kill = mode === "local" && !memory.fail && !a.status().unprotected.length && rng.next() < killRate;
    // After any number of key writes: mostly the first few, where a step's writes are torn.
    if (kill) memory.killAfter(rng.next() < 0.6 ? rng.int(3) : rng.int(12), () => a.stop());
    try { work(); } catch (error) { if (!a.status().stopped) throw error; }
    await ticks();
    memory.killAfter(Infinity);
    if (!a.status().stopped) return;
    count("killed");
    // Every caller waiting when the step began, or added by it, hears that the page stopped (the kill comes before any other outcome).
    settle([...waiting, ...spec.intents.flatMap(intent => intent.callers)], "stopped");
    await recover([spec, ...between, before]);
  };

  // Window B: edits the same documents and imports the same immutable documents, resolving its conflicts with Keep mine.
  const b = new DocumentOutbox(transport("B", () => 0), memoryOutboxStorage(), { immutable, newId: () => `b-${Math.floor(rng.next() * 1e9).toString(36)}`,
    schedule: (_ms, task) => { retries.push(task); return { cancel() {} }; } });
  for (const ref of [...DOCS, ...BLOBS]) b.hold(ref, null);
  b.open();
  b.subscribe(event => { if (event.kind === "conflict") queueMicrotask(() => { if (b.conflicts().some(item => item.id === event.entry.id)) b.keepMine(event.entry.id); }); });

  openA();
  adopt(restarted(spec, library, caller));
  let counter = 0, forks = 0;
  const value = (window: string, blob?: string) => ({ w: window, n: ++counter, ...(blob ? { ref: blob } : {}) });

  for (stepNow = 0; stepNow < steps && !failures.length; stepNow++) {
    const roll = rng.next();
    trace.push(`step ${stepNow} ${roll.toFixed(3)}`);
    if (roll < 0.2) {
      const ref = rng.pick(DOCS), next = value("A"), item = caller();
      await onA(() => {
        const entry = a.commit("edit", [{ ...ref, value: next }]);
        const how = record(spec, entry.id, [[documentKey(ref), next]], [], item);
        if (how === "joined" && !spec.intents.some(intent => intent.id === entry.id)) fail(`A joined the edit to ${entry.id}, the specification to another intent`);
        if (how === "new" && spec.intents.at(-1)!.id !== entry.id) fail(`A joined the edit to ${entry.id}, the specification made a new intent`);
        watch(entry, item);
      });
    } else if (roll < 0.27) {
      const one = rng.pick(DOCS), two = rng.pick(DOCS);
      if (one.id === two.id) continue;
      const edits = [{ ...one, value: value("A") }, { ...two, value: value("A") }], item = caller();
      await onA(() => {
        const entry = a.commit("pair", edits);
        record(spec, entry.id, edits.map(edit => [documentKey(edit), edit.value]), [], item);
        watch(entry, item);
      });
    } else if (roll < 0.31) {
      // A imports an immutable document (its value is its ID); a command of its own then names it.
      const blob = rng.pick(BLOBS), item = caller();
      await onA(() => {
        const put = a.put(blob, { blob: blob.id });
        if (put) spec.intents.push({ id: put.id, writes: [[documentKey(blob), { blob: blob.id }]], put: true, requires: [], conflict: null, sent: false, committed: null,
          bases: { [documentKey(blob)]: 0 }, callers: [item] });
        else if (visible(spec, documentKey(blob)) === undefined) fail("A put nothing for a document the specification doesn't hold");
        else callers.splice(callers.indexOf(item), 1);
        watch(put, item);
      });
      const ref = rng.pick(DOCS), next = value("A", blob.id), named = caller();
      await onA(() => {
        const entry = a.commit("edit", [{ ...ref, value: next }], { requires: [blob] });
        record(spec, entry.id, [[documentKey(ref), next]], [documentKey(blob)], named);
        watch(entry, named);
      });
    } else if (roll < 0.4) {
      // Window B edits, or imports an immutable document and names it.
      const ref = rng.pick(DOCS.slice(0, 3));
      if (rng.next() < 0.25) { const blob = rng.pick(BLOBS); b.put(blob, { blob: blob.id }); b.commit("edit", [{ ...ref, value: value("B", blob.id) }], { requires: [blob] }); count("B imports"); }
      else b.commit("edit", [{ ...ref, value: value("B") }]);
      await ticks();
    } else if (roll < 0.66) {
      if (!queue.length) continue;
      const sent = rng.pick(queue), how = rng.next() < 0.8 ? "ok" : rng.next() < 0.5 ? "lose" : "fail";
      const live = sent.window === "A" && sent.life === life;
      const before = structuredClone(spec);
      const answer = deliver(sent, how);
      if (answer && !answer.ok && answer.reason === "stale" && live) {
        const foreign = sent.request.writes.some(write => {
          const list = writers.get(documentKey(write)) ?? [], now = answer.current[documentKey(write)]?.revision ?? 0;
          for (let revision = write.base + 1; revision <= now; revision++) if (list[revision] !== "A") return true;
          return false;
        });
        if (!foreign && !sent.request.writes.every(write => immutable(write.kind))) fail(`A's ${sent.request.id} went stale against its own writes`);
      }
      if (!answer || !live || !spec.intents.some(intent => intent.id === sent.request.id)) { await ticks(); continue; }
      const between: Spec[] = [];
      await onA(() => {
        if (how === "lose") { if (answer.ok) lost(spec, sent.request.id, answer.revisions); return; }
        if (answer.ok) {
          // Part-way through an acknowledgement, the intent may still be stored, to be replayed and answered by its receipt.
          const partial = structuredClone(before);
          lost(partial, sent.request.id, answer.revisions);
          between.push(partial);
          acknowledge(spec, sent.request.id, answer.revisions);
        } else if (answer.reason === "stale") stale(spec, sent.request.id, answer.current);
      }, between);
    } else if (roll < 0.7) {
      for (const task of retries.splice(0)) task();
      await ticks();
    } else if (roll < 0.78) {
      const conflict = a.conflicts()[0];
      if (!conflict) continue;
      const how = rng.pick(["mine", "theirs", "both"] as const);
      count(`resolve ${how}`);
      if (!spec.intents.some(intent => intent.id === conflict.id && intent.conflict)) { fail(`A's conflict ${conflict.id} isn't the specification's`); break; }
      const item = caller();
      await onA(() => {
        if (how === "mine") { keepMine(spec, conflict.id, a.keepMine(conflict.id).id); callers.splice(callers.indexOf(item), 1); return; }
        if (how === "theirs") { a.useTheirs(conflict.id); useTheirs(spec, conflict.id); callers.splice(callers.indexOf(item), 1); return; }
        const fork = ++forks;
        const copy = a.keepBoth(conflict.id, mine => mine.map(edit => ({ ...edit, id: `${edit.id}~${fork}` })));
        const dropped = useTheirs(spec, conflict.id);
        for (const [key] of dropped.writes) { keys.push(`${key}~${fork}`); spec.docs[`${key}~${fork}`] = { revision: 0, value: undefined }; }
        spec.intents.push({ id: copy.id, writes: dropped.writes.map(([key, value]) => [`${key}~${fork}`, value]), put: false, requires: [...dropped.requires], conflict: null,
          sent: false, committed: null, bases: Object.fromEntries(dropped.writes.map(([key]) => [`${key}~${fork}`, 0])), callers: [item] });
        watch(copy, item);
      }, [], 0.45);
    } else if (roll < 0.82) {
      // A revision check; its reads come back in later steps.
      count("check asked");
      void a.check().catch(() => {});
      await ticks();
    } else if (roll < 0.88) {
      if (!lookups.length) continue;
      const lookup = lookups.splice(rng.int(lookups.length), 1)[0]!;
      count(`late ${lookup.kind}`);
      if (lookup.kind === "revisions") lookup.resolve(Object.fromEntries(lookup.refs.map(ref => [documentKey(ref), library(documentKey(ref)).revision])));
      else {
        const answer = Object.fromEntries(lookup.refs.map(ref => { const now = store.get(ref.kind, ref.id); return [documentKey(ref), now ? { revision: now.revision, value: now.value } : null]; }));
        for (const [key, now] of Object.entries(answer)) readValues.set(key, now);
        lookup.resolve(answer);
      }
      await ticks();
    } else if (mode === "desktop" ? roll < 0.95 : roll < 0.9) {
      if (mode !== "desktop") continue;
      // A host write of a key lands, or fails (it is sent again).
      if (!hostWrites.length) continue;
      const write = hostWrites.splice(rng.int(hostWrites.length), 1)[0]!;
      // A write from a page that has since restarted is refused by the host (its lease generation is older), never applied.
      if (write.life !== life) { count("host write fenced"); write.reject(Error("Superseded.")); }
      else if (rng.next() < 0.85) { if (write.text === null) host.delete(write.key); else host.set(write.key, write.text); count("host write landed"); write.resolve(); }
      else { count("host write failed"); write.reject(Error("The host file wasn't written.")); }
      await ticks();
    } else if (roll < (mode === "desktop" ? 0.965 : 0.92)) {
      // Storage refuses writes for a while (a full quota), or works again.
      memory.fail = !memory.fail;
      count(memory.fail ? "storage failing" : "storage back");
      if (!memory.fail) a.protect();
      await ticks();
    } else if (roll < 0.98) {
      // A restart reads back what is stored: a key whose write failed is written again first (Try again), since a restart while changes
      // are reported unprotected may come back older, as the warning says (the protection check covers that state).
      memory.fail = false;
      a.protect();
      count("restart");
      settle(spec.intents.flatMap(intent => intent.callers), "stopped");
      a.stop(); await ticks();
      adopting = true;
      openA();
      adopt(restarted(spec, library, caller));
      adopting = false;
      for (const request of deferred.splice(0)) checkSend(request);
      await ticks();
    } else continue;

    // ---- Invariants after every step.
    if (failures.length) break;
    const shown = real(), expected = specSignature(spec, keys);
    if (shown !== expected) { fail(`A shows ${shown}; the specification ${expected}`); break; }
    // Protected means recoverable: every document with intents A doesn't report unprotected comes back from the durable storage.
    const unprotected = new Set(a.status().unprotected.map(documentKey));
    const durable = mode === "local" ? new Map(memory.keys) : new Map(host);
    const probe = new DocumentOutbox(documents, { load: () => durable, write: () => {} }, { immutable, writable: () => false, sendable: () => false });
    for (const key of keys) { const now = library(key); probe.hold(refOf(key), now.revision ? now : null); }
    probe.open();
    for (const key of keys) if (touching(spec, key).length && !unprotected.has(key)) {
      count("protected change checked");
      if (!same(probe.document(refOf(key))?.value, visible(spec, key))) fail(`${key} is reported protected, but the stored outbox recovers ${JSON.stringify(probe.document(refOf(key))?.value)}, not ${JSON.stringify(visible(spec, key))}` +
        (process.env.XFS_OUTBOX_TRACE ? ` (unprotected ${[...unprotected]}; host writes waiting ${hostWrites.map(write => write.key)}; durable ${JSON.stringify([...durable].map(([k, text]) => [k, JSON.parse(text).entries.map((entry: OutboxEntry) => [entry.id, entry.stamp, entry.writes.map(write => [write.id, write.value])])]))}; A ${JSON.stringify(a.pendingEntries().map(entry => [entry.id, entry.stamp]))})` : ""));
    }
    probe.stop();
    for (const item of callers) if (item.actual && item.actual !== item.expected) fail(`a caller heard ${item.actual}; the specification says ${item.expected ?? "nothing yet"}`);
    for (const [kind, id] of store.list("doc").map(doc => ["doc", doc.id] as const)) {
      const named = (store.get<{ ref?: string }>(kind, id)?.value as { ref?: string } | undefined)?.ref;
      if (named && !store.get("blob", named)) fail(`${id} names ${named}, which the library doesn't hold`);
    }
  }

  // ---- The end: everything delivered, every conflict resolved, every host write landed.
  memory.fail = false;
  for (let round = 0; round < 600 && !failures.length; round++) {
    for (const task of retries.splice(0)) task();
    await ticks();
    if (hostWrites.length) { const write = hostWrites.shift()!;
      if (write.life !== life) write.reject(Error("Superseded.")); else { if (write.text === null) host.delete(write.key); else host.set(write.key, write.text); write.resolve(); }
      await ticks(); continue; }
    if (lookups.length) { const lookup = lookups.shift()!; lookup.resolve(lookup.kind === "revisions" ? Object.fromEntries(lookup.refs.map(ref => [documentKey(ref), library(documentKey(ref)).revision]))
      : Object.fromEntries(lookup.refs.map(ref => { const now = store.get(ref.kind, ref.id); const value = now ? { revision: now.revision, value: now.value } : null; readValues.set(documentKey(ref), value); return [documentKey(ref), value]; }))); await ticks(); continue; }
    const sent = queue[0];
    if (sent) {
      const live = sent.window === "A" && sent.life === life;
      const answer = deliver(sent, "ok");
      if (live && spec.intents.some(intent => intent.id === sent.request.id)) {
        if (answer!.ok) acknowledge(spec, sent.request.id, answer!.revisions); else if (answer!.reason === "stale") stale(spec, sent.request.id, answer!.current);
      }
      await ticks();
      continue;
    }
    const conflict = a.conflicts()[0];
    if (conflict) { keepMine(spec, conflict.id, a.keepMine(conflict.id).id); await ticks(); continue; }
    if (!a.pendingEntries().length && !b.pendingEntries().length) break;
  }
  if (!failures.length) {
    if (a.pendingEntries().length || b.pendingEntries().length) fail(`not quiet: A holds ${a.pendingEntries().length}, B ${b.pendingEntries().length}`);
    const checking = a.check();
    for (let i = 0; i < 4; i++) { await ticks(); for (const lookup of lookups.splice(0)) lookup.resolve(lookup.kind === "revisions"
      ? Object.fromEntries(lookup.refs.map(ref => [documentKey(ref), library(documentKey(ref)).revision]))
      : Object.fromEntries(lookup.refs.map(ref => { const now = store.get(ref.kind, ref.id); const value = now ? { revision: now.revision, value: now.value } : null; readValues.set(documentKey(ref), value); return [documentKey(ref), value]; }))); }
    await checking; await ticks();
    for (const key of keys) {
      const held = library(key).value;
      if (!same(a.document(refOf(key))?.value, held)) fail(`A shows ${JSON.stringify(a.document(refOf(key))?.value)} for ${key}, the library ${JSON.stringify(held)}`);
      if (!same(visible(spec, key), held)) fail(`the specification shows ${JSON.stringify(visible(spec, key))} for ${key}, the library ${JSON.stringify(held)}`);
    }
    const open = callers.filter(item => item.actual === null || item.expected === null);
    if (open.length) fail(`${open.length} caller(s) without an outcome (heard ${open.map(item => item.actual).join(", ")}; expected ${open.map(item => item.expected).join(", ")})`);
  }
  b.stop(); a.stop();
  return failures;
}

const pinned = process.env.XFS_OUTBOX_SEED;
const modes = (process.env.XFS_OUTBOX_MODE ? [process.env.XFS_OUTBOX_MODE] : ["local", "desktop"]) as ("local" | "desktop")[];
const RUNS = Number(process.env.XFS_OUTBOX_RUNS ?? 60);
const STEPS = 400;
test(`the outbox meets its specification in seeded runs (kills while working and while recovering, late checks, failing storage, two windows)`, async () => {
  const all: string[] = [];
  let total = 0;
  for (const mode of modes) for (const seed of pinned ? [Number(pinned)] : Array.from({ length: mode === "local" ? RUNS : Math.ceil(RUNS / 2) }, (_, i) => 1000 + i * 7919)) {
    const failures = await run(mode, seed, STEPS);
    total += STEPS;
    if (failures.length) { all.push(failures[0]!); console.log(failures[0]); }
  }
  console.log(JSON.stringify({ steps: total, seen }));
  expect(all).toEqual([]);
  if (!pinned) for (const name of ["killed", "killed while opening", "recovered after", "recovered before", "restart", "resolve mine", "resolve theirs", "resolve both",
    "answer stale", "answer receipt", "answer equal", "answer lost", "send failed", "late read", "storage failing", "host write landed", "host write failed",
    "B imports", "protected change checked"]) expect(seen[name] ?? 0, name).toBeGreaterThan(0);
}, 600_000);
