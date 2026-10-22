/**
 * The subject registry (`platform/api/subjects.ts`): the kinds of subject a build knows. Kinds register themselves (`compose/subjects.ts`
 * registers `character`); nothing here names one, and nothing assumes there is only one. A reference to a kind this build doesn't know
 * is kept by whoever holds it and is simply not resolvable here (forward reading: unknown kinds are ignored, never dropped).
 */
import { SUBJECT_KIND, type SubjectKind, type SubjectKindSpec, type SubjectRef, type SubjectRegistryPort } from "../api/subjects";

export class SubjectRegistry implements SubjectRegistryPort {
  private readonly specs = new Map<SubjectKind, SubjectKindSpec>();

  register(spec: SubjectKindSpec): () => void {
    if (!SUBJECT_KIND.test(spec.kind)) throw Error(`“${spec.kind}” isn't a subject kind.`);
    if (this.specs.has(spec.kind)) throw Error(`The subject kind “${spec.kind}” is already registered.`);
    this.specs.set(spec.kind, Object.freeze({ ...spec, scenes: Object.freeze([...spec.scenes]) }));
    return () => { if (this.specs.get(spec.kind)?.document === spec.document) this.specs.delete(spec.kind); };
  }
  kind(kind: SubjectKind): SubjectKindSpec | undefined { return this.specs.get(kind); }
  kinds(): readonly SubjectKindSpec[] { return Object.freeze([...this.specs.values()]); }
  valid(ref: SubjectRef): boolean {
    const spec = ref && typeof ref === "object" ? this.specs.get(ref.kind) : undefined;
    return !!spec && typeof ref.id === "string" && spec.isId(ref.id);
  }
}
