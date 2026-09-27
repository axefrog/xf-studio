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
import { createBrowserChoicePreviewDevice } from "./browser-choice-preview-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import { CharacterDetailActions } from "./character-detail-actions";
import { CharacterContextActions, initialBodyGender, type ContextHistory, type CreatorPort } from "./character-context-actions";
import type { CoreBody } from "./render-detail";
import { followCharacter } from "./character-follow";
import type { createBrowserPreviewDevice } from "./browser-preview-device";
import type { createBrowserViewportDevice } from "./browser-viewport-device";
import type { MotionActions } from "./motion-actions";
import type { PreviewActions } from "./preview-actions";
import type { SavedAppearanceActions } from "./saved-appearance-actions";
import { bindStageTheme, type SystemColourScheme } from "./stage-theme-binding";
import { createTrustedPreviewServices } from "./trusted-preview-services";
import type { WorkspaceState } from "./workspace-state";
import type { ViewGraph } from "./platform/core/view-graph";
import type { LayeredMakeupSurface } from "./engines/layered-makeup/render/makeup-stack";
import { surfaceOutline, type SurfaceOutline } from "./engines/layered-makeup/surface-edge";

type ViewportDevice = ReturnType<typeof createBrowserViewportDevice>;
type PreviewDevice = ReturnType<typeof createBrowserPreviewDevice>;
type Scene = Awaited<ReturnType<ViewportDevice["loadHead"]>>;

/** The head-bound services the application holds; `undefined` disconnects one. */
export type HeadServices = { savedV?: SavedAppearanceActions; preview?: PreviewActions; motion?: MotionActions; characterDetails?: CharacterDetailActions;
  characterContext?: CharacterContextActions;
  /** The edited layered surface's outer boundary in UV, where its makeup is cut off (surface-edge.ts, PREV-146). */
  surfaceOutline?: SurfaceOutline };

/**
 * One layered-makeup surface on the loaded head and the devices that drive it (UI-76): the preview device that fills its layers, and
 * the on-head editor's hooks when this is the surface being edited. The composition root builds one per composed layered surface it
 * has a layer source for (the live feature's), from the composition's renderer list, so this module names no feature.
 */
export type LayeredSurfaceWiring = {
  /** The feature whose renderer draws the surface (for messages). */
  feature: string;
  /** The surface on a loaded head (the feature renderer's). */
  surface(scene: Scene): LayeredMakeupSurface | undefined;
  preview: Pick<PreviewDevice, "connectScene" | "disconnectScene" | "presentInitialLayers">;
  /** The on-head editor's hooks into the authoring core, for the one surface being edited. */
  editor?: Parameters<ViewportDevice["mountSurface"]>[1];
};

export type HeadAttachmentPorts = {
  workspace: WorkspaceState;
  /** The workspace's view graph (it outlives any one head): the head restores its main view and follows it. */
  graph?: ViewGraph;
  viewport: Pick<ViewportDevice, "loadHead" | "unloadHead" | "mountSurface">;
  /** Every layered-makeup surface to connect, in composition order; at most one carries the on-head editor. */
  layered: readonly LayeredSurfaceWiring[];
  /** The UI theme preference and the OS colour scheme the stage backdrop follows. */
  preferences: Parameters<typeof bindStageTheme>[1];
  colourScheme: SystemColourScheme;
  /** The preview quality (generated-texture size) the creator rig's shadow maps follow; 1K when absent. */
  quality?: { snapshot(): { size: number }; subscribe(listener: () => void): () => void };
  /** Connects head services to the application (and disconnects them with `undefined`). */
  attach(services: HeadServices): void;
  /** Requests an autosave. */
  persist(): void;
  /** Tells the presentation that device status changed. */
  changed(): void;
  /** The creator catalogue's host transport (default: the page's own host). */
  creator?: CreatorPort;
  /**
   * Make sure a body's core head is prepared before it loads (the masculine V's is prepared on first use); rejects when it can't
   * be, and the feminine head is shown instead. Absent: the core is taken as prepared.
   */
  prepareCore?(body: CoreBody): Promise<void>;
  /**
   * The shown V now has the other body: load the head again (with the workspace as it is now), which re-attaches everything; the
   * character panel's Undo history goes with it (`history` on the next attachment).
   */
  reload?(history: ContextHistory): void;
  /** The character panel's Undo history from the head this one replaces (a V that changed body). */
  history?: ContextHistory;
  /** A plain notice for the person (the masculine head couldn't be prepared, so the feminine one shows). */
  notice?(text: string): void;
};

export type AttachedHead = {
  scene: Scene;
  savedAppearance: SavedAppearanceActions;
  preview: PreviewActions;
  motion: MotionActions;
  /** Resolved skin, face details, eyes, brows, lashes, hair, piercings and body of the shown V (default or loaded save). */
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
    // The head is the shown V's body's own core (the masculine V's head is prepared on first use). The body comes from the stored
    // context and the restored save, as the character context below decides it. If the masculine head can't be prepared, the feminine
    // head shows (with a notice) so the Character panel stays usable, and the other body is tried again when the V changes body.
    const wanted = initialBodyGender(ports.workspace.preview.character, ports.workspace.savedV);
    let body: CoreBody = wanted, unavailable: string | null = null;
    if (wanted !== "female" && ports.prepareCore) {
      try { await ports.prepareCore(wanted); }
      catch (error) { body = "female"; unavailable = (error as Error)?.message || ""; }
    }
    const scene = await ports.viewport.loadHead(body);
    releases.push(() => ports.viewport.unloadHead(scene));
    releases.push(bindStageTheme(scene, ports.preferences, ports.colourScheme));
    if (ports.quality) {
      const quality = ports.quality, follow = () => { scene.lighting.setShadowQuality(quality.snapshot().size); scene.requestRender(); };
      follow();
      releases.push(quality.subscribe(follow));
    }
    let surface: ReturnType<ViewportDevice["mountSurface"]> | undefined;
    let savedAppearance: SavedAppearanceActions | undefined;
    // Skin, face details, eyes, brows, lashes, hair, piercings and body follow the character context: the restored or newly loaded save, else
    // the default V, with the creator choices set on it. A save switch replaces them completely (CharacterDetailActions supersedes the
    // previous V); a changed choice on the same V keeps it on screen. It starts following once the preview services have restored the
    // workspace.
    const characterDetails = new CharacterDetailActions(createBrowserCharacterDetailDevice(scene));
    releases.push(() => { characterDetails.dispose(); scene.setCharacterDetails(null); });
    const services = createTrustedPreviewServices(ports.workspace, createBrowserScenePreviewPorts(scene, {
      setSurfaceControls: enabled => surface?.setEnabled(enabled),
    }), ports.graph);
    savedAppearance = services.savedAppearance;
    ports.attach({ savedV: savedAppearance });
    releases.push(() => ports.attach({ savedV: undefined }));
    releases.push(savedAppearance.subscribe(ports.persist), savedAppearance.subscribe(ports.changed));
    if (ports.layered.filter(wiring => wiring.editor).length > 1) throw Error("Only one layered surface can carry the on-head editor.");
    for (const wiring of ports.layered) {
      const makeup = wiring.surface(scene);
      if (!makeup) throw Error(`The ${wiring.feature} renderer is not composed.`);
      wiring.preview.connectScene(makeup);
      releases.push(() => wiring.preview.disconnectScene(makeup));
      if (wiring.editor) {
        surface = ports.viewport.mountSurface(makeup.surface, wiring.editor);
        // The anchor's rest positions and UVs, read per element (glTF attributes may be interleaved).
        const geometry = makeup.surface.geometry, uv = geometry?.getAttribute("uv"), position = geometry?.getAttribute("position");
        if (uv && position) {
          const uvs = new Float64Array(uv.count * 2), positions = new Float64Array(position.count * 3);
          for (let i = 0; i < uv.count; i++) { uvs[2 * i] = uv.getX(i); uvs[2 * i + 1] = uv.getY(i); }
          for (let i = 0; i < position.count; i++) { positions[3 * i] = position.getX(i); positions[3 * i + 1] = position.getY(i); positions[3 * i + 2] = position.getZ(i); }
          ports.attach({ surfaceOutline: surfaceOutline({ positions, uvs, index: geometry!.index?.array ?? null }) });
          releases.push(() => ports.attach({ surfaceOutline: undefined }));
        }
      }
    }
    const { preview, motion } = services.finish();
    releases.push(() => preview.dispose());
    ports.attach({ preview, motion });
    releases.push(() => ports.attach({ preview: undefined, motion: undefined }));
    releases.push(preview.subscribe(ports.persist), motion.subscribe(ports.persist), preview.subscribe(ports.changed));
    for (const wiring of ports.layered) wiring.preview.presentInitialLayers();
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
      details: { failed: () => characterDetails.failed(), retry: () => void characterDetails.retry() },
      previews: ports.creator ? undefined : createBrowserChoicePreviewDevice() },
    { stored: retired.character, save: savedAppearance.snapshot().savedV,
      legacy: retired.piercingStyle && retired.piercingDefinition ? { style: retired.piercingStyle, definition: retired.piercingDefinition } : undefined,
      history: ports.history });
    releases.push(() => characterContext.dispose());
    ports.attach({ characterContext });
    releases.push(() => ports.attach({ characterContext: undefined }));
    // The Body switch decides whether the body is prepared at all (PREV-108), and the uncensored setting how the game would draw it: the
    // context's request follows both.
    const followBody = () => {
      const shown = preview.snapshot();
      characterContext.setBodyShown(shown.body !== false);
      characterContext.setUncensored(shown.uncensored === true);
    };
    followBody();
    releases.push(preview.subscribe(followBody));
    // The creator's idles are authored for the creator puppet's lifted feet; while one plays, the request draws V's bare feet that way
    // (knowledge/body-animation.md §4). The inventory's idle, Still and a photo-mode pose (the photo-mode puppet is V's own body) stand on
    // the feet her footwear gives her.
    const followPuppet = () => {
      const shown = motion.snapshot();
      characterContext.setCreatorPuppet(shown.idle && !shown.pose && shown.idles.find(entry => entry.id === shown.idleClip)?.puppet === "creator");
    };
    followPuppet();
    releases.push(motion.subscribe(followPuppet));
    releases.push(savedAppearance.subscribe(() => characterContext.followSave(saved.snapshot().savedV)));
    // The V's own makeup shows or hides at once: the prepared parts of the makeup rows are hidden in the view, nothing is prepared again.
    let hiddenOptions: readonly string[] | null = null;
    const followMakeup = () => {
      const next = characterContext.hiddenOptions();
      if (next !== hiddenOptions) { hiddenOptions = next; scene.setHiddenOptions(next); }
    };
    followMakeup();
    releases.push(characterContext.subscribe(followMakeup));
    // The shown details and the head's facial shape follow the context's V and choices (character-follow.ts), on a head of its body.
    releases.push(followCharacter({ context: characterContext, details: characterDetails, savedV: savedAppearance,
      setFaceMorphs: morphs => scene.setFaceMorphs(morphs), headBody: scene.body }));
    // A V of the other body (a masculine save loaded, the other Default V, a preset) needs that body's head: the head loads again.
    // The reload runs after the change that asked for it has finished (it releases this context), and never for a released head.
    let shownBody = wanted, released = false;
    releases.push(() => { released = true; });
    releases.push(characterContext.subscribe(() => {
      const next = characterContext.shownBody();
      if (next === shownBody) return;
      shownBody = next;
      if (next !== scene.body) setTimeout(() => { if (!released) ports.reload?.(characterContext.history()); }, 0);
    }));
    if (unavailable !== null) ports.notice?.(`The masculine V's head couldn't be prepared from your Cyberpunk 2077 files, so the feminine head is shown. ${unavailable}`.trim());
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
