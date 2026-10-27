/** Remaining geometry/view compatibility projection; all production mutation services come from registration. */
import { AuthoringDocument } from "./makeup-document";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringPresentation } from "./authoring-presentation";
import type { MakeupEditing } from "../../engines/layered-makeup/editor";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import type { AuthoringEditing, StudioComposition } from "../trusted-authoring-core";
export function createMakeupView(editing: AuthoringEditing, ports: { resetStack(previous: Recipe): void; release?(): void }, composition: StudioComposition) {
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
