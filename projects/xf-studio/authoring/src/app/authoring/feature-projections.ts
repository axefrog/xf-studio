/** Optional application projections on the existing feature registrations. They own no look state or history. */
import type { FeatureModule } from "../../platform/api";
import type { AnyOwner } from "../../platform/core/registry";
import type { AuthoringEditing, EditingComposition } from "../trusted-authoring-core";
import type { StudioApplicationServices } from "../studio-application";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import type { AuthoringPresentation } from "./authoring-presentation";
import { authoringAttachment } from "./authoring-attachment";

/** The released stack-reset notification remains an optional compatibility port. */
export type ProjectionPorts = { resetStack?(previous: Recipe): void; release?(): void };
export type AuthoringProjection = { readonly value: object; readonly services: Partial<StudioApplicationServices> };
type FollowingProjection = { readonly value: object; changing(): void; changed(): void; dispose(): void };
export type ProjectionFeature = FeatureModule & {
  readonly authoring?: {
    create(editing: AuthoringEditing, ports: ProjectionPorts, composition: EditingComposition): AuthoringProjection;
    follow?(read: () => object): FollowingProjection;
    presentation?(value: object): AuthoringPresentation;
  };
};
export function registeredProjection(owner: AnyOwner | undefined) {
  return owner?.owner === "feature" ? (owner as ProjectionFeature).authoring : undefined;
}
export function createAuthoringProjections(editing: AuthoringEditing, ports: ProjectionPorts, composition: EditingComposition) {
  const projections = new Map<string, object>();
  let services: Partial<StudioApplicationServices> = {};
  for (const id of editing.editors.keys()) {
    const projection = registeredProjection(composition.registry.owner(id))?.create(editing, ports, composition);
    if (!projection) continue;
    editing.signal.throwIfAborted();
    projections.set(id, projection.value); services = { ...services, ...projection.services };
  }
  return { projections: projections as ReadonlyMap<string, object>, services };
}
/** Root readers follow the drawn context; keyed readers retain their exact per-look projection. */
export function followAuthoringProjections(base: ReadonlyMap<string, object>, read: () => ReadonlyMap<string, object>, composition: EditingComposition) {
  const attachments = [...base.keys()].map(id => {
    const get = () => read().get(id)!;
    const registered = registeredProjection(composition.registry.owner(id));
    const fallback = () => { const attachment = authoringAttachment(get); return { ...attachment, value: attachment.port }; };
    return [id, registered?.follow?.(get) ?? fallback()] as const;
  });
  return { projections: new Map(attachments.map(([id, attachment]) => [id, attachment.value])) as ReadonlyMap<string, object>,
    changing: () => { for (const [, attachment] of attachments) attachment.changing(); },
    changed: () => { for (const [, attachment] of attachments) attachment.changed(); },
    dispose: () => { for (const [, attachment] of attachments) attachment.dispose(); } };
}
export function authoringPresentation(core: { documents: { live?: string }; projections: ReadonlyMap<string, object>; app: { actionRegistry(): EditingComposition["registry"] } }) {
  const id = core.documents.live, value = id ? core.projections.get(id) : undefined;
  return id && value ? registeredProjection(core.app.actionRegistry().owner(id))?.presentation?.(value) : undefined;
}
