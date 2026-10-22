/**
 * Profiles phase 1: the profile model and subject registry, `CharacterService` on the outbox, the creator catalogue's split into shared
 * data and per-requester state, `character.setSource` and conflicts on a V (profiles design §1, §2.1, §2.2, §7). The multi-subject tests
 * run three characters of two bodies through the services at once and check that nothing of one reaches another; the 1b handover's 17
 * scenarios each have a test.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { descriptorsFromUiState } from "../src/character/cco-model";
import type { CreatorPort } from "../src/character/character-context-actions";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { CharacterService } from "../src/character/character-service";
import { CHARACTER_DOCUMENT, CHARACTER_SUBJECT, type CharacterDocument, SAVED_V_DOCUMENT } from "../src/character/character-document";
import { characterScope } from "../src/character/character-history";
import { ProfileService, PROFILE_DOCUMENT, PROFILE_SCHEMA } from "../src/app/profiles/profile-service";
import { createStudioSubjects } from "../src/compose/subjects";
import { SubjectRegistry } from "../src/platform/core/subject-registry";
import type { TransactRequest } from "../src/platform/api/document-commands";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { immutableDocumentKind } from "../src/compose/document-kinds";
import { createHistoryService } from "../src/platform/core/history-service";
import { ChoicePreviewOwner } from "../src/character/choice-preview-owner";
import type { ChoicePreviewPort } from "../src/character/choice-preview-service";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { characterRef } from "../src/platform/api";
import type { SavedV } from "../src/saves/save-reader";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { fixtureHost } from "./fixtures/creator-host";
import { sourceText } from "./fixtures/source-files";
import { imports, resolveFrom } from "./fixtures/import-scan";

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(done: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!done()) { if (Date.now() > end) throw Error("Timed out."); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function saveFor(derived: ReturnType<typeof descriptorsFromUiState>, isMale = false): SavedV {
  const groups = { head: [] as SavedV["groups"]["head"], body: [] as SavedV["groups"]["head"], arms: [] as SavedV["groups"]["head"] };
  const group = (part: "head" | "body" | "arms", name: string) => {
    let found = groups[part].find(g => g.name === name);
    if (!found) { found = { name, appearances: [], morphs: [] }; groups[part].push(found); }
    return found;
  };
  for (const a of derived.appearances) group(a.part, a.group).appearances.push({ resourceHash: a.app.hash, definition: a.definition, name: a.option, censorFlag: 0, censorAction: 0 });
  for (const m of derived.morphs) group(m.part, m.group).morphs.push({ region: m.region, target: m.target, censorFlag: 0, censorAction: 0 });
  return { schema: "eye-artistry/saved-v-1", saveVersion: 269, gameVersion: 2310, presetVersion: 12, isMale, brainIsMale: isMale, groups,
    perspectives: [], tags: [], evidence: { nodeName: "test", nodeBytes: 0, bytesRead: 0, trailingBytes: 0, chunks: 0, decompressedBytes: 0 } };
}

/** A choice-preview device that answers nothing and counts its ending. */
function previewDevice(count: { disposed: number }): ChoicePreviewPort {
  return { sources: async () => [], subject: async () => "subject", stored: async () => null, render: async (_source, key) => ({ url: `u:${key}` }),
    release: () => {}, dispose: () => { count.disposed++; } };
}

/**
 * The library behind a port the tests control: commands named in `hold` wait in flight until `open`, and `down` makes every command fail
 * in transit (the host doesn't answer). A second window writes through `other`, straight to the library.
 */
function library() {
  const documents = storeDocuments();
  let held = new Set<string>(), down = false;
  const waits: (() => void)[] = [];
  const port: DocumentStorePort = { ...documents,
    async transact(request) {
      if (held.has(request.command) || held.has("*")) await new Promise<void>(resolve => waits.push(resolve));
      if (down) throw Error("The library is unreachable.");
      return documents.store.transact(request);
    } };
  return { documents, store: documents.store, port,
    hold(...commands: string[]) { held = new Set(commands); },
    held: () => waits.length > 0,
    open() { held = new Set(); for (const resume of waits.splice(0)) resume(); },
    setDown(value: boolean) { down = value; },
    /** Another window's command, straight to the library. */
    other(command: string, ref: { kind: string; id: string }, value: (current: unknown) => unknown) {
      const now = documents.store.get(ref.kind, ref.id);
      return documents.store.transact({ id: `other:${Math.random()}`, command, writes: [{ ...ref, base: now?.revision ?? 0, value: value(now?.value) }] });
    },
    value<T>(kind: string, id: string) { return documents.store.get<T>(kind, id)?.value; } };
}

async function world(lib = library(), storage = memoryOutboxStorage()) {
  const host = await fixtureHost(), outbox = new DocumentOutbox(lib.port, storage, { retryMs: 5, immutable: immutableDocumentKind });
  outbox.open();
  const subjects = createStudioSubjects(), history = createHistoryService(), catalogue = new CreatorCatalogue(host.port);
  const profiles = new ProfileService({ documents: lib.documents, outbox, subjects });
  const characters = new CharacterService({ documents: lib.documents, outbox, catalogue, history, profiles });
  return { host, lib, outbox, subjects, history, catalogue, profiles, characters };
}
const blueSave = (w: { host: { source: { cco: Parameters<typeof descriptorsFromUiState>[0] } } }, isMale = false) =>
  saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" }), isMale);
const libraryCharacter = (w: Awaited<ReturnType<typeof world>>, id: string) => w.lib.value<CharacterDocument>(CHARACTER_DOCUMENT, id);
/** A V made and held by a scene, its catalogue ready, everything in the library. */
async function shownV(w: Awaited<ReturnType<typeof world>>, input: Parameters<CharacterService["create"]>[0] = {}) {
  const made = await w.characters.create(input), id = made.ok ? made.character : "";
  const shown: (SavedV | null)[] = [];
  const context = w.characters.context(id, { showSave: value => shown.push(value) });
  context.start(); await settle(); await w.characters.flush();
  return { id, context, shown };
}

describe("the subject registry (profiles design §1.1)", () => {
  test("kinds register themselves; character is one kind among any others, and an unknown kind resolves to nothing", () => {
    const registry = createStudioSubjects();
    expect(registry.kinds().map(spec => spec.kind)).toEqual(["character"]);
    expect(() => registry.register(CHARACTER_SUBJECT)).toThrow("already registered");
    // Nothing assumes one kind: another registers beside it and its references are valid.
    const unregister = registry.register({ kind: "location", document: "location", scenes: ["world"], isId: id => /^l-[a-z0-9]+$/.test(id), label: () => "A place" });
    expect(registry.kinds().map(spec => spec.kind)).toEqual(["character", "location"]);
    expect(registry.valid({ kind: "location", id: "l-1" })).toBe(true);
    expect(registry.valid({ kind: "character", id: "l-1" })).toBe(false);
    unregister();
    expect(registry.valid({ kind: "location", id: "l-1" })).toBe(false);
    expect(registry.valid({ kind: "quest", id: "q-1" })).toBe(false);
    expect(() => new SubjectRegistry().register({ ...CHARACTER_SUBJECT, kind: "Bad Kind" })).toThrow();
  });
});

describe("profiles (profiles design §1.1, §1.4)", () => {
  test("a profile holds subjects of registered kinds, or none; every command names its profile and the revision it read", async () => {
    const w = await world();
    const made = await w.profiles.dispatch({ kind: "profile.create", name: "  Night City  " });
    expect(made).toMatchObject({ ok: true, revision: 1 });
    const id = made.ok ? made.profile : "";
    expect(w.profiles.profile(id)).toMatchObject({ name: "Night City", subjects: [], collections: [] });
    const ref = characterRef("c-abcd1234");
    expect(await w.profiles.dispatch({ kind: "profile.addSubject", profile: id, base: 1, subject: ref })).toMatchObject({ ok: true, revision: 2 });
    // A stale base, an unregistered kind and a repeat are refused, and nothing is recorded.
    expect(await w.profiles.dispatch({ kind: "profile.rename", profile: id, base: 1, name: "Old" })).toMatchObject({ ok: false, code: "stale" });
    expect(w.profiles.capability({ kind: "profile.addSubject", profile: id, base: 2, subject: { kind: "quest", id: "q-1" } })).toMatchObject({ available: false, code: "invalid_value" });
    expect(w.profiles.capability({ kind: "profile.addSubject", profile: id, base: 2, subject: ref })).toMatchObject({ available: false });
    expect(w.profiles.holding(ref).map(profile => profile.id)).toEqual([id]);
    await w.outbox.settle();
    expect(w.lib.value(PROFILE_DOCUMENT, id)).toMatchObject({ name: "Night City", subjects: [ref] });
    // A subject of a kind this build doesn't know, written by a newer build, is kept when the profile is written again.
    const lib = library();
    lib.other("x", { kind: PROFILE_DOCUMENT, id: "p-future1" }, () => ({ schema: PROFILE_SCHEMA, id: "p-future1", name: "Future", subjects: [{ kind: "quest", id: "q-9" }],
      collections: [], createdAt: 1, extra: "kept" }));
    const later = await world(lib);
    await later.profiles.load();
    expect(await later.profiles.dispatch({ kind: "profile.rename", profile: "p-future1", base: 1, name: "Renamed" })).toMatchObject({ ok: true });
    await later.outbox.settle();
    expect(lib.value(PROFILE_DOCUMENT, "p-future1")).toMatchObject({ name: "Renamed", subjects: [{ kind: "quest", id: "q-9" }], extra: "kept" });
    // Removing a subject is membership only; deleting a profile is a tombstone, and a reader sees no live profile.
    expect(await w.profiles.dispatch({ kind: "profile.removeSubject", profile: id, base: 2, subject: ref })).toMatchObject({ ok: true, revision: 3 });
    expect(await w.profiles.dispatch({ kind: "profile.delete", profile: id, base: 3 })).toMatchObject({ ok: true, revision: 4 });
    await w.outbox.settle();
    const again = await world(w.lib);
    await again.profiles.load();
    expect(again.profiles.list()).toEqual([]);
    expect(w.lib.value(PROFILE_DOCUMENT, id)).toMatchObject({ tombstone: true, value: { name: "Night City" } });
  });
});

describe("three characters of two bodies at once (profiles design §7)", () => {
  test("characters are made with their profile membership in one command each, and read back from the library", async () => {
    const w = await world();
    const profile = await w.profiles.dispatch({ kind: "profile.create", name: "Crew" });
    const id = profile.ok ? profile.profile : "";
    const a = await w.characters.create({ profile: { id, base: 1 } });
    const b = await w.characters.create({ source: { kind: "default", bodyGender: "female" }, name: "Second", profile: { id, base: 2 } });
    const c = await w.characters.create({ source: { kind: "default", bodyGender: "male" }, profile: { id, base: 3 } });
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    // A stale profile revision refuses the whole command, membership and character alike.
    expect(await w.characters.create({ profile: { id, base: 1 } })).toMatchObject({ ok: false, code: "stale" });
    expect(w.profiles.profile(id)!.subjects.map(ref => ref.id)).toEqual(w.characters.list().map(character => character.id));
    expect(w.characters.list().map(character => [character.body, character.label])).toEqual([["female", "Default feminine V"], ["female", "Second"], ["male", "Default masculine V"]]);
    await w.outbox.settle();
    // Each was one command over the character and the profile together: the profile's revision moved once per V, and receipts the
    // window no longer needs were forgotten by the commands after them.
    expect(w.lib.store.get(PROFILE_DOCUMENT, id)!.revision).toBe(4);
    expect(w.lib.store.list(CHARACTER_DOCUMENT).map(doc => doc.revision)).toEqual([1, 1, 1]);
    expect(w.lib.store.list("xfs-receipt").length).toBe(1);
    const reread = await world(w.lib);
    await reread.characters.load();
    expect(reread.characters.list().map(character => character.id)).toEqual(w.characters.list().map(character => character.id));
  });

  test("catalogue requests, search, prefetch, history and cancellation never cross from one character to another (scenarios 12, 13, 16)", async () => {
    const w = await world();
    const ids = [];
    for (const body of ["female", "female", "male"] as const) {
      const made = await w.characters.create({ source: { kind: "default", bodyGender: body } });
      ids.push(made.ok ? made.character : "");
    }
    // Each character's one preview device, counting when it ends.
    const devices = ids.map(() => ({ disposed: 0 }));
    const [a, b, c] = ids.map((id, index) => w.characters.context(id!, { showSave: () => {}, previews: previewDevice(devices[index]!) }));
    expect(w.characters.context(ids[0]!, { showSave: () => {} })).toBe(a!);
    for (const context of [a, b, c]) context!.start();
    await settle();
    // One panel question per body, shared by both feminine Vs.
    expect(w.host.asked.filter(label => label.startsWith("panel:")).sort()).toEqual(["panel:female", "panel:male"]);
    expect([a, b, c].map(context => context!.snapshot().phase)).toEqual(["ready", "ready", "ready"]);

    // Rows: one page question per body; the feminine Vs share its choices, the masculine V has its own.
    for (const context of [a, b, c]) context!.choices("head/eyes_color");
    await settle();
    expect(w.host.asked.filter(label => label.startsWith("page:"))).toEqual(["page:female:head/eyes_color:0:", "page:male:head/eyes_color:0:"]);
    expect(a!.choices("head/eyes_color").choices).toBe(b!.choices("head/eyes_color").choices);
    expect(c!.choices("head/eyes_color").choices).not.toBe(a!.choices("head/eyes_color").choices);
    expect(a!.choices("head/eyes_color").choices.length).toBeGreaterThan(0);

    // Search: each requester's own query; one host question per body and query.
    expect(a!.search("blue").loading).toBe(true);
    c!.search("blue");
    await settle();
    expect(b!.search("").options).toBeNull();
    b!.search("blue");
    await settle();
    expect(w.host.asked.filter(label => label.startsWith("search:"))).toEqual(["search:female:blue", "search:male:blue"]);
    expect(a!.search("blue").options).toEqual(b!.search("blue").options);
    expect(w.catalogue.asked.search).toBe(2);

    // Prepared ahead, on the host's real prefetcher: the feminine and masculine Vs' rows are two jobs that never supersede each other,
    // and closing one stops only its own.
    const rowsReady = () => [a, c].every(context => [0, 1, 2, 3].every(position => context!.prefetch("head/eyes_color", [0, 1, 2, 3])!.states.get(position) === "r"));
    await until(rowsReady);
    expect(w.host.prefetcher.stats.cancelled).toBe(0);
    expect(w.host.warmed.filter(item => item.startsWith("female:")).sort()).toEqual(["female:c0", "female:c1", "female:c2", "female:c3"]);
    expect(w.host.warmed.filter(item => item.startsWith("male:")).sort()).toEqual(["male:c0", "male:c1", "male:c2", "male:c3"]);
    a!.stopPrefetch("head/eyes_color");
    await settle();
    expect(w.host.stops).toEqual([`${ids[0]}/panel`]);
    expect(w.host.prefetcher.stateOf(c!.detailRequest(), "head/eyes_color", 0)).toBe("r");
    c!.stopPrefetch("head/eyes_color");
    await settle();
    expect(w.host.stops).toEqual([`${ids[0]}/panel`, `${ids[2]}/panel`]);

    // A panel instance that closes lets go of its own questions only, publishes nothing late, and its row prepared ahead stops.
    const extra = b!.requester("extra"), main = b!.requester("panel");
    extra.prefetch("head/eyes_color", [0]);
    w.host.hold();
    extra.choices("head/piercings_00"); main.search("ring");
    let published = 0;
    const unsubscribe = b!.subscribe(() => { published++; });
    b!.releaseRequester("extra");
    expect(w.host.stopped).toContain("page:female:head/piercings_00:0:");
    expect(w.host.stopped).not.toContain("search:female:ring");
    await settle();
    expect(w.host.stops.at(-1)).toBe(`${ids[1]}/extra`);
    w.host.release();
    await settle();
    expect(main.search("ring").options).not.toBeNull();
    const before = published;
    extra.choices("head/eyes_color"); extra.search("blue");
    await settle();
    expect(published).toBe(before);
    unsubscribe();

    // History: each character's steps are its own `character:<id>` scope.
    a!.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    c!.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    expect(w.history.scope(characterScope(ids[0]!))!.state().depth).toBe(1);
    expect(w.history.scope(characterScope(ids[2]!))!.state().depth).toBe(1);
    expect(b!.snapshot().undo).toBeNull();
    w.history.acting([characterScope(ids[0]!)])!.command({ kind: "history.undo" });
    expect([a!.snapshot().set, b!.snapshot().set, c!.snapshot().set]).toEqual([0, 0, 1]);
    expect(a!.snapshot().redo).not.toBeNull();
    expect(c!.snapshot()).toMatchObject({ undo: c!.snapshot().undo, redo: null });
    expect(c!.snapshot().undo).not.toBeNull();

    // Cancellation: two requesters of one body share a question; one letting go stops nothing, the last one stops it.
    w.host.hold();
    a!.search("brown"); b!.search("brown");
    expect(w.host.asked.filter(label => label === "search:female:brown")).toHaveLength(1);
    a!.search("brow");
    expect(w.host.stopped).not.toContain("search:female:brown");
    b!.search("bro");
    expect(w.host.stopped).toContain("search:female:brown");
    w.host.release();
    await settle();

    // Each character's own changes reach its own document.
    await w.characters.flush();
    const docs = Object.fromEntries(w.lib.store.list<{ choices: unknown[] }>(CHARACTER_DOCUMENT).map(doc => [doc.id, doc.value.choices.length]));
    expect(docs).toEqual({ [ids[0]!]: 0, [ids[1]!]: 0, [ids[2]!]: 1 });
    // Closing a panel instance never ended its character's preview device; releasing the character does, once.
    expect(devices.map(device => device.disposed)).toEqual([0, 0, 0]);
    for (const id of ids) expect(await w.characters.release(id!)).toBe(true);
    expect(devices.map(device => device.disposed)).toEqual([1, 1, 1]);
  });

  test("a save is one decoded document shared by the Vs made from it; setSource replaces savedV and names its base", async () => {
    const w = await world();
    const save = blueSave(w);
    const a = await w.characters.create({ source: { kind: "save", value: save }, save: { kind: "file", name: "sav.dat" } });
    const b = await w.characters.create({ source: { kind: "save", value: structuredClone(save) } });
    expect([a.ok, b.ok]).toEqual([true, true]);
    await w.outbox.settle();
    expect(w.lib.store.list(SAVED_V_DOCUMENT)).toHaveLength(1);
    const idA = a.ok ? a.character : "", idB = b.ok ? b.character : "";
    expect(w.characters.document(idA)!.source as object).toMatchObject({ kind: "save", save: { kind: "file", name: "sav.dat" } });
    expect(w.characters.document(idA)!.source as object).toEqual({ ...w.characters.document(idB)!.source, save: { kind: "file", name: "sav.dat" } });

    // A V a scene shows changes through its context: one Undo step, applied on that scene, and recorded at once.
    const shown: (SavedV | null)[] = [];
    const context = w.characters.context(idA, { showSave: value => shown.push(value) });
    expect(context.snapshot().origin).toEqual({ kind: "save" });
    expect(await w.characters.setSource({ kind: "character.setSource", character: idA, base: 1, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: true, revision: 2 });
    expect(shown).toEqual([null]);
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male", undo: "Show the default V" });
    expect(w.characters.document(idA)).toMatchObject({ body: "male", source: { kind: "default" } });
    // A stale base is refused; a V no scene shows is recorded directly.
    expect(await w.characters.setSource({ kind: "character.setSource", character: idB, base: 9, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: false, code: "stale" });
    expect(await w.characters.setSource({ kind: "character.setSource", character: idB, base: 1, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: true, revision: 2 });
    // The save comes back through the context, and Undo takes it away again: every step is mirrored to the document.
    context.dispatch({ kind: "character.setSource", source: { kind: "save", value: save } });
    expect(shown.at(-1)).toEqual(save);
    expect(w.characters.document(idA)!.source.kind).toBe("save");
    w.history.acting([characterScope(idA)])!.command({ kind: "history.undo" });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    expect(w.characters.document(idA)).toMatchObject({ body: "male", source: { kind: "default" } });
    await w.characters.flush();
    expect(libraryCharacter(w, idA)).toMatchObject({ body: "male", source: { kind: "default" } });
    // Deleting names the profiles that list it, records a tombstone and closes its history.
    const deleted = await w.characters.delete(idA, w.characters.character(idA)!.revision);
    expect(deleted).toMatchObject({ ok: true, holding: [] });
    expect(w.characters.character(idA)).toBeNull();
    expect(w.history.scope(characterScope(idA))).toBeUndefined();
    await w.outbox.settle();
    expect(w.lib.value(CHARACTER_DOCUMENT, idA)).toMatchObject({ tombstone: true });
  });
});

describe("the shared creator catalogue (profiles design §7, step 1)", () => {
  test("answers are kept per body and identity, typed searches only up to a bound, and a changed catalogue drops what was kept", async () => {
    const host = await fixtureHost(), catalogue = new CreatorCatalogue(host.port), signal = new AbortController().signal;
    await catalogue.panel("female", signal);
    await catalogue.search("female", "q0", signal);
    for (let i = 1; i <= 130; i++) await catalogue.search("female", `q${i}`, signal);
    await catalogue.search("female", "q130", signal);
    expect(catalogue.asked.search).toBe(131);
    await catalogue.search("female", "q0", signal);
    expect(catalogue.asked.search).toBe(132);
    // An answer naming another catalogue than the kept panel's: nothing kept for that body stands, the other body's stays.
    await catalogue.panel("male", signal);
    await catalogue.loadRow("female", "fixture-female", "head/eyes_color", "", 0, signal);
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color")).not.toBeNull();
    expect(catalogue.identity("female")).toBe("fixture-female");
    (catalogue as unknown as { seen(gender: string, identity: string): void }).seen("female", "another");
    expect(catalogue.identity("female")).toBe("");
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color")).toBeNull();
    expect(catalogue.identity("male")).toBe("fixture-male");
  });
});

/**
 * The 17 scenarios of the phase 1b handover note (`experiments/038-profiles-spikes/1b-handover.md`), each a test. 1–11 are the
 * character write path, now the outbox; 12–17 are the catalogue and requesters (12, 13 and 16 also run in the three-character test above,
 * 13 and 14 in `choice-prefetch.test.ts`).
 */
describe("the 1b handover's scenarios, on the outbox", () => {
  test("scenario 1: a source change made while a rename is in flight never undoes the rename; both reach the library", async () => {
    const w = await world();
    const made = await w.characters.create(), id = made.ok ? made.character : "";
    await w.outbox.settle();
    w.lib.hold("character.rename");
    expect(await w.characters.rename(id, 1, "Renamed")).toMatchObject({ ok: true, revision: 2 });
    await until(w.lib.held);
    expect(await w.characters.setSource({ kind: "character.setSource", character: id, base: 2, source: { kind: "save", value: blueSave(w) } }))
      .toMatchObject({ ok: true, revision: 3 });
    w.lib.open();
    expect(await w.characters.settle(id)).toBe(true);
    expect(w.characters.document(id)).toMatchObject({ name: "Renamed", source: { kind: "save" } });
    expect(libraryCharacter(w, id)).toMatchObject({ name: "Renamed", source: { kind: "save" } });
  });

  test("scenario 2: a source change asked before a delete is refused after it; the delete is never undone", async () => {
    const w = await world();
    const made = await w.characters.create(), id = made.ok ? made.character : "";
    w.lib.hold("character.delete");
    expect(await w.characters.delete(id, 1)).toMatchObject({ ok: true });
    expect(await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: blueSave(w) } }))
      .toMatchObject({ ok: false, code: "missing_target" });
    expect(await w.characters.rename(id, 1, "Back")).toMatchObject({ ok: false, code: "missing_target" });
    w.lib.open();
    await w.outbox.settle();
    expect(w.characters.character(id)).toBeNull();
    expect(w.lib.store.get(CHARACTER_DOCUMENT, id)).toMatchObject({ revision: 2, value: { tombstone: true } });
  });

  test("scenario 3: a save's ID never waits on hashing, so a masculine V chosen right after it through the context wins everywhere", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    // The browser's digest would never answer: a source change no longer waits for it.
    const spy = spyOn(crypto.subtle, "digest").mockImplementation((() => new Promise(() => {})) as never);
    try {
      expect(await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: blueSave(w) } }))
        .toMatchObject({ ok: true });
      context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
    } finally { spy.mockRestore(); }
    await w.characters.flush();
    expect(w.characters.document(id)).toMatchObject({ body: "male", source: { kind: "default" } });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    expect(libraryCharacter(w, id)).toMatchObject({ body: "male", source: { kind: "default" } });
  });

  test("scenario 4: a source change held in flight never replaces a newer one asked through the context", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    w.lib.hold("character.setSource");
    await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: blueSave(w) } });
    await until(w.lib.held);
    context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
    w.lib.open();
    await w.characters.flush();
    expect(w.characters.document(id)).toMatchObject({ body: "male", source: { kind: "default" } });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    expect(libraryCharacter(w, id)).toMatchObject({ body: "male", source: { kind: "default" } });
  });

  test("scenario 5: a context opened while a source change is in flight shows it, and never writes the earlier source back", async () => {
    const w = await world();
    const made = await w.characters.create(), id = made.ok ? made.character : "";
    await w.outbox.settle();
    const save = blueSave(w);
    w.lib.hold("character.setSource");
    await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: save } });
    await until(w.lib.held);
    const context = w.characters.context(id, { showSave: () => {} });
    context.start();
    expect(context.snapshot().origin).toEqual({ kind: "save" });
    w.lib.open();
    await settle(); await w.characters.flush();
    expect(context.snapshot().origin).toEqual({ kind: "save" });
    expect(w.characters.document(id)!.source.kind).toBe("save");
    expect(libraryCharacter(w, id)!.source.kind).toBe("save");
    expect(w.outbox.pendingEntries()).toEqual([]);
  });

  test("scenario 6: an edit made while a command is in flight is its successor, written after it over its revision; flush waits for both", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    w.lib.hold("character.rename");
    await w.characters.rename(id, 1, "Named");
    await until(w.lib.held);
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    const [first, second] = w.outbox.pendingEntries();
    expect(second!.writes[0]!.base).toEqual({ after: first!.id });
    let flushed = false;
    void w.characters.flush().then(() => { flushed = true; });
    await settle();
    expect(flushed).toBe(false);
    w.lib.open();
    await until(() => flushed);
    expect(w.characters.character(id)).toMatchObject({ conflict: false, unsaved: false });
    expect(w.lib.store.get(CHARACTER_DOCUMENT, id)).toMatchObject({ revision: 3, value: { name: "Named", choices: [{ option: "eyes_color", choice: "he__02_blue" }] } });
  });

  test("scenario 7: a change the library can't take stays in the outbox, says so, and a release waits until it is in the library", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    w.lib.setDown(true);
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    expect(await w.characters.settle(id)).toBe(false);
    expect(w.characters.character(id)).toMatchObject({ unsaved: true });
    expect(await w.characters.release(id)).toBe(false);
    expect(w.characters.context(id, { showSave: () => {} })).toBe(context);
    expect(libraryCharacter(w, id)!.choices).toHaveLength(0);
    // The library is back: the outbox sends it again by itself, and the release goes through.
    w.lib.setDown(false);
    expect(await w.characters.release(id)).toBe(true);
    expect(w.characters.character(id)).toMatchObject({ unsaved: false });
    expect(libraryCharacter(w, id)!.choices).toHaveLength(1);
  });

  test("scenario 8: an edit made after a source change was asked survives it, in the document, the library and the context", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    w.lib.hold("character.setSource");
    await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "default", bodyGender: "male" } });
    await until(w.lib.held);
    await settle();
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    w.lib.open();
    await w.characters.flush(); await settle();
    const want = { body: "male", source: { kind: "default" }, choices: [{ option: "eyes_color", choice: "he__02_blue" }] };
    expect(w.characters.document(id)).toMatchObject(want);
    expect(libraryCharacter(w, id)).toMatchObject(want);
    expect(context.snapshot()).toMatchObject({ bodyGender: "male", set: 1 });
  });

  test("scenario 9: the save a V already comes from changes nothing, and the document and the context agree", async () => {
    const w = await world();
    const save = blueSave(w);
    const { id, context } = await shownV(w, { source: { kind: "save", value: save } });
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__01_brown" });
    await w.characters.flush();
    const before = w.outbox.pendingEntries().length, revision = w.characters.character(id)!.revision;
    expect(await w.characters.setSource({ kind: "character.setSource", character: id, base: revision, source: { kind: "save", value: structuredClone(save) } }))
      .toMatchObject({ ok: true, revision });
    expect(w.outbox.pendingEntries().length).toBe(before);
    expect(context.snapshot()).toMatchObject({ origin: { kind: "save" }, set: 1 });
    expect(w.characters.document(id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__01_brown" }]);
    await w.characters.flush();
    expect(libraryCharacter(w, id)!.choices).toEqual(w.characters.document(id)!.choices);
  });

  test("scenario 10: a source change that can't be made says why, and one another window overtook becomes a conflict shown in the panel", async () => {
    const w = await world();
    const { id, context } = await shownV(w);
    // Refused at once, with the reason; nothing changes.
    expect(() => context.dispatch({ kind: "character.setSource", source: { kind: "save", value: { not: "a save" } } })).toThrow();
    expect(await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "preset", value: { nope: 1 } } }))
      .toMatchObject({ ok: false, code: "invalid_value" });
    expect(w.outbox.pendingEntries()).toEqual([]);
    // Another window renames the V while this one changes its source: the change is never silently dropped or written over theirs.
    w.lib.other("character.rename", { kind: CHARACTER_DOCUMENT, id }, value => ({ ...value as object, name: "Theirs" }));
    let notified = 0;
    context.subscribe(() => { notified++; });
    context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
    await until(() => w.characters.character(id)!.conflict);
    expect(notified).toBeGreaterThan(0);
    expect(context.snapshot().conflict).toMatchObject({ message: expect.stringContaining("Which version"), keepBoth: true });
    expect(libraryCharacter(w, id)).toMatchObject({ name: "Theirs", body: "female" });
    expect(context.snapshot()).toMatchObject({ bodyGender: "male" });
  });

  test("scenario 11: reselecting the save already shown, while an older source change is in flight, lands last everywhere", async () => {
    const w = await world();
    const save = blueSave(w);
    const { id, context } = await shownV(w, { source: { kind: "save", value: save } });
    w.lib.hold("character.setSource");
    await w.characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "default", bodyGender: "male" } });
    await until(w.lib.held);
    context.dispatch({ kind: "character.setSource", source: { kind: "save", value: structuredClone(save) } });
    w.lib.open();
    await w.characters.flush();
    expect(context.snapshot()).toMatchObject({ origin: { kind: "save" }, bodyGender: "female" });
    expect(w.characters.document(id)!.source.kind).toBe("save");
    expect(libraryCharacter(w, id)!.source.kind).toBe("save");
  });

  test("scenario 12: each requester draws through its own lease of one preview device: ending one never ends another's", async () => {
    const calls = { disposed: 0, released: [] as string[], stops: 0, aborted: 0 };
    const device: ChoicePreviewPort = {
      sources: (_request, _option, _kind, _positions, _derive, signal) => new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => { calls.aborted++; reject(Error("Stopped.")); })),
      subject: async () => "subject", stored: async () => null, render: async (_source, key) => ({ url: `u:${key}` }),
      release: url => { calls.released.push(url); }, dispose: () => { calls.disposed++; },
      live: { start: async () => {}, frame: async () => ({ bitmap: null as never }), stop: () => { calls.stops++; } },
    };
    const owner = new ChoicePreviewOwner(device), first = owner.lease(), second = owner.lease(), source = {} as never;
    await first.render(source, "k1"); await second.render(source, "k2");
    const asking = (lease: ChoicePreviewPort) => lease.sources({} as never, "head/hair", "hair" as never, [0], null, new AbortController().signal).then(() => "answered", () => "stopped");
    const firstAsks = asking(first), secondAsks = asking(second);
    await second.live!.start(source);
    first.dispose!();
    expect(calls).toMatchObject({ disposed: 0, released: ["u:k1"], aborted: 1, stops: 0 });
    expect(await firstAsks).toBe("stopped");
    // The live turn is the second's: the first can't stop it.
    first.live!.stop();
    expect(calls.stops).toBe(0);
    second.dispose!();
    expect(calls).toMatchObject({ disposed: 0, released: ["u:k1", "u:k2"], aborted: 2, stops: 1 });
    expect(await secondAsks).toBe("stopped");
    owner.dispose();
    expect(calls.disposed).toBe(1);
  });

  test("scenario 12: an ended lease forwards no work to the device, and a picture finished after it ended is let go, not handed on", async () => {
    const asked: string[] = [], released: string[] = [];
    let finish!: () => void;
    const device: ChoicePreviewPort = {
      sources: async () => { asked.push("sources"); return []; }, subject: async () => { asked.push("subject"); return "subject"; },
      stored: async () => { asked.push("stored"); return null; },
      render: (_source, key) => { asked.push("render"); return new Promise(resolve => { finish = () => resolve({ url: `u:${key}` }); }); },
      release: url => { released.push(url); },
    };
    const lease = new ChoicePreviewOwner(device).lease(), source = {} as never;
    const drawing = lease.render(source, "k1").then(() => "handed on", () => "refused");
    lease.dispose!();
    finish();
    expect(await drawing).toBe("refused");
    expect(released).toEqual(["u:k1"]);
    const outcome = (work: Promise<unknown>) => work.then(() => "asked", () => "refused");
    expect(await Promise.all([outcome(lease.render(source, "k2")), outcome(lease.subject("female")), outcome(lease.stored("k3")),
      outcome(lease.sources({} as never, "head/hair", "hair" as never, [0], null, new AbortController().signal))])).toEqual(["refused", "refused", "refused", "refused"]);
    expect(asked).toEqual(["render"]);
  });

  test("scenario 12: a lease draws only its own live turn: an obsolete one is refused and a frame drawn after the turn moved is closed", async () => {
    const frames: ((value: { bitmap: { close(): void } }) => void)[] = [];
    let closed = 0;
    const device: ChoicePreviewPort = {
      sources: async () => [], subject: async () => "subject", stored: async () => null, render: async (_source, key) => ({ url: `u:${key}` }),
      live: { start: async () => {}, stop: () => {}, frame: () => new Promise(resolve => frames.push(resolve as never)) },
    };
    const owner = new ChoicePreviewOwner(device), first = owner.lease(), second = owner.lease(), source = {} as never;
    const outcome = (frame: Promise<unknown>) => frame.then(() => "drawn", () => "refused");
    await first.live!.start(source);
    const drawing = outcome(first.live!.frame(0, false));
    await second.live!.start(source);
    frames.shift()!({ bitmap: { close: () => { closed++; } } });
    expect(await drawing).toBe("refused");
    expect(closed).toBe(1);
    expect(await outcome(first.live!.frame(0, false))).toBe("refused");
    first.dispose!();
    expect(await outcome(first.live!.frame(0, false))).toBe("refused");
    const own = outcome(second.live!.frame(0, false));
    frames.shift()!({ bitmap: { close: () => { closed++; } } });
    expect(await own).toBe("drawn");
    expect(closed).toBe(1);
  });


  test("scenario 15: an answer to a question asked before the catalogue was dropped is never kept", async () => {
    const host = await fixtureHost(), catalogue = new CreatorCatalogue(host.port), signal = new AbortController().signal;
    host.hold();
    const late = catalogue.panel("female", signal);
    catalogue.forget("female");
    host.release();
    expect((await late).phase).toBe("ready");
    expect(catalogue.identity("female")).toBe("");
    await catalogue.panel("female", signal);
    expect(host.asked.filter(label => label === "panel:female")).toHaveLength(2);
    expect(catalogue.identity("female")).toBe("fixture-female");
    host.hold();
    const page = catalogue.loadRow("female", "fixture-female", "head/eyes_color", "", 0, signal);
    catalogue.forget("female");
    host.release();
    await page;
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color")).toBeNull();
  });

  test("scenario 15: a late answer from before the catalogue was dropped never clears the newer catalogue", async () => {
    let identity = "first";
    const pages: (() => void)[] = [];
    const port: CreatorPort = {
      panel: async () => ({ phase: "ready" as const, message: "", panel: { identity } as never }),
      page: (_gender, option, offset) => { const asked = identity; return new Promise(resolve => pages.push(() => resolve({ identity: asked, option, query: "", offset, total: 0, choices: [] } as never))); },
      view: async () => ({}) as never, preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }), wait: async () => {},
    };
    const catalogue = new CreatorCatalogue(port), signal = new AbortController().signal;
    await catalogue.panel("female", signal);
    const late = catalogue.loadRow("female", "first", "head/eyes_color", "", 0, signal);
    identity = "second";
    catalogue.forget("female");
    await catalogue.panel("female", signal);
    expect(catalogue.identity("female")).toBe("second");
    pages.shift()!();
    await late;
    expect(catalogue.identity("female")).toBe("second");
  });


  test("scenario 17: a row is assembled from kept pages as from fresh ones, and a searched row goes with its pages", async () => {
    const host = await fixtureHost(), catalogue = new CreatorCatalogue(host.port), signal = new AbortController().signal;
    await catalogue.panel("female", signal);
    await catalogue.loadRow("female", "fixture-female", "head/eyes_color", "", 0, signal);
    (catalogue as unknown as { rows: Map<string, unknown> }).rows.clear();
    await catalogue.loadRow("female", "fixture-female", "head/eyes_color", "", 0, signal);
    expect(catalogue.asked.page).toBe(1);
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color")!.choices.length).toBeGreaterThan(0);
    await catalogue.loadRow("female", "fixture-female", "head/eyes_color", "blue", 0, signal);
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color", "blue")).not.toBeNull();
    for (let i = 0; i < 130; i++) await catalogue.search("female", `q${i}`, signal);
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color", "blue")).toBeNull();
    await catalogue.loadRow("female", "fixture-female", "head/eyes_color", "blue", 0, signal);
    expect(catalogue.asked.page).toBe(3);
    expect(catalogue.rowOf("female", "fixture-female", "head/eyes_color", "blue")).not.toBeNull();
  });

});

describe("conflicts on a V (profiles design §2.2)", () => {
  /** A V shown here, changed in another window while this window changed it too. */
  async function conflicted() {
    const w = await world();
    const profile = await w.profiles.dispatch({ kind: "profile.create", name: "Crew" });
    const pid = profile.ok ? profile.profile : "";
    const shown = await shownV(w, { name: "Mine", profile: { id: pid, base: 1 } });
    w.lib.other("character.update", { kind: CHARACTER_DOCUMENT, id: shown.id }, value => ({ ...value as object, choices: [{ part: "head", option: "eyes_color", choice: "he__01_brown" }] }));
    shown.context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    await until(() => w.characters.character(shown.id)!.conflict);
    return { w, pid, ...shown };
  }

  test("Keep mine writes this window's version over theirs, explicitly", async () => {
    const { w, id, context } = await conflicted();
    // Edits while in conflict update mine.
    context.dispatch({ kind: "character.setOwnMakeup", shown: false });
    expect(context.capability({ kind: "character.resolveConflict", keep: "mine" })).toEqual({ available: true });
    context.dispatch({ kind: "character.resolveConflict", keep: "mine" });
    await w.characters.flush();
    expect(context.snapshot().conflict).toBeNull();
    expect(libraryCharacter(w, id)).toMatchObject({ choices: [{ choice: "he__02_blue" }], ownMakeup: "hidden" });
  });

  test("Use theirs shows the other window's version, its Undo starting there, and sends nothing", async () => {
    const { w, id, context } = await conflicted();
    const revision = w.characters.character(id)!.revision;
    context.dispatch({ kind: "character.resolveConflict", keep: "theirs" });
    expect(context.snapshot()).toMatchObject({ conflict: null, undo: null, elsewhere: "Changed in another window. Undo starts here." });
    expect(w.characters.document(id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__01_brown" }]);
    expect(w.characters.character(id)!.revision).toBeGreaterThan(revision);
    await w.characters.flush();
    expect(w.outbox.pendingEntries()).toEqual([]);
    expect(w.lib.store.get(CHARACTER_DOCUMENT, id)!.revision).toBe(2);
    // The next change of this window's own clears the note.
    context.dispatch({ kind: "character.setOwnMakeup", shown: false });
    expect(context.snapshot().elsewhere).toBeNull();
  });

  test("Keep both keeps mine as a copy of the V, in the profiles that list it; the original takes theirs", async () => {
    const { w, id, pid, context } = await conflicted();
    context.dispatch({ kind: "character.resolveConflict", keep: "both" });
    await w.characters.flush(); await w.outbox.settle();
    const copy = w.characters.list().find(item => item.id !== id)!;
    expect(copy.label).toBe("Mine (this window)");
    expect(w.characters.document(copy.id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__02_blue" }]);
    expect(w.characters.document(id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__01_brown" }]);
    expect(w.lib.value<{ subjects: unknown[] }>(PROFILE_DOCUMENT, pid)!.subjects).toEqual([characterRef(id), characterRef(copy.id)]);
    expect(libraryCharacter(w, copy.id)).toMatchObject({ name: "Mine (this window)" });
  });

  test("a V shown while the page recovers an older stored change ends up showing the library's newer one, and the next edit goes over it (second 1c-ii review, finding 1)", async () => {
    // A library whose receipts are never forgotten (as when the host's copy of a key didn't land before a crash).
    const lib = library();
    const kept = { ...lib, port: { ...lib.port, transact: (request: TransactRequest) => lib.port.transact({ ...request, forget: [] }) } };
    const firstStorage = memoryOutboxStorage(), first = await world(kept as typeof lib, firstStorage);
    const { id, context } = await shownV(first);
    // A: blue eyes. The stored copy of the outbox from while A was recorded is what a crash leaves.
    lib.hold("*");
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    const stale = new Map(firstStorage.keys);
    lib.open(); await first.characters.flush();
    // B: brown eyes, acknowledged.
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__01_brown" });
    await first.characters.flush();
    expect(libraryCharacter(first, id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__01_brown" }]);
    first.outbox.stop();
    const storage = memoryOutboxStorage();
    for (const [key, text] of stale) storage.keys.set(key, text);
    // The next page replays A; its answer waits while a scene opens the V.
    lib.hold("*");
    const second = await world(kept as typeof lib, storage);
    await second.characters.load();
    const shown = second.characters.context(id, { showSave() {} });
    shown.start(); await settle();
    expect(second.outbox.recovering({ kind: CHARACTER_DOCUMENT, id })).toBe(true);
    // Its controls say why they wait (style guide t-recovering).
    expect(shown.capability({ kind: "character.setOwnMakeup", shown: false })).toMatchObject({ available: false, code: "not_ready" });
    lib.open();
    await until(() => !second.outbox.recovering({ kind: CHARACTER_DOCUMENT, id }));
    await settle();
    // The context was told: it shows B, and a makeup toggle now writes B with it, never A over B.
    expect(second.characters.document(id)!.choices).toEqual([{ part: "head", option: "eyes_color", choice: "he__01_brown" }]);
    shown.dispatch({ kind: "character.setOwnMakeup", shown: false });
    await second.characters.flush();
    expect(second.outbox.conflicts()).toEqual([]);
    expect(libraryCharacter(second, id)).toMatchObject({ choices: [{ part: "head", option: "eyes_color", choice: "he__01_brown" }], ownMakeup: "hidden" });
  });

  test("third 1c-ii review: a V restored without its save shows the save once it is imported (through another V, or its own Load save), and an edit keeps its source", async () => {
    for (const through of ["another V", "its own Load save"] as const) {
      const lib = library(), storage = memoryOutboxStorage();
      const first = await world(lib, storage);
      const { id, context } = await shownV(first);
      // The V's source becomes a save, but nothing of it reaches the library, and the page dies: the record of the save is lost too.
      lib.hold("*");
      const save = blueSave(first);
      context.dispatch({ kind: "character.setSource", source: { kind: "save", value: save } });
      await settle();
      first.outbox.stop();
      for (const key of [...storage.keys.keys()]) if (key.startsWith(`${SAVED_V_DOCUMENT}/`)) storage.keys.delete(key);
      // The next page (its commands go straight to the library) restores the V's change; the save is nowhere.
      const direct = { ...lib, port: { ...lib.documents, transact: (request: TransactRequest) => Promise.resolve(lib.store.transact(request)) } };
      const second = await world(direct as typeof lib, storage);
      await second.characters.load();
      const shown = second.characters.context(id, { showSave() {} });
      shown.start(); await settle();
      await until(() => second.outbox.status().missing.length > 0);
      expect(second.characters.document(id)!.source.kind).toBe("save");
      // It can't show its save: changes are refused with the reason, never made over a V without its source.
      expect(shown.capability({ kind: "character.setClothing", state: "underwear" })).toMatchObject({ available: false, code: "not_ready" });
      if (through === "another V") expect(await second.characters.create({ source: { kind: "save", value: save } })).toMatchObject({ ok: true });
      else {
        // Importing the same save for this V is taken while it is restored (an immutable put; the V's source doesn't change).
        expect(shown.capability({ kind: "character.setSource", source: { kind: "save", value: save } })).toEqual({ available: true });
        shown.dispatch({ kind: "character.setSource", source: { kind: "save", value: save } });
      }
      await until(() => !second.outbox.recovering({ kind: CHARACTER_DOCUMENT, id }) && !second.outbox.status().missing.length);
      await settle();
      expect(shown.shownSave()).not.toBeNull();
      shown.dispatch({ kind: "character.setClothing", state: "underwear" });
      await second.characters.flush();
      expect(second.outbox.conflicts()).toEqual([]);
      expect(libraryCharacter(second, id)).toMatchObject({ source: { kind: "save" }, clothing: { state: "underwear" } });
      second.outbox.stop();
    }
  });

  test("fourth 1c-ii review: a V shown without its save shows it once a library reload finds it (imported elsewhere), and takes edits again", async () => {
    const lib = library(), first = await world(lib);
    const save = blueSave(first);
    const made = await first.characters.create({ source: { kind: "save", value: save } });
    if (!made.ok) throw Error(made.reason);
    await first.characters.flush(); await first.outbox.settle();
    const decoded = (first.characters.document(made.character)!.source as { decoded: string }).decoded;
    first.outbox.stop();
    // The library's copy of the save is gone (purged) when the next page opens the V.
    const saved = lib.store.get(SAVED_V_DOCUMENT, decoded)!;
    (lib.store as unknown as { db: { write(change: (db: { query(sql: string): { run(...args: unknown[]): unknown } }) => void): void } }).db
      .write(db => { db.query("DELETE FROM documents WHERE kind = ? AND id = ?").run(SAVED_V_DOCUMENT, decoded); });
    const second = await world(lib);
    await second.characters.load();
    const shown = second.characters.context(made.character, { showSave() {} });
    shown.start(); await settle();
    // Opening it never writes its source away (a context without its save would otherwise show, and record, the default V).
    expect(second.characters.document(made.character)!.source).toMatchObject({ kind: "save", decoded });
    expect(shown.shownSave()).toBeNull();
    expect(shown.capability({ kind: "character.setClothing", state: "underwear" })).toMatchObject({ available: false, code: "not_ready" });
    // Another window imports the same save; this page reads the library again.
    lib.store.put(SAVED_V_DOCUMENT, decoded, saved.value, 0);
    await second.characters.load();
    await settle();
    expect(shown.shownSave()).not.toBeNull();
    shown.dispatch({ kind: "character.setClothing", state: "underwear" });
    await second.characters.flush();
    expect(libraryCharacter(second, made.character)).toMatchObject({ source: { kind: "save", decoded }, clothing: { state: "underwear" } });
    second.outbox.stop();
  });

  test("Keep both over an existing membership (Sol's 1c-i note): a create whose profile went stale keeps theirs' profile, the copy added to it", async () => {
    const w = await world();
    const made = await w.profiles.dispatch({ kind: "profile.create", name: "Mine" });
    if (!made.ok) throw Error(made.reason);
    await w.outbox.settle();
    w.lib.other("profile.rename", { kind: PROFILE_DOCUMENT, id: made.profile }, value => ({ ...value as object, name: "Renamed elsewhere" }));
    const created = await w.characters.create({ name: "New V", profile: { id: made.profile, base: w.profiles.profile(made.profile)!.revision } });
    if (!created.ok) throw Error(created.reason);
    await until(() => w.outbox.conflicts().length > 0);
    // Before resolving, the profile shows mine (the new V listed); the stored one is theirs (renamed).
    expect(w.profiles.profile(made.profile)!.subjects).toEqual([characterRef(created.character)]);
    const context = w.characters.context(created.character, { showSave() {} });
    context.dispatch({ kind: "character.resolveConflict", keep: "both" });
    await w.characters.flush(); await w.outbox.settle();
    expect(w.outbox.conflicts()).toEqual([]);
    const stored = w.lib.value<{ name: string; subjects: { kind: string; id: string }[] }>(PROFILE_DOCUMENT, made.profile)!;
    // Theirs' rename is kept (mine's copy of the profile never lands over it), and the copy of the new V is listed there.
    expect(stored.name).toBe("Renamed elsewhere");
    expect(stored.subjects.length).toBe(1);
    expect(libraryCharacter(w, stored.subjects[0]!.id)).toMatchObject({ name: "New V (this window)" });
    expect(w.profiles.profile(made.profile)).toMatchObject({ name: "Renamed elsewhere", subjects: stored.subjects });
  });

  test("a stored conflict is shown again after a restart, and a change from elsewhere replaces a clean V's context (A7)", async () => {
    const storage = memoryOutboxStorage(), lib = library();
    const first = await world(lib, storage);
    const shown = await shownV(first);
    lib.other("character.update", { kind: CHARACTER_DOCUMENT, id: shown.id }, value => ({ ...value as object, name: "Theirs" }));
    shown.context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
    await until(() => first.characters.character(shown.id)!.conflict);
    first.outbox.stop();
    const host = await fixtureHost(), outbox = new DocumentOutbox(lib.port, storage, { retryMs: 5, immutable: immutableDocumentKind });
    const characters = new CharacterService({ documents: lib.documents, outbox, catalogue: new CreatorCatalogue(host.port), history: createHistoryService() });
    outbox.open();
    await characters.load();
    expect(characters.character(shown.id)).toMatchObject({ conflict: true });
    const context = characters.context(shown.id, { showSave: () => {} });
    expect(context.snapshot()).toMatchObject({ bodyGender: "male", conflict: { message: expect.any(String) } });
    context.dispatch({ kind: "character.resolveConflict", keep: "theirs" });
    // Another window changes it again: the clean V takes it at the next revision check, and its context shows it.
    lib.other("character.rename", { kind: CHARACTER_DOCUMENT, id: shown.id }, value => ({ ...value as object, body: "male", source: { kind: "default" } }));
    expect(await outbox.check()).toEqual([{ kind: CHARACTER_DOCUMENT, id: shown.id }]);
    expect(context.snapshot()).toMatchObject({ bodyGender: "male", elsewhere: expect.any(String), undo: null });
  });
});

describe("boundaries (profiles design §3.6, §7)", () => {
  const src = (name: string) => sourceText(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
  test("no profile, subject or character service holds a current, active, selected or primary one", () => {
    for (const name of ["app/profiles/profile-service", "character/character-service", "character/creator-catalogue", "character/creator-requester",
      "character/character-history", "platform/core/subject-registry", "platform/api/subjects", "platform/api/characters"]) {
      expect(src(name)).not.toMatch(/\b(?:current|active|selected|primary|focused|default)(?:Character|Subject|Profile|V)\b/);
      expect(src(name)).not.toMatch(/\bthis\.(?:current|active|selected|primary)\b/);
    }
  });
  test("features reach characters and profiles only through platform/api ports", () => {
    const walk = (dir: string): string[] => readdirSync(fileURLToPath(new URL(`../src/${dir}/`, import.meta.url)), { withFileTypes: true })
      .flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".ts") ? [`${dir}/${entry.name.slice(0, -3)}`] : []);
    const features = walk("features");
    expect(features.length).toBeGreaterThan(0);
    for (const name of features) for (const path of imports(src(name)).map(specifier => resolveFrom(name, specifier)))
      expect(path.startsWith("character/") || path.startsWith("app/profiles/") ? `${name} → ${path}` : "").toBe("");
  });
});

/** Review findings on chunk 1c-i (Sol's report) at the owners: decoded saves are immutable documents, and profiles hear every change. */
describe("review findings (chunk 1c-i): owners", () => {
  const saved = (w: Awaited<ReturnType<typeof world>>, id: string) => w.lib.store.get(SAVED_V_DOCUMENT, id);

  test("finding 1: Keep both after a new save keeps the copy's decoded save; it reads back after a restart", async () => {
    const w = await world();
    const { id, context } = await shownV(w, { name: "Mine" });
    w.lib.other("character.rename", { kind: CHARACTER_DOCUMENT, id }, value => ({ ...value as object, name: "Theirs" }));
    const save = blueSave(w);
    context.dispatch({ kind: "character.setSource", source: { kind: "save", value: save } });
    await until(() => w.characters.character(id)!.conflict);
    context.dispatch({ kind: "character.resolveConflict", keep: "both" });
    await w.outbox.settle();
    const copy = w.characters.list().find(item => item.id !== id)!;
    const decoded = (libraryCharacter(w, copy.id)!.source as { decoded: string }).decoded;
    expect(saved(w, decoded)).not.toBeNull();
    const later = await world(w.lib);
    await later.characters.load();
    expect(later.characters.decoded(decoded)).not.toBeNull();
  });

  test("finding 2: two Vs added to one profile while the first command is held both stay members", async () => {
    const w = await world();
    const made = await w.profiles.dispatch({ kind: "profile.create", name: "Crew" });
    const pid = made.ok ? made.profile : "";
    await w.outbox.settle();
    w.lib.hold("character.create");
    const a = await w.characters.create({ profile: { id: pid, base: w.profiles.profile(pid)!.revision } });
    const b = await w.characters.create({ profile: { id: pid, base: w.profiles.profile(pid)!.revision } });
    expect([a.ok, b.ok]).toEqual([true, true]);
    w.lib.open();
    await w.outbox.settle();
    expect(w.lib.value<{ subjects: { id: string }[] }>(PROFILE_DOCUMENT, pid)!.subjects.map(ref => ref.id).sort())
      .toEqual([a.ok ? a.character : "", b.ok ? b.character : ""].sort());
  });

  test("finding 5: a decoded save another V references is never removed by Use theirs on the V that brought it", async () => {
    const w = await world();
    const made = await w.profiles.dispatch({ kind: "profile.create", name: "Crew" });
    const pid = made.ok ? made.profile : "";
    await w.outbox.settle();
    const save = blueSave(w);
    w.lib.hold("character.create");
    // A's membership goes stale: another window renamed the profile meanwhile.
    const a = await w.characters.create({ source: { kind: "save", value: save }, profile: { id: pid, base: w.profiles.profile(pid)!.revision } });
    w.lib.other("profile.rename", { kind: PROFILE_DOCUMENT, id: pid }, value => ({ ...value as object, name: "Renamed" }));
    const b = await w.characters.create({ source: { kind: "save", value: structuredClone(save) } });
    w.lib.open();
    await until(() => w.outbox.conflicts().length === 1);
    await w.outbox.settle();
    w.outbox.useTheirs(w.outbox.conflicts()[0]!.id);
    await w.outbox.settle();
    expect(w.characters.character(a.ok ? a.character : "")).toBeNull();
    const decoded = (libraryCharacter(w, b.ok ? b.character : "")!.source as { decoded: string }).decoded;
    expect(saved(w, decoded)).not.toBeNull();
  });

  test("finding 8: two windows importing the same save make no conflict; the library holds one decoded save", async () => {
    const lib = library();
    const one = await world(lib), two = await world(lib);
    await one.characters.load(); await two.characters.load();
    const save = blueSave(one);
    await one.characters.create({ source: { kind: "save", value: save } });
    await two.characters.create({ source: { kind: "save", value: structuredClone(save) } });
    await one.outbox.settle(); await two.outbox.settle();
    expect([one.outbox.conflicts().length, two.outbox.conflicts().length]).toEqual([0, 0]);
    expect(lib.store.list(SAVED_V_DOCUMENT)).toHaveLength(1);
    expect(lib.store.list(CHARACTER_DOCUMENT)).toHaveLength(2);
  });
});
