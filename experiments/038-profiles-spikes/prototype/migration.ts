/**
 * Spike prototype (S3): the `profiles-1` migration's library transaction (design §8 step 2) over the real library owner, with
 * the rules this spike settled (README "Migration rules", M1–M6). Evidence code, not production.
 *
 * M1 One immediate transaction per run; a `migration/profiles-1:<token>` record answers a resumed run with its stored result.
 * M2 Collections are compared by content (look names and values in order, IDs ignored) against the working copy **and every
 *    earlier fork of the same collection**, so a re-upgrade with a draft already brought back reuses that fork.
 * M3 A named version newer than the working copy's `saved.revision` (or, with no working copy, than the draft's base) is
 *    brought back too: the working copy is made from it when absent, otherwise it becomes a fork "(saved in an older version)".
 * M4 Characters are compared by normalized content; decoded saves by their content hash.
 * M5 Profile: one already holding this character and collection; else none → "My profile"; one → it; several → "From this
 *    browser".
 * M6 Own defaults are deduplicated by name and dock hash.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { STUDIO_PARTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import type { LibraryDatabase } from "../../../projects/xf-studio/authoring/src/platform/persistence/library-database";

export type DraftLook = { id: string; name: string; parts: unknown };
export type CharacterState = { source: unknown; decoded?: { hash: string; value: unknown }; body: "feminine" | "masculine";
  voice?: string; choices: unknown; kept?: unknown; notCarried?: unknown; clothing?: unknown; ownMakeup?: unknown };
export type MigrationSnapshot = {
  collection: { id: string; name: string; looks: DraftLook[]; selected?: string };
  /** `library.current`: the named version the draft was opened from. */
  current?: { id: string; revision: number };
  character: CharacterState;
  layouts: { name: string; dock: unknown }[];
};
export type MigrationRequest = { token: string; snapshot: MigrationSnapshot };
export type MigrationResult = {
  profile: string; character: string; collection: string; defaults: string[];
  idMap: { collections: Record<string, string>; looks: Record<string, string> };
  made: string[];
};
export const MIGRATION_POINTS = ["m-collections", "m-subjects", "m-profile", "m-defaults", "m-record"] as const;

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const newId = (prefix: string) => `${prefix}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

type Doc = { id: string; revision: number; value: any };
const get = (db: Database, kind: string, id: string): Doc | null => {
  const row = db.query("SELECT id, revision, value FROM documents WHERE kind = ? AND id = ?").get(kind, id) as { id: string; revision: number; value: string } | null;
  return row ? { id: row.id, revision: row.revision, value: JSON.parse(row.value) } : null;
};
const list = (db: Database, kind: string): Doc[] =>
  (db.query("SELECT id, revision, value FROM documents WHERE kind = ? ORDER BY rowid").all(kind) as { id: string; revision: number; value: string }[])
    .map(row => ({ id: row.id, revision: row.revision, value: JSON.parse(row.value) })).filter(doc => !doc.value?.tombstone);
const put = (db: Database, kind: string, id: string, value: unknown, at: number) => {
  const current = get(db, kind, id);
  if (current) db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?").run(current.revision + 1, JSON.stringify(value), at, kind, id);
  else db.query("INSERT INTO documents VALUES (?, ?, 1, ?, ?, ?)").run(kind, id, JSON.stringify(value), at, at);
};

/** A collection working copy's content as compared (IDs left out, so a fork compares equal to its source). */
function contentOf(db: Database, collection: Doc): string {
  return hash((collection.value.order as string[]).map(look => {
    const doc = get(db, "look-working", `${collection.id}/${look}`);
    return { name: doc?.value.name, parts: doc?.value.parts };
  }));
}
const draftContent = (looks: { name: string; parts: unknown }[]) => hash(looks.map(look => ({ name: look.name, parts: look.parts })));

/** The newest named version (released tables), read only. */
function newestNamed(db: Database, id: string): { revision: number; looks: DraftLook[]; name: string } | null {
  const row = db.query("SELECT revision, collection_json FROM collection_revisions WHERE collection_id = ? ORDER BY revision DESC LIMIT 1").get(id) as
    { revision: number; collection_json: string } | null;
  if (!row) return null;
  // Read through the part registry, as the draft's looks were: a row stored in the older schema compares by content.
  const collection = STUDIO_PARTS.readCollection(JSON.parse(row.collection_json), true);
  return { revision: row.revision, name: collection.name,
    looks: collection.presets.map(preset => ({ id: preset.id, name: preset.name, parts: JSON.parse(JSON.stringify(preset.parts)) })) };
}

function createCollection(db: Database, at: number, id: string, name: string, looks: DraftLook[], extra: Record<string, unknown>, fresh: boolean) {
  const lookMap: Record<string, string> = {};
  for (const look of looks) {
    const lookId = fresh ? newId("l-") : look.id;
    lookMap[look.id] = lookId;
    put(db, "look-working", `${id}/${lookId}`, { name: look.name, parts: look.parts, state: "live" }, at);
  }
  put(db, "collection-working", id, { name, order: looks.map(look => lookMap[look.id]), removed: [], lookMap, ...extra }, at);
  return lookMap;
}

export function migrateProfiles(database: LibraryDatabase, request: MigrationRequest, point: (at: string) => void = () => {},
  now: () => number = Date.now): MigrationResult {
  return database.write(db => {
    const recordId = `profiles-1:${request.token}`;
    const recorded = get(db, "migration", recordId);
    if (recorded) return recorded.value as MigrationResult;
    const at = now(), snap = request.snapshot, made: string[] = [];
    /** Collections this run brings into the profile: the draft's, and a named version brought back as a fork. */
    const members: string[] = [];
    const idMap: MigrationResult["idMap"] = { collections: {}, looks: {} };

    // 1. Collections and looks (M2, M3).
    const source = snap.collection;
    const family = list(db, "collection-working").filter(doc => doc.id === source.id || doc.value.origin === source.id);
    const byContent = new Map(family.map(doc => [contentOf(db, doc), doc]));
    let working = family.find(doc => doc.id === source.id) ?? null;
    const named = newestNamed(db, source.id);
    const baseRevision = working ? working.value.saved?.revision ?? 0 : snap.current?.id === source.id ? snap.current.revision : 0;
    if (named && named.revision > baseRevision && !byContent.has(draftContent(named.looks))) {
      const id = working ? newId("c-") : source.id;
      createCollection(db, at, id, working ? `${named.name} (saved in an older version)` : named.name, named.looks,
        working ? { origin: source.id, saved: { revision: named.revision } } : { saved: { revision: named.revision } }, !!working);
      made.push(working ? "fork-named" : "working-from-named");
      if (working) members.push(id);
      const doc = get(db, "collection-working", id)!;
      byContent.set(draftContent(named.looks), doc);
      working ??= doc;
    }
    const draftHash = draftContent(source.looks);
    const same = byContent.get(draftHash);
    let collection: string;
    if (same) {
      collection = same.id;
      const lookMap = (same.value.lookMap ?? {}) as Record<string, string>;
      for (const look of source.looks) idMap.looks[look.id] = same.id === source.id ? look.id : lookMap[look.id] ?? look.id;
      made.push("collection-reused");
    } else if (!working) {
      createCollection(db, at, source.id, source.name, source.looks,
        snap.current?.id === source.id ? { saved: { revision: snap.current.revision } } : {}, false);
      collection = source.id;
      for (const look of source.looks) idMap.looks[look.id] = look.id;
      made.push("collection-created");
    } else {
      collection = newId("c-");
      const lookMap = createCollection(db, at, collection, `${source.name} (from this browser)`, source.looks, { origin: source.id }, true);
      Object.assign(idMap.looks, lookMap);
      made.push("collection-forked");
    }
    idMap.collections[source.id] = collection;
    members.unshift(collection);
    point("m-collections");

    // 2. Subjects (M4).
    const character = snap.character;
    const decodedHash = character.decoded?.hash;
    const normalized = { ...character, decoded: decodedHash };
    let characterId = list(db, "character").find(doc => hash(doc.value) === hash(normalized))?.id;
    if (!characterId) {
      if (character.decoded && !get(db, "saved-v", character.decoded.hash)) put(db, "saved-v", character.decoded.hash, character.decoded.value, at);
      characterId = newId("c-");
      put(db, "character", characterId, normalized, at);
      made.push("character-created");
    } else made.push("character-reused");
    point("m-subjects");

    // 3. Profile (M5).
    const profiles = list(db, "profile");
    const holding = profiles.find(doc => doc.value.subjects.some((s: { id: string }) => s.id === characterId) && members.every(id => doc.value.collections.includes(id)))
      ?? profiles.find(doc => doc.value.subjects.some((s: { id: string }) => s.id === characterId) && doc.value.collections.includes(collection));
    let profile = holding ?? (profiles.length === 1 ? profiles[0] : null);
    if (!profile) {
      const id = newId("p-");
      put(db, "profile", id, { name: profiles.length ? "From this browser" : "My profile", subjects: [], collections: [], createdAt: at }, at);
      profile = get(db, "profile", id)!;
      made.push("profile-created");
    }
    const value = profile.value as { subjects: { kind: string; id: string }[]; collections: string[] };
    const subjects = value.subjects.some(s => s.id === characterId) ? value.subjects : [...value.subjects, { kind: "character", id: characterId }];
    const added = members.filter(id => !value.collections.includes(id));
    const collections = added.length ? [...value.collections, ...added] : value.collections;
    if (subjects !== value.subjects || collections !== value.collections) put(db, "profile", profile.id, { ...profile.value, subjects, collections }, at);
    point("m-profile");

    // 4. Own defaults (M6).
    const existing = list(db, "layout-default");
    const defaults: string[] = [];
    for (const layout of snap.layouts) {
      const found = existing.find(doc => doc.value.name === layout.name && hash(doc.value.dock) === hash(layout.dock));
      if (found) { defaults.push(found.id); continue; }
      const id = newId("d-");
      put(db, "layout-default", id, { name: layout.name, dock: layout.dock, owner: "user" }, at);
      existing.push({ id, revision: 1, value: { name: layout.name, dock: layout.dock } });
      defaults.push(id);
    }
    point("m-defaults");

    // 5. The record (M1).
    const result: MigrationResult = { profile: profile.id, character: characterId, collection, defaults, idMap, made };
    put(db, "migration", recordId, result, at);
    point("m-record");
    return result;
  });
}
