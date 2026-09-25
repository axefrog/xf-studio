/**
 * One loaded 3D head and everything connected to it, released together. The composition root
 * calls `attachBrowserHead` once the prepared preview is ready: it loads the scene, then binds the
 * stage theme, attaches the scene-backed services to the application, subscribes autosave and
 * status, connects the layer canvases, mounts the surface editor and listens to the camera.
 * Each connection registers its release as it is made. A failure part-way through releases them
 * all, newest first, including the scene's renderer and canvas, so "Try again" starts from nothing
 * instead of doubling listeners (PREV-20). `dispose()` does the same for a head that loaded.
 */
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import type { createBrowserPreviewDevice } from "./browser-preview-device";
import type { createBrowserViewportDevice } from "./browser-viewport-device";
import type { MotionActions } from "./motion-actions";
import type { PreviewActions } from "./preview-actions";
import type { SavedAppearanceActions } from "./saved-appearance-actions";
import { bindStageTheme, type SystemColourScheme } from "./stage-theme-binding";
import { createTrustedPreviewServices } from "./trusted-preview-services";
import type { WorkspaceState } from "./workspace-state";

type ViewportDevice = ReturnType<typeof createBrowserViewportDevice>;
type PreviewDevice = ReturnType<typeof createBrowserPreviewDevice>;
type Scene = Awaited<ReturnType<ViewportDevice["loadHead"]>>;

/** The head-bound services the application holds; `undefined` disconnects one. */
export type HeadServices = { savedV?: SavedAppearanceActions; preview?: PreviewActions; motion?: MotionActions };

export type HeadAttachmentPorts = {
  workspace: WorkspaceState;
  viewport: Pick<ViewportDevice, "loadHead" | "unloadHead" | "mountSurface">;
  preview: Pick<PreviewDevice, "emptyCanvases" | "connectScene" | "disconnectScene" | "presentInitialLayers">;
  /** The UI theme preference and the OS colour scheme the stage backdrop follows. */
  preferences: Parameters<typeof bindStageTheme>[1];
  colourScheme: SystemColourScheme;
  /** Connects head services to the application (and disconnects them with `undefined`). */
  attach(services: HeadServices): void;
  /** The surface editor's hooks into the authoring core. */
  surface: Parameters<ViewportDevice["mountSurface"]>[0];
  /** Requests an autosave. */
  persist(): void;
  /** Tells the presentation that device status changed. */
  changed(): void;
};

export type AttachedHead = {
  scene: Scene;
  savedAppearance: SavedAppearanceActions;
  preview: PreviewActions;
  motion: MotionActions;
  /** Releases every head-bound connection and the scene. Safe to call more than once. */
  dispose(): void;
};

export async function attachBrowserHead(ports: HeadAttachmentPorts): Promise<AttachedHead> {
  const releases: (() => void)[] = [];
  const dispose = () => {
    for (const release of releases.splice(0).reverse()) {
      try { release(); } catch (error) { console.error(error); }
    }
  };
  // The scene (with its surface editor) is released last, after everything that uses it.
  releases.push(() => ports.viewport.unloadHead());
  try {
    const scene = await ports.viewport.loadHead(ports.preview.emptyCanvases());
    releases.push(bindStageTheme(scene, ports.preferences, ports.colourScheme));
    let surface: ReturnType<ViewportDevice["mountSurface"]> | undefined;
    let savedAppearance: SavedAppearanceActions | undefined;
    const services = createTrustedPreviewServices(ports.workspace, createBrowserScenePreviewPorts(scene, {
      setSurfaceControls: enabled => surface?.setEnabled(enabled),
      hasSavedAppearance: () => !!ports.workspace.savedV || !!savedAppearance?.hasSavedV(),
    }));
    savedAppearance = services.savedAppearance;
    ports.attach({ savedV: savedAppearance });
    releases.push(() => ports.attach({ savedV: undefined }));
    releases.push(savedAppearance.subscribe(ports.persist), savedAppearance.subscribe(ports.changed));
    ports.preview.connectScene(scene);
    releases.push(() => ports.preview.disconnectScene(scene));
    surface = ports.viewport.mountSurface(ports.surface);
    const { preview, motion } = services.finish();
    ports.attach({ preview, motion });
    releases.push(() => ports.attach({ preview: undefined, motion: undefined }));
    releases.push(preview.subscribe(ports.persist), motion.subscribe(ports.persist), preview.subscribe(ports.changed));
    ports.preview.presentInitialLayers();
    const cameraMoved = () => ports.persist();
    scene.controls.addEventListener("change", cameraMoved);
    releases.push(() => scene.controls.removeEventListener("change", cameraMoved));
    return { scene, savedAppearance, preview, motion, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
