/**
 * Profiles phase 1b: the profile model and subject registry, `CharacterService`, the creator catalogue's split into shared data and
 * per-requester state, and `character.setSource` (profiles design §1, §2.1, §7). The multi-subject tests run three characters of two
 * bodies through the services at once and check that nothing of one reaches another.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { descriptorsFromUiState } from "../src/character/cco-model";
import { CatalogueIndex } from "../src/character/cc-catalogue";
import { choicePage, panelProjection, searchChoices } from "../src/character/cc-panel";
import { catalogueCoverage } from "../src/character/cc-render-coverage";
import { deriveCharacter } from "../src/character/character-context";
import type { CreatorPort } from "../src/character/character-context-actions";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { CharacterService } from "../src/character/character-service";
import { CHARACTER_DOCUMENT, CHARACTER_SUBJECT, SAVED_V_DOCUMENT } from "../src/character/character-document";
import { characterScope } from "../src/character/character-history";
import { ProfileService, PROFILE_DOCUMENT, PROFILE_SCHEMA } from "../src/app/profiles/profile-service";
import { createStudioSubjects } from "../src/compose/subjects";
import { SubjectRegistry } from "../src/platform/core/subject-registry";
import { storeCommands } from "../src/platform/core/document-commands";
import { createHistoryService } from "../src/platform/core/history-service";
import { createJobScheduler } from "../src/platform/core/jobs";
import { hostClock } from "../src/platform/core/clock";
import { ChoicePrefetcher } from "../src/character/choice-prefetch";
import { ChoicePreviewOwner } from "../src/character/choice-preview-owner";
import type { ChoicePreviewPort } from "../src/character/choice-preview-service";
import type { CommandAnswer, DocumentCommandPort } from "../src/platform/api/document-commands";
import { characterRef } from "../src/platform/api";
import type { SavedV } from "../src/saves/save-reader";
import { fixtureSource } from "./cc-fixtures";
import { storeDocuments } from "./fixtures/platform-doubles";
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

/**
 * A host over the fixture catalogue for both bodies (each its own catalogue identity), logging every question it is asked and every one
 * stopped, and holding its answers while `held` is on.
 */
async function fixtureHost() {
  const source = await fixtureSource(true);
  const index = new CatalogueIndex(source.catalogue), coverage = catalogueCoverage(source.catalogue);
  const projection = { female: panelProjection(source.catalogue, coverage, "fixture-female"), male: panelProjection(source.catalogue, coverage, "fixture-male") };
  const asked: string[] = [], stopped: string[] = [];
  const stops: string[] = [], warmed: string[] = [];
  let holding = false;
  const held: (() => void)[] = [];
  const prefetcher = new ChoicePrefetcher({
    jobs: createJobScheduler({ clock: hostClock(), quietMs: 0 }),
    requestFor: async (base, option, position) => ({ ...base, choices: [...base.choices ?? [], { part: "head", option: option.split("/")[1]!, choice: `c${position}` }] }),
    readiness: async () => () => false,
    warm: async requests => {
      warmed.push(...requests.map(request => `${request.bodyGender}:${request.choices!.at(-1)!.choice}`));
      await new Promise(resolve => setTimeout(resolve, 1));
      return requests.map(() => ({ ready: true }));
    },
    preparedBytes: async () => 0,
  }, { batch: 2, maxBatch: 2, timeMs: 60_000, bytes: 1e12 });
  const gate = <T>(label: string, signal: AbortSignal | undefined, make: () => T) => new Promise<T>((resolve, reject) => {
    asked.push(label);
    signal?.addEventListener("abort", () => { stopped.push(label); reject(new DOMException("Stopped.", "AbortError")); }, { once: true });
    const answer = () => { if (!signal?.aborted) resolve(make()); };
    if (holding) held.push(answer); else queueMicrotask(answer);
  });
  const port: CreatorPort = {
    panel: (gender, signal) => gate(`panel:${gender}`, signal, () => ({ phase: "ready" as const, message: "", panel: structuredClone(projection[gender].panel) })),
    page: (gender, option, offset, signal, query) => gate(`page:${gender}:${option}:${offset}:${query ?? ""}`, signal,
      () => choicePage(index, projection[gender].mods, option, offset, { identity: `fixture-${gender}`, ...(query ? { query } : {}) })!),
    search: (gender, query, signal) => gate(`search:${gender}:${query}`, signal, () => searchChoices(index, query, `fixture-${gender}`)),
    view: (request, signal) => gate(`view:${request.bodyGender}`, signal, () => {
      const saved = request.source === "save" ? { appearances: request.appearances, morphs: request.morphs } : null;
      const { view } = deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? []);
      const values = Object.fromEntries(Object.entries(view.values).map(([id, value]) => [id, { ...value, label: value.choice, color: null, ownLabel: value.own }]));
      return { ...view, identity: `fixture-${request.bodyGender}`, values, faceMorphs: [] };
    }),
    preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }),
    wait: (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, Math.min(ms, 2)); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }); }),
    // The host's own prefetcher (choice-prefetch.ts) on a real scheduler: each requester's row is its own job there.
    prefetch: async (request, option, positions, focus, _signal, requester) => {
      const answer = prefetcher.update({ base: request, option, positions, focus, ...(requester ? { requester } : {}) });
      return { states: answer.states, stopped: answer.stopped === "failed" ? null : answer.stopped, busy: answer.busy };
    },
    stopPrefetch: async requester => { stops.push(requester ?? "(all)"); prefetcher.cancel(requester); },
  };
  return { port, asked, stopped, source, stops, prefetcher, warmed,
    hold() { holding = true; }, release() { holding = false; for (const answer of held.splice(0)) answer(); } };
}

/** A choice-preview device that answers nothing and counts its ending. */
function previewDevice(count: { disposed: number }): ChoicePreviewPort {
  return { sources: async () => [], subject: async () => "subject", stored: async () => null, render: async (_source, key) => ({ url: `u:${key}` }),
    release: () => {}, dispose: () => { count.disposed++; } };
}

async function world() {
  const host = await fixtureHost(), store = storeDocuments(), documents = storeCommands(store);
  const subjects = createStudioSubjects(), history = createHistoryService(), catalogue = new CreatorCatalogue(host.port);
  const profiles = new ProfileService({ documents, subjects });
  const characters = new CharacterService({ documents, catalogue, history, profiles });
  return { host, store, documents, subjects, history, catalogue, profiles, characters };
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

describe("owner commands over the document store (phase 1b's path)", () => {
  test("a command ID is answered once, an equal value is acknowledged, and a stale base writes nothing more", async () => {
    const store = storeDocuments(), documents = storeCommands(store);
    const command = { id: "x:1", command: "x", writes: [{ kind: "thing", id: "a", base: 0, value: { n: 1 } }] };
    const first = await documents.commit(command), again = await documents.commit(command);
    expect(first).toEqual({ ok: true, revisions: { "thing/a": 1 } });
    expect(again).toEqual(first);
    expect((await store.list("thing"))[0]!.revision).toBe(1);
    // Another command writing the value already there over an older base is acknowledged at the current revision (A5).
    expect(await documents.commit({ id: "x:2", command: "x", writes: [{ kind: "thing", id: "a", base: 0, value: { n: 1 } }] }))
      .toEqual({ ok: true, revisions: { "thing/a": 1 } });
    expect(await documents.commit({ id: "x:3", command: "x", writes: [{ kind: "thing", id: "a", base: 0, value: { n: 2 } }] }))
      .toEqual({ ok: false, reason: "stale", current: { "thing/a": 1 } });
    expect(await documents.commit({ id: "x:4", command: "x", writes: [{ kind: "thing", id: "a", base: 1, tombstone: true, value: { n: 1 } }] })).toMatchObject({ ok: true });
    expect(await documents.list("thing")).toEqual([{ id: "a", revision: 2, value: { n: 1 }, deleted: true }]);
  });
});

describe("profiles (profiles design §1.1, §1.4)", () => {
  test("a profile holds subjects of registered kinds, or none; every command names its profile and the revision it read", async () => {
    const { profiles, documents, subjects } = await world();
    const made = await profiles.dispatch({ kind: "profile.create", name: "  Night City  " });
    expect(made).toMatchObject({ ok: true, revision: 1 });
    const id = made.ok ? made.profile : "";
    expect(profiles.profile(id)).toMatchObject({ name: "Night City", subjects: [], collections: [] });
    const ref = characterRef("c-abcd1234");
    expect(await profiles.dispatch({ kind: "profile.addSubject", profile: id, base: 1, subject: ref })).toMatchObject({ ok: true, revision: 2 });
    // A stale base, an unregistered kind and a repeat are refused, and nothing is written.
    expect(await profiles.dispatch({ kind: "profile.rename", profile: id, base: 1, name: "Old" })).toMatchObject({ ok: false, code: "stale" });
    expect(profiles.capability({ kind: "profile.addSubject", profile: id, base: 2, subject: { kind: "quest", id: "q-1" } })).toMatchObject({ available: false, code: "invalid_value" });
    expect(profiles.capability({ kind: "profile.addSubject", profile: id, base: 2, subject: ref })).toMatchObject({ available: false });
    expect(profiles.holding(ref).map(profile => profile.id)).toEqual([id]);
    // A subject of a kind this build doesn't know, written by a newer build, is kept when the profile is written again.
    const store = storeDocuments(), later = storeCommands(store);
    await store.put(PROFILE_DOCUMENT, "p-future1", { schema: PROFILE_SCHEMA, id: "p-future1", name: "Future", subjects: [{ kind: "quest", id: "q-9" }],
      collections: [], createdAt: 1, extra: "kept" }, 0);
    const reader = new ProfileService({ documents: later, subjects });
    await reader.load();
    expect(await reader.dispatch({ kind: "profile.rename", profile: "p-future1", base: 1, name: "Renamed" })).toMatchObject({ ok: true });
    expect((await store.list(PROFILE_DOCUMENT))[0]!.value).toMatchObject({ name: "Renamed", subjects: [{ kind: "quest", id: "q-9" }], extra: "kept" });
    // Removing a subject is membership only; deleting a profile is a tombstone, and a reader sees no live profile.
    expect(await profiles.dispatch({ kind: "profile.removeSubject", profile: id, base: 2, subject: ref })).toMatchObject({ ok: true, revision: 3 });
    expect(await profiles.dispatch({ kind: "profile.delete", profile: id, base: 3 })).toMatchObject({ ok: true, revision: 4 });
    const again = new ProfileService({ documents, subjects });
    await again.load();
    expect(again.list()).toEqual([]);
    expect((await documents.list(PROFILE_DOCUMENT))[0]).toMatchObject({ deleted: true, value: { name: "Night City" } });
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
    // A stale profile revision refuses the whole command's membership.
    expect(await w.characters.create({ profile: { id, base: 1 } })).toMatchObject({ ok: false, code: "stale" });
    expect(w.profiles.profile(id)!.subjects.map(ref => ref.id)).toEqual(w.characters.list().map(character => character.id));
    expect(w.characters.list().map(character => [character.body, character.label])).toEqual([["female", "Default feminine V"], ["female", "Second"], ["male", "Default masculine V"]]);
    const reread = new CharacterService({ documents: w.documents, catalogue: w.catalogue, history: w.history });
    await reread.load();
    expect(reread.list().map(character => character.id)).toEqual(w.characters.list().map(character => character.id));
  });

  test("catalogue requests, search, prefetch, history and cancellation never cross from one character to another", async () => {
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
    a!.dispatch({ kind: "character.undo" });
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

    // Each character's own changes are written back to its own document.
    await w.characters.flush();
    const docs = Object.fromEntries((await w.documents.list<{ choices: unknown[] }>(CHARACTER_DOCUMENT)).map(doc => [doc.id, doc.value.choices.length]));
    expect(docs).toEqual({ [ids[0]!]: 0, [ids[1]!]: 0, [ids[2]!]: 1 });
    // Closing a panel instance never ended its character's preview device; releasing the character does, once.
    expect(devices.map(device => device.disposed)).toEqual([0, 0, 0]);
    for (const id of ids) expect(await w.characters.release(id!)).toBe(true);
    expect(devices.map(device => device.disposed)).toEqual([1, 1, 1]);
  });

  test("a save is one decoded document shared by the Vs made from it; setSource replaces savedV and names its base", async () => {
    const w = await world();
    const save = saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" }));
    const a = await w.characters.create({ source: { kind: "save", value: save }, save: { kind: "file", name: "sav.dat" } });
    const b = await w.characters.create({ source: { kind: "save", value: structuredClone(save) } });
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await w.documents.list(SAVED_V_DOCUMENT)).toHaveLength(1);
    const idA = a.ok ? a.character : "", idB = b.ok ? b.character : "";
    expect(w.characters.document(idA)!.source as object).toMatchObject({ kind: "save", save: { kind: "file", name: "sav.dat" } });
    expect(w.characters.document(idA)!.source as object).toEqual({ ...w.characters.document(idB)!.source, save: { kind: "file", name: "sav.dat" } });

    // A V a scene shows changes through its context: one Undo step, applied on that scene, then written back.
    const shown: (SavedV | null)[] = [];
    const context = w.characters.context(idA, { showSave: value => shown.push(value) });
    expect(context.snapshot().origin).toEqual({ kind: "save" });
    expect(await w.characters.setSource({ kind: "character.setSource", character: idA, base: 1, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: true, revision: 2 });
    expect(shown).toEqual([null]);
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male", undo: "Show the default V" });
    expect(w.characters.document(idA)).toMatchObject({ body: "male", source: { kind: "default" } });
    // A stale base is refused; a V no scene shows is written at once.
    expect(await w.characters.setSource({ kind: "character.setSource", character: idB, base: 9, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: false, code: "stale" });
    expect(await w.characters.setSource({ kind: "character.setSource", character: idB, base: 1, source: { kind: "default", bodyGender: "male" } }))
      .toMatchObject({ ok: true, revision: 2 });
    // The save comes back through the context (the alias path: `savedV.*` shows it on the scene, the context follows).
    context.dispatch({ kind: "character.setSource", source: { kind: "save", value: save } });
    // The context sends it as a command on the character's queue and shows it once committed.
    await w.characters.flush();
    expect(shown.at(-1)).toEqual(save);
    context.dispatch({ kind: "character.undo" });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    await w.characters.flush();
    // Deleting names the profiles that list it, writes a tombstone and closes its history.
    const deleted = await w.characters.delete(idA, w.characters.character(idA)!.revision);
    expect(deleted).toMatchObject({ ok: true, holding: [] });
    expect(w.characters.character(idA)).toBeNull();
    expect(w.history.scope(characterScope(idA))).toBeUndefined();
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

describe("review fixes (chunk 1b)", () => {
  test("a source change prepared while a rename or a delete landed is refused, never undoing either (finding 1)", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) { const made = await w.characters.create(); ids.push(made.ok ? made.character : ""); }
    const [one, two] = ids as [string, string];
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const spy = spyOn(crypto.subtle, "digest").mockImplementation((async (...args: Parameters<typeof digest>) => { await gate; return digest(...args); }) as never);
    try {
      const fresh = () => saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" }));
      const renamed = w.characters.setSource({ kind: "character.setSource", character: one, base: 1, source: { kind: "save", value: fresh() } });
      const deleted = w.characters.setSource({ kind: "character.setSource", character: two, base: 1, source: { kind: "save", value: fresh() } });
      expect(await w.characters.rename(one, 1, "Renamed")).toMatchObject({ ok: true, revision: 2 });
      expect(await w.characters.delete(two, 1)).toMatchObject({ ok: true, revision: 2 });
      open();
      expect(await renamed).toMatchObject({ ok: false, code: "stale" });
      expect(await deleted).toMatchObject({ ok: false, code: "missing_target" });
    } finally { spy.mockRestore(); }
    expect(w.characters.document(one)).toMatchObject({ name: "Renamed", source: { kind: "default" } });
    expect(w.characters.character(two)).toBeNull();
    expect((await w.documents.list(CHARACTER_DOCUMENT)).find(doc => doc.id === two)).toMatchObject({ deleted: true, revision: 2 });
  });

  test("a failed write keeps its changes unsaved, says so, and a release waits until they are in the library (finding 2)", async () => {
    const w = await world(), failing = { count: 0 };
    const documents: DocumentCommandPort = { list: (kind, signal) => w.documents.list(kind, signal),
      commit: async (command): Promise<CommandAnswer> => {
        if (command.command === "character.update" && failing.count > 0) { failing.count--; throw Error("The library is unreachable."); }
        return w.documents.commit(command);
      } };
    const characters = new CharacterService({ documents, catalogue: w.catalogue, history: w.history });
    const made = await characters.create(), id = made.ok ? made.character : "";
    const context = characters.context(id, { showSave: () => {} });
    context.start(); await settle();
    failing.count = 99;
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    await settle();
    await characters.flush();
    expect(characters.character(id)).toMatchObject({ unsaved: true, revision: 1 });
    expect(await characters.settle(id)).toBe(false);
    expect((await w.documents.list<{ choices: unknown[] }>(CHARACTER_DOCUMENT))[0]!.value.choices).toHaveLength(0);
    // The library is back. Released: written again first, then let go.
    failing.count = 0;
    expect(await characters.release(id)).toBe(true);
    expect(characters.character(id)).toMatchObject({ unsaved: false, revision: 2 });
    expect((await w.documents.list<{ choices: unknown[] }>(CHARACTER_DOCUMENT))[0]!.value.choices).toHaveLength(1);
    // A write that keeps failing: the release refuses and the context, with its change, stays.
    const again = characters.context(id, { showSave: () => {} });
    again.start(); await settle();
    failing.count = 99;
    again.dispatch({ kind: "character.reset", part: "head", option: "eyes_color" });
    expect(await characters.release(id)).toBe(false);
    expect(characters.context(id, { showSave: () => {} })).toBe(again);
    expect(characters.character(id)!.unsaved).toBe(true);
    failing.count = 0;
    expect(await characters.settle(id)).toBe(true);
  });

  test("each requester draws through its own lease of one preview device: ending one never ends another's (finding 3)", async () => {
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

  test("an answer to a question asked before the catalogue was dropped is never kept (finding 5)", async () => {
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

  test("a row is assembled from kept pages as from fresh ones, and a searched row goes with its pages (finding 7)", async () => {
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

/** The library through a port that holds the commits of `held` commands until `open` (and says when one is held). */
function holding(documents: DocumentCommandPort, held: string) {
  const waits: (() => void)[] = [];
  let open = false;
  const port: DocumentCommandPort = { list: (kind, signal) => documents.list(kind, signal),
    commit: async command => { if (command.command === held && !open) await new Promise<void>(resolve => waits.push(resolve)); return documents.commit(command); } };
  return { port, held: () => waits.length > 0, open() { open = true; for (const resume of waits.splice(0)) resume(); } };
}

describe("review fixes, second round (chunk 1b)", () => {
  test("a late answer from before the catalogue was dropped never clears the newer catalogue (finding 5)", async () => {
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

  test("an edit made while a command commits is written after it, on the same queue, and flush waits for both (queue)", async () => {
    const w = await world(), gate = holding(w.documents, "character.rename");
    const characters = new CharacterService({ documents: gate.port, catalogue: w.catalogue, history: w.history });
    const made = await characters.create(), id = made.ok ? made.character : "";
    const context = characters.context(id, { showSave: () => {} });
    context.start(); await settle(); await characters.flush();
    const renaming = characters.rename(id, 1, "Named");
    await until(gate.held);
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    let flushed = false;
    void characters.flush().then(() => { flushed = true; });
    await settle();
    expect(flushed).toBe(false);
    gate.open();
    expect(await renaming).toMatchObject({ ok: true, revision: 2 });
    await characters.flush();
    expect(flushed).toBe(true);
    expect(characters.character(id)).toMatchObject({ conflict: false, unsaved: false, revision: 3 });
    expect(characters.document(id)).toMatchObject({ name: "Named", choices: [{ option: "eyes_color", choice: "he__02_blue" }] });
  });

  test("a context opened while a source change commits follows the new source and never writes the earlier one back (source)", async () => {
    const w = await world(), gate = holding(w.documents, "character.setSource");
    const characters = new CharacterService({ documents: gate.port, catalogue: w.catalogue, history: w.history });
    const made = await characters.create(), id = made.ok ? made.character : "";
    const save = saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" }));
    const changing = characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: save } });
    await until(gate.held);
    const shown: (SavedV | null)[] = [];
    const context = characters.context(id, { showSave: value => shown.push(value) });
    context.start();
    expect(context.snapshot().origin).toEqual({ kind: "default" });
    gate.open();
    expect(await changing).toMatchObject({ ok: true, revision: 2 });
    await settle(); await characters.flush();
    expect(context.snapshot().origin).toEqual({ kind: "save" });
    expect(shown.at(-1)).toEqual(save);
    expect(characters.document(id)!.source.kind).toBe("save");
    expect((await w.documents.list<{ source: { kind: string } }>(CHARACTER_DOCUMENT))[0]!.value.source.kind).toBe("save");
  });

  test("a lease draws only its own live turn: an obsolete one is refused and a frame drawn after the turn moved is closed (previews)", async () => {
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
});

describe("review fixes, third round: one path for source changes (chunk 1b)", () => {
  test("a save paused while hashing gives way to a masculine source chosen meanwhile through the context", async () => {
    const w = await world();
    const made = await w.characters.create(), id = made.ok ? made.character : "";
    const context = w.characters.context(id, { showSave: () => {} });
    context.start(); await settle(); await w.characters.flush();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const spy = spyOn(crypto.subtle, "digest").mockImplementation((async (...args: Parameters<typeof digest>) => { await gate; return digest(...args); }) as never);
    let saving: Promise<unknown>;
    try {
      saving = w.characters.setSource({ kind: "character.setSource", character: id, base: 1,
        source: { kind: "save", value: saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" })) } });
      context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
      await until(() => w.characters.document(id)!.body === "male");
      open();
      expect(await saving).toMatchObject({ ok: false, code: "stale" });
    } finally { spy.mockRestore(); }
    await w.characters.flush();
    expect(w.characters.document(id)).toMatchObject({ body: "male", source: { kind: "default" } });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    expect((await w.documents.list<{ body: string }>(CHARACTER_DOCUMENT))[0]!.value.body).toBe("male");
  });

  test("a source held while committing never replaces a newer one asked through the context: the context shows the newer one", async () => {
    const w = await world(), gate = holding(w.documents, "character.setSource");
    const characters = new CharacterService({ documents: gate.port, catalogue: w.catalogue, history: w.history });
    const made = await characters.create(), id = made.ok ? made.character : "";
    const context = characters.context(id, { showSave: () => {} });
    context.start(); await settle(); await characters.flush();
    const save = saveFor(descriptorsFromUiState(w.host.source.cco, { eyes_color: "he__02_blue" }));
    const first = characters.setSource({ kind: "character.setSource", character: id, base: 1, source: { kind: "save", value: save } });
    await until(gate.held);
    context.dispatch({ kind: "character.useDefault", bodyGender: "male" });
    gate.open();
    await first;
    await characters.flush();
    expect(characters.document(id)).toMatchObject({ body: "male", source: { kind: "default" } });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "default" }, bodyGender: "male" });
    expect((await w.documents.list<{ source: { kind: string } }>(CHARACTER_DOCUMENT))[0]!.value.source.kind).toBe("default");
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
