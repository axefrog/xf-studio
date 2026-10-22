/**
 * The window's scene runtime owner (profiles phase 4a-iv, experiment 043 §10): which head the drawn view shows, the heads kept resident,
 * and the V's context, which outlives them.
 *
 * - **A superseding subject change.** The drawn scene wants a head for (its V, the V's body). A change of the scene's V, or of the V's body
 *   (a save, a preset, the other Default V, Undo), is a new want: the newest wins (scene-residency.ts), a build still running for an older
 *   one stops (a masculine core's preparation too, decision D1), and the head shown before stays drawn until the new one is built. Nothing
 *   is refused meanwhile: the V's context stays attached, and its changes land as they are made.
 * - **Residency.** The shown head plus at most one warm one (`warm`, decision D2); a warm head is shown again at once, catching up with
 *   its V. A lost context drops the warm heads first.
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
import { SceneResidency, type ResidencySnapshot, type ResidencyWant } from "../scene-residency";
import { buildBrowserHead, type AttachedHead, type HeadAttachmentPorts } from "./browser-head-attachment";

/** What the drawn scene wants shown: its V and the V's body. */
export type SceneHeadWant = ResidencyWant & { readonly character: string; readonly body: CoreBody };

export type SceneHeadsPorts = {
  /** What every head is built with (its scene ports, the graph, the layered surfaces, the application's attachments). */
  head: Omit<HeadAttachmentPorts, "character" | "prepareCore" | "notice">;
  /** The drawn view's scene and the V it shows (phase 4a draws one view), and making one for a scene that has none. */
  scenes: {
    drawn(): string;
    subject(scene: string): string | undefined;
    ensureSubject(scene: string): Promise<string | null>;
    subscribe(listener: () => void): () => void;
  };
  /** The characters' owner: each V's one context, its document and its decoded save. */
  characters: Pick<CharacterService, "context" | "document" | "decoded">;
  /** Prepare a body's core head (the host's preparation, `ensureBody`), reporting progress; stops when `signal` aborts (decision D1). */
  prepareCore(body: CoreBody, pending: (message: string, progress: number | null) => void, signal: AbortSignal): Promise<void>;
  /** Show progress in the head pane while no head is shown yet (the first load). */
  pending(message: string, progress: number | null): void;
  /** A plain notice for the person. */
  notice(text: string): void;
  /** The head shown now changed (undefined: none is shown); the composition root connects what follows the shown head. */
  shown(head: AttachedHead | undefined): void;
  /** Hear the pane's WebGL context being lost and restored. */
  onContext?(listener: (event: "lost" | "restored") => void): () => void;
  /** Choice previews for a V's context (default: a page worker per context; null: none, for fixtures). */
  previews?: (() => CharacterScenePorts["previews"]) | null;
  /** How many heads stay warm beside the shown one (default 1). */
  warm?: number;
};

const NOT_SHOWN = "Your V couldn't be shown in the 3D view, so the V shown before stays. Change the V again to try once more.";
const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError";

export function createBrowserSceneHeads(ports: SceneHeadsPorts) {
  /** Each V's context as last handed over by its owner, with what this module connected to it. */
  const contexts = new Map<string, { context: CharacterContextActions; release: () => void }>();
  /** Scene ports ready for a V's next context (its owner takes them only when it makes one: they hold a choice-preview device). */
  const unused = new Map<string, CharacterScenePorts>();
  let started = false, disposed = false, scheduled = false;
  /** Whether the want being built has told the person it is preparing (once per want, while another head is shown). */
  let told = "";

  const residency = new SceneResidency<SceneHeadWant, AttachedHead>({
    build: (want, signal) => buildBrowserHead({ ...ports.head, character: { body: want.body, ...saveOf(want.character), context: contextOf(want.character) },
      prepareCore: (body, buildSignal) => ports.prepareCore(body, (message, progress) => preparing(want, message, progress), buildSignal),
      notice: ports.notice }, signal),
    show: head => {
      head.show();
      // The V's context stays attached while heads swap: creator changes are never refused for a reload (the old `not_ready`).
      ports.head.attach({ characterContext: head.characterContext });
      ports.shown(head);
    },
    hide: head => { head.hide(); ports.shown(undefined); },
    dispose: head => head.dispose(),
  }, { warm: ports.warm });
  const offContext = ports.onContext?.(event => { if (event === "lost") residency.contextLost(); });
  const offScenes = ports.scenes.subscribe(() => schedule());

  /** Progress of a head's core preparation: in the head pane while nothing is shown, else one plain notice (the V shown stays). */
  function preparing(want: SceneHeadWant, message: string, progress: number | null) {
    if (!residency.shown()) { ports.pending(message, progress); return; }
    if (told === want.key || residency.pending()?.key !== want.key) return;
    told = want.key;
    ports.notice(`${message} The V shown now stays until it's ready.`.trim());
  }
  function saveOf(character: string): { save?: NonNullable<ReturnType<CharacterContextActions["shownSave"]>> } {
    const save = contextOf(character).shownSave();
    return save ? { save } : {};
  }
  /** The head showing `character` now, if any. */
  function showing(character: string): AttachedHead | undefined {
    return residency.shownWant()?.character === character ? residency.shown() : undefined;
  }
  /** The V's one context (made by its owner the first time), with its scene ports bound late to the head that shows it. */
  function contextOf(character: string): CharacterContextActions {
    const offered = unused.get(character) ?? scenePorts(character);
    const made = ports.characters.context(character, offered);
    const known = contexts.get(character);
    if (known?.context === made) { unused.set(character, offered); return made; }
    unused.delete(character);
    known?.release();
    // A changed body is a new want; every change asks for an autosave and tells the presentation.
    const releases = [made.subscribe(() => schedule()), made.subscribe(ports.head.changed), made.subscribe(ports.head.persist)];
    contexts.set(character, { context: made, release: () => { for (const release of releases.splice(0)) release(); } });
    made.start();
    return made;
  }
  function scenePorts(character: string): CharacterScenePorts {
    const previews = ports.previews === null ? undefined : (ports.previews ?? createBrowserChoicePreviewDevice)();
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
  /** What the drawn scene wants now (undefined while its V isn't known: `load` makes one). */
  function current(): SceneHeadWant | undefined {
    const scene = ports.scenes.drawn(), character = ports.scenes.subject(scene);
    if (!character || !ports.characters.document(character)) return undefined;
    const body = contextOf(character).shownBody();
    return { scene, character, body, key: `${scene}|${character}|${body}` };
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
      const scene = ports.scenes.drawn();
      const character = await ports.scenes.ensureSubject(scene);
      if (!character) throw Error("The V couldn't be shown: this window can't make one. Reload the window to continue.");
      for (let attempt = 0; ; attempt++) {
        const want = current() ?? { scene, character, body: contextOf(character).shownBody(), key: `${scene}|${character}|${contextOf(character).shownBody()}` };
        try { await request(want); return; }
        catch (error) { if (!isAbort(error) || disposed || attempt > 50) throw error; }
      }
    },
    /** The head shown now. */
    shown(): AttachedHead | undefined { return residency.shown(); },
    /** The resident heads and the build in flight, as evidence. */
    snapshot(): ResidencySnapshot { return residency.snapshot(); },
    /** Everything goes (the window closes): the build stops, every head is disposed, the contexts are let go. */
    dispose() {
      if (disposed) return;
      disposed = true;
      offContext?.(); offScenes();
      residency.dispose();
      ports.head.attach({ characterContext: undefined });
      for (const { release } of contexts.values()) release();
      contexts.clear();
    },
  };
}
