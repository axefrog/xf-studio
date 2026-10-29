/**
 * One scene runtime's head and everything connected to it (profiles phase 4a-iv, experiment 043 §10), in three steps:
 *
 * - **Built hidden** (`buildBrowserHead`, with an `AbortSignal`): the body's core prepared, the scene built on the pane's renderer device,
 *   and the head's own services made over it: the stage theme, the V's detail service, the saved-V and preview services, the motion
 *   service. The scene shown meanwhile stays drawn; nothing reaches the application yet.
 * - **Prepared** (`prepare`, profiles phase 4a-v): still hidden, the V's details placed, the layered surfaces filled with the authored
 *   makeup as it is now, and the scene prepared with them, so its first shown frame has nothing left to compile, composite or upload.
 * - **Shown** (`show`): the head is drawn and becomes the one the application and the V's context use. Its services are attached, the
 *   layered surfaces connected (keeping what they were filled with, brought up to date), it follows the V's context (catching up with what
 *   changed while it was hidden), and it restores the scene's motion and the view's camera. The on-head editor is the view's, mounted on the
 *   head shown for it by the scene editors (scene-editors.ts).
 * - **Hidden** (`hide`): its camera pose goes to the view's camera node and its motion is released, then everything `show` connected is let
 *   go, newest first. A hidden head is warm: it stops following its V and catches up when shown again.
 * - **Holding its makeup** (`holdSurfaces`, experiment 044 decision D3): a shown head about to hand over to a view of another look lets its
 *   layered surfaces go first, while it stays drawn. Each keeps exactly the layers it shows (the preview device's hold), so no frame of it
 *   ever holds the other look's layers. `connectSurfaces` connects them again (the person went back before the takeover).
 *
 * `dispose` releases everything, hidden first when shown. Every connection registers its release as it is made, so a failure part-way
 * through releases what was made, newest first (PREV-20). The V's context is not this head's: it outlives every head (its owner hands it
 * over, browser-scene-heads.ts).
 */
import { createBrowserCharacterDetailDevice } from "../../character/browser/browser-character-detail-device";
import { CharacterDetailActions } from "../../character/character-detail-actions";
import type { CharacterWarmStart } from "../../character/browser/character-warm-start";
import type { CharacterContextActions } from "../../character/character-context-actions";
import type { CharacterRequest } from "../../character/character-detail-request";
import type { CoreBody } from "../../character/render-detail";
import type { SavedV } from "../../saves/save-reader";
import { followCharacter } from "../../character/character-follow";
import type { createBrowserViewportDevice } from "./browser-viewport-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import type { MotionActions } from "../../animation/motion-actions";
import type { PreviewActions } from "../preview-actions";
import type { SavedAppearanceActions } from "../../character/saved-appearance-actions";
import { bindStageTheme, type SystemColourScheme } from "./stage-theme-binding";
import { createTrustedPreviewServices } from "../../app/trusted-preview-services";
import type { WorkspaceState } from "../../app/workspace/workspace-state";
import type { ViewGraph } from "../../platform/core/view-graph";
import type { PreparationProgress } from "../scene-residency";
import type { ViewId } from "../../platform/api/view-graph";
import { previewFields } from "../preview-view-graph";
import { lightingSource, type LightingSource } from "../lighting-setups";

type ViewportDevice = ReturnType<typeof createBrowserViewportDevice>;
/** Preparation handoff belongs to the viewport port; the attachment does not depend on the scene implementation. */
type SceneDetailPreparation = Parameters<NonNullable<Parameters<ViewportDevice["buildHead"]>[2]>>[0];
type Scene = Awaited<ReturnType<ViewportDevice["buildHead"]>>;

/** The real detail service can request/read its V before setup permits construction of the head. It gains no display capability early. */
export function startHeadDetails(request: CharacterRequest | undefined, warmStart?: Pick<CharacterWarmStart, "remember" | "files">) {
  const scene = Promise.withResolvers<Scene>(), preparation = Promise.withResolvers<SceneDetailPreparation>();
  void scene.promise.catch(() => {}); void preparation.promise.catch(() => {});
  const actions = new CharacterDetailActions(createBrowserCharacterDetailDevice(scene.promise, undefined, warmStart, preparation.promise));
  const initial = request ? { key: JSON.stringify(request), promise: actions.setCharacter(request) } : undefined;
  let disposed = false;
  return {
    actions, initial, ready: preparation.resolve,
    connect(built: Promise<Scene>) { void built.then(scene.resolve, scene.reject); void built.then(preparation.resolve, preparation.reject); },
    dispose() {
      if (disposed) return;
      disposed = true; actions.dispose();
      const reason = new DOMException("The head request ended.", "AbortError"); scene.reject(reason); preparation.reject(reason);
    },
  };
}

/** The head-bound services the application holds; `undefined` disconnects one. */
export type HeadServices = { savedV?: SavedAppearanceActions; preview?: PreviewActions; motion?: MotionActions; characterDetails?: CharacterDetailActions;
  characterContext?: CharacterContextActions;
  /** The edited layered surface's outer boundary in UV, where its makeup is cut off (surface-edge.ts, PREV-146). */
  surfaceOutline?: ReturnType<ViewportDevice["surfaceOutline"]> };

/** Registered preview lifecycle. A head with no contributions prepares and draws without feature surfaces. */
export type HeadPreviewWiring = {
  readonly feature: string;
  edited?: boolean;
  bind(scene: Scene, viewport: HeadAttachmentPorts["viewport"]): {
    connect(): void; disconnect(): void; present(): void; fill(): void; current(): boolean; release(): void;
    preparation(): Pick<NonNullable<Parameters<NonNullable<Scene["prepare"]>>[0]>, "overlays" | "work">;
  };
};

export type HeadAttachmentPorts = {
  workspace: Pick<WorkspaceState, "preview" | "savedV" | "views" | "uiPreferences" | "migration" | "profiles">;
  /** The workspace's view graph (it outlives any one head): the head restores the view it is made for and follows the view it draws. */
  graph?: ViewGraph;
  /** The destination view, resolved after construction and preparation waits so a surviving view of its scene can take over. */
  view?: ViewId | (() => ViewId);
  viewport: Pick<ViewportDevice, "buildHead" | "showHead" | "hideHead" | "disposeHead"> & Partial<Pick<ViewportDevice, "surfaceGuides" | "surfaceSteps">>;
  /** Every layered-makeup surface to connect, in composition order; at most one is the on-head editor's. */
  layered: readonly HeadPreviewWiring[];
  /**
   * The UI theme preference and the OS colour scheme the stage backdrop follows; the research tools preference the feature renderers
   * follow (they make ahead only what can be chosen, PREV-194).
   */
  preferences: { snapshot(): ReturnType<Parameters<typeof bindStageTheme>[1]["snapshot"]> & { readonly researchTools?: boolean };
    subscribe(listener: () => void): () => void };
  colourScheme: SystemColourScheme;
  /** The preview quality (generated-texture size) the creator rig's shadow maps follow; 1K when absent. */
  quality?: { snapshot(): { size: number }; subscribe(listener: () => void): () => void };
  /** Connects head services to the application (and disconnects them with `undefined`). */
  attach(services: HeadServices): void;
  /** Requests an autosave. */
  persist(): void;
  /** Tells the presentation that device status changed. */
  changed(): void;
  /**
   * The V this head shows (profiles design §7): the body it is built for, the decoded save it comes from now, and its context, which
   * outlives this head (the character's owner made it; browser-scene-heads.ts binds its scene ports to the head shown).
   */
  character: { body: CoreBody; save?: SavedV; context: CharacterContextActions };
  /**
   * Make sure a body's core head is prepared before it is built (the masculine V's is prepared on first use); rejects when it can't be,
   * and the feminine head is built instead, or with `signal.reason` once aborted (decision D1). Absent: the core is taken as prepared.
   */
  prepareCore?(body: CoreBody, signal: AbortSignal): Promise<void>;
  /** A plain notice for the person (the masculine head couldn't be prepared, so the feminine one shows). */
  notice?(text: string): void;
  /** The page's warm start (character-warm-start.ts): the V's files read while the head loaded, and the request remembered for next time. */
  warmStart?: Pick<CharacterWarmStart, "remember" | "files">;
  /** Startup's already-requested V, adopted only when the authoritative context still matches. */
  initialDetails?: ReturnType<typeof startHeadDetails>;
};

export type AttachedHead = {
  scene: Scene;
  /** The body this head was built for (its scene's `body` is the feminine one when the masculine core couldn't be prepared). */
  body: CoreBody;
  savedAppearance: SavedAppearanceActions;
  preview: PreviewActions;
  motion: MotionActions;
  /** Resolved skin, face details, eyes, brows, lashes, hair, piercings and body of the shown V (default or loaded save). */
  characterDetails: CharacterDetailActions;
  /** Which V is shown and every creator choice set on it (CORE-58); the V's, not this head's. */
  characterContext: CharacterContextActions;
  /** Whether the head is the one shown now. */
  readonly shown: boolean;
  /**
   * Make the head ready to be shown while it is hidden (profiles phase 4a-v): the V's details loaded and made ready for their first frame,
   * the layered surfaces filled with the authored makeup as it is now (each wiring's `fillScene`), then the whole scene prepared (programs
   * compiled ahead, maps uploaded, one hidden warm-up draw; scene-host.ts `prepare`), reporting its stages. Rejects with
   * `signal.reason` once aborted. A detail failure doesn't stop it: the head shows without them, as it would anyway.
   */
  prepare(signal: AbortSignal, progress: PreparationProgress): Promise<void>;
  /**
   * Whether a warm head is still prepared, so shown again it needs nothing more: nothing that decides its programs changed since (the scene's
   * own record), and each layered surface still holds the authored makeup as it is now (a layer enabled or edited while the head was warm
   * would bring new materials and uploads at show: it is filled and prepared again first).
   */
  prepared(): boolean;
  /**
   * Prepare the shown head for a change it was asked to draw and isn't prepared for (a lighting setup whose programs aren't linked: the
   * scene stages it and keeps drawing the setup before: scene-host.ts), reporting its stages; the change is drawn once ready.
   * Rejects with `signal.reason` once aborted.
   */
  prepareShown(signal: AbortSignal, progress: PreparationProgress): Promise<void>;
  /** Hear the shown head needing `prepareShown` (or no longer needing it). Returns the unsubscribe. */
  onUnprepared(listener: () => void): () => void;
  /** Whether the view this head draws has its Surface controls tool on (withdrawn tools off), and hearing it change: the on-head editor follows. */
  surfaceControls(): boolean;
  onSurfaceControls(listener: () => void): () => void;
  /**
   * Draw this head for `view` (default: the view it drew last, or was made for) and connect it (see the module header). Throws, having let
   * go of what it connected, when a step fails.
   */
  show(view?: ViewId): void;
  /** The shown head draws another view of its scene: its camera to the old view's node, the new view's settings, motion and camera. */
  draw(view: ViewId): void;
  /** Hand over to the head shown next: its camera to the node, its motion released, its connections let go. Safe to call when hidden. */
  hide(): void;
  /**
   * The shown head keeps drawing the layers its layered surfaces hold now, and stops following the layers' owner (the editor document is
   * about to show another look: decision D3). Does nothing when hidden or already holding.
   */
  holdSurfaces(): void;
  /** The shown head's layered surfaces follow the layers' owner again (brought up to date); does nothing when hidden or connected. */
  connectSurfaces(): void;
  /** Show a save's V on this head (the V's context asks while this head is shown): null for the default V. */
  showSave(save: SavedV | null): void;
  /** Releases everything, hidden first when shown. Safe to call more than once. */
  dispose(): void;
};

/** Run releases newest first; one failing never stops the rest. */
const releaseAll = (releases: (() => void)[]) => {
  for (const release of releases.splice(0).reverse()) {
    try { release(); } catch (error) { console.error(error); }
  }
};

/** Build a head, hidden (see the module header); a build aborted or failing part-way releases what it made. */
export async function buildBrowserHead(ports: HeadAttachmentPorts, signal: AbortSignal = new AbortController().signal): Promise<AttachedHead> {
  const releases: (() => void)[] = [];
  try {
    if (ports.initialDetails) releases.push(() => ports.initialDetails!.dispose());
    signal.throwIfAborted();
    if (ports.layered.filter(wiring => wiring.edited).length > 1) throw Error("Only one layered surface can carry the on-head editor.");
    // The head is the V's body's own core (the masculine V's head is prepared on first use). If the masculine head can't be prepared, the
    // feminine head is built (with a notice) so the Character panel stays usable; the other body is tried again when the V changes body.
    const wanted = ports.character.body;
    let body: CoreBody = wanted, unavailable: string | null = null;
    if (wanted !== "female" && ports.prepareCore) {
      try { await ports.prepareCore(wanted, signal); }
      catch (error) { if (signal.aborted) throw signal.reason; body = "female"; unavailable = (error as Error)?.message || ""; }
    }
    // Ask for this V while the core head (including its idle and blink) is being built. One detail service owns both this request
    // and its eventual placement; its device can read the record now and waits for the scene only to load/prepare the parts.
    const context = ports.character.context;
    const destination = typeof ports.view === "function" ? ports.view() : ports.view;
    const fields = ports.graph ? previewFields(ports.graph, destination ?? ports.graph.viewIds()[0]!) : undefined;
    context.setBodyShown((fields?.display ?? ports.workspace.preview).body !== false);
    context.setUncensored((fields?.scene ?? ports.workspace.preview).uncensored === true);
    // A build that fails releases what it made itself (createSceneRuntime does).
    const request = context.detailRequest();
    const initialRequest = request.bodyGender === body ? request : undefined;
    const matches = !!ports.initialDetails && ports.initialDetails.initial?.key === JSON.stringify(initialRequest);
    if (!matches) ports.initialDetails?.dispose();
    const details = matches ? ports.initialDetails! : startHeadDetails(initialRequest, ports.warmStart);
    releases.push(() => details.dispose());
    const sceneReady = ports.viewport.buildHead(body, signal, details.ready);
    details.connect(sceneReady);
    const characterDetails = details.actions;
    const stopDetails = () => characterDetails.dispose();
    signal.addEventListener("abort", stopDetails, { once: true });
    releases.push(() => { signal.removeEventListener("abort", stopDetails); stopDetails(); });
    let initialDetails = details.initial;
    const scene = await sceneReady;
    releases.push(() => ports.viewport.disposeHead(scene));
    signal.throwIfAborted();
    releases.push(bindStageTheme(scene, ports.preferences, ports.colourScheme));
    {
      const preferences = ports.preferences, follow = () => scene.setResearchTools?.(preferences.snapshot().researchTools === true);
      follow();
      releases.push(preferences.subscribe(follow));
    }
    if (ports.quality) {
      const quality = ports.quality, follow = () => { scene.lighting.setShadowQuality(quality.snapshot().size); scene.requestRender(); };
      follow();
      releases.push(quality.subscribe(follow));
    }
    const previews = ports.layered.map(wiring => {
      const preview = wiring.bind(scene, ports.viewport);
      releases.push(() => preview.release());
      return preview;
    });
    // Skin, face details, eyes, brows, lashes, hair, piercings and body follow the V's context while this head is shown (`show`).
    releases.push(() => { characterDetails.dispose(); scene.setCharacterDetails(null); });
    // The head takes the V's save (its facial shapes and body) before anything else follows it.
    // The view's Surface controls tool, which the on-head editor mounted on this head follows (scene-editors.ts).
    let surfaceEnabled = true;
    const surfaceListeners = new Set<() => void>();
    const view = typeof ports.view === "function" ? ports.view() : ports.view;
    const services = createTrustedPreviewServices({ ...ports.workspace, savedV: ports.character.save }, createBrowserScenePreviewPorts(scene, {
      setSurfaceControls: enabled => { surfaceEnabled = enabled; for (const listener of [...surfaceListeners]) listener(); },
    }), ports.graph ? { graph: ports.graph, view: view ?? ports.graph.viewIds()[0]! } : undefined);
    const savedAppearance = services.savedAppearance;
    const restored = services.finish();
    const { preview, motion } = restored;
    releases.push(() => preview.dispose());
    if (unavailable !== null) ports.notice?.(`The masculine V's head couldn't be prepared from your Cyberpunk 2077 files, so the feminine head is shown. ${unavailable}`.trim());
    signal.throwIfAborted();

    /** Preparation follows the runtime owner's current destination, without showing it or restoring a camera or motion. */
    const bindPreparationView = (signal: AbortSignal) => {
      signal.throwIfAborted();
      const view = typeof ports.view === "function" ? ports.view() : ports.view;
      signal.throwIfAborted();
      if (view !== undefined) { preview.draw(view); preview.draw(null); }
      const state = preview.snapshot();
      context.setBodyShown(state.body !== false);
      context.setUncensored(state.uncensored === true);
    };
    /** What `show` connected, released by `hide`. */
    const shownReleases: (() => void)[] = [];
    let shown = false, disposed = false, connected = false;
    /** The layered surfaces follow their owner (the editor document's layers), each brought up to date from what it holds. */
    const connectSurfaces = () => {
      if (connected) return;
      connected = true;
      for (const preview of previews) preview.connect();
    };
    /** Each layered surface keeps what it holds now (the preview device's hold) and stops following. */
    const holdSurfaces = () => {
      if (!connected) return;
      connected = false;
      for (const preview of previews) preview.disconnect();
    };
    /** The save this head's saved-V service shows (the one it was built with, then each one shown on it). */
    let savedShown: SavedV | null = ports.character.save ?? null;
    const showSave = (save: SavedV | null) => {
      savedShown = save;
      if (save) savedAppearance.dispatch({ kind: "savedV.restore", value: save });
      else if (savedAppearance.hasSavedV()) savedAppearance.dispatch({ kind: "savedV.clear" });
    };
    const hide = () => {
      if (!shown) return;
      shown = false;
      // The camera pose to the camera node, then the motion handed over (its idle's phase stored), before anything is let go.
      try { restored.hide(); } catch (error) { console.error(error); }
      releaseAll(shownReleases);
    };
    const head: AttachedHead = {
      scene, body: wanted, savedAppearance, preview, motion, characterDetails, characterContext: context,
      get shown() { return shown; },
      showSave,
      async prepare(prepareSignal, progress) {
        if (disposed) throw Error("The head was released.");
        for (;;) {
          bindPreparationView(prepareSignal);
          // The V's own details on a head of its body (the feminine head standing in for an unavailable masculine one shows none), with its
          // own makeup hidden as the view hides it, as show would place them.
          // The destination's Body switch and uncensored setting decide what the V's request draws, as `show` follows them.
          const request = context.detailRequest();
          if (request.bodyGender === scene.body) {
            scene.setHiddenOptions(context.hiddenOptions());
            progress({ stage: "details", fraction: 0, waiting: "host" });
            const started = initialDetails?.key === JSON.stringify(request) ? initialDetails.promise : undefined;
            initialDetails = undefined;
            await detailsSettled(characterDetails, request, prepareSignal, (fraction, waiting) => progress({ stage: "details", fraction, waiting }), started);
            bindPreparationView(prepareSignal);
            // Another destination can hide the body or change its cover while the details load. Settle that request before warming it.
            if (JSON.stringify(request) !== JSON.stringify(context.detailRequest())) continue;
          }
          progress({ stage: "details", fraction: 1 });
          // The authored makeup as it is now, so the plate's composite, its masks and maps and their programs are prepared with the scene.
          // The surface holds this snapshot until show connects it, which brings only what changed since.
          prepareSignal.throwIfAborted();
          for (const preview of previews) preview.fill();
          // Every lighting setup another view of this scene shows (the view it draws is the scene's own now).
          const setups: LightingSource[] = [];
          if (ports.graph) {
            const graph = ports.graph, drawn = preview.view(), own = graph.node(drawn, "scene").id;
            for (const view of graph.viewIds()) if (view !== drawn && graph.node(view, "scene").id === own) {
              const lights = previewFields(graph, view).lights;
              setups.push(lightingSource({ setup: lights.setup, setups: lights.setups }, lights.creatorLighting));
            }
          }
          // The on-head editor, which show mounts: its guides compiled with the scene (their first frame links nothing), and its parts (the
          // surface map and occlusion trees) made ahead between frames, so mounting it makes none of them.
          const preparation = previews.map(preview => preview.preparation());
          const overlays = preparation.flatMap(item => item.overlays ? [item.overlays] : []);
          const work = preparation.flatMap(item => item.work ? [item.work] : []);
          await scene.prepare?.({ signal: prepareSignal, setups, report: report => progress(report),
            ...(overlays.length ? { overlays: () => overlays.flatMap(read => [...read()]) } : {}),
            ...(work.length ? { work: () => work.flatMap(read => [...read()]) } : {}) });
          bindPreparationView(prepareSignal);
          if (JSON.stringify(request) === JSON.stringify(context.detailRequest())) return;
        }
      },
      prepared: () => (scene.prepared?.() ?? true) && previews.every(preview => preview.current()),
      async prepareShown(prepareSignal, progress) {
        if (disposed) throw Error("The head was released.");
        await scene.prepare?.({ signal: prepareSignal, report: report => progress(report) });
      },
      onUnprepared: listener => scene.onUnprepared?.(listener) ?? (() => {}),
      surfaceControls: () => surfaceEnabled,
      onSurfaceControls: listener => { surfaceListeners.add(listener); return () => { surfaceListeners.delete(listener); }; },
      draw(view) {
        if (!shown || disposed || view === preview.view()) return;
        // The camera to the old view's node and the motion handed over, then the new view's settings, motion and camera.
        restored.hide();
        restored.show(view);
      },
      show(view) {
        if (shown || disposed) return;
        shown = true;
        const add = (release: () => void) => { shownReleases.push(release); };
        try {
          ports.viewport.showHead(scene);
          add(() => ports.viewport.hideHead(scene));
          // Catch up with the V as it is now: a save shown or cleared while this head was hidden (or since it was built).
          const save = context.shownSave();
          if (save !== savedShown && wanted === context.shownBody()) showSave(save);
          ports.attach({ savedV: savedAppearance, preview, motion, characterDetails });
          add(() => ports.attach({ savedV: undefined, preview: undefined, motion: undefined, characterDetails: undefined }));
          add(savedAppearance.subscribe(ports.persist)); add(savedAppearance.subscribe(ports.changed));
          add(holdSurfaces);
          connectSurfaces();
          add(preview.subscribe(ports.persist)); add(motion.subscribe(ports.persist)); add(preview.subscribe(ports.changed));
          for (const preview of previews) preview.present();
          add(characterDetails.subscribe(ports.changed)); add(characterDetails.subscribe(ports.persist));
          // The scene's motion, then the view's camera (where the head shown before left it).
          restored.show(view);
          // The Body switch decides whether the body is prepared at all (PREV-108), and the uncensored setting how the game would draw it: the
          // context's request follows both.
          const followBody = () => {
            const state = preview.snapshot();
            context.setBodyShown(state.body !== false);
            context.setUncensored(state.uncensored === true);
          };
          followBody();
          add(preview.subscribe(followBody));
          // The creator's idles are authored for the creator puppet's lifted feet; while one plays, the request draws V's bare feet that way
          // (knowledge/body-animation.md §4). The inventory's idle, Still and a photo-mode pose (the photo-mode puppet is V's own body) stand
          // on the feet her footwear gives her.
          const followPuppet = () => {
            const state = motion.snapshot();
            context.setCreatorPuppet(state.idle && !state.pose && state.idles.find(entry => entry.id === state.idleClip)?.puppet === "creator");
          };
          followPuppet();
          add(motion.subscribe(followPuppet));
          add(savedAppearance.subscribe(() => context.followSave(savedAppearance.snapshot().savedV)));
          // The V's own makeup shows or hides at once: the prepared parts of the makeup rows are hidden in the view, nothing is prepared again.
          let hiddenOptions: readonly string[] | null = null;
          const followMakeup = () => {
            const next = context.hiddenOptions();
            if (next !== hiddenOptions) { hiddenOptions = next; scene.setHiddenOptions(next); }
          };
          followMakeup();
          add(context.subscribe(followMakeup));
          // The shown details and the head's facial shape follow the context's V and choices (character-follow.ts), on a head of its body.
          add(followCharacter({ context, details: characterDetails, savedV: savedAppearance, setFaceMorphs: morphs => scene.setFaceMorphs(morphs),
            headBody: scene.body }));
          const cameraMoved = () => ports.persist();
          scene.controls.addEventListener("change", cameraMoved);
          add(() => scene.controls.removeEventListener("change", cameraMoved));
        } catch (error) {
          shown = false;
          releaseAll(shownReleases);
          throw error;
        }
      },
      hide,
      holdSurfaces() { if (shown) holdSurfaces(); },
      connectSurfaces() {
        if (!shown || connected) return;
        connectSurfaces();
        for (const preview of previews) preview.present();
      },
      dispose() {
        if (disposed) return;
        hide();
        disposed = true;
        releaseAll(releases);
      },
    };
    return head;
  } catch (error) {
    releaseAll(releases);
    throw signal.aborted ? signal.reason : error;
  }
}

/**
 * Wait until the detail service has settled `request` (shown, failed or waiting for WolvenKit, with no change on it still updating), asking
 * for it first (asking again for the request asked last is a no-op). Reports the host's progress while it prepares. Rejects with
 * `signal.reason` once aborted.
 */
function detailsSettled(details: CharacterDetailActions, request: Parameters<CharacterDetailActions["setCharacter"]>[0], signal: AbortSignal,
  progress: (fraction: number, waiting: "host" | "files" | null) => void, started?: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const end = (error?: unknown) => {
      if (done) return;
      done = true;
      stop(); signal.removeEventListener("abort", aborted);
      if (error === undefined) resolve(); else reject(error);
    };
    const aborted = () => end(signal.reason);
    const check = (finished = false) => {
      const status = details.snapshot();
      if ((status.phase === "ready" && !status.updating) || status.phase === "failed") { end(); return; }
      // Its own work ended without a result to wait for (the service was released meanwhile).
      if (finished && status.phase !== "preparing" && !status.updating) { end(); return; }
      const step = status.phase === "preparing" ? status.progress : null;
      progress(step && step.total > 0 ? Math.min(0.9, step.index / step.total) : status.updating ? 0.5 : 0, step ? "host" : "files");
    };
    const stop = details.subscribe(() => check());
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    void (started ?? details.setCharacter(request)).then(() => check(true), () => check(true));
    check();
  });
}
