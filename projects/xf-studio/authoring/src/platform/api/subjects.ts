/**
 * Subjects (profiles design §1.1): what a profile holds and a scene shows. A subject is a document of a registered kind; `character`
 * is the first kind, and NPCs, quests and locations come later. Nothing assumes a kind is the only one, and nothing is current or
 * primary: a profile lists its subjects, and each panel or view names the one it works on. Types only.
 */

/** A subject kind's name: lowercase letters, digits and `-`, starting with a letter (`character`). */
export type SubjectKind = string;
export const SUBJECT_KIND = /^[a-z][a-z0-9-]{0,31}$/;
/** One subject, by kind and ID. */
export type SubjectRef = { readonly kind: SubjectKind; readonly id: string };
export const sameSubject = (a: SubjectRef, b: SubjectRef) => a.kind === b.kind && a.id === b.id;
export const subjectKey = (ref: SubjectRef) => `${ref.kind}:${ref.id}`;

/** A registered kind: its document kind in the library, the scenes that can show it, and how a person names one. */
export type SubjectKindSpec = {
  readonly kind: SubjectKind;
  /** The `documents` kind its subjects are stored as (`character`). */
  readonly document: string;
  /** The scene kinds that can show one (`character`: the head-and-body scene). */
  readonly scenes: readonly string[];
  /** Whether an ID is one this kind makes (`c-<base36>` for characters). */
  isId(id: string): boolean;
  /** A plain name for one subject's stored value (a fallback when it has none). */
  label(value: unknown): string;
};

/** The subject kinds a build registers (`compose/subjects.ts`): kinds register themselves; none is assumed to be the only one. */
export interface SubjectRegistryPort {
  /** Registers a kind; returns its unregistration. A kind registered twice is refused. */
  register(spec: SubjectKindSpec): () => void;
  kind(kind: SubjectKind): SubjectKindSpec | undefined;
  kinds(): readonly SubjectKindSpec[];
  /** Whether `ref` names a registered kind with an ID that kind makes. */
  valid(ref: SubjectRef): boolean;
}

/**
 * What a panel type shows and edits, and what it can resolve its target from (profiles design §3.1, §5): `profile` (no binding: it works
 * on the profile), a `view`, a `scene`, a `subject` of the given kinds, or a `look`; `scenes` narrows the scene kinds it can follow.
 */
export type PanelContext =
  | { readonly kind: "profile" }
  | { readonly kind: "view" | "scene" | "look"; readonly scenes?: readonly string[] }
  | { readonly kind: "subject"; readonly subjects: readonly SubjectKind[]; readonly scenes?: readonly string[] };
