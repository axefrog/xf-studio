/**
 * The profile owner (profiles design §1.1, §2.1): profile documents, and only through commands. A profile is generic: it holds subjects
 * of any registered kind (characters now; NPCs, quests and locations later) and the collections it works on, or none. Nothing is
 * current or primary here: no profile, subject or collection is "the" one, and every command names the profile it changes and the
 * revision it read (`base`).
 *
 * - **Commands:** `profile.create`, `profile.rename`, `profile.addSubject`, `profile.removeSubject` (membership only: the subject's
 *   document stays, §1.4) and `profile.delete` (a tombstone; its subjects are detached, never deleted). Another owner's multi-document
 *   command (`character.create` with membership) takes its write from `membership`.
 * - **Subjects are checked against the registry**: a kind this build doesn't register can't be added, but one already stored (written
 *   by a newer build) is kept as it is whenever the profile is written again.
 * - **One write path:** `DocumentCommandPort` (phase 1b writes through the document store; 1c's outbox takes over behind it).
 */
import { refusal, type Capability } from "../../platform/api/capability";
import { type CommandWrite, commandKey, type DocumentCommandPort } from "../../platform/api/document-commands";
import { sameSubject, type SubjectRef, type SubjectRegistryPort } from "../../platform/api/subjects";
import { commandId } from "../../platform/core/document-commands";

export const PROFILE_DOCUMENT = "profile";
export const PROFILE_SCHEMA = "xfs/profile-1";
export type ProfileId = string;
/** `p-<base36>`. */
export const PROFILE_ID = /^p-[0-9a-z]{4,32}$/;
const NAME_LIMIT = 80;

export type ProfileDocument = {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly id: ProfileId;
  readonly name: string;
  readonly subjects: readonly SubjectRef[];
  readonly collections: readonly string[];
  readonly createdAt: number;
};
/** A profile as readers see it: its document and the revision a command names as its `base`. */
export type ProfileView = ProfileDocument & { readonly revision: number };

export type ProfileAction =
  | { kind: "profile.create"; name: string; subjects?: readonly SubjectRef[] }
  | { kind: "profile.rename"; profile: ProfileId; base: number; name: string }
  | { kind: "profile.addSubject"; profile: ProfileId; base: number; subject: SubjectRef }
  | { kind: "profile.removeSubject"; profile: ProfileId; base: number; subject: SubjectRef }
  | { kind: "profile.delete"; profile: ProfileId; base: number };
export type ProfileAnswer = { ok: true; profile: ProfileId; revision: number } | { ok: false; code: Capability["code"]; reason: string };

export const newProfileId = (random: () => number = Math.random): ProfileId =>
  `p-${Date.now().toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, "0")}`;
const nameOf = (value: unknown) => typeof value === "string" && value.trim() && value.trim().length <= NAME_LIMIT ? value.trim() : null;
const refOf = (value: unknown): SubjectRef | null => {
  const v = value as SubjectRef | null;
  return v && typeof v === "object" && typeof v.kind === "string" && typeof v.id === "string" ? { kind: v.kind, id: v.id } : null;
};

/** A stored profile, validated (null when it isn't one); unknown fields and subjects of unknown kinds are kept. */
export function profileDocumentOf(value: unknown): ProfileDocument | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || v.schema !== PROFILE_SCHEMA || typeof v.id !== "string" || !PROFILE_ID.test(v.id)) return null;
  const name = nameOf(v.name);
  if (!name || !Array.isArray(v.subjects) || !Array.isArray(v.collections)) return null;
  const subjects: SubjectRef[] = [];
  for (const item of v.subjects) { const ref = refOf(item); if (ref && !subjects.some(known => sameSubject(known, ref))) subjects.push(ref); }
  return { ...v, schema: PROFILE_SCHEMA, id: v.id, name, subjects,
    collections: [...new Set(v.collections.filter((id): id is string => typeof id === "string"))],
    createdAt: Number.isFinite(v.createdAt) ? v.createdAt as number : 0 } as ProfileDocument;
}

export type ProfileServiceDeps = {
  readonly documents: DocumentCommandPort;
  readonly subjects: SubjectRegistryPort;
  readonly random?: () => number;
  readonly now?: () => number;
};

export class ProfileService {
  private readonly held = new Map<ProfileId, { revision: number; value: ProfileDocument | null }>();
  private readonly listeners = new Set<() => void>();
  private views: readonly ProfileView[] | null = null;

  constructor(private readonly deps: ProfileServiceDeps) {}

  /** Read every profile from the library (deleted ones are held as tombstones, so a later command knows their revision). */
  async load(signal?: AbortSignal): Promise<void> {
    for (const document of await this.deps.documents.list(PROFILE_DOCUMENT, signal))
      this.held.set(document.id, { revision: document.revision, value: document.deleted ? null : profileDocumentOf(document.value) });
    this.changed();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.views = null; for (const listener of [...this.listeners]) listener(); }

  /** Every live profile, in the order they were made (frozen; the same array until something changes). */
  list(): readonly ProfileView[] {
    this.views ??= Object.freeze([...this.held.values()].flatMap(entry => entry.value ? [Object.freeze({ ...entry.value, revision: entry.revision })] : [])
      .sort((a, b) => a.createdAt - b.createdAt));
    return this.views;
  }
  profile(id: ProfileId): ProfileView | null { return this.list().find(profile => profile.id === id) ?? null; }
  /** The profiles that list a subject (named before the subject is deleted, §1.4). */
  holding(subject: SubjectRef): readonly ProfileView[] { return this.list().filter(profile => profile.subjects.some(ref => sameSubject(ref, subject))); }

  private target(id: ProfileId, base: number): ProfileView | Capability {
    const profile = this.profile(id);
    if (!profile) return refusal("missing_target", "That profile doesn't exist any more.");
    if (profile.revision !== base) return refusal("stale", "That profile changed since it was read.");
    return profile;
  }
  private subjectCheck(subject: unknown): Capability {
    const ref = refOf(subject);
    return ref && this.deps.subjects.valid(ref) ? { available: true } : refusal("invalid_value", "That isn't something a profile can hold.");
  }

  capability(action: ProfileAction): Capability {
    if (action.kind === "profile.create") {
      if (!nameOf(action.name)) return refusal("invalid_value", `A profile needs a name of 1 to ${NAME_LIMIT} characters.`);
      for (const subject of action.subjects ?? []) { const check = this.subjectCheck(subject); if (!check.available) return check; }
      return { available: true };
    }
    const profile = this.target(action.profile, action.base);
    if (!("id" in profile)) return profile;
    switch (action.kind) {
      case "profile.rename": return nameOf(action.name) ? { available: true } : refusal("invalid_value", `A profile needs a name of 1 to ${NAME_LIMIT} characters.`);
      case "profile.addSubject": {
        const check = this.subjectCheck(action.subject);
        if (!check.available) return check;
        return profile.subjects.some(ref => sameSubject(ref, action.subject)) ? refusal("invalid_value", "The profile already holds that.") : { available: true };
      }
      case "profile.removeSubject":
        return profile.subjects.some(ref => sameSubject(ref, action.subject)) ? { available: true } : refusal("invalid_value", "The profile doesn't hold that.");
      case "profile.delete": return { available: true };
    }
  }

  /** The value a command writes for a profile (null: a tombstone). */
  private next(action: ProfileAction, id: ProfileId): ProfileDocument | null {
    if (action.kind === "profile.create") {
      return { schema: PROFILE_SCHEMA, id, name: nameOf(action.name)!, subjects: (action.subjects ?? []).map(ref => ({ kind: ref.kind, id: ref.id })),
        collections: [], createdAt: (this.deps.now ?? Date.now)() };
    }
    const { revision: _revision, ...current } = this.profile(action.profile)!;
    switch (action.kind) {
      case "profile.rename": return { ...current, name: nameOf(action.name)! };
      case "profile.addSubject": return { ...current, subjects: [...current.subjects, { kind: action.subject.kind, id: action.subject.id }] };
      case "profile.removeSubject": return { ...current, subjects: current.subjects.filter(ref => !sameSubject(ref, action.subject)) };
      case "profile.delete": return null;
    }
  }

  /** Apply one command: one write, checked against the revision it read. */
  async dispatch(action: ProfileAction): Promise<ProfileAnswer> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code, reason: allowed.reason ?? "That can't be done." };
    const id = action.kind === "profile.create" ? newProfileId(this.deps.random) : action.profile;
    const base = action.kind === "profile.create" ? 0 : action.base;
    const value = this.next(action, id);
    const write: CommandWrite = value ? { kind: PROFILE_DOCUMENT, id, base, value }
      : { kind: PROFILE_DOCUMENT, id, base, tombstone: true, value: this.held.get(id)?.value ?? null };
    const answer = await this.deps.documents.commit({ id: commandId(action.kind, this.deps.random), command: action.kind, writes: [write] });
    if (!answer.ok) return answer.reason === "superseded" ? { ok: false, code: "unavailable", reason: "This workspace is now open in another window." }
      : { ok: false, code: "stale", reason: "That profile changed since it was read." };
    const revision = answer.revisions[commandKey(PROFILE_DOCUMENT, id)]!;
    this.held.set(id, { revision, value });
    this.changed();
    return { ok: true, profile: id, revision };
  }

  /**
   * A membership write for another owner's command (`character.create`), checked like `profile.addSubject`; `committed` takes the
   * command's revision once it is in the library.
   */
  membership(profile: ProfileId, base: number, subject: SubjectRef): { write: CommandWrite; committed(revision: number): void } | Capability {
    const action: ProfileAction = { kind: "profile.addSubject", profile, base, subject };
    const allowed = this.subjectCheck(subject);
    const target = this.target(profile, base);
    if (!allowed.available) return allowed;
    if (!("id" in target)) return target;
    const value = this.next(action, profile)!;
    return { write: { kind: PROFILE_DOCUMENT, id: profile, base, value },
      committed: revision => { this.held.set(profile, { revision, value }); this.changed(); } };
  }
}
