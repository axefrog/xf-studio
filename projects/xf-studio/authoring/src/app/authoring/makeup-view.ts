/** Remaining geometry/view compatibility projection; all production mutation services come from registration. */
import { AuthoringDocument } from "./makeup-document";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringPresentation } from "./authoring-presentation";
import type { MakeupEditing } from "../../engines/layered-makeup/editor";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import type { AuthoringEditing, EditingComposition } from "../trusted-authoring-core";
import type { ProjectionFeature } from "./feature-projections";
import { authoringAttachment } from "./authoring-attachment";
export function createMakeupView(editing: AuthoringEditing, ports: { resetStack?(previous: Recipe): void; release?(): void }, composition: EditingComposition & { documents: { live: string } }) {
  const { documents } = composition;
  const editor = editing.editors.get(documents.live) as unknown as MakeupEditing | undefined;
  if (!editor?.subscribePublication) throw Error(`The live feature ${documents.live} needs its registered editing services.`);
  const document = new AuthoringDocument(undefined,
    { feature: documents.live, parts: documents.parts, module: documents.parts.feature(documents.live)! },
    { look: editing.document, signal: editing.signal, release: ports.release, resetStack: ports.resetStack, registered: true });
  editor.subscribePublication(event => document.published(event));
  const geometry = new AuthoringGeometry(document), presentation = new AuthoringPresentation(document, geometry);
  const { recipe, eyeMakeup, gestures, controls } = editor;
  return { document, geometry, presentation, recipe, eyeMakeup, gestures, controls };
}
export type MakeupView = ReturnType<typeof createMakeupView>;
/** Only composition registers this adapter. The neutral constructors never import it. */
export function makeupAuthoring(feature: string): NonNullable<ProjectionFeature["authoring"]> {
  return { create(editing, ports, composition) {
    const value = createMakeupView(editing, ports, { ...composition, documents: { ...composition.documents, live: feature } });
    return { value, services: { document: value.document, eyeMakeup: value.eyeMakeup, gestures: value.gestures, controls: value.controls } };
  }, presentation: value => (value as MakeupView).presentation,
  follow(read) {
    const current = () => read() as MakeupView;
    const document = authoringAttachment(() => current().document, { subscribe: ["restore"], subscribeEffects: undefined, onReplacing: undefined });
    const presentation = authoringAttachment(() => current().presentation, { subscribe: ["restore"] });
    const value: MakeupView = { document: document.port, presentation: presentation.port,
      geometry: authoringAttachment(() => current().geometry).port, recipe: authoringAttachment(() => current().recipe).port,
      eyeMakeup: authoringAttachment(() => current().eyeMakeup).port, gestures: authoringAttachment(() => current().gestures).port,
      controls: authoringAttachment(() => current().controls).port };
    return { value, changing: () => document.changing(), changed() { document.changed(); presentation.changed(); },
      dispose() { document.dispose(); presentation.dispose(); } };
  } };
}
/** The sole compatibility cache attached by this feature, absent from a neutral composition. */
export function makeupProjection(core: { projections: ReadonlyMap<string, object>; documents: { live?: string } }): MakeupView | undefined {
  return core.documents.live ? core.projections.get(core.documents.live) as MakeupView | undefined : undefined;
}
