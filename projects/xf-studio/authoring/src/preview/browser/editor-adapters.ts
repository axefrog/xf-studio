/** Browser contributions on the existing feature registration. The host never interprets a feature's editing state. */
import type * as THREE from "three";
import type { Capability } from "../../platform/api";
import type { StudioAction } from "../../app/studio-application";
import type { ViewportPort } from "../../app/viewport-adapter";
import type { EditorInputState } from "../../app/input-bindings";
import type { UVNavigation, UVViewCommand, ViewportHit } from "../../app/viewport-attachment";
import type { UVSelectionVisibility, UVView } from "../../legacy/eye-makeup/uv-view";
import type { SurfaceOutline } from "../../engines/layered-makeup/surface-edge";
import type { EditorScene } from "./browser-viewport-device";
import type { LookRef } from "../../library/collection-documents";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
type Core = ReturnType<typeof createTrustedAuthoringCore>;

export type EditorBinding = {
  /** Opaque, bound services: only the registered adapter knows their feature-specific projection. */
  state: unknown; source: string; signal: AbortSignal;
  look(): LookRef | undefined;
  complete(action: { kind: string } & Record<string, unknown>): StudioAction;
  check(): Capability;
  input(state: EditorInputState): void;
  message(text: string): void;
};
export type FlatEditor = ViewportPort & {
  snapshot(): UVView; selection?(): UVSelectionVisibility | undefined;
  viewCommand(command: UVViewCommand): boolean; navigate?(command: UVNavigation): boolean;
  hitAt(x: number, y: number): ViewportHit | undefined; draw(): void;
};
export type SurfaceEditor = ViewportPort & {
  hitAt(x: number, y: number): ViewportHit | undefined; setEnabled(enabled: boolean): void;
};
export type BrowserEditorAdapters = {
  flat?: { create(canvas: HTMLCanvasElement, binding: EditorBinding, options: {
    initial?: unknown; persist(view: UVView): void; canvases(): HTMLCanvasElement[]; albedo(): HTMLImageElement | undefined;
  }): FlatEditor };
  surface?: { create(scene: EditorScene): {
    readonly guides: readonly THREE.Object3D[];
    steps(surface: THREE.SkinnedMesh): readonly (() => void)[];
    mount(surface: THREE.SkinnedMesh, binding: EditorBinding): SurfaceEditor;
    outline(surface: THREE.SkinnedMesh): SurfaceOutline | undefined;
    dispose(): void;
  } };
};
/** No secondary registry or product fallback: the same registered owner supplies its browser adapters. */
export function registeredEditorAdapters(core: Pick<Core, "app" | "documents">): BrowserEditorAdapters | undefined {
  const owner = core.documents.live ? core.app.actionRegistry().owner(core.documents.live) : undefined;
  return owner?.owner === "feature" ? (owner as typeof owner & { editors?: BrowserEditorAdapters }).editors : undefined;
}
