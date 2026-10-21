/**
 * Profiles phase 1b: the profile model and subject registry, `CharacterService`, the creator catalogue's split into shared data and
 * per-requester state, and `character.setSource` (profiles design §1, §2.1, §7). The multi-subject tests run three characters of two
 * bodies through the services at once and check that nothing of one reaches another.
 */
import { describe, expect, test } from "bun:test";
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
import { characterRef } from "../src/platform/api";
import type { SavedV } from "../src/saves/save-reader";
import { fixtureSource } from "./cc-fixtures";
import { storeDocuments } from "./fixtures/platform-doubles";
import { sourceText } from "./fixtures/source-files";
import { imports, resolveFrom } from "./fixtures/import-scan";

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
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
  let stops = 0, holding = false;
  const held: (() => void)[] = [];
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
    wait: async () => {},
    prefetch: (request, option, positions, _focus, signal) => gate(`prefetch:${request.bodyGender}:${option}`, signal,
      () => ({ states: "r".repeat(positions.length), stopped: null, busy: false })),
    stopPrefetch: async () => { stops++; },
  };
  return { port, asked, stopped, source, stops: () => stops,
    hold() { holding = true; }, release() { holding = false; for (const answer of held.splice(0)) answer(); } };
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
    const [a, b, c] = ids.map(id => w.characters.context(id!, { showSave: () => {} }));
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

    // Prepared ahead: closing one character's row doesn't stop the host while another's is still open.
    a!.prefetch("head/eyes_color", [0, 1]);
    c!.prefetch("head/eyes_color", [0, 1]);
    await settle();
    expect(a!.prefetch("head/eyes_color", [0, 1])!.states.get(0)).toBe("r");
    a!.stopPrefetch("head/eyes_color");
    await settle();
    expect(w.host.stops()).toBe(0);
    c!.stopPrefetch("head/eyes_color");
    await settle();
    expect(w.host.stops()).toBe(1);

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
    for (const id of ids) await w.characters.release(id!);
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
