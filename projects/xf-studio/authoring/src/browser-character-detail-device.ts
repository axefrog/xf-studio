import type { CharacterDetailPort, HostCharacterState } from "./character-detail-actions";
import { readCharacterRecord, type CharacterDetailFetch, type LoadedCharacterDetails } from "./character-detail-loader";
import type { CharacterWarmStart } from "./character-warm-start";
import { parseCharacterRequest } from "./character-detail-request";
import { DetailVersionSkewError, type DetailLimit, type SlotLimits } from "./detail-limits";
import { CHARACTER_DETAIL_SCHEMA, RenderDetailVersionError, type DetailSlot } from "./render-detail";
import type { SceneHost } from "./platform/scene/scene-host";
import { markCharacter } from "./character-timing";

/** The scene host's character side: its detail loader and the swap into the scene (feature-module platform §5). */
type Scene = Pick<SceneHost, "setCharacterDetails" | "details"> & Partial<Pick<SceneHost, "onBakeLimits" | "releaseKeptParts" | "prepareDetails">>;

/**
 * Browser device for the character-detail service: the host transport (same endpoint on both hosts)
 * and the renderer side (load a record, then swap it into the scene in one step). A load that is
 * cancelled or superseded never reaches the scene; the parts it built are kept for later. Each load reuses the parts of the shown
 * details whose content is unchanged (PREV-68), so a tried piercing style loads only the piercings, and takes parts shown before (or
 * built by a superseded load) from the renderer's part pool, so undo, a style tried again or makeup shown again loads nothing.
 *
 * A host of another version (the app was updated while it ran, so the page and the host were built apart) is reported as
 * `DetailVersionSkewError`, never as a silent failure: a state that names another record schema (or none: an older host), a request
 * the host refuses as `unsupported_version`, a request the host calls invalid although this page's own reader accepts it, and a
 * record of a version this page doesn't read.
 *
 * Limits the scene finds after the details were placed (a hidden slot shown and baked, a re-bake after a context restore) reach the
 * service through `onLimits` (PREV-74), worded like the ones `show` returns.
 */
export const CHARACTER_ENDPOINT = "/api/preview-character";
/** This page's name for the host (character-detail-server.ts `X-XFS-Page`): a page supersedes only its own earlier V (PIPE-103). */
const pageName = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");

function hostState(value: unknown): HostCharacterState {
  const state = value as HostCharacterState & { recordSchema?: unknown };
  if (!state || typeof state.key !== "string" || !["preparing", "ready", "failed", "unknown"].includes(state.phase))
    throw Error("The preview host sent an unexpected answer.");
  if (state.recordSchema !== CHARACTER_DETAIL_SCHEMA)
    throw new DetailVersionSkewError(`the host writes ${typeof state.recordSchema === "string" ? state.recordSchema.slice(0, 40) : "an older record"}, this page reads ${CHARACTER_DETAIL_SCHEMA}.`);
  return { key: state.key, phase: state.phase, message: typeof state.message === "string" ? state.message : "",
    progress: state.progress && Number.isInteger(state.progress.index) && Number.isInteger(state.progress.total) && typeof state.progress.label === "string"
      ? { index: state.progress.index, total: state.progress.total, label: state.progress.label } : null,
    record: typeof state.record === "string" && /^[a-f0-9]{64}\.json$/.test(state.record) ? state.record : null,
    ...(state.phase === "failed" && state.need === "wolvenkit" ? { need: "wolvenkit" as const } : {}) };
}

/** How many times a load ahead asks after a request the host is still preparing (about two seconds in all) before leaving it. */
const PRELOAD_POLLS = 8;
const answerState = (value: unknown) => hostState(value);

/**
 * `warm`: the page's warm start (character-warm-start.ts): each request asked is remembered for the next start, and a load takes the
 * files it read ahead.
 */
export function createBrowserCharacterDetailDevice(scene: Scene, fetcher: CharacterDetailFetch = (url, init) => fetch(url, init),
  warm?: Pick<CharacterWarmStart, "remember" | "files">): CharacterDetailPort {
  /** This page's name, sent with each request. */
  const page = pageName();
  /** The details the scene shows now (this device put them there), whose unchanged parts the next load reuses. */
  let shown: LoadedCharacterDetails | null = null;
  /**
   * The load in progress. A newer one starts once it has settled: a superseded load stops at its next part, and the part it was building
   * is finished and kept (the renderer's part pool), so the newer load takes it instead of loading it again.
   */
  let loading: Promise<unknown> = Promise.resolve();
  /** A load ahead in progress (`preload`): a show stops it first, so the person's change never waits behind it. */
  let ahead: AbortController | null = null;
  /** The slots the last `show` answered with (their limits follow the scene's, plus the host's own codes, `hostLimits`). */
  let shownSlots: readonly { slot: DetailSlot; state: string; hostLimits: readonly DetailLimit[] }[] = [];
  const limitListeners = new Set<(update: SlotLimits) => void>();
  /** Each shown slot's limit codes: the loaded parts' and the placed V's (skin placement, bakes). */
  const slotLimits = (loaded: LoadedCharacterDetails, placed: readonly { slot: DetailSlot; limit: DetailLimit }[]) =>
    shownSlots.filter(slot => slot.state === "shown").map(slot => ({ slot: slot.slot,
      limits: [...new Set([...slot.hostLimits, ...[...loaded.limits, ...placed].filter(item => item.slot === slot.slot).map(item => item.limit)])] }));
  scene.onBakeLimits?.(placed => {
    if (!shown) return;
    const update = slotLimits(shown, placed);
    for (const listener of limitListeners) listener(update);
  });
  const answer = async (response: Response, sent?: unknown) => {
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      if (body?.code === "unsupported_version") throw new DetailVersionSkewError("the host doesn't read this page's requests.");
      // This page only sends requests its own reader accepts; a host that refuses one reads another version.
      if (sent !== undefined && body?.code === "invalid") {
        let valid = true;
        try { parseCharacterRequest(JSON.parse(JSON.stringify(sent))); } catch { valid = false; }
        if (valid) throw new DetailVersionSkewError("the host refused a request this page reads as valid.");
      }
      throw Error(`The preview host refused the request (${response.status}).`);
    }
    return hostState(await response.json());
  };
  return {
    request: async (request, signal) => {
      warm?.remember(request);
      return answer(await fetcher(CHARACTER_ENDPOINT, { method: "POST", signal,
        headers: { "Content-Type": "application/json", "X-XFS-Page": page }, body: JSON.stringify(request) }), request);
    },
    poll: async (key, signal) => answer(await fetcher(`${CHARACTER_ENDPOINT}?key=${encodeURIComponent(key)}`, { signal })),
    async show(file, signal) {
      let record;
      try { record = await readCharacterRecord(file, fetcher, signal); }
      catch (error) {
        if (error instanceof RenderDetailVersionError) throw new DetailVersionSkewError(`the record is ${error.direction} than this page reads.`);
        throw error;
      }
      markCharacter("record", { components: record.components.length });
      ahead?.abort();
      // Through the host's detail loader: each chunk through the adapter for its template, with the host's anisotropy and skin placement.
      await loading;
      if (signal.aborted) throw new DOMException("Superseded.", "AbortError");
      const load = scene.details.load(record, { fetcher, signal, reuse: shown, warmed: warm?.files ?? null });
      loading = load.catch(() => {});
      const loaded = await load;
      if (signal.aborted) { loaded.dispose(); throw new DOMException("Superseded.", "AbortError"); }
      markCharacter("loaded", { reused: loaded.reused, components: loaded.components?.length ?? 0 });
      // New parts are made ready for their first frame while the shown V keeps drawing (PREV-189): nothing waits inside that frame.
      if (scene.prepareDetails) {
        try { await scene.prepareDetails(loaded, signal); }
        catch (error) { loaded.dispose(); throw error; }
        if (signal.aborted) { loaded.dispose(); throw new DOMException("Superseded.", "AbortError"); }
        markCharacter("prepared");
      }
      const placed = scene.setCharacterDetails(loaded);
      markCharacter("placed");
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(() => markCharacter("frame")));
      shown = loaded;
      shownSlots = record.slots.map(slot => ({ slot: slot.slot, state: loaded.problems.some(item => item.slot === slot.slot) ? "unavailable" : slot.state,
        hostLimits: slot.limits ?? [] }));
      const limits = [...loaded.limits, ...(placed?.limits ?? [])];
      // Record outcomes, overridden by anything that failed to load in this browser; a shown slot with a part
      // the preview can't draw yet keeps its state and carries the limit codes (the presentation words them).
      // How the details landed in the scene is developer evidence, read in `?verify=1` (studio-startup.ts).
      return { drawn: [...new Set(record.components.map(component => component.option))], partial: [...record.partial ?? []],
        garmentTags: [...new Set(record.components.flatMap(component => component.garment?.tags ?? []))].sort(), slots: record.slots.map(slot => {
        const problem = loaded.problems.find(item => item.slot === slot.slot);
        if (problem) return { slot: slot.slot, state: "unavailable" as const, label: slot.label, message: problem.message };
        // The host's codes (a part it couldn't prepare, PIPE-84) come first, then this browser's.
        const { limits: host, ...rest } = slot;
        const codes = slot.state === "shown" ? [...new Set([...(host ?? []), ...limits.filter(item => item.slot === slot.slot).map(item => item.limit)])] : [];
        return codes.length ? { ...rest, limits: codes } : rest;
      }) };
    },
    async preload(request, outer) {
      if (!scene.prepareDetails || outer.aborted) return;
      ahead?.abort();
      const controller = new AbortController(), signal = controller.signal;
      ahead = controller;
      outer.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        // Asked as another page (PIPE-103): the person's own request is never cancelled by it.
        const ask = async () => answer(await fetcher(CHARACTER_ENDPOINT, { method: "POST", signal,
          headers: { "Content-Type": "application/json", "X-XFS-Page": `${page}-ahead` }, body: JSON.stringify(request) }), request);
        let state = await ask();
        // A prepared choice answers within a few polls; one the host is still preparing is not waited for.
        for (let attempt = 0; state.phase === "preparing" && attempt < PRELOAD_POLLS; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** Math.min(attempt, 4)));
          if (signal.aborted) return;
          state = answerState(await (await fetcher(`${CHARACTER_ENDPOINT}?key=${encodeURIComponent(state.key)}`, { signal })).json());
        }
        if (signal.aborted || state.phase !== "ready" || !state.record) return;
        const record = await readCharacterRecord(state.record, fetcher, signal);
        await loading;
        if (signal.aborted) return;
        const prepare = scene.prepareDetails;
        // Its new parts made ready for their first frame, then kept (the part pool) for the change that shows them. A show waits for all
        // of it (`loading`), so a click during the preparation finds the parts in the pool instead of building them again (PREV-192); a
        // stopped preparation returns at once, its programs still linking on the driver's threads for the show's own preparation.
        const ahead = (async () => {
          const loaded = await scene.details.load(record, { fetcher, signal, reuse: shown });
          try { if (!signal.aborted) await prepare(loaded, signal); }
          finally { loaded.dispose(); }
        })();
        loading = ahead.catch(() => {});
        await ahead;
      } catch (error) {
        if (!signal.aborted) throw error;
      } finally { if (ahead === controller) ahead = null; }
    },
    // Another V: the previous one leaves the scene and GPU memory whole, kept parts included.
    clear() { scene.setCharacterDetails(null); scene.releaseKeptParts?.(); shown = null; shownSlots = []; },
    onLimits(listener) { limitListeners.add(listener); return () => { limitListeners.delete(listener); }; },
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
