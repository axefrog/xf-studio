import type { CharacterDetailPort, HostCharacterState } from "./character-detail-actions";
import { readCharacterRecord, type CharacterDetailFetch, type LoadedCharacterDetails } from "./character-detail-loader";
import { parseCharacterRequest } from "./character-detail-request";
import { DetailVersionSkewError, type DetailLimit, type SlotLimits } from "./detail-limits";
import { CHARACTER_DETAIL_SCHEMA, RenderDetailVersionError, type DetailSlot } from "./render-detail";
import type { SceneHost } from "./platform/scene/scene-host";

/** The scene host's character side: its detail loader and the swap into the scene (feature-module platform §5). */
type Scene = Pick<SceneHost, "setCharacterDetails" | "details"> & Partial<Pick<SceneHost, "onBakeLimits">>;

/**
 * Browser device for the character-detail service: the host transport (same endpoint on both hosts)
 * and the renderer side (load a record, then swap it into the scene in one step). A load that is
 * cancelled or superseded is disposed and never reaches the scene. Each load reuses the parts of the shown
 * details whose content is unchanged (PREV-68), so a tried piercing style loads only the piercings.
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

export function createBrowserCharacterDetailDevice(scene: Scene, fetcher: CharacterDetailFetch = (url, init) => fetch(url, init)): CharacterDetailPort {
  /** The details the scene shows now (this device put them there), whose unchanged parts the next load reuses. */
  let shown: LoadedCharacterDetails | null = null;
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
    request: async (request, signal) => answer(await fetcher(CHARACTER_ENDPOINT, { method: "POST", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }), request),
    poll: async (key, signal) => answer(await fetcher(`${CHARACTER_ENDPOINT}?key=${encodeURIComponent(key)}`, { signal })),
    async show(file, signal) {
      let record;
      try { record = await readCharacterRecord(file, fetcher, signal); }
      catch (error) {
        if (error instanceof RenderDetailVersionError) throw new DetailVersionSkewError(`the record is ${error.direction} than this page reads.`);
        throw error;
      }
      // Through the host's detail loader: each chunk through the adapter for its template, with the host's anisotropy and skin placement.
      const loaded = await scene.details.load(record, { fetcher, signal, reuse: shown });
      if (signal.aborted) { loaded.dispose(); throw new DOMException("Superseded.", "AbortError"); }
      const placed = scene.setCharacterDetails(loaded);
      shown = loaded;
      shownSlots = record.slots.map(slot => ({ slot: slot.slot, state: loaded.problems.some(item => item.slot === slot.slot) ? "unavailable" : slot.state,
        hostLimits: slot.limits ?? [] }));
      const limits = [...loaded.limits, ...(placed?.limits ?? [])];
      // Record outcomes, overridden by anything that failed to load in this browser; a shown slot with a part
      // the preview can't draw yet keeps its state and carries the limit codes (the presentation words them).
      // How the details landed in the scene is developer evidence, read in `?verify=1` (studio-startup.ts).
      return { drawn: [...new Set(record.components.map(component => component.option))], slots: record.slots.map(slot => {
        const problem = loaded.problems.find(item => item.slot === slot.slot);
        if (problem) return { slot: slot.slot, state: "unavailable" as const, label: slot.label, message: problem.message };
        // The host's codes (a part it couldn't prepare, PIPE-84) come first, then this browser's.
        const { limits: host, ...rest } = slot;
        const codes = slot.state === "shown" ? [...new Set([...(host ?? []), ...limits.filter(item => item.slot === slot.slot).map(item => item.limit)])] : [];
        return codes.length ? { ...rest, limits: codes } : rest;
      }) };
    },
    clear() { scene.setCharacterDetails(null); shown = null; shownSlots = []; },
    onLimits(listener) { limitListeners.add(listener); return () => { limitListeners.delete(listener); }; },
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
