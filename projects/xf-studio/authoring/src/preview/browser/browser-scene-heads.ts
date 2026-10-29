/**
 * The window's scene runtime owner (profiles phase 4a-iv, experiment 043 §10): which head the drawn view shows, the heads kept resident,
 * and the V's context, which outlives them.
 *
 * - **A superseding subject change.** The drawn scene wants a head for (its V, the V's body). A change of the scene's V, or of the V's body
 *   (a save, a preset, the other Default V, Undo), is a new want: the newest wins (scene-residency.ts), a build or preparation still running
 *   for an older one stops (and the page stops waiting for a masculine core, whose host job finishes and is cached: decision D1), and the
 *   head shown before stays drawn until the new one is prepared. Nothing is refused meanwhile: the V's context stays attached, and its
 *   changes land as they are made.
 * - **Prepared before shown** (phase 4a-v). A new head is built, then prepared hidden (its V's details made ready, its programs compiled
 *   ahead, its maps uploaded, one hidden warm-up draw: browser-head-attachment.ts `prepare`), and only then shown, so its first frame
 *   waits on nothing. Its typed progress goes to the presentation (`preparation`): the head pane's loading state while nothing is shown,
 *   its quiet status line while another V is.
 * - **A change of the shown head prepared ahead too** (phase 4a-v-b). A lighting setup asked of the shown head whose programs aren't linked
 *   is staged by its scene, which keeps drawing the setup before and says so (`onUnprepared`); the shown head is then prepared again
 *   (scene-residency.ts `refresh`), with progress in the quiet status line, and draws the new setup once ready. A newer change restarts it,
 *   and a subject change supersedes it.
 * - **A view to show** (`show(view)`): the drawn view becomes `view`, and its scene's head is wanted like any other. The window draws the
 *   shown tab's most recently focused view (experiment 044 P2-iii) and calls `show` when that changes; `show(undefined)` draws nothing (the
 *   shown tab holds no view), keeping the head shown before warm. A runtime whose scene no longer exists (its tab closed) goes once it isn't
 *   shown.
 * - **Per-view editing** (experiment 044 decision D3): one editor document follows the drawn view's look (`document`). Showing a view of
 *   another look settles the on-head editor (an open gesture is cancelled on the look it began on), lets the head on screen hold the layers
 *   it shows (its surfaces stop following the document: browser-head-attachment.ts `holdSurfaces`), and only then switches the document, so
 *   no frame of the leaving head ever holds the new look's layers. The target head is filled and prepared with the new look before it takes
 *   over. Going back before the takeover switches the document back, and the head on screen follows it again. A warm head keeps its look's
 *   makeup (the preview device's hold), so switching back to it rasters and composites nothing.
 * - **Each view's editors** (`editors`, scene-editors.ts): the on-head editor is mounted on the head shown for the drawn view, editing the
 *   look that view's scene shows, and unmounted before the head is hidden (or drawn for another view).
 * - **Routing by view** (`runtimes`, view-routes.ts): the application sends a view's camera, preview and motion actions to the head that
 *   holds it, and says how.
 * - **Residency.** The shown head plus at most one warm one (`warm`, decision D2); a warm head is shown again at once, catching up with
 *   its V. A lost context drops the warm heads first. The same decisions bound the choice-preview devices: only a V a resident head shows
 *   is admitted to have one, and a question for any other V waits for its admission (choice-preview-suspension.ts).
 * - **The V's context outlives heads.** It is made once per V by the character's owner, with scene ports bound late: they reach the head
 *   that shows the V now, and do nothing while none does (a warm head stops following its V and catches up when shown).
 *
 * `load` is the preview setup's first load (and its Try again): it resolves once a head of the drawn scene is shown.
 */
import type { CharacterContextActions } from "../../character/character-context-actions";
import type { CharacterScenePorts, CharacterService } from "../../character/character-service";
import type { CoreBody } from "../../character/render-detail";
import { createBrowserChoicePreviewDevice } from "../../character/browser/browser-choice-preview-device";
import { pageFailure } from "../../diagnostics/page-sink";
import { SceneResidency, type PreparationStage, type PreparationState, type ResidencySnapshot, type ResidencyWant } from "../scene-residency";
import { suspendablePreviews, type SuspendablePreviews } from "../../character/choice-preview-suspension";
import { buildBrowserHead, startHeadDetails, type AttachedHead, type HeadAttachmentPorts } from "./browser-head-attachment";
import { previewFields } from "../preview-view-graph";
import type { ViewRoute, ViewRuntimes } from "../view-routes";

/** What the drawn scene wants shown: its V and the V's body (and the view it was wanted for, which a head is made for). */
export type SceneHeadWant = ResidencyWant & { readonly view: string; readonly character: string; readonly body: CoreBody };

export type SceneHeadsPorts = {
  /** What every head is built with (its scene ports, the graph, the layered surfaces, the application's attachments). */
  head: Omit<HeadAttachmentPorts, "character" | "prepareCore" | "notice" | "view" | "initialDetails" | "requester">;
  /**
   * The views and their scenes (one view is drawn at a time until phase 4b): the view drawn first (undefined: none), until `show(view)` names
   * another; the scene a view shows; whether a scene still exists (a view shows it); the V a scene shows, and making one for a scene that has
   * none.
   */
  scenes: {
    view(): string | undefined;
    of(view: string): string | undefined;
    has(scene: string): boolean;
    subject(scene: string): string | undefined;
    ensureSubject(scene: string): Promise<string | null>;
    subscribe(listener: () => void): () => void;
  };
  /** The characters' owner: each V's one context, its document and its decoded save. */
  characters: Pick<CharacterService, "context" | "document" | "decoded">;
  /** Prepare a body's core head (the host's preparation, `ensureBody`), reporting progress; stops waiting when `signal` aborts (decision D1). */
  prepareCore(body: CoreBody, pending: (message: string, progress: number | null) => void, signal: AbortSignal): Promise<void>;
  /** Show progress in the head pane while no head is shown yet (the first load). */
  pending(message: string, progress: number | null): void;
  /**
   * How far the wanted head is being built and prepared, as typed data (null: nothing is in flight). The presentation shows it in the head
   * pane: in its loading state while nothing is shown, in its quiet status line while a V is.
   */
  preparation?(state: PreparationState | null): void;
  /** A plain notice for the person. */
  notice(text: string): void;
  /** The head shown now changed (undefined: none is shown); the composition root connects what follows the shown head. */
  shown(head: AttachedHead | undefined): void;
  /** Each view's editors (scene-editors.ts): mount the on-head editor on the head shown for `view`; the release unmounts it. */
  editors?: { mount(head: AttachedHead, view: string): () => void };
  /**
   * The one editor document, which follows the drawn view's look (decision D3): whether it shows the look `view`'s scene shows, and switching
   * it to that look (called once the head on screen holds the layers it shows).
   */
  document?: { shows(view: string): boolean; follow(view: string): void };
  /** Hear the pane's WebGL context being lost and restored. */
  onContext?(listener: (event: "lost" | "restored") => void): () => void;
  /**
   * Choice previews for a V's context (default: a page worker per context, made when first used while a resident head shows the V, and
   * ended while none does; null: none, for fixtures).
   */
  previews?: (() => CharacterScenePorts["previews"]) | null;
  /** How many heads stay warm beside the shown one (default 1). */
  warm?: number;
};

const STAGES: readonly PreparationStage[] = ["build", "details", "programs", "textures", "warm-up"];
const STAGES_MALE: readonly PreparationStage[] = ["core", ...STAGES];
const NOT_SHOWN = "Your V couldn't be shown in the 3D view, so the V shown before stays. Change the V again to try once more.";
const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError";

export function createBrowserSceneHeads(ports: SceneHeadsPorts) {
  /** Each V's context as last handed over by its owner, with what this module connected to it and its choice-preview device. */
  const contexts = new Map<string, { context: CharacterContextActions; release: () => void; previews: SuspendablePreviews | undefined }>();
  let started = false, disposed = false, scheduled = false;
  let initial: { character: string; details: ReturnType<typeof startHeadDetails> } | undefined;
  // Superseding a speculative V must replace the same host want, even after a transport has already been aborted.
  let initialRequester: string | undefined;
  /** The view drawn now (undefined: none): the one the scenes port names first, then the one `show(view)` drew last. */
  let drawnView: string | undefined = ports.scenes.view();
  const drawn = () => drawnView;
  /** The on-head editor mounted on the shown head (for the view it draws), and its release. */
  let editor: { head: AttachedHead; release: () => void } | undefined;
  const mountEditor = (head: AttachedHead, view: string) => { editor = { head, release: ports.editors?.mount(head, view) ?? (() => {}) }; };
  const unmountEditor = () => { const mounted = editor; editor = undefined; mounted?.release(); };
  /**
   * The shown head draws the drawn view, with the document's look: drawn for it when it drew another view of its scene, its surfaces
   * following the document again (they held their layers while another look's head was wanted), and the on-head editor mounted for it.
   */
  const settle = (head: AttachedHead) => {
    const view = drawn();
    if (view === undefined || residency.shown() !== head || ports.scenes.of(view) !== residency.shownWant()?.scene) return;
    if (head.preview.view() !== view) { unmountEditor(); head.draw(view); }
    head.connectSurfaces();
    if (!editor) mountEditor(head, view);
  };

  const residency = new SceneResidency<SceneHeadWant, AttachedHead>({
    build: async (want, signal, progress) => {
      progress({ stage: want.body === "male" ? "core" : "build" });
      // Same-scene requests share construction and preparation. Resolve their destination after every wait.
      const primed = initial; initial = undefined;
      if (primed && primed.character !== want.character) primed.details.dispose();
      const head = await buildBrowserHead({ ...ports.head, view: () => destination(want),
        requester: primed?.details.requester,
        initialDetails: primed?.character === want.character ? primed.details : undefined,
        character: { body: want.body, ...saveOf(want.character), context: contextOf(want.character) },
        prepareCore: (body, buildSignal) => ports.prepareCore(body, (message, fraction) => {
          progress({ stage: "core", fraction: fraction ?? 0, waiting: "host", ...(message ? { detail: message } : {}) });
          // The first load: the head pane says what the host is doing, as it always has.
          if (!residency.shown()) ports.pending(message, residency.preparation()?.fraction ?? fraction);
        }, buildSignal).then(() => progress({ stage: "build" })),
        notice: ports.notice }, signal);
      // Shown, a change it isn't prepared for prepares it again (it says so only while shown); the head's release ends the subscription.
      head.onUnprepared(() => { if (residency.shown() === head) void residency.refresh().catch(() => { /* Superseded, or shown anyway. */ }); });
      return head;
    },
    prepare: (head, _want, signal, progress) => head.prepare(signal, progress),
    prepareShown: (head, _want, signal, progress) => head.prepareShown(signal, progress),
    prepared: head => head.prepared(),
    // A masculine V's core head is prepared by the host first (once; the host caches it).
    stages: want => want.body === "male" ? STAGES_MALE : STAGES,
    show: (head, want) => {
      const view = destination(want);
      head.show(view);
      mountEditor(head, view);
      // The V's context stays attached while heads swap: creator changes are never refused for a reload (the old `not_ready`).
      ports.head.attach({ characterContext: head.characterContext });
      ports.shown(head);
      admitPreviews();
    },
    // Hidden, a head whose scene no longer exists goes (its tab closed while it was drawn: it stayed drawn until another took over).
    hide: head => { if (editor?.head === head) unmountEditor(); head.hide(); ports.shown(undefined); queueMicrotask(closeGone); },
    dispose: head => { head.dispose(); admitPreviews(); },
  }, { warm: ports.warm });
  const offContext = ports.onContext?.(event => { if (event === "lost") residency.contextLost(); });
  const offScenes = ports.scenes.subscribe(() => schedule());
  // The want in flight's progress, as typed data, for the head pane (its loading state or its quiet status line).
  let told: PreparationState | null = null;
  const offPreparation = residency.subscribe(() => {
    const state = residency.preparation();
    if (JSON.stringify(state) === JSON.stringify(told)) return;
    told = state;
    ports.preparation?.(state);
    // While nothing is shown yet, the head pane's own progress follows the whole preparation (the host's line while it prepares the core).
    if (state && !residency.shown() && state.stage !== "core") ports.pending("", state.fraction);
  });
  function saveOf(character: string): { save?: NonNullable<ReturnType<CharacterContextActions["shownSave"]>> } {
    const save = contextOf(character).shownSave();
    return save ? { save } : {};
  }
  /**
   * The budget bounds preview workers too, as one decision with the heads': a V no resident head shows keeps its context (its choices,
   * its history), but its choice-preview device (a worker with its own WebGL context) ends, and its questions wait until a resident head
   * shows it again. Admission is withdrawn first, so a V admitted now never makes its device while one past the budget still lives.
   */
  function admitPreviews() {
    const resident = new Set(residency.wants().map(want => want.character));
    for (const [character, entry] of contexts) if (!resident.has(character)) entry.previews?.admit(false);
    for (const [character, entry] of contexts) if (resident.has(character)) entry.previews?.admit(true);
  }
  /** The head showing `character` now, if any. */
  function showing(character: string): AttachedHead | undefined {
    return residency.shownWant()?.character === character ? residency.shown() : undefined;
  }
  /** The V's one context (made by its owner the first time), with its scene ports bound late to the head that shows it. */
  function contextOf(character: string): CharacterContextActions {
    // The ports are taken only when the owner makes the context (their preview device is made only once it is used).
    const offered = scenePorts(character);
    const made = ports.characters.context(character, offered);
    const known = contexts.get(character);
    if (known?.context === made) return made;
    known?.release();
    // A changed body is a new want; every change asks for an autosave and tells the presentation.
    const releases = [made.subscribe(() => schedule()), made.subscribe(ports.head.changed), made.subscribe(ports.head.persist)];
    contexts.set(character, { context: made, previews: offered.previews as SuspendablePreviews | undefined,
      release: () => { for (const release of releases.splice(0)) release(); } });
    // A context made again for a V a resident head shows keeps that V's admission.
    if (residency.wants().some(want => want.character === character)) contexts.get(character)!.previews?.admit(true);
    made.start();
    return made;
  }
  function scenePorts(character: string): CharacterScenePorts {
    const make = ports.previews === null ? undefined : ports.previews ?? createBrowserChoicePreviewDevice;
    const previews = make ? suspendablePreviews(() => make()!) : undefined;
    return {
      // A save shown on the head of its own body only; another body's head shows it once built (it catches up when shown).
      showSave: save => {
        const head = showing(character), body = save ? (save.isMale ? "male" : "female") : contexts.get(character)?.context.shownBody();
        if (head && head.body === body) head.showSave(save);
      },
      details: {
        failed: () => showing(character)?.characterDetails.failed() ?? false,
        retry: () => void showing(character)?.characterDetails.retry(),
        preload: (request, signal) => showing(character)?.characterDetails.preload(request, signal) ?? Promise.resolve(),
      },
      ...(previews ? { previews } : {}),
    };
  }
  /** The drawn view's scene (undefined: none is drawn). */
  function drawnScene(): string | undefined { const view = drawn(); return view === undefined ? undefined : ports.scenes.of(view); }
  /** The latest destination of a shared request. No surviving view means its owner cancels the work through its signal. */
  function destination(want: SceneHeadWant): string {
    if (drawnScene() === want.scene) return drawn()!;
    if (ports.scenes.of(want.view) === want.scene) return want.view;
    const surviving = ports.head.graph?.viewIds().find(view => ports.scenes.of(view) === want.scene);
    if (surviving !== undefined) return surviving;
    residency.close(want.scene);
    throw new DOMException("The scene's views were closed.", "AbortError");
  }
  /** What the drawn scene wants now (undefined while nothing is drawn, or until U6 chooses its V). */
  function current(): SceneHeadWant | undefined {
    const view = drawn(), scene = drawnScene();
    if (view === undefined || scene === undefined) return undefined;
    const character = ports.scenes.subject(scene);
    if (!character || !ports.characters.document(character)) return undefined;
    const body = contextOf(character).shownBody();
    return { scene, view, character, body, key: `${scene}|${character}|${body}` };
  }
  /** The runtimes of scenes that no longer exist (their tab closed) go, unless one is shown: it goes once another takes over. */
  function closeGone() {
    if (disposed) return;
    // A deleted V's context is terminal. Its runtimes cannot stay warm and be reused with that old context after Restore.
    for (const want of residency.wants()) if (!ports.characters.document(want.character)) residency.close(want.scene);
    const shown = residency.shownWant()?.scene;
    for (const scene of new Set([...residency.wants().map(want => want.scene), ...(residency.pending() ? [residency.pending()!.scene] : [])]))
      if (scene !== shown && !ports.scenes.has(scene)) residency.close(scene);
  }
  /**
   * The resident head holding what `view`'s scene shows now, and how (view-routes.ts): the shown head when it shows the scene's V and body
   * now; a warm head of them; else the shown head's services for graph edits only, the view's V being made ready (`loading`) or not
   * (`absent`). A head of the scene's V before a change (the female head while the male one builds) holds the view no more. It makes no
   * context: a V whose context was never made has no head.
   */
  function route(view: string): ViewRoute | undefined {
    const shown = residency.shown(), scene = ports.scenes.of(view);
    if (!shown || scene === undefined) return undefined;
    const character = ports.scenes.subject(scene), body = character === undefined ? undefined : contexts.get(character)?.context.shownBody();
    const key = body === undefined ? undefined : `${scene}|${character}|${body}`;
    if (key !== undefined && residency.shownWant()?.key === key) return { reach: view === drawn() ? "drawn" : "scene", preview: shown.preview, motion: shown.motion };
    const warm = key === undefined ? undefined : residency.resident(key)?.runtime;
    if (warm) return { reach: "warm", preview: warm.preview, motion: warm.motion };
    return { reach: residency.pending()?.scene === scene ? "loading" : "absent", preview: shown.preview, motion: shown.motion };
  }
  /** Want what the drawn scene shows now, once the change that asked for it has finished. */
  function schedule() {
    if (disposed || scheduled) return;
    if (!started) { if (initial) prime(); return; }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      closeGone();
      const want = current();
      if (disposed) return;
      if (!want) { residency.hideShown(); return; }
      const pending = residency.pending();
      if (pending ? pending.key === want.key : residency.shownWant()?.key === want.key) return;
      void request(want).catch(() => { /* Reported in `request`. */ });
    });
  }
  /** Want `want`: resolves once shown; a superseded want rejects with its abort, and a failure is reported while another head shows. */
  function request(want: SceneHeadWant): Promise<AttachedHead> {
    return residency.want(want).catch(error => {
      if (!isAbort(error) && residency.shown()) {
        pageFailure("preview", "head_load_failed", "The 3D head couldn't be loaded.", error, { level: "warn" });
        ports.notice(NOT_SHOWN);
      }
      throw error;
    });
  }

  /** Only the authoritative active context is requested, never the remembered read-ahead V or an unseen character. */
  function prime(): void {
    if (started || disposed) return;
    const want = current();
    if (!want) { initial?.details.dispose(); initial = undefined; return; }
    const context = contextOf(want.character), view = drawn()!;
    const fields = ports.head.graph ? previewFields(ports.head.graph, view) : undefined;
    context.setBodyShown((fields?.display ?? ports.head.workspace.preview).body !== false);
    context.setUncensored((fields?.scene ?? ports.head.workspace.preview).uncensored === true);
    const request = context.detailRequest();
    if (initial?.character === want.character && initial.details.initial?.key === JSON.stringify(request)) return;
    initial?.details.dispose();
    const details = startHeadDetails(request, ports.head.warmStart, initialRequester);
    initialRequester = details.requester;
    initial = { character: want.character, details };
  }

  return {
    /** Request the active V while setup checks the core, without constructing or drawing a scene. */
    prime,
    /**
     * Show the drawn scene's head. A scene without a V stays empty for U6. Resolves once a head of the drawn scene is shown: a want
     * superseded meanwhile (the V changed body during the first load) waits for the one that replaced it. Rejects when the head can't be
     * built, with nothing shown, so the preview setup offers Try again.
     */
    async load(): Promise<void> {
      if (disposed) throw Error("The 3D view was closed.");
      started = true;
      for (let attempt = 0; ; attempt++) {
        // Nothing to draw (the shown tab holds no view): the first view shown later is wanted then.
        const view = drawn(), scene = drawnScene();
        if (view === undefined || scene === undefined) return;
        if (ports.scenes.subject(scene) === undefined) { residency.hideShown(); return; }
        const character = await ports.scenes.ensureSubject(scene);
        if (!character) throw Error("The V couldn't be shown: this window can't make one. Reload the window to continue.");
        if (drawn() !== view) continue;
        const want = current() ?? { scene, view, character, body: contextOf(character).shownBody(), key: `${scene}|${character}|${contextOf(character).shownBody()}` };
        try { await request(want); return; }
        catch (error) { if (!isAbort(error) || disposed || attempt > 50) throw error; }
      }
    },
    /**
     * Draw `view` (a tab shown, another of its views focused, the view drawn closed), or nothing (`undefined`: the shown tab holds no view).
     * Its scene's head is wanted like any subject change, so the head shown now stays drawn, with progress, until that one is prepared, and
     * a newer `show` or change supersedes it. A view of another look switches the editor document first (see the header). Resolves once it
     * is shown; before the first load, only the drawn view and the document change (the load shows it).
     */
    show(view: string | undefined): Promise<void> {
      if (disposed) return Promise.reject(Error("The 3D view was closed."));
      if (view !== undefined && ports.scenes.of(view) === undefined) return Promise.reject(Error("That view no longer exists."));
      const shown = residency.shown(), switching = view !== undefined && !!ports.document && !ports.document.shows(view);
      // The on-head editor goes first: an open gesture is settled on the look and view it began on.
      if (view !== drawnView || switching) unmountEditor();
      // The head on screen keeps the layers it shows before the document shows another look (D3).
      if (switching) shown?.holdSurfaces();
      drawnView = view;
      if (switching) ports.document!.follow(view!);
      if (!started) { if (initial) prime(); return Promise.resolve(); }
      if (view === undefined) { residency.hideShown(); return Promise.resolve(); }
      const want = current();
      if (!want) { residency.hideShown(); return Promise.reject(Error("That view's V isn't known yet.")); }
      // The head on screen draws a view that went (its tab closed): it isn't kept drawn while a head of another scene is made ready.
      if (shown && ports.scenes.of(shown.preview.view()) === undefined && residency.shownWant()?.scene !== want.scene) residency.hideShown();
      // Another view of the scene shown now draws on the same head (its camera, settings and motion).
      return request(want).then(settle, error => {
        // The head couldn't be shown (request noticed it): the view the head shown still draws is drawn again, with its look.
        const head = residency.shown(), back = head?.preview.view();
        if (!isAbort(error) && head && drawnView === view && back !== undefined && ports.scenes.of(back) !== undefined) {
          drawnView = back;
          if (ports.document && !ports.document.shows(back)) ports.document.follow(back);
          settle(head);
        }
        throw error;
      });
    },
    /** The view drawn now (undefined: none). */
    shownView(): string | undefined { return drawn(); },
    /** The runtimes as the application routes view actions to them (view-routes.ts). */
    runtimes: { route } satisfies ViewRuntimes,
    /** The head shown now. */
    shown(): AttachedHead | undefined { return residency.shown(); },
    /** The head showing `character` now, if any (what a loader that names the V applies through). */
    showing,
    /** Acquire the existing keyed character data without requesting or drawing a head. */
    context: contextOf,
    /** The want being built or prepared, and how far it is (null: none). */
    preparation(): PreparationState | null { return residency.preparation(); },
    /** The resident heads and the build in flight, as evidence. */
    snapshot(): ResidencySnapshot { return residency.snapshot(); },
    /** Everything goes (the window closes): the build stops, every head is disposed, the contexts are let go. */
    dispose() {
      if (disposed) return;
      disposed = true;
      initial?.details.dispose(); initial = undefined;
      offContext?.(); offScenes(); offPreparation();
      residency.dispose();
      ports.head.attach({ characterContext: undefined });
      for (const { release } of contexts.values()) release();
      contexts.clear();
    },
  };
}
