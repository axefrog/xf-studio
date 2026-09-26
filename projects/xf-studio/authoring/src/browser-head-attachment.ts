/**
 * One loaded 3D head and everything connected to it, released together. The composition root
 * calls `attachBrowserHead` once the prepared preview is ready: it loads the scene, then binds the
 * stage theme, attaches the scene-backed services to the application, subscribes autosave and
 * status, connects the layer canvases, mounts the surface editor and listens to the camera.
 * Each connection registers its release as it is made. A failure part-way through releases them
 * all, newest first, including the scene's renderer and canvas, so "Try again" starts from nothing
 * instead of doubling listeners (PREV-20). `dispose()` does the same for a head that loaded.
 */
import { createBrowserCharacterDetailDevice } from "./browser-character-detail-device";
import { createBrowserCreatorDevice } from "./browser-cc-catalogue-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import { CharacterDetailActions } from "./character-detail-actions";
import { CharacterContextActions, type CreatorPort } from "./character-context-actions";
import { followCharacter } from "./character-follow";
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
export type HeadServices = { savedV?: SavedAppearanceActions; preview?: PreviewActions; motion?: MotionActions; characterDetails?: CharacterDetailActions;
  characterContext?: CharacterContextActions };

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
  /** The creator catalogue's host transport (default: the page's own host). */
  creator?: CreatorPort;
};

export type AttachedHead = {
  scene: Scene;
  savedAppearance: SavedAppearanceActions;
  preview: PreviewActions;
  motion: MotionActions;
  /** Resolved skin, face details, eyes, brows, lashes, hair and piercings of the shown V (default or loaded save). */
  characterDetails: CharacterDetailActions;
  /** Which V is shown and every creator choice set on it (CORE-58). */
  characterContext: CharacterContextActions;
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
  try {
    // A load that fails releases what it made itself (createScene does), so there is nothing to
    // unload until it returns. The scene (with its surface editor) is released last, after
    // everything that uses it, and only if it is still the loaded head (UI-36).
    const scene = await ports.viewport.loadHead(ports.preview.emptyCanvases());
    releases.push(() => ports.viewport.unloadHead(scene));
    releases.push(bindStageTheme(scene, ports.preferences, ports.colourScheme));
    let surface: ReturnType<ViewportDevice["mountSurface"]> | undefined;
    let savedAppearance: SavedAppearanceActions | undefined;
    // Skin, face details, eyes, brows, lashes, hair and piercings follow the character context: the restored or newly loaded save, else
    // the default V, with the creator choices set on it. A save switch replaces them completely (CharacterDetailActions supersedes the
    // previous V); a changed choice on the same V keeps it on screen. It starts following once the preview services have restored the
    // workspace.
    const characterDetails = new CharacterDetailActions(createBrowserCharacterDetailDevice(scene));
    releases.push(() => { characterDetails.dispose(); scene.setCharacterDetails(null); });
    const services = createTrustedPreviewServices(ports.workspace, createBrowserScenePreviewPorts(scene, {
      setSurfaceControls: enabled => surface?.setEnabled(enabled),
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
    ports.attach({ characterDetails });
    releases.push(() => ports.attach({ characterDetails: undefined }));
    releases.push(characterDetails.subscribe(ports.changed), characterDetails.subscribe(ports.persist));
    // The character context: its V is the restored save (or the default V), with the workspace's stored choices on it. A save loaded
    // later becomes its V as one undoable step; its Undo shows an earlier V through the saved-V service.
    // Its Try again also retries a V whose preparation failed (PREV-86). An earlier build's tried piercing style (the retired preview
    // fields) becomes Piercings choices once the catalogue is ready (CORE-74).
    const saved = savedAppearance, retired = ports.workspace.preview;
    const characterContext = new CharacterContextActions({ creator: ports.creator ?? createBrowserCreatorDevice(),
      showSave: save => { if (save) saved.dispatch({ kind: "savedV.restore", value: save }); else if (saved.hasSavedV()) saved.dispatch({ kind: "savedV.clear" }); },
      details: { failed: () => characterDetails.failed(), retry: () => void characterDetails.retry() } },
    { stored: retired.character, save: savedAppearance.snapshot().savedV,
      legacy: retired.piercingStyle && retired.piercingDefinition ? { style: retired.piercingStyle, definition: retired.piercingDefinition } : undefined });
    releases.push(() => characterContext.dispose());
    ports.attach({ characterContext });
    releases.push(() => ports.attach({ characterContext: undefined }));
    releases.push(savedAppearance.subscribe(() => characterContext.followSave(saved.snapshot().savedV)));
    // The shown details and the head's facial shape follow the context's V and choices (character-follow.ts).
    releases.push(followCharacter({ context: characterContext, details: characterDetails, savedV: savedAppearance,
      setFaceMorphs: morphs => scene.setFaceMorphs(morphs) }));
    releases.push(characterContext.subscribe(ports.changed), characterContext.subscribe(ports.persist));
    characterContext.start();
    const cameraMoved = () => ports.persist();
    scene.controls.addEventListener("change", cameraMoved);
    releases.push(() => scene.controls.removeEventListener("change", cameraMoved));
    return { scene, savedAppearance, preview, motion, characterDetails, characterContext, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
