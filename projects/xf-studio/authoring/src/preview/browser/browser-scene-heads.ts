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
 * - **A view to show** (`show(view)`, for phase 2's tabs): the drawn view becomes `view`, and its scene's head is wanted like any other.
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
import { buildBrowserHead, type AttachedHead, type HeadAttachmentPorts } from "./browser-head-attachment";
import type { ViewRoute, ViewRuntimes } from "../view-routes";

/** What the drawn scene wants shown: its V and the V's body. */
export type SceneHeadWant = ResidencyWant & { readonly character: string; readonly body: CoreBody };

export type SceneHeadsPorts = {
  /** What every head is built with (its scene ports, the graph, the layered surfaces, the application's attachments). */
  head: Omit<HeadAttachmentPorts, "character" | "prepareCore" | "notice" | "view">;
  /**
   * The views and their scenes (phase 4a draws one view at a time): the view drawn until `show(view)` names another, the scene a view
   * shows, the V a scene shows, and making one for a scene that has none.
   */
  scenes: {
    view(): string;
    of(view: string): string | undefined;
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
  /** The view `show(view)` drew last (undefined: the view the scenes port names). */
  let drawnView: string | undefined;
  /** The view drawn now. */
  const drawn = () => drawnView ?? ports.scenes.view();
  /** The on-head editor mounted on the shown head (for the view it draws), and its release. */
  let editor: { head: AttachedHead; release: () => void } | undefined;
  const mountEditor = (head: AttachedHead) => { editor = { head, release: ports.editors?.mount(head, drawn()) ?? (() => {}) }; };
  const unmountEditor = () => { const mounted = editor; editor = undefined; mounted?.release(); };

  const residency = new SceneResidency<SceneHeadWant, AttachedHead>({
    build: async (want, signal, progress) => {
      progress({ stage: want.body === "male" ? "core" : "build" });
      // Made for the view drawn now; shown, it draws whichever view of its scene is drawn then (`show`).
      const head = await buildBrowserHead({ ...ports.head, view: drawn(), character: { body: want.body, ...saveOf(want.character), context: contextOf(want.character) },
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
    show: head => {
      head.show(drawn());
      mountEditor(head);
      // The V's context stays attached while heads swap: creator changes are never refused for a reload (the old `not_ready`).
      ports.head.attach({ characterContext: head.characterContext });
      ports.shown(head);
      admitPreviews();
    },
    hide: head => { if (editor?.head === head) unmountEditor(); head.hide(); ports.shown(undefined); },
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
  /** The drawn view's scene. */
  function drawnScene(): string { return ports.scenes.of(drawn()) ?? ""; }
  /** What the drawn scene wants now (undefined while its V isn't known: `load` makes one). */
  function current(): SceneHeadWant | undefined {
    const scene = drawnScene(), character = ports.scenes.subject(scene);
    if (!character || !ports.characters.document(character)) return undefined;
    const body = contextOf(character).shownBody();
    return { scene, character, body, key: `${scene}|${character}|${body}` };
  }
  /**
   * The resident head holding what `view`'s scene shows now, and how (view-routes.ts): the shown head for its own scene; a warm head of the
   * scene's V and body; else the shown head's services for graph edits only, the view's V being made ready (`loading`) or not (`absent`).
   * It makes no context: a V whose context was never made has no head.
   */
  function route(view: string): ViewRoute | undefined {
    const shown = residency.shown(), scene = ports.scenes.of(view);
    if (!shown || scene === undefined) return undefined;
    if (residency.shownWant()?.scene === scene) return { reach: view === drawn() ? "drawn" : "scene", preview: shown.preview, motion: shown.motion };
    const character = ports.scenes.subject(scene), body = character === undefined ? undefined : contexts.get(character)?.context.shownBody();
    const warm = body === undefined ? undefined : residency.resident(`${scene}|${character}|${body}`)?.runtime;
    if (warm) return { reach: "warm", preview: warm.preview, motion: warm.motion };
    return { reach: residency.pending()?.scene === scene ? "loading" : "absent", preview: shown.preview, motion: shown.motion };
  }
  /** Want what the drawn scene shows now, once the change that asked for it has finished. */
  function schedule() {
    if (!started || disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const want = current();
      if (!want || disposed) return;
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

  return {
    /**
     * Show the drawn scene's head (made with a V when the scene has none). Resolves once a head of the drawn scene is shown: a want
     * superseded meanwhile (the V changed body during the first load) waits for the one that replaced it. Rejects when the head can't be
     * built, with nothing shown, so the preview setup offers Try again.
     */
    async load(): Promise<void> {
      if (disposed) throw Error("The 3D view was closed.");
      started = true;
      const scene = drawnScene();
      const character = await ports.scenes.ensureSubject(scene);
      if (!character) throw Error("The V couldn't be shown: this window can't make one. Reload the window to continue.");
      for (let attempt = 0; ; attempt++) {
        const want = current() ?? { scene, character, body: contextOf(character).shownBody(), key: `${scene}|${character}|${contextOf(character).shownBody()}` };
        try { await request(want); return; }
        catch (error) { if (!isAbort(error) || disposed || attempt > 50) throw error; }
      }
    },
    /**
     * Draw `view` (phase 2's tab switch: `device.show(view)`): its scene's head is wanted like any subject change, so the head shown now
     * stays drawn, with progress, until that one is prepared, and a newer `show` or change supersedes it. Resolves once it is shown.
     */
    show(view: string): Promise<void> {
      if (disposed) return Promise.reject(Error("The 3D view was closed."));
      if (ports.scenes.of(view) === undefined) return Promise.reject(Error("That view no longer exists."));
      drawnView = view;
      const want = current();
      if (!want) return Promise.reject(Error("That view's V isn't known yet."));
      // Another view of the scene shown now draws on the same head (its camera, settings and motion).
      return request(want).then(head => {
        if (drawn() !== view || residency.shown() !== head || head.preview.view() === view) return;
        unmountEditor(); head.draw(view); mountEditor(head);
      });
    },
    /** The view drawn now (the one `show` drew last, else the one the scenes port names). */
    shownView(): string { return drawn(); },
    /** The runtimes as the application routes view actions to them (view-routes.ts). */
    runtimes: { route } satisfies ViewRuntimes,
    /** The head shown now. */
    shown(): AttachedHead | undefined { return residency.shown(); },
    /** The head showing `character` now, if any (what a loader that names the V applies through). */
    showing,
    /** The want being built or prepared, and how far it is (null: none). */
    preparation(): PreparationState | null { return residency.preparation(); },
    /** The resident heads and the build in flight, as evidence. */
    snapshot(): ResidencySnapshot { return residency.snapshot(); },
    /** Everything goes (the window closes): the build stops, every head is disposed, the contexts are let go. */
    dispose() {
      if (disposed) return;
      disposed = true;
      offContext?.(); offScenes(); offPreparation();
      residency.dispose();
      ports.head.attach({ characterContext: undefined });
      for (const { release } of contexts.values()) release();
      contexts.clear();
    },
  };
}
