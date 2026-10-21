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
 * the desktop adapter, and each host write of a key is its own step, which lands or fails. Chunk 1c-ii added the collection's shapes:
 * three-document commands (a collection, a look and a look it drops as a tombstone); a membership document that Keep both adds each fork
 * to, over its value as it is now, and that window B edits too; reads answered as the library was when the host read them and delivered
 * late and out of order (a stale one is never taken); and snapshots (Save version, export): flush some documents, then read them in one
 * read transaction, each with no conflict reading as A shows it unless only another window's writes moved it on. Its review added each
 * window's workspace and lease generation on every command (so receipts know their writer and replays answer `own`, checked against the
 * specification's own log of who wrote each revision), host purges of receipts no window can replay, desktop app crashes with host writes
 * still on their way (each key keeps a prefix of them; the specification then adopts what A recovered), and the recovery gate: an edit of
 * a document with a recovered intent not yet answered is refused.
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
import { ATTEMPT_MS, DocumentOutbox, type OutboxEntry, type OutboxOutcome, OutboxRecoveringError, STORE_SOON_MS } from "../src/platform/core/document-outbox";
import { type CurrentDocument, documentKey, type DocumentRef, tombstoneOf, type TransactAnswer, type TransactRequest } from "../src/platform/api/document-commands";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { desktopOutboxStorage } from "../src/app/browser/outbox-storage";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";

const DOCS = ["d0", "d1", "d2", "d3"].map(id => ({ kind: "doc", id }));
/** A membership document (a profile's subjects, a collection's looks): Keep both adds each fork to it, over its value as it is now. */
const MEMBERS = { kind: "doc", id: "m" };
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
  /** Read back from storage when the page opened, and not answered since: no new edit is admitted on its documents until it is. */
  recovered?: boolean;
  /** Bases it took from a lost answer of the intent before it (the page never learned them): by document, that intent's ID. */
  from?: Record<string, string>;
};
/** `versions`: what a command reading each document names as its base, as the design states it: it moves with every change made here and
 * every change taken from elsewhere, never with an acknowledgement, and starts again at the library's revision when the page opens. */
type Spec = { docs: Record<string, { revision: number; value: unknown }>; versions: Record<string, number>; intents: Intent[];
  /** Intents the library acknowledged (a stored copy of one may still be replayed: answered by its receipt, it changes nothing). */
  acknowledged: string[] };
const bump = (spec: Spec, key: string) => { spec.versions[key] = (spec.versions[key] ?? 0) + 1; };
const moved = (spec: Spec, key: string, revision: number) => { spec.versions[key] = Math.max((spec.versions[key] ?? 0) + 1, revision); };
const keysOf = (intent: Intent) => intent.writes.map(([key]) => key);
const touching = (spec: Spec, key: string) => spec.intents.filter(intent => keysOf(intent).includes(key));
function visible(spec: Spec, key: string): unknown {
  const last = touching(spec, key).at(-1);
  return last ? last.writes.find(([item]) => item === key)![1] : spec.docs[key]?.value;
}
/** The next intent after `index` on `key`. */
const nextOn = (spec: Spec, index: number, key: string) => spec.intents.slice(index + 1).find(intent => keysOf(intent).includes(key));
function record(spec: Spec, id: string, edits: [string, unknown][], requires: string[], caller: Caller): "joined" | "new" {
  for (const [key] of edits) bump(spec, key);
  if (edits.length === 1) {
    const last = touching(spec, edits[0]![0]).at(-1);
    if (last && last.writes.length === 1 && !last.put && (!last.sent || last.conflict)) {
      last.writes[0]![1] = edits[0]![1];
      // The new value's references replace the old one's when it names any (an owner names them with every value it writes).
      if (requires.length) last.requires = [...new Set(requires)];
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
type Own = Readonly<Record<string, { readonly revision: number; readonly value: unknown }>>;
/** What a receipt's answer says the command committed, as the documents' values at its revisions. */
const committedOf = (answer: TransactAnswer & { ok: true }): Record<string, CurrentDocument> | undefined => answer.committed
  ? Object.fromEntries(Object.entries(answer.committed).map(([key, value]) => [key, { revision: answer.revisions[key] ?? 0, value }])) : undefined;
function acknowledge(spec: Spec, id: string, revisions: Readonly<Record<string, number>>, current?: Readonly<Record<string, CurrentDocument>>, own?: Own) {
  const at = spec.intents.findIndex(intent => intent.id === id), intent = spec.intents[at]!;
  const shown = keysOf(intent).map(key => [key, visible(spec, key)] as const);
  // An earlier intent still pending on one of its documents is one the library already holds (it is only being replayed): this answer
  // supersedes its write of that document; one left with no write is done.
  for (const earlier of spec.intents.slice(0, at)) {
    if (earlier.conflict || !earlier.committed || !earlier.writes.some(([key]) => keysOf(intent).includes(key))) continue;
    earlier.writes = earlier.writes.filter(([key]) => !keysOf(intent).includes(key));
  }
  for (const earlier of spec.intents.slice(0, at).filter(item => !item.writes.length)) {
    spec.intents.splice(spec.intents.indexOf(earlier), 1);
    spec.acknowledged.push(earlier.id);
    settle(earlier.callers, "acknowledged");
  }
  answered(spec, id, revisions, current);
  // A replay answered by its receipt adopts this workspace's later revisions as the baseline; the intents after it still go over the
  // revision it produced (their values were made over its value).
  const adopted = new Set<string>();
  // (Only of the documents it still writes: a copy an earlier answer superseded on one no longer speaks for it.)
  for (const [key, later] of Object.entries(own ?? {}))
    if (shown.some(([item]) => item === key) && later.revision > (spec.docs[key]?.revision ?? 0)) { spec.docs[key] = { revision: later.revision, value: structuredClone(later.value) }; moved(spec, key, later.revision); adopted.add(key); }
  // An answer that changes what a document shows (a recovered intent's value giving way to the library's newer one) is a change from
  // elsewhere for whoever holds the document.
  for (const [key, before] of shown) if (!adopted.has(key) && !same(before, visible(spec, key))) moved(spec, key, spec.docs[key]?.revision ?? 0);
}
/** Whether a document still has an intent read back at the last opening and not yet answered: edits on it wait. */
const recovering = (spec: Spec, key: string) => touching(spec, key).some(intent => intent.recovered && !intent.conflict);
function answered(spec: Spec, id: string, revisions: Readonly<Record<string, number>>, current?: Readonly<Record<string, CurrentDocument>>) {
  const at = spec.intents.findIndex(intent => intent.id === id), intent = spec.intents[at]!;
  for (const [key, value] of intent.writes) {
    const next = nextOn(spec, at, key);
    if (next && next.bases[key] === null) next.bases[key] = revisions[key]!;
    if (revisions[key]! >= (spec.docs[key]?.revision ?? 0)) spec.docs[key] = { revision: revisions[key]!, value: current?.[key] ? current[key]!.value : value };
  }
  spec.intents.splice(at, 1);
  spec.acknowledged.push(id);
  settle(intent.callers, "acknowledged");
}
function lost(spec: Spec, id: string, revisions: Readonly<Record<string, number>>) {
  const at = spec.intents.findIndex(intent => intent.id === id), intent = spec.intents[at]!;
  intent.committed = { ...revisions };
  for (const [key] of intent.writes) {
    const next = nextOn(spec, at, key);
    if (next && next.bases[key] === null) { next.bases[key] = revisions[key]!; (next.from ??= {})[key] = intent.id; }
  }
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
  // A conflict on an intent the library had already taken (its answer lost, its receipt gone): the intents after it follow the fresh
  // command again, as they did before its lost answer was known.
  for (const [key] of intent.writes) { const next = nextOn(spec, spec.intents.indexOf(intent), key); if (next?.from?.[key] === intent.id) { next.bases[key] = null; delete next.from[key]; } }
  Object.assign(intent, { id: freshId, conflict: null, sent: false, committed: null, recovered: false,
    bases: Object.fromEntries(intent.writes.map(([key]) => [key, theirs[key]?.revision ?? 0])) });
}
/** Use theirs (and the first half of Keep both): the documents take theirs; the next intents go over the stale bases, to go stale too. */
function useTheirs(spec: Spec, id: string) {
  const at = spec.intents.findIndex(item => item.id === id), intent = spec.intents[at]!;
  for (const [key] of intent.writes) {
    const now = intent.conflict!.theirs[key];
    spec.docs[key] = { revision: now?.revision ?? 0, value: now?.value };
    moved(spec, key, now?.revision ?? 0);
    const next = nextOn(spec, at, key);
    // (Over its stale base even where its lost answer had given them its revision: the page never learned that answer.)
    if (next && (next.bases[key] === null || next.from?.[key] === intent.id)) next.bases[key] = intent.bases[key]!;
  }
  spec.intents.splice(at, 1);
  settle(intent.callers, "dropped");
  return intent;
}
/** A restart: every stored intent may have been sent; the owner reads every document from the library; callers start again. */
function restarted(spec: Spec, library: (key: string) => { revision: number; value: unknown }, nextCaller: () => Caller): Spec {
  const copy: Spec = structuredClone(spec);
  for (const key of Object.keys(copy.docs)) { copy.docs[key] = library(key); copy.versions[key] = copy.docs[key]!.revision; }
  for (const intent of copy.intents) { intent.sent = true; intent.recovered = true; intent.callers = [nextCaller()]; }
  return copy;
}
const specSignature = (spec: Spec, keys: readonly string[]) => JSON.stringify({ visible: keys.map(key => [key, visible(spec, key) ?? null]),
  intents: spec.intents.map(intent => [intent.id, intent.conflict ? "conflict" : "queued", keysOf(intent)]) });

// ---------------------------------------------------------------------------------------------------------------------
// One run.

/** A command as the host receives it; `signal`: its attempt, which the sender may abandon (its deadline, Try again). */
type Sent = { window: string; life: number; request: TransactRequest; resolve(answer: TransactAnswer): void; reject(error: Error): void; signal?: AbortSignal };
/** A revision check's read: its answer is taken when the host reads it (`captured`, at the request or later) and arrives later still. */
type Lookup = { kind: "revisions" | "read"; refs: readonly DocumentRef[]; resolve(value: unknown): void; captured: unknown };
type HostWrite = { life: number; key: string; text: string | null; resolve(): void; reject(error: Error): void };
/** What the runs exercised (printed once): every kind of event must come up. */
const seen: Record<string, number> = {};
const count = (name: string) => { seen[name] = (seen[name] ?? 0) + 1; };

async function run(mode: "local" | "desktop", seed: number, steps: number): Promise<string[]> {
  const rng = random(seed), documents = storeDocuments(), store = documents.store;
  // A second stream for what chunk 1c-ii added (snapshots, three-document commands with tombstones, membership edits, captured reads),
  // so the first stream's sequences stay as they were where those don't change the state.
  const more = random(seed ^ 0x5bd1e995);
  const keys = [...DOCS, MEMBERS, ...BLOBS].map(documentKey), loaded = [...keys];
  const writers = new Map<string, string[]>();
  const queue: Sent[] = [], lookups: Lookup[] = [], hostWrites: HostWrite[] = [], retries: (() => void)[] = [];
  /** Each attempt's deadline: when one runs, that attempt is abandoned and its command sent again. */
  const deadlines: (() => void)[] = [];
  const failures: string[] = [], trace: string[] = [];
  let stepNow = 0;
  const fail = (message: string) => { if (failures.length < 3) failures.push(`${mode} seed ${seed}, step ${stepNow}: ${message}` +
    (process.env.XFS_OUTBOX_TRACE ? [""].concat(trace.slice(-Number(process.env.XFS_OUTBOX_TRACE_LINES ?? 50))).join(String.fromCharCode(10)) : "")); };
  const library = (key: string) => { const ref = refOf(key), now = store.get(ref.kind, ref.id); return { revision: now?.revision ?? 0, value: now?.value }; };
  const ticks = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  /** Every value each document has had in the library, by `<key>@<revision>` (what a late read may still carry). */
  const history = new Map<string, unknown>();
  /** The command, window and life that wrote each document's revision, by `<key>@<revision>`. */
  const writerIds = new Map<string, { id: string; window: string; life: number }>();
  /** The bases recovered commands had after a crash with host writes pending (`<key>@<base>`). */
  const lossyBases = new Set<string>();
  /** The commands recovered after such a crash. */
  const lossyIds = new Set<string>();
  const answerOf = (kind: Lookup["kind"], refs: readonly DocumentRef[]) => kind === "revisions"
    ? Object.fromEntries(refs.map(ref => [documentKey(ref), library(documentKey(ref)).revision]))
    : Object.fromEntries(refs.map(ref => { const now = store.get(ref.kind, ref.id); return [documentKey(ref), now ? { revision: now.revision, value: structuredClone(now.value) } : null]; }));
  const answerLookup = (lookup: Lookup) => lookup.resolve(lookup.captured ?? answerOf(lookup.kind, lookup.refs));

  // The host, the transports and the late revision checks.
  const deliver = (sent: Sent, how: "ok" | "lose" | "fail") => {
    queue.splice(queue.indexOf(sent), 1);
    if (how === "fail") { count("send failed"); sent.reject(Error("The host didn't answer.")); return null; }
    // Each window is its own workspace: A's lease generation is its life (a restart is a new one), B's is 1.
    const answer = store.transact(sent.request, sent.window === "A" ? { workspace: "A", generation: Math.max(1, sent.life) } : { workspace: "B", generation: 1 });
    trace.push(`deliver ${how} ${sent.window}${sent.life} ${sent.request.id} ${JSON.stringify(answer)}`);
    count(`answer ${answer.ok ? answer.replayed ?? "ok" : answer.reason}`);
    if (answer.ok && !answer.replayed) for (const write of sent.request.writes) {
      const list = writers.get(documentKey(write)) ?? []; list[answer.revisions[documentKey(write)]!] = sent.window; writers.set(documentKey(write), list);
      history.set(`${documentKey(write)}@${answer.revisions[documentKey(write)]}`, structuredClone(write.value));
      writerIds.set(`${documentKey(write)}@${answer.revisions[documentKey(write)]}`, { id: sent.request.id, window: sent.window, life: Math.max(1, sent.life) });
    }
    // The host's `own` (receipt replays) is what the specification says: every later revision of each document written by A, at a life
    // no newer than this one, with A's receipt for it still in the library.
    if (answer.ok && answer.replayed === "receipt" && sent.window === "A") {
      const expected: Record<string, { revision: number; value: unknown }> = {};
      for (const [key, revision] of Object.entries(answer.revisions)) {
        const now = library(key);
        if (now.revision <= revision) continue;
        let mine = true;
        for (let next = revision + 1; next <= now.revision && mine; next++) {
          const writer = writerIds.get(`${key}@${next}`);
          mine = !!writer && writer.window === "A" && writer.life <= Math.max(1, sent.life) && !!store.get("xfs-receipt", writer.id);
        }
        if (mine) expected[key] = { revision: now.revision, value: now.value };
      }
      if (!same(answer.own ?? {}, expected)) fail(`the host answered ${sent.request.id} with own ${JSON.stringify(answer.own ?? {})}, the specification ${JSON.stringify(expected)}`);
      if (answer.own) count("own adopted");
    }
    if (how === "lose") { count("answer lost"); sent.reject(Error("The answer was lost.")); } else sent.resolve(answer);
    return answer;
  };
  let spec: Spec = { docs: Object.fromEntries(keys.map(key => [key, { revision: 0, value: undefined }])), versions: {}, intents: [], acknowledged: [] };
  let life = 0, adopting = false, a!: DocumentOutbox;
  let owner = new Map<string, unknown>();
  /** The immutable documents this launch's owners haven't read yet: A holds nothing of them (the specification neither). */
  const unheld = new Set<string>();
  const asHeld = (key: string) => unheld.has(key) ? { revision: 0, value: undefined } : library(key);
  let putting = false;
  /** Keeps generated command IDs unique (the random part alone collides about once in a few hundred runs). */
  let ids = 0;
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
    transact: (request, signal) => new Promise((resolve, reject) => {
      const mine = lifeOf();
      trace.push(`send ${window}${mine} ${request.id} ${JSON.stringify(request.writes.map(write => [write.id, write.base, write.value]))}`);
      if (window === "A" && mine === life) { if (adopting) deferred.push(structuredClone(request)); else checkSend(request); }
      queue.push({ window, life: mine, request: structuredClone(request), resolve, reject, ...(signal ? { signal } : {}) });
    }),
    // A revision check's two reads are answered as the library was when the host read them (often at once, so a later change makes the
    // answer stale), and come back whenever the run lets them, in any order.
    revisions: refs => new Promise(resolve => { lookups.push({ kind: "revisions", refs, resolve, captured: more.next() < 0.5 ? answerOf("revisions", refs) : null }); }),
    read: refs => new Promise(resolve => { lookups.push({ kind: "read", refs, resolve, captured: more.next() < 0.5 ? answerOf("read", refs) : null }); }) });

  // Window A's storage: memory (local) or the desktop adapter (its WebView copy and the host's, each host write its own step).
  const memory = memoryOutboxStorage();
  const webview = new Map<string, string>();
  const host = new Map<string, string>();
  /** The renderer dies after this many more WebView writes (desktop kills), like `memory.killAfter`. */
  const webKill = { left: Infinity, onKill: null as (() => void) | null, killed: false, writes: 0 };
  const webWrite = (change: () => void) => {
    if (webKill.killed) return;
    if (webKill.left-- <= 0) { webKill.killed = true; webKill.onKill?.(); return; }
    change(); webKill.writes++;
  };
  const webviewStorage = { get length() { return webview.size; }, key: (i: number) => [...webview.keys()][i] ?? null, getItem: (key: string) => webview.get(key) ?? null,
    setItem: (key: string, text: string) => { if (memory.fail) throw new DOMException("Full.", "QuotaExceededError"); webWrite(() => webview.set(key, text)); },
    removeItem: (key: string) => { webWrite(() => webview.delete(key)); } };
  /** Kill the page after `writes` more writes to its synchronous storage (memory, or the WebView), or stop arming it (`Infinity`). */
  const killAfter = (writes: number) => {
    if (mode === "local") memory.killAfter(writes, () => a.stop());
    else { webKill.left = writes; webKill.onKill = () => a.stop(); webKill.killed = false; }
  };
  const syncWrites = () => mode === "local" ? memory.writes : webKill.writes;
  /** The app's launch: a real restart is a new one, and the WebView's records of earlier launches aren't read. */
  let launch = 1;
  /** Storage failed since it last was whole again: a restart may then come back older (as the warning says), so no kill is armed. */
  let degraded = false;
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
    } else storage = desktopOutboxStorage(webviewStorage, "desktop", `launch-${launch}`, Object.fromEntries(host), (key, text) =>
      new Promise<void>((resolve, reject) => { hostWrites.push({ life: mine, key, text, resolve, reject }); }));
    a = new DocumentOutbox(transport("A", () => mine), storage, { immutable, newId: () => `a${mine}-${Math.floor(rng.next() * 1e9).toString(36)}${(++ids).toString(36)}`,
      schedule: (ms, task) => { const list = ms === ATTEMPT_MS ? deadlines : retries; list.push(task); return { cancel: () => { const at = list.indexOf(task); if (at >= 0) list.splice(at, 1); } }; } });
    // An owner that never read some immutable documents (a V shown before its save was read): those come later, by a lookup, a put or
    // a reload (`hold`), and must then reach every owner.
    unheld.clear();
    for (const key of keys) {
      // (Not one the outbox keeps itself: content kept with a stored command, or a stored put of it.)
      const stored = [...memory.keys, ...webview, ...host].filter(([name]) => name === key || name.endsWith(`.${key}`)).some(([, text]) => {
        try { const record = JSON.parse(text) as { entries?: unknown[]; retained?: unknown }; return !!record.entries?.length || record.retained !== undefined; } catch { return false; }
      });
      if (immutable(refOf(key).kind) && !stored && more.next() < 0.3) { unheld.add(key); continue; }
      const now = library(key); a.hold(refOf(key), now.revision ? now : null);
    }
    // A check the outbox makes by itself (the host answered again after failing) is a change from elsewhere, as one asked for.
    a.subscribe(event => {
      if (event.kind !== "external" || mine !== life) return;
      for (const ref of event.refs) {
        // What A took must be a value the library held at that revision, newer than the one A had, for a document with no intent: a read
        // that arrives after a newer one (or after A's own write) is never taken.
        const key = documentKey(ref), held = a.document(ref), revision = held?.revision ?? 0;
        // A later revision of A's own, adopted with its receipt's answer (the specification already took it).
        // Or the value an answer revealed in place of a recovered intent's (the specification already moved it).
        if (revision === (spec.docs[key]?.revision ?? 0) && same(visible(spec, key), held?.value)) continue;
        if (touching(spec, key).length || revision <= (spec.docs[key]?.revision ?? 0) || !history.has(`${key}@${revision}`) || !same(history.get(`${key}@${revision}`), held?.value))
          fail(`A took ${key} at revision ${revision} from a check the specification doesn't allow`);
        else { spec.docs[key] = { revision, value: structuredClone(held!.value) }; moved(spec, key, revision); }
      }
    });
    a.open();
    // An owner holding every document from the moment the page opens (during recovery too), told only by the outbox's events: it must
    // show what A shows after every step, or it would write over a value it never saw (finding 1 of the second 1c-ii review).
    owner = new Map(keys.map(key => [key, a.document(refOf(key))?.value]));
    a.subscribe(event => {
      // A put A makes by itself: an immutable document a command requires that the library didn't have (purged, or not there yet when
      // asked), put again from the content A holds. It changes no value; the specification holds it as A's intent from here on.
      if (mine === life && event.kind === "recorded" && event.entry.command === "immutable.put" && !putting && !spec.intents.some(intent => intent.id === event.entry.id)) {
        count("source put again");
        spec.intents.push({ id: event.entry.id, writes: event.entry.writes.map(write => [documentKey(write), structuredClone(write.value)]), put: true, requires: [],
          conflict: null, sent: false, committed: null, bases: Object.fromEntries(event.entry.writes.map(write => [documentKey(write), 0])), callers: [] });
      }
      if (mine !== life || event.kind === "status" || event.kind === "acknowledged" || event.kind === "conflict") return;
      for (const ref of event.refs) {
        // A dependency (an immutable document a held document names) arriving here, by a put or from the library: the owner hears it
        // too, so whatever shows the dependent document can show its content before taking an edit.
        if (immutable(ref.kind) && owner.get(documentKey(ref)) === undefined && a.document(ref)?.value !== undefined) count("dependency arrived");
        owner.set(documentKey(ref), a.document(ref)?.value);
      }
    });
  };
  /** The specification after a restart; every intent the restarted page holds has a caller waiting for it again. */
  const adopt = (next: Spec) => {
    for (const intent of next.intents) { const entry = a.pendingEntries().find(item => item.id === intent.id); if (entry) watch(entry, intent.callers[0]!); }
    spec = next;
  };
  /** A's state as the specification states it. */
  const real = () => JSON.stringify({ visible: keys.map(key => [key, a.document(refOf(key))?.value ?? null]),
    intents: a.pendingEntries().map(entry => [entry.id, entry.state, entry.writes.map(write => documentKey(write))]) });
  /** A was killed: it restarts (perhaps dying again while it opens and repairs); its state must be one the specification allows. */
  const recover = async (allowed: Spec[], labels: string[] = allowed.map(() => "current")) => {
    for (let attempt = 0; ; attempt++) {
      adopting = true;
      const crash = !degraded && attempt < 4 && rng.next() < 0.6;
      if (crash) killAfter(rng.int(4));
      openA();
      await ticks();
      killAfter(Infinity);
      if (a.status().stopped) { count("killed while opening"); continue; }
      const now = real(), candidates = allowed.map(candidate => restarted(candidate, asHeld, () => ({ id: 0, expected: null, actual: null })));
      const match = candidates.find(candidate => specSignature(candidate, keys) === now);
      adopting = false;
      if (!match) { fail(`after a kill A shows ${now}; the specification allows ${candidates.map(candidate => specSignature(candidate, keys)).join(" or ")}`); return; }
      count(`recovered ${labels[candidates.indexOf(match)]}`);
      for (const intent of match.intents) intent.callers = [caller()];
      adopt(match);
      for (const request of deferred.splice(0)) checkSend(request);
      return;
    }
  };
  /** A step's work on A, which a kill may interrupt after any number of key writes. */
  const onA = async (work: () => void, between: Spec[] = [], killRate = 0.2) => {
    const before = structuredClone(spec), waiting = spec.intents.flatMap(intent => intent.callers);
    // A kill loses what waits to be stored soon (reported unprotected, at most `STORE_SOON_MS` of a continuous edit), as storage that
    // failed does: no kill is armed while any waits; the protection check covers that state.
    const kill = !degraded && !a.storingSoon().length && rng.next() < killRate;
    // After any number of key writes: mostly the first few, where a step's writes are torn.
    const writesBefore = syncWrites();
    if (kill) killAfter(rng.next() < 0.6 ? rng.int(3) : rng.int(12));
    try { work(); } catch (error) { if (!a.status().stopped) throw error; }
    await ticks();
    killAfter(Infinity);
    if (!a.status().stopped) return;
    count(`killed (${mode})`);
    // Every caller waiting when the step began, or added by it, hears that the page stopped (the kill comes before any other outcome).
    settle([...waiting, ...spec.intents.flatMap(intent => intent.callers)], "stopped");
    // The crash oracle: no key written yet means the step left nothing behind; once one was, the step's decision is stored (every key a
    // step writes carries it whole: an entry, its conflict, a resolution's markers), and only an acknowledgement's replay may remain.
    if (syncWrites() === writesBefore) await recover([before], ["before"]);
    else await recover([spec, ...between], ["after", ...between.map(() => "between")]);
  };

  // Window B: edits the same documents and imports the same immutable documents, resolving its conflicts with Keep mine.
  const b = new DocumentOutbox(transport("B", () => 0), memoryOutboxStorage(), { immutable, newId: () => `b-${Math.floor(rng.next() * 1e9).toString(36)}${(++ids).toString(36)}`,
    schedule: (ms, task) => { (ms === ATTEMPT_MS ? deadlines : retries).push(task); return { cancel() {} }; } });
  for (const ref of [...DOCS, ...BLOBS]) b.hold(ref, null);
  b.open();
  b.subscribe(event => { if (event.kind === "conflict") queueMicrotask(() => { if (b.conflicts().some(item => item.id === event.entry.id)) b.keepMine(event.entry.id); }); });

  openA();
  adopt(restarted(spec, library, caller));
  let counter = 0, forks = 0;
  /**
   * An edit of documents the specification still recovers: A must refuse it (`OutboxRecoveringError`) and change nothing. True when it
   * was refused (the step is over).
   */
  const refusedWhileRecovering = (keys: readonly string[], attempt: () => unknown, item: Caller) => {
    if (!keys.some(key => recovering(spec, key))) return false;
    try { attempt(); fail(`A took an edit of ${keys} while the specification still recovers it`); }
    catch (error) { if (!(error instanceof OutboxRecoveringError)) throw error; }
    callers.splice(callers.indexOf(item), 1);
    count("edit refused while recovering");
    return true;
  };
  const value = (window: string, blob?: string) => ({ w: window, n: ++counter, ...(blob ? { ref: blob } : {}) });

  /** Delivers A's first live send and keeps the specification in step (the end's and the snapshot's drive). */
  const deliverA = (sent: Sent) => {
    const abandoned = !!sent.signal?.aborted;
    const answer = deliver(sent, abandoned ? "lose" : "ok");
    if (abandoned) { if (answer?.ok && spec.intents.some(intent => intent.id === sent.request.id)) lost(spec, sent.request.id, answer.revisions); return; }
    if (spec.intents.some(intent => intent.id === sent.request.id)) {
      if (answer!.ok) acknowledge(spec, sent.request.id, answer!.revisions, committedOf(answer!), answer!.own); else if (answer!.reason === "stale") stale(spec, sent.request.id, answer!.current);
    }
  };
  /** Every command ID some window still holds (stored, pending or in flight): their receipts must stay. */
  const held = () => {
    const ids = new Set<string>([...a.pendingEntries(), ...b.pendingEntries()].map(entry => entry.id));
    for (const item of queue) ids.add(item.request.id);
    for (const text of [...memory.keys.values(), ...webview.values(), ...host.values()])
      try { for (const entry of (JSON.parse(text) as { entries?: { id: string }[] }).entries ?? []) ids.add(entry.id); } catch { /* not a record */ }
    return ids;
  };
  for (stepNow = 0; stepNow < steps && !failures.length; stepNow++) {
    if (more.next() < 0.02) {
      // The owners read the library again (a reload): every document they hold takes a newer revision, and every immutable one they
      // hadn't read arrives; each change reaches every owner (the outbox announces it), which the owner check after the step verifies.
      // (What owners load: the documents they list; copies Keep both made here are this page's own until acknowledged.)
      for (const key of loaded) { const now = library(key); a.hold(refOf(key), now.revision ? now : null); }
      if (unheld.size) count("owners reload");
      unheld.clear();
      await ticks();
    } else if (more.next() < 0.03 && deadlines.length) {
      // The library takes too long: some attempts' deadlines pass (each is abandoned, and its command sent again under its ID).
      for (const task of deadlines.splice(0, 1 + more.int(deadlines.length))) task();
      count("attempt abandoned");
      await ticks();
      continue;
    }
    if (more.next() < 0.03) {
      // The host purges receipts no window can replay any more (as its 7-day purge does): later replays then learn less of their own.
      const keep = held();
      const purge = store.list<unknown>("xfs-receipt").filter(item => !keep.has(item.id)).map(item => item.id);
      (store as unknown as { db: { write(change: (db: { query(sql: string): { run(...args: unknown[]): unknown } }) => void): void } }).db
        .write(db => { for (const id of purge) db.query("DELETE FROM documents WHERE kind = 'xfs-receipt' AND id = ?").run(id); });
      if (purge.length) count("receipts purged");
      trace.push(`step ${stepNow} purge ${purge.length}`);
      continue;
    }
    if (more.next() < 0.04) {
      // Save version or export: flush the documents (only A's sends are answered meanwhile), then read them in one read transaction.
      // Each one with no conflict must read as A shows it, unless the library moved on by another window's writes alone.
      const refs = [MEMBERS, ...DOCS].filter(() => more.next() < 0.5);
      if (!refs.length) continue;
      trace.push(`step ${stepNow} snapshot ${refs.map(ref => ref.id)}`);
      let done: boolean | null = null;
      void a.settle(refs).then(ok => { done = ok; });
      for (let round = 0; round < 80 && done === null && !failures.length; round++) {
        await ticks();
        const sent = queue.find(item => item.window === "A" && item.life === life);
        if (sent) { deliverA(sent); continue; }
        if (lookups.length) { answerLookup(lookups.shift()!); continue; }
        for (const task of retries.splice(0)) task();
      }
      await ticks();
      if (done) {
        const read = store.read(refs);
        for (const ref of refs) {
          const key = documentKey(ref), held = a.document(ref), now = read[key];
          if (held?.conflict || held?.pending) continue;
          const by = writers.get(key) ?? [];
          if ((now?.revision ?? 0) === (held?.revision ?? 0)) { count("snapshot checked"); if (!same(now?.value, held?.value)) fail(`the snapshot reads ${key} as ${JSON.stringify(now?.value)}, A shows ${JSON.stringify(held?.value)}`); }
          else for (let revision = (held?.revision ?? 0) + 1; revision <= (now?.revision ?? 0); revision++)
            // (A write of this launch's: one an earlier launch made may be lost to a crash with host writes pending.)
            if (by[revision] === "A" && writerIds.get(`${key}@${revision}`)?.life === life) fail(`the snapshot reads ${key} at revision ${now?.revision}, past A's own revision ${revision} that A doesn't show`);
        }
      }
    } else {
    const roll = rng.next();
    trace.push(`step ${stepNow} ${roll.toFixed(3)}`);
    if (roll < 0.2) {
      // A continuous edit (a look being edited) is recorded at once and stored soon; the rest are stored at once.
      const ref = rng.pick(DOCS), next = value("A"), item = caller(), store = rng.next() < (process.env.XFS_SOON_OFF ? 0 : 0.4) ? "soon" as const : "now" as const;
      if (store === "soon") count("edit stored soon");
      if (!refusedWhileRecovering([documentKey(ref)], () => a.commit("edit", [{ ...ref, value: next }], { store }), item)) await onA(() => {
        const entry = a.commit("edit", [{ ...ref, value: next }], { store });
        trace.push(`edit A ${entry.id} ${ref.id} ${store} base ${JSON.stringify(entry.writes[0]!.base)}`);
        const how = record(spec, entry.id, [[documentKey(ref), next]], [], item);
        if (how === "joined" && !spec.intents.some(intent => intent.id === entry.id)) fail(`A joined the edit to ${entry.id}, the specification to another intent`);
        if (how === "new" && spec.intents.at(-1)!.id !== entry.id) fail(`A joined the edit to ${entry.id}, the specification made a new intent`);
        watch(entry, item);
      });
    } else if (roll < 0.27) {
      const one = rng.pick(DOCS), two = rng.pick(DOCS);
      if (one.id === two.id) continue;
      const edits: { kind: string; id: string; value: unknown }[] = [{ ...one, value: value("A") }, { ...two, value: value("A") }], item = caller();
      // A collection command: the collection (the membership document), a look and a look it drops as a tombstone (removeLook).
      if (more.next() < 0.3) {
        const third = more.next() < 0.5 ? MEMBERS : DOCS.find(doc => doc.id !== one.id && doc.id !== two.id)!;
        edits.push({ ...third, value: more.next() < 0.5 ? tombstoneOf(value("A"), counter) : value("A") });
        count("three-document command");
      }
      if (!refusedWhileRecovering(edits.map(documentKey), () => a.commit("pair", edits), item)) await onA(() => {
        const entry = a.commit("pair", edits);
        record(spec, entry.id, edits.map(edit => [documentKey(edit), edit.value]), [], item);
        watch(entry, item);
      });
    } else if (roll < 0.31) {
      // A imports an immutable document (its value is its ID); a command of its own then names it.
      const blob = rng.pick(BLOBS), item = caller();
      await onA(() => {
        putting = true;
        let put: OutboxEntry | null;
        try { put = a.put(blob, { blob: blob.id }); } finally { putting = false; }
        if (put) bump(spec, documentKey(blob));
        if (put) spec.intents.push({ id: put.id, writes: [[documentKey(blob), { blob: blob.id }]], put: true, requires: [], conflict: null, sent: false, committed: null,
          bases: { [documentKey(blob)]: 0 }, callers: [item] });
        else if (visible(spec, documentKey(blob)) === undefined) fail("A put nothing for a document the specification doesn't hold");
        else callers.splice(callers.indexOf(item), 1);
        watch(put, item);
      });
      const ref = rng.pick(DOCS), next = value("A", blob.id), named = caller();
      if (!refusedWhileRecovering([documentKey(ref)], () => a.commit("edit", [{ ...ref, value: next }], { requires: [blob] }), named)) await onA(() => {
        const entry = a.commit("edit", [{ ...ref, value: next }], { requires: [blob] });
        record(spec, entry.id, [[documentKey(ref), next]], [documentKey(blob)], named);
        watch(entry, named);
      });
    } else if (roll < 0.4) {
      // Window B edits, or imports an immutable document and names it.
      const ref = more.next() < 0.15 ? MEMBERS : rng.pick(DOCS.slice(0, 3));
      if (rng.next() < 0.25) { const blob = rng.pick(BLOBS); b.put(blob, { blob: blob.id }); b.commit("edit", [{ ...ref, value: value("B", blob.id) }], { requires: [blob] }); count("B imports"); }
      else b.commit("edit", [{ ...ref, value: value("B") }]);
      await ticks();
    } else if (roll < 0.66) {
      if (!queue.length) continue;
      const sent = rng.pick(queue), chosen = rng.next() < 0.8 ? "ok" : rng.next() < 0.5 ? "lose" : "fail";
      // An answer to an attempt A abandoned (its deadline passed, or Try again) reaches nobody: for A it is lost.
      if (sent.signal?.aborted && sent.window === "A") count("answer to an abandoned attempt");
      const how = sent.signal?.aborted && chosen === "ok" ? "lose" : chosen;
      const live = sent.window === "A" && sent.life === life;
      const before = structuredClone(spec);
      const answer = deliver(sent, how);
      // (An abandoned attempt's answer reaches nobody: a later attempt of the same command may already have landed and been forgotten.)
      if (answer && !answer.ok && answer.reason === "stale" && live && !sent.signal?.aborted) {
        const foreign = sent.request.writes.some(write => {
          const list = writers.get(documentKey(write)) ?? [], now = answer.current[documentKey(write)]?.revision ?? 0;
          for (let revision = write.base + 1; revision <= now; revision++) if (list[revision] !== "A") return true;
          return false;
        });
        // After a crash with host writes pending, a recovered command whose predecessor's copy was lost goes over the revision the
        // repair could still prove (it may be older than A's own later write): a conflict there is allowed (never an overwrite).
        // So may a recovered command the library had already taken, once its receipt is gone too (it was forgotten when the copy that
        // the crash lost was written without it).
        const guessed = lossyIds.has(sent.request.id) || sent.request.writes.some(write => lossyBases.has(`${documentKey(write)}@${write.base}`));
        if (!foreign && !guessed && !sent.request.writes.every(write => immutable(write.kind))) fail(`A's ${sent.request.id} went stale against its own writes`);
        if (!foreign && guessed) count("conflict after a lossy crash");
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
          // Or with the earlier stored copies it supersedes already reduced (they are written first).
          const reduced = structuredClone(partial), at = reduced.intents.findIndex(intent => intent.id === sent.request.id);
          for (const earlier of reduced.intents.slice(0, at)) if (!earlier.conflict && earlier.committed)
            earlier.writes = earlier.writes.filter(([key]) => !keysOf(reduced.intents[at]!).includes(key));
          if (reduced.intents.every(intent => intent.writes.length)) between.push(reduced);
          acknowledge(spec, sent.request.id, answer.revisions, committedOf(answer), answer.own);
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
      trace.push(`resolve ${how} ${conflict.id}${lossyIds.has(conflict.id) ? " (lossy)" : ""}`);
      if (!spec.intents.some(intent => intent.id === conflict.id && intent.conflict)) { fail(`A's conflict ${conflict.id} isn't the specification's`); break; }
      const item = caller();
      // Use theirs and Keep both send the dropped command's successors over its base; on a command recovered after a crash with host writes
      // pending, that base is what the recovery could prove and may be older than A's own later write, so they may go stale against it.
      if (how !== "mine" && lossyIds.has(conflict.id))
        for (const write of conflict.writes) if (typeof write.base === "number") lossyBases.add(`${documentKey(write)}@${write.base}`);
      await onA(() => {
        if (how === "mine") {
          // A conflict on a command recovered after a crash with host writes pending was taken against what that recovery could prove;
          // a later write of A's own (an earlier recovered command) may have overtaken it, and Keep mine then goes stale against it.
          if (lossyIds.has(conflict.id)) for (const [key, now] of Object.entries(conflict.current ?? {})) lossyBases.add(`${key}@${now?.revision ?? 0}`);
          keepMine(spec, conflict.id, a.keepMine(conflict.id).id); callers.splice(callers.indexOf(item), 1); return; }
        if (how === "theirs") { a.useTheirs(conflict.id); useTheirs(spec, conflict.id); callers.splice(callers.indexOf(item), 1); return; }
        const fork = ++forks, members = documentKey(MEMBERS);
        /** The membership document with this fork added: over its value as it is now (theirs, with any surviving successors). */
        const joined = (now: unknown) => ({ ...(now && typeof now === "object" ? now : {}), forks: [...((now as { forks?: number[] } | undefined)?.forks ?? []), fork] });
        const copy = a.keepBoth(conflict.id, mine => [...mine.map(edit => ({ ...edit, id: `${edit.id}~${fork}` })), { ...MEMBERS, value: joined(a.document(MEMBERS)?.value) }]);
        const dropped = useTheirs(spec, conflict.id);
        for (const [key] of dropped.writes) { keys.push(`${key}~${fork}`); spec.docs[`${key}~${fork}`] = { revision: 0, value: undefined }; spec.versions[`${key}~${fork}`] = 1; }
        const membership = joined(visible(spec, members));
        spec.intents.push({ id: copy.id, writes: [...dropped.writes.map(([key, value]) => [`${key}~${fork}`, value] as [string, unknown]), [members, membership]], put: false,
          requires: [...dropped.requires], conflict: null, sent: false, committed: null,
          bases: { ...Object.fromEntries(dropped.writes.map(([key]) => [`${key}~${fork}`, 0])), [members]: touching(spec, members).length ? null : spec.docs[members]?.revision ?? 0 },
          callers: [item] });
        bump(spec, members);
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
      if (lookup.captured) {
        count("read captured earlier");
        if (lookup.kind === "read" && lookup.refs.some(ref => ((lookup.captured as Record<string, CurrentDocument>)[documentKey(ref)]?.revision ?? 0) < library(documentKey(ref)).revision)) count("stale read delivered");
      }
      answerLookup(lookup);
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
      if (memory.fail) degraded = true;
      else a.protect();
      await ticks();
    } else if (roll < 0.98) {
      // A restart reads back what is stored: a key whose write failed is written again first (Try again), since a restart while changes
      // are reported unprotected may come back older, as the warning says (the protection check covers that state).
      memory.fail = false;
      a.protect();
      const app = mode === "desktop" && rng.next() < 0.5;
      if (app && more.next() < 0.4) {
        // The app crashes with host copies still on their way: each key's pending host writes land only in part (a prefix), so the new
        // launch may read an entry older than what the library holds of this workspace's own (the 1c-i known limit). The state it reads
        // isn't the specification's to choose: the specification adopts what A recovered (each intent committed when its receipt is in the
        // library), and from there every send, refusal and answer is checked against it, `own` adoption and the recovery gate included.
        settle(spec.intents.flatMap(intent => intent.callers), "stopped");
        a.stop(); await ticks();
        // The host dies with the page: each of A's commands in flight either committed before the crash (its answer lost) or never
        // arrived. Nothing from this launch reaches the host afterwards (the next launch's lease fences it).
        for (const sent of queue.filter(item => item.window === "A")) { if (more.next() < 0.5) deliver(sent, "lose"); else { queue.splice(queue.indexOf(sent), 1); sent.reject(Error("The host died.")); } }
        const pending = hostWrites.splice(0).filter(write => write.life === life);
        for (const key of new Set(pending.map(write => write.key))) {
          const writes = pending.filter(write => write.key === key), landed = more.int(writes.length + 1);
          for (const write of writes.slice(0, landed)) if (write.text === null) host.delete(write.key); else host.set(write.key, write.text);
        }
        launch++;
        count("app crash with host writes pending");
        degraded = false;
        adopting = true;
        openA();
        const rebuilt: Spec = { docs: {}, versions: {}, intents: [], acknowledged: [...spec.acknowledged] };
        for (const key of keys) { rebuilt.docs[key] = asHeld(key); rebuilt.versions[key] = rebuilt.docs[key]!.revision; }
        for (const entry of a.pendingEntries()) {
          lossyIds.add(entry.id);
          for (const write of entry.writes) if (typeof write.base === "number") lossyBases.add(`${documentKey(write)}@${write.base}`);
          // A conflict brought back (its resolution's copy was lost): Keep mine goes over the revision it recorded then.
          for (const [key, now] of Object.entries(entry.current ?? {})) lossyBases.add(`${key}@${now?.revision ?? 0}`);
          // Committed: its receipt says so, or (a receipt already forgotten) the library's log of who wrote each revision does.
          const logged = [...writerIds].filter(([, writer]) => writer.id === entry.id).map(([at]) => [at.slice(0, at.lastIndexOf("@")), Number(at.slice(at.lastIndexOf("@") + 1))]);
          const receipt = store.get<{ revisions: Record<string, number> }>("xfs-receipt", entry.id)?.value ?? (logged.length ? { revisions: Object.fromEntries(logged) } : undefined);
          rebuilt.intents.push({ id: entry.id, writes: entry.writes.map(write => [documentKey(write), structuredClone(write.value)]), put: entry.command === "immutable.put",
            requires: [...entry.requires ?? []], conflict: entry.state === "conflict" ? { theirs: { ...entry.current } } : null, sent: true,
            bases: Object.fromEntries(entry.writes.map(write => [documentKey(write), typeof write.base === "number" ? write.base : null])),
            committed: receipt ? { ...receipt.revisions } : null, callers: [caller()], recovered: true });
        }
        adopt(rebuilt);
        adopting = false;
        for (const request of deferred.splice(0)) checkSend(request);
        await ticks();
      } else {
      if (app) {
        // A real app restart: everything the host was given lands first (a restart with copies still on their way is the protection
        // check's case, below: only what it says is protected must come back); then a new launch reads the host's copy alone.
        for (let round = 0; round < 1000 && hostWrites.some(write => write.life === life); round++) {
          const write = hostWrites.find(item => item.life === life)!;
          hostWrites.splice(hostWrites.indexOf(write), 1);
          if (write.text === null) host.delete(write.key); else host.set(write.key, write.text);
          write.resolve(); await ticks();
        }
        launch++;
        count("app restart");
      } else count("restart");
      degraded = false;
      settle(spec.intents.flatMap(intent => intent.callers), "stopped");
      a.stop(); await ticks();
      adopting = true;
      openA();
      adopt(restarted(spec, asHeld, caller));
      adopting = false;
      for (const request of deferred.splice(0)) checkSend(request);
      await ticks();
      }
    } else continue;
    }

    // ---- Invariants after every step.
    if (failures.length) break;
    const shown = real(), expected = specSignature(spec, keys);
    if (shown !== expected) { fail(`A shows ${shown}; the specification ${expected}`); break; }
    for (const key of keys) if (!same(owner.get(key), a.document(refOf(key))?.value))
      fail(`an owner holding ${key} since the page opened shows ${JSON.stringify(owner.get(key))}, A ${JSON.stringify(a.document(refOf(key))?.value)}`);
    // Baselines and versions, directly.
    for (const key of keys) {
      const held = a.document(refOf(key));
      if (!immutable(refOf(key).kind) && (held?.revision ?? 0) !== (spec.docs[key]?.revision ?? 0)) fail(`A's baseline of ${key} is revision ${held?.revision}, the specification's ${spec.docs[key]?.revision}`);
      if (!immutable(refOf(key).kind) && (held?.version ?? 0) !== (spec.versions[key] ?? 0)) fail(`A's version of ${key} is ${held?.version}, the specification's ${spec.versions[key] ?? 0}`);
    }
    // Protected means recoverable, for every document: what A doesn't report unprotected comes back from the durable storage (memory, or
    // the desktop host's copy, as a new launch reads it) as A shows it, and nothing discarded or acknowledged comes back as a change.
    const unprotected = new Set(a.status().unprotected.map(documentKey));
    const durable = mode === "local" ? new Map(memory.keys) : new Map(host);
    const probe = new DocumentOutbox(documents, { load: () => durable, write: () => {} }, { immutable, writable: () => false, sendable: () => false });
    for (const key of keys) { const doc = spec.docs[key]; probe.hold(refOf(key), doc?.revision ? doc : null); }
    probe.open();
    // A document shares a stored command with an unprotected one: what the unprotected one's key holds may still be older.
    const unsafe = new Set(unprotected);
    for (const entry of probe.pendingEntries()) { const touched = entry.writes.map(documentKey); if (touched.some(key => unprotected.has(key))) for (const key of touched) unsafe.add(key); }
    for (const entry of probe.pendingEntries()) {
      const intent = spec.intents.find(item => item.id === entry.id);
      // An acknowledged command may come back (it is replayed, and answered by its receipt). A discarded one, or a conflict already
      // resolved, may come back only while every document it writes is reported unprotected (the warning's promise).
      if (intent ? !(entry.state === "conflict" && !intent.conflict) : spec.acknowledged.includes(entry.id)) continue;
      if (entry.writes.every(write => unprotected.has(documentKey(write)))) continue;
      fail(`the stored outbox brings back ${entry.id} (${entry.state}), which the specification discarded, though ${entry.writes.filter(write => !unprotected.has(documentKey(write))).map(documentKey)} is reported protected`);
    }
    for (const key of keys) if (!unsafe.has(key)) {
      count("protected document checked");
      if (!same(probe.document(refOf(key))?.value, visible(spec, key))) fail(`${key} is reported protected, but the stored outbox recovers ${JSON.stringify(probe.document(refOf(key))?.value)}, not ${JSON.stringify(visible(spec, key))}` +
        (process.env.XFS_OUTBOX_TRACE ? ` (unprotected ${[...unprotected]}; host writes waiting ${hostWrites.map(write => write.key)}; durable ${JSON.stringify([...durable].map(([k, text]) => [k, JSON.parse(text).entries.map((entry: OutboxEntry) => [entry.id, entry.stamp, entry.writes.map(write => [write.id, write.value])])]))}; A ${JSON.stringify(a.pendingEntries().map(entry => [entry.id, entry.stamp]))})` : ""));
    }
    probe.stop();
    if (mode === "desktop" && !degraded && !unprotected.size) count("desktop fully protected");
    for (const item of callers) if (item.actual && item.actual !== item.expected) fail(`a caller heard ${item.actual}; the specification says ${item.expected ?? "nothing yet"}`);
    for (const [kind, id] of store.list("doc").map(doc => ["doc", doc.id] as const)) {
      const named = (store.get<{ ref?: string }>(kind, id)?.value as { ref?: string } | undefined)?.ref;
      if (named && !store.get("blob", named)) fail(`${id} names ${named}, which the library doesn't hold`);
    }
  }

  // ---- The end: everything delivered, every conflict resolved, every host write landed.
  memory.fail = false;
  for (let round = 0; round < 4000 && !failures.length; round++) {
    // Retries only once nothing else is waiting: a resend loop must never starve the answers it waits for.
    if (!queue.length && !hostWrites.length && !lookups.length) for (const task of retries.splice(0)) task();
    await ticks();
    if (hostWrites.length) { const write = hostWrites.shift()!;
      if (write.life !== life) write.reject(Error("Superseded.")); else { if (write.text === null) host.delete(write.key); else host.set(write.key, write.text); write.resolve(); }
      await ticks(); continue; }
    if (lookups.length) { answerLookup(lookups.shift()!); await ticks(); continue; }
    const sent = queue[0];
    if (sent) {
      if (sent.window === "A" && sent.life === life) deliverA(sent); else deliver(sent, "ok");
      await ticks();
      continue;
    }
    const conflict = a.conflicts()[0];
    if (conflict) {
      if (lossyIds.has(conflict.id)) for (const [key, now] of Object.entries(conflict.current ?? {})) lossyBases.add(`${key}@${now?.revision ?? 0}`);
      keepMine(spec, conflict.id, a.keepMine(conflict.id).id); await ticks(); continue;
    }
    if (!a.pendingEntries().length && !b.pendingEntries().length) break;
  }
  if (!failures.length) {
    if (a.pendingEntries().length || b.pendingEntries().length) fail(`not quiet: A holds ${a.pendingEntries().length}, B ${b.pendingEntries().length} ${JSON.stringify(a.pendingEntries().slice(0, 6).map(e => [e.id, e.state, e.requires, e.writes.map(w => [w.id, w.base])]))} queue ${queue.length} lookups ${lookups.length} retries ${retries.length}`);
    // The owners read everything once more (a reload): every document is then held, unread immutable ones included.
    for (const key of loaded) { const now = library(key); a.hold(refOf(key), now.revision ? now : null); }
    unheld.clear();
    await ticks();
    const checking = a.check();
    for (let i = 0; i < 4; i++) { await ticks(); for (const lookup of lookups.splice(0)) lookup.resolve(answerOf(lookup.kind, lookup.refs)); }
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
/**
 * Seeds that found defects in deeper sweeps, run every time: a replayed copy of an acknowledged command followed by the next edit (local
 * 5979845, desktop 1212607), immutable baselines learned by lookup (local 2527161, 4609858), discarded conflicts brought back from the
 * desktop host's copy (desktop 1719423, 1806532), long recoveries (desktop 365274, 2519242), and (chunk 1c-ii) a kill between an
 * acknowledgement's keys bringing back a superseded copy's write (local 982956, desktop 476140); after crashes with host writes pending, a
 * recovered launch ordering its new commands before older ones that came back (desktop 792900) and a conflict overtaken by an own write
 * (desktop 491978); in the second review, an `own` answer for a document a superseded copy no longer writes (local 5132512), and two
 * recovered commands on one document both ready to send (desktop 2986463, 2717217); in the third, a stored copy older than its command as
 * sent, replayed by receipt (desktop 2028264, 990875); in the fourth, an abandoned attempt's late answer (local 5710599) and a reload of
 * documents a Keep both copy wrote (desktop 349436).
 */
const FIXED = { local: [5979845, 2527161, 4609858, 982956, 5132512, 5710599], desktop: [1212607, 1719423, 1806532, 365274, 2519242, 476140, 792900, 491978, 2986463, 2717217, 2028264, 990875, 349436] };
const STEPS = 400;
test(`the outbox meets its specification in seeded runs (kills while working and while recovering, late checks, failing storage, two windows)`, async () => {
  const all: string[] = [];
  let total = 0;
  for (const mode of modes) for (const seed of pinned ? [Number(pinned)] : [...Array.from({ length: mode === "local" ? RUNS : Math.ceil(RUNS / 2) }, (_, i) => 1000 + i * 7919),
    ...FIXED[mode]]) {
    const failures = await run(mode, seed, STEPS);
    total += STEPS;
    if (failures.length) { all.push(failures[0]!); console.log(failures[0]); }
  }
  console.log(JSON.stringify({ steps: total, seen }));
  expect(all).toEqual([]);
  if (!pinned) for (const name of ["killed (local)", "killed (desktop)", "killed while opening", "recovered after", "recovered before", "recovered between", "restart",
    "app restart", "resolve mine", "resolve theirs", "resolve both", "answer stale", "answer receipt", "answer equal", "answer lost", "send failed", "late read",
    "storage failing", "host write landed", "host write failed", "host write fenced", "B imports", "protected document checked", "three-document command",
    "snapshot checked", "read captured earlier", "stale read delivered", "own adopted", "edit refused while recovering", "receipts purged",
    "app crash with host writes pending", "answer to an abandoned attempt", "attempt abandoned", "dependency arrived", "owners reload"]) expect(seen[name] ?? 0, name).toBeGreaterThan(0);
}, 600_000);

/**
 * The class the profiles 1d-ii review asked for: an edit lands while it waits to be stored (`store: "soon"`, a look edited continuously)
 * or while a resolution is under way, and a newer value arrives by each way the outbox takes one: a read (`hold`), a revision check, a
 * recovered command's answer (with `own`, this workspace's later revision), and a resolution. In every case the edit is a pending change
 * of the outbox's own the moment it is made, so it is never replaced: it meets the newer value as a conflict (its value "mine"), is
 * kept by Keep mine, carried into Keep both's copy, and let go only by Use theirs, the person's choice.
 */
const EDIT_DOC = { kind: "doc", id: "e" };
const valueOf = (outbox: DocumentOutbox) => outbox.document(EDIT_DOC)?.value;
const mineOf = (outbox: DocumentOutbox) => outbox.conflicts().find(entry => entry.writes.some(write => write.id === EDIT_DOC.id))?.writes.find(write => write.id === EDIT_DOC.id)?.value;
/** Turns of the event loop, for sends and answers to land. */
const turns = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
/** The library, A's outbox over it (its store timer run by hand), and the other window's direct write. */
async function editWorld(port?: (base: DocumentStorePort) => DocumentStorePort) {
  const documents = storeDocuments(), timers: (() => void)[] = [];
  const storage = memoryOutboxStorage();
  const make = () => new DocumentOutbox(port ? port(documents) : documents, storage, { retryMs: 1,
    schedule: (ms, run) => { if (ms === STORE_SOON_MS) timers.push(run); else setTimeout(run, ms); return { cancel() {} }; } });
  const a = make();
  a.hold(EDIT_DOC, null);
  a.open();
  a.commit("edit", [{ ...EDIT_DOC, value: { n: 1 } }]);
  await a.settle();
  const other = (value: unknown) => { const now = documents.store.get(EDIT_DOC.kind, EDIT_DOC.id); documents.store.transact({ id: `other-${Math.random()}`, command: "x", writes: [{ ...EDIT_DOC, base: now?.revision ?? 0, value }] }); };
  return { documents, storage, a, other, timers, make, storeNow: () => { for (const run of timers.splice(0)) run(); } };
}

test("an edit waiting to be stored meets a newer value taken by a read, a check, a recovered command's answer or a resolution, never replaced by it", async () => {
  // A read (an owner loading again) and a revision check: both find the edit pending.
  for (const path of ["read", "check"] as const) {
    const w = await editWorld();
    w.a.commit("edit", [{ ...EDIT_DOC, value: { n: 2 } }], { store: "soon" });
    w.other({ theirs: 1 });
    if (path === "read") w.a.hold(EDIT_DOC, w.documents.store.get(EDIT_DOC.kind, EDIT_DOC.id));
    else expect(await w.a.check()).toEqual([]);
    expect(valueOf(w.a)).toEqual({ n: 2 });
    w.storeNow(); await turns();
    expect(mineOf(w.a)).toEqual({ n: 2 });
  }

  // A recovered command's answer: an earlier session's change, restored and kept (its base is what this page read), the edit after it;
  // the other window's write lands first, so the restored change goes stale and the edit folds into its "mine".
  {
    const w = await editWorld();
    let down = true;
    const gated = new DocumentOutbox({ ...w.documents, transact: async request => { if (down) throw Error("The host didn't answer."); return w.documents.store.transact(request); } },
      w.storage, { retryMs: 1 });
    gated.hold(EDIT_DOC, w.documents.store.get(EDIT_DOC.kind, EDIT_DOC.id));
    gated.open();
    gated.commit("edit", [{ ...EDIT_DOC, value: { n: 3 } }]);
    await turns(5);
    gated.stop();
    const b = w.make();
    b.hold(EDIT_DOC, w.documents.store.get(EDIT_DOC.kind, EDIT_DOC.id));
    // Still recovering: no send yet (the host answers nothing until it is up), and the person keeps working.
    down = false;
    b.open();
    expect(b.recovering(EDIT_DOC)).toBe(true);
    b.keepRestored();
    b.commit("edit", [{ ...EDIT_DOC, value: { n: 4 } }], { store: "soon" });
    w.other({ theirs: 2 });
    expect(valueOf(b)).toEqual({ n: 4 });
    for (const run of w.timers.splice(0)) run();
    await turns();
    expect(mineOf(b)).toEqual({ n: 4 });
    expect(valueOf(b)).toEqual({ n: 4 });
  }

  // `own`: a command in flight when the edit is made (so the edit follows it) is answered with a later revision this same workspace wrote
  // (a copy a crash lost): that revision becomes the baseline, and the edit, made over the command's value, is never replaced by it: it
  // goes over the command's own revision and meets the later one as a conflict.
  {
    let gate: Promise<void> | null = null, release!: () => void;
    const w = await editWorld(base => ({ ...base, transact: async request => {
      if (!gate) return base.transact(request);
      await gate; gate = null;
      const answer = await base.transact(request);
      if (!answer.ok) return answer;
      const now = (base as DocumentStorePort & { store: { get(kind: string, id: string): { revision: number } | null } }).store.get(EDIT_DOC.kind, EDIT_DOC.id)!;
      await base.transact({ id: `own-${now.revision}`, command: "x", writes: [{ ...EDIT_DOC, base: now.revision, value: { own: 1 } }] });
      return { ...answer, replayed: "receipt", own: { [documentKey(EDIT_DOC)]: { revision: now.revision + 1, value: { own: 1 } } } };
    } }));
    gate = new Promise(resolve => { release = resolve; });
    w.a.commit("edit", [{ ...EDIT_DOC, value: { n: 5 } }]);
    await turns(3);
    w.a.commit("edit", [{ ...EDIT_DOC, value: { n: 6 } }], { store: "soon" });
    expect(w.a.pendingEntries().length).toBe(2);
    release(); await turns(5);
    expect(valueOf(w.a)).toEqual({ n: 6 });
    w.storeNow(); await turns();
    expect(valueOf(w.a)).toEqual({ n: 6 });
    expect(mineOf(w.a)).toEqual({ n: 6 });
  }

  // A resolution: the edit lands while the conflict waits (it joins "mine"); Keep mine writes it, Keep both carries it into the copy, and
  // only Use theirs lets it go.
  for (const keep of ["mine", "both", "theirs"] as const) {
    const w = await editWorld();
    w.a.commit("edit", [{ ...EDIT_DOC, value: { n: 7 } }], { store: "soon" });
    w.other({ theirs: 3 });
    w.storeNow(); await turns();
    const conflict = w.a.conflicts()[0]!;
    w.a.commit("edit", [{ ...EDIT_DOC, value: { n: 8 } }], { store: "soon" });
    expect(mineOf(w.a)).toEqual({ n: 8 });
    if (keep === "mine") w.a.keepMine(conflict.id);
    else if (keep === "theirs") w.a.useTheirs(conflict.id);
    else w.a.keepBoth(conflict.id, mine => mine.map(edit => ({ ...edit, id: `${edit.id}~copy` })));
    w.storeNow(); await turns();
    expect(w.a.conflicts()).toEqual([]);
    const library = (id: string) => w.documents.store.get(EDIT_DOC.kind, id)?.value;
    if (keep === "mine") expect(library("e")).toEqual({ n: 8 });
    if (keep === "both") { expect(library("e")).toEqual({ theirs: 3 }); expect(library("e~copy")).toEqual({ n: 8 }); }
    if (keep === "theirs") expect(library("e")).toEqual({ theirs: 3 });
  }
});
