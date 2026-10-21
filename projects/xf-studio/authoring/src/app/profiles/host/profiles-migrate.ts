/**
 * The `profiles-1` migration's library transaction (profiles design §8 step 2), on the host: one immediate transaction per run, fenced by
 * the workspace lease, answered from its record (`migration/profiles-1:<token>`) when it already ran, so a resumed run duplicates
 * nothing. It only adds or updates `documents` rows: the released tables are read (named versions) and never written, and
 * `user_version` is untouched. Before the library's first `profiles-1` run commits, a pre-migration copy of the file is taken.
 *
 * The steps, as S3 proved them (rules M1–M6, experiment 038):
 * 1. **Collections and looks** (M2, M3). Each draft, the current one first, is compared by content (names and parts in order, read
 *    through the part registry, IDs ignored) against its collection's working copy and every fork of it (`origin`). Equal content is
 *    reused only when that loses nothing the draft keeps (each look's Undo history, and its removed looks, restorable there); with no
 *    working copy, and its identity never used (a deleted collection's is), the draft becomes it under its own IDs; otherwise the whole
 *    collection forks, "(from this browser)"
 *    (a recovery draft: "(earlier draft)"), with new collection and look IDs. A named version newer than what the working copy (or,
 *    without one, the draft) was saved as comes back first: as the working copy when there is none, else as a fork "(saved in an older
 *    version)" that joins the profile (as one an earlier run brought back does). Nothing existing is overwritten.
 * 2. **The V** (M4): reused when an existing character has exactly its whole state, decoded save by content hash; else created with its
 *    decoded save, as `character.create` makes it.
 * 3. **The profile** (M5): one already holding this V and collection; else none makes "My profile", one is used, several make "From
 *    this browser". The V and the new collections join it.
 * 4. **Own defaults** (M6) from the saved layouts, deduplicated by name and arrangement.
 * 5. **The record**, with the ID map.
 */
import { basename } from "node:path";
import { CHARACTER_DOCUMENT, CHARACTER_SCHEMA, characterDocumentOf, decodedSaveId, newCharacterId, SAVED_V_DOCUMENT } from "../../../character/character-document";
import { COLLECTION_WORKING, COLLECTION_WORKING_SCHEMA, LOOK_WORKING, LOOK_WORKING_SCHEMA, nameOf, REMOVED_LIMIT, suffixed } from "../../../library/collection-documents";
import { isTombstone } from "../../../platform/api/document-commands";
import { DOCUMENT_ID, parseFence, WORKSPACE_FENCE_HEADER, type WorkspaceFence } from "../../../platform/api/document-store";
import type { PartRegistry } from "../../../platform/core/document";
import type { LibraryBackups } from "../../../platform/persistence/backups";
import type { DocumentStore } from "../../../platform/persistence/document-store";
import type { LibraryDatabase } from "../../../platform/persistence/library-database";
import { parseSavedV } from "../../../saves/save-reader";
import { newProfileId, PROFILE_DOCUMENT, PROFILE_SCHEMA, profileDocumentOf } from "../profile-service";
import { MIGRATION_TOKEN, PROFILES_MIGRATION } from "../profile-session";
import { canonicalJson } from "../../../platform/api";
import { contentKey, lookContent, LAYOUT_DEFAULT_DOCUMENT, LAYOUT_DEFAULT_SCHEMA, LAYOUT_FRAGMENT_SCHEMA, MIGRATION_DOCUMENT, MIGRATION_RESULT_SCHEMA,
  MIGRATION_SNAPSHOT_SCHEMA, type MigrationAnswer, type MigrationDraft, type MigrationLook, migrationRecordId, type MigrationRequest, type MigrationResult,
  type MigrationSnapshot, valueKey } from "../profiles-migration-data";

/** The protocol points inside the transaction (after each step) and after its commit, before the answer: the crash harness's kill points. */
export const MIGRATION_POINTS = ["m-collections", "m-subjects", "m-profile", "m-defaults", "m-record"] as const;
export type MigrationPoint = typeof MIGRATION_POINTS[number] | "m-after-commit";

export type MigrateOptions = {
  readonly parts: PartRegistry;
  /** The file's backups: the pre-migration copy (null or absent: none, a scratch or verification file). */
  readonly backups?: LibraryBackups | null;
  readonly fence?: WorkspaceFence | null;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly random?: () => number;
  /** Crash harnesses only: runs at each protocol point (inside the transaction, a throw or a kill rolls it back). */
  readonly point?: (at: MigrationPoint) => void;
};

/** A request the host refuses as malformed; its message is safe to show. */
export class MigrationRequestError extends Error {}

const COLLECTION_ID = /^[0-9a-f-]{36}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const LOOK_ID = /^[^/\u0000-\u001f\u007f]{1,100}$/;
const LIMITS = { drafts: 8, looks: 2_000, layouts: 64 } as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const refuse = (message: string): never => { throw new MigrationRequestError(message); };

function checkLook(value: unknown): MigrationLook {
  if (!object(value) || typeof value.id !== "string" || !LOOK_ID.test(value.id) || !nameOf(value.name) || !object(value.parts)) refuse("A look in the workspace is damaged.");
  const look = value as MigrationLook;
  return { id: look.id, name: nameOf(look.name)!, parts: look.parts, ...(look.memory !== undefined ? { memory: look.memory } : {}) };
}
function checkDraft(value: unknown): MigrationDraft {
  if (!object(value) || typeof value.id !== "string" || !COLLECTION_ID.test(value.id) || !nameOf(value.name) || !Array.isArray(value.looks) || !Array.isArray(value.removed))
    refuse("A collection in the workspace is damaged.");
  const draft = value as MigrationDraft;
  if (draft.looks.length + draft.removed.length > LIMITS.looks) refuse("A collection in the workspace is too large.");
  const looks = draft.looks.map(checkLook), removed = draft.removed.map(checkLook);
  if (new Set([...looks, ...removed].map(look => look.id)).size !== looks.length + removed.length) refuse("A collection in the workspace names a look twice.");
  return { id: draft.id, name: nameOf(draft.name)!, ...(Number.isSafeInteger(draft.revision) && draft.revision! >= 1 ? { revision: draft.revision } : {}),
    ...(draft.packagePlan !== undefined ? { packagePlan: draft.packagePlan } : {}), looks, removed };
}
/** The request, validated (a malformed one throws `MigrationRequestError`). */
export function checkMigrationRequest(value: unknown): MigrationRequest {
  if (!object(value) || typeof value.token !== "string" || !MIGRATION_TOKEN.test(value.token) || typeof value.digest !== "string" || !DIGEST.test(value.digest))
    refuse("That isn't a migration.");
  const s = (value as { snapshot?: unknown }).snapshot;
  if (!object(s) || s.schema !== MIGRATION_SNAPSHOT_SCHEMA || typeof s.workspace !== "string" || !DOCUMENT_ID.test(s.workspace) ||
    !Array.isArray(s.drafts) || s.drafts.length > LIMITS.drafts || !Array.isArray(s.layouts) || s.layouts.length > LIMITS.layouts || !object(s.character))
    refuse("That isn't a workspace snapshot.");
  const snapshot = s as MigrationSnapshot;
  const drafts = snapshot.drafts.map(checkDraft);
  const character = snapshot.character;
  const document = characterDocumentOf({ ...(character.document as object), schema: CHARACTER_SCHEMA, id: "c-migrating" });
  if (!document) refuse("The V in the workspace is damaged.");
  let saved: { id: string; value: ReturnType<typeof parseSavedV> } | undefined;
  if (character.saved !== undefined) {
    let parsed: ReturnType<typeof parseSavedV>;
    try { parsed = parseSavedV(character.saved.value); } catch { return refuse("The V's save in the workspace is damaged."); }
    // The decoded save's ID is its content hash, computed here again: a mismatch is refused, never stored under the wrong ID.
    if (decodedSaveId(parsed) !== character.saved.id) refuse("The V's save in the workspace is damaged.");
    saved = { id: character.saved.id, value: parsed };
  }
  if (document!.source.kind === "save" && document!.source.decoded !== saved?.id) refuse("The V's save isn't in the workspace.");
  const layouts = snapshot.layouts.map(layout => {
    if (!object(layout) || !nameOf(layout.name) || !object(layout.fragment) || layout.fragment.schema !== LAYOUT_FRAGMENT_SCHEMA || !object(layout.fragment.tab))
      refuse("A saved layout in the workspace is damaged.");
    return { name: nameOf(layout.name)!, fragment: layout.fragment, ...(layout.active === true ? { active: true as const } : {}) };
  });
  const current = object(snapshot.current) && typeof snapshot.current.id === "string" && Number.isSafeInteger(snapshot.current.revision)
    ? { id: snapshot.current.id, revision: snapshot.current.revision } : undefined;
  const { id: _id, ...doc } = document!;
  return { token: (value as { token: string }).token, digest: (value as { digest: string }).digest, snapshot: { schema: MIGRATION_SNAPSHOT_SCHEMA, workspace: snapshot.workspace, drafts,
    ...(typeof snapshot.selected === "string" ? { selected: snapshot.selected } : {}), ...(current ? { current } : {}),
    character: { document: doc, ...(saved ? { saved } : {}) }, layouts } };
}

type Row = { id: string; revision: number; value: Record<string, any> };

/**
 * Runs the migration for `request` (validated by `checkMigrationRequest`) in one transaction; answers its result (the stored one when this
 * token already ran) or `superseded` when the workspace issued a newer lease generation.
 */
export function migrateProfiles(database: LibraryDatabase, store: DocumentStore, request: MigrationRequest, options: MigrateOptions): MigrationAnswer {
  const { parts, point = () => {} } = options;
  const now = options.now ?? Date.now, uuid = options.uuid ?? (() => crypto.randomUUID()), random = options.random ?? Math.random;
  return database.write(db => {
    if (options.fence && options.fence.generation < store.leaseGeneration(options.fence.workspace)) return { ok: false, reason: "superseded" } as const;
    const get = (kind: string, id: string): Row | null => {
      const row = db.query("SELECT id, revision, value FROM documents WHERE kind = ? AND id = ?").get(kind, id) as { id: string; revision: number; value: string } | null;
      return row ? { id: row.id, revision: row.revision, value: JSON.parse(row.value) } : null;
    };
    const list = (kind: string): Row[] => (db.query("SELECT id, revision, value FROM documents WHERE kind = ? ORDER BY rowid").all(kind) as { id: string; revision: number; value: string }[])
      .map(row => ({ id: row.id, revision: row.revision, value: JSON.parse(row.value) })).filter(row => !isTombstone(row.value));
    const recorded = get(MIGRATION_DOCUMENT, migrationRecordId(request.token));
    if (recorded) return { ok: true, result: recorded.value as MigrationResult } as const;

    // The pre-migration copy, before the library's first profiles-1 run changes anything (taken while this transaction holds the write
    // lock, so it is the file as committed); dropped again if the run fails and rolls back.
    const first = !db.query(`SELECT 1 FROM documents WHERE kind = ? AND substr(id, 1, ?) = ? LIMIT 1`).get(MIGRATION_DOCUMENT, PROFILES_MIGRATION.length + 1, `${PROFILES_MIGRATION}:`);
    const copy = first ? options.backups?.beforeMigration(PROFILES_MIGRATION) : undefined;
    try {
      return database.write(() => ({ ok: true, result: run() }) as const);
    } catch (error) {
      if (copy) try { options.backups?.discardMigrationCopy(copy); } catch { /* A spare copy is harmless. */ }
      throw error;
    }

    function run(): MigrationResult {
      const at = now(), snap = request.snapshot, made: string[] = [];
      const put = (kind: string, id: string, value: unknown) => {
        const current = db.query("SELECT revision FROM documents WHERE kind = ? AND id = ?").get(kind, id) as { revision: number } | null;
        if (current) db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?").run(current.revision + 1, JSON.stringify(value), at, kind, id);
        else db.query("INSERT INTO documents VALUES (?, ?, 1, ?, ?, ?)").run(kind, id, JSON.stringify(value), at, at);
      };
      const lookOf = (collection: string, look: string) => get(LOOK_WORKING, `${collection}/${look}`);
      /** A working copy's content, or a key of its own when a look it lists is missing (never equal to anything). */
      const contentOf = (collection: Row) => {
        const looks = (collection.value.looks as string[]).map(id => lookOf(collection.id, id));
        return looks.every(look => look && !isTombstone(look.value)) ? contentKey(parts, looks.map(look => look!.value as MigrationLook)) : `incomplete:${collection.id}`;
      };
      /** Writes a collection and its looks; answers the map from the given looks' IDs to the stored ones. */
      const create = (id: string, name: string, looks: readonly MigrationLook[], removed: readonly MigrationLook[], extra: Record<string, unknown>, fresh: boolean) => {
        const map: Record<string, string> = {};
        const write = (look: MigrationLook, state: "live" | "removed") => {
          const lookId = fresh ? uuid() : look.id;
          map[look.id] = lookId;
          put(LOOK_WORKING, `${id}/${lookId}`, { schema: LOOK_WORKING_SCHEMA, collection: id, id: lookId, name: look.name, parts: look.parts,
            ...(look.memory !== undefined ? { memory: look.memory } : {}), state });
        };
        for (const look of looks) write(look, "live");
        const kept = removed.slice(Math.max(0, removed.length - REMOVED_LIMIT));
        for (const look of kept) write(look, "removed");
        put(COLLECTION_WORKING, id, { schema: COLLECTION_WORKING_SCHEMA, id, name, looks: looks.map(look => map[look.id]),
          removed: kept.map(look => ({ look: map[look.id], at })), ...extra, createdAt: at });
        return map;
      };
      /** The newest named version of a collection (released tables, read only), read through the part registry. */
      const newestNamed = (id: string) => {
        const row = db.query("SELECT revision, collection_json FROM collection_revisions WHERE collection_id = ? ORDER BY revision DESC LIMIT 1").get(id) as
          { revision: number; collection_json: string } | null;
        if (!row) return null;
        try {
          const collection = parts.readCollection(JSON.parse(row.collection_json), true, "keep");
          return { revision: row.revision, name: collection.name, packagePlan: collection.packagePlan,
            looks: collection.presets.map(look => ({ id: look.id, name: look.name, parts: parts.minimalLook(look).parts })) };
        } catch { return null; }
      };

      // 1. Collections and looks (M2, M3).
      /**
       * Whether an identity is taken: by a collection or a look of it, live, removed or deleted. A taken identity is never written over (a
       * deleted collection isn't brought back over what it held); what would have used it is recovered under fresh IDs instead.
       */
      const occupied = (id: string) => !!get(COLLECTION_WORKING, id) ||
        !!db.query("SELECT 1 FROM documents WHERE kind = ? AND substr(id, 1, ?) = ? LIMIT 1").get(LOOK_WORKING, id.length + 1, `${id}/`);
      const keptKey = (look: { name: string; parts: Readonly<Record<string, unknown>>; memory?: unknown }) =>
        `${lookContent(parts, look)}|${canonicalJson(look.memory ?? null)}`;
      /**
       * Whether reusing `candidate` for `draft` loses nothing the draft keeps: every look's Undo history is the candidate's, and every look the
       * draft removed (the newest it keeps) is restorable from the candidate with the same content and history. Otherwise the draft forks.
       */
      const preserves = (candidate: Row, draft: MigrationDraft) => {
        const ids = candidate.value.looks as string[];
        if (draft.looks.some((look, i) => canonicalJson(lookOf(candidate.id, ids[i]!)?.value.memory ?? null) !== canonicalJson(look.memory ?? null))) return false;
        const removed = new Set((candidate.value.removed as { look: string }[]).flatMap(item => {
          const look = lookOf(candidate.id, item.look);
          return look && !isTombstone(look.value) ? [keptKey(look.value as MigrationLook)] : [];
        }));
        return draft.removed.slice(Math.max(0, draft.removed.length - REMOVED_LIMIT)).every(look => removed.has(keptKey(look)));
      };
      const members: string[] = [], recovered: string[] = [];
      const idMap = { collections: {} as Record<string, string>, looks: {} as Record<string, string> };
      let collection = "";
      snap.drafts.forEach((draft, index) => {
        const main = index === 0;
        const familyOf = () => list(COLLECTION_WORKING).filter(doc => doc.id === draft.id || doc.value.origin === draft.id).map(doc => ({ doc, content: contentOf(doc) }));
        let family = familyOf();
        let working = family.find(item => item.doc.id === draft.id)?.doc ?? null;
        const opened = main && snap.current?.id === draft.id ? snap.current.revision : draft.revision ?? 0;
        const base = working ? (working.value.saved?.revision as number | undefined) ?? 0 : opened;
        const named = newestNamed(draft.id);
        if (named && named.revision > base) {
          const plan = named.packagePlan !== undefined ? { packagePlan: named.packagePlan } : {};
          const content = contentKey(parts, named.looks), held = family.find(item => item.content === content)?.doc;
          if (held) {
            // Brought back by an earlier run: a fork of it joins this run's profile too.
            if (main && held.id !== draft.id) members.push(held.id);
          } else if (!working && !occupied(draft.id)) {
            create(draft.id, named.name, named.looks, [], { ...plan, saved: { revision: named.revision } }, false);
            made.push("working-from-named");
          } else {
            const fork = uuid();
            create(fork, suffixed(named.name, "(saved in an older version)"), named.looks, [], { ...plan, origin: draft.id }, true);
            made.push("fork-named");
            if (main) members.push(fork);
          }
          family = familyOf();
          working ??= family.find(item => item.doc.id === draft.id)?.doc ?? null;
        }
        const content = contentKey(parts, draft.looks);
        const same = family.find(item => item.content === content && preserves(item.doc, draft))?.doc;
        let id: string, map: Record<string, string>;
        const plan = draft.packagePlan !== undefined ? { packagePlan: draft.packagePlan } : {};
        if (same) {
          id = same.id;
          map = Object.fromEntries(draft.looks.map((look, i) => [look.id, (same.value.looks as string[])[i]!]));
          made.push(main ? "collection-reused" : "recovered-reused");
        } else if (!working && !occupied(draft.id)) {
          id = draft.id;
          map = create(id, draft.name, draft.looks, draft.removed, { ...plan, ...(opened > 0 && named ? { saved: { revision: opened } } : {}) }, false);
          made.push(main ? "collection-created" : "recovered-created");
        } else {
          id = uuid();
          map = create(id, suffixed(draft.name, main ? "(from this browser)" : "(earlier draft)"), draft.looks, draft.removed, { ...plan, origin: draft.id }, true);
          made.push(main ? "collection-forked" : "recovered-forked");
        }
        if (main) { collection = id; idMap.collections[draft.id] = id; Object.assign(idMap.looks, map); members.unshift(id); }
        else recovered.push(id);
      });
      const unique = [...new Set(members)];
      members.splice(0, members.length, ...unique);
      point("m-collections");

      // 2. The V (M4): its whole state, the decoded save by its content hash.
      const character = snap.character;
      const state = valueKey(character.document);
      let characterId = list(CHARACTER_DOCUMENT).find(doc => {
        const known = characterDocumentOf(doc.value);
        if (!known) return false;
        const { id: _id, ...rest } = known;
        return valueKey(rest) === state;
      })?.id;
      if (character.saved && !get(SAVED_V_DOCUMENT, character.saved.id)) put(SAVED_V_DOCUMENT, character.saved.id, character.saved.value);
      if (!characterId) {
        characterId = newCharacterId(random);
        put(CHARACTER_DOCUMENT, characterId, { ...character.document, schema: CHARACTER_SCHEMA, id: characterId });
        made.push("character-created");
      } else made.push("character-reused");
      point("m-subjects");

      // 3. The profile (M5).
      const profiles = list(PROFILE_DOCUMENT).flatMap(doc => { const value = profileDocumentOf(doc.value); return value ? [{ row: doc, value }] : []; });
      const holds = (profile: (typeof profiles)[number], ids: readonly string[]) =>
        profile.value.subjects.some(subject => subject.kind === "character" && subject.id === characterId) && ids.every(id => profile.value.collections.includes(id));
      let profile = profiles.find(item => holds(item, members)) ?? profiles.find(item => holds(item, collection ? [collection] : []))
        ?? (profiles.length === 1 ? profiles[0] : undefined);
      if (!profile) {
        const id = newProfileId(random);
        const value = { schema: PROFILE_SCHEMA, id, name: profiles.length ? "From this browser" : "My profile", subjects: [], collections: [], createdAt: at };
        put(PROFILE_DOCUMENT, id, value);
        profile = { row: { id, revision: 1, value }, value: profileDocumentOf(value)! };
        made.push("profile-created");
      }
      const held = profile.value;
      const subjects = held.subjects.some(subject => subject.kind === "character" && subject.id === characterId) ? held.subjects : [...held.subjects, { kind: "character", id: characterId }];
      const added = [...new Set(members)].filter(id => !held.collections.includes(id));
      // Written over the stored value (unknown fields and subjects of unknown kinds kept), only when membership changes.
      if (subjects !== held.subjects || added.length)
        put(PROFILE_DOCUMENT, profile.row.id, { ...profile.row.value, subjects, collections: [...held.collections, ...added] });
      point("m-profile");

      // 4. Own defaults (M6), by name and arrangement.
      const existing = list(LAYOUT_DEFAULT_DOCUMENT);
      const defaults = snap.layouts.map(layout => {
        const dock = valueKey(layout.fragment.tab.dock);
        const found = existing.find(doc => doc.value.name === layout.name && valueKey(doc.value.fragment?.tab?.dock) === dock);
        if (found) return found.id;
        const id = `d-${at.toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, "0")}`;
        const value = { schema: LAYOUT_DEFAULT_SCHEMA, id, name: layout.name, owner: "user", fragment: layout.fragment, createdAt: at };
        put(LAYOUT_DEFAULT_DOCUMENT, id, value);
        existing.push({ id, revision: 1, value });
        made.push("default-created");
        return id;
      });
      point("m-defaults");

      // 5. The record (M1).
      const result: MigrationResult = { schema: MIGRATION_RESULT_SCHEMA, token: request.token, digest: request.digest, at, profile: profile.row.id, character: characterId,
        collection, members, recovered, defaults, idMap, made, ...(copy ? { backup: basename(copy) } : {}) };
      put(MIGRATION_DOCUMENT, migrationRecordId(request.token), result);
      point("m-record");
      return result;
    }
  });
}

/** Most bytes of a migration request (a workspace with every draft and Undo history). */
export const MIGRATION_BODY_BYTES = 64_000_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `POST <path>` (`/api/profiles/migrate`, or under `/api/verification`) with a `MigrationRequest`: the answer's result, or 409
 * `superseded` when the page no longer holds its workspace. Local, same-origin requests only.
 */
export function createProfilesMigrationHandler(stores: { readonly database: LibraryDatabase; readonly documents: DocumentStore }, path: string,
  options: Omit<MigrateOptions, "fence">): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (url.pathname !== path) return json({ error: "Not found." }, 404);
    if (!LOCAL_HOSTS.has(url.hostname) || origin !== url.origin) return json({ error: "Local studio requests only." }, 403);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio." }, 403);
    const fence = parseFence(request.headers.get(WORKSPACE_FENCE_HEADER));
    if (fence === "invalid") return json({ error: "That isn't a workspace lease." }, 400);
    const declared = Number(request.headers.get("Content-Length") ?? NaN);
    if (Number.isFinite(declared) && declared > MIGRATION_BODY_BYTES) return json({ error: "That workspace is too large to move." }, 413);
    let checked: MigrationRequest;
    try {
      const text = await request.text();
      if (text.length > MIGRATION_BODY_BYTES) return json({ error: "That workspace is too large to move." }, 413);
      checked = checkMigrationRequest(JSON.parse(text));
    } catch (error) {
      return json({ error: error instanceof MigrationRequestError ? error.message : "Invalid JSON." }, 400);
    }
    let answer: MigrationAnswer;
    try { answer = migrateProfiles(stores.database, stores.documents, checked, { ...options, fence }); }
    catch { return json({ error: "Your work couldn't be moved into your profile right now. Nothing was changed; it will try again." }, 500); }
    options.point?.("m-after-commit");
    return !answer.ok ? json({ code: "superseded", error: "This workspace is now open elsewhere, so it wasn't moved here." }, 409) : json(answer.result);
  };
}
