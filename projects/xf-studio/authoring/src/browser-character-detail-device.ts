import type { CharacterDetailPort, HostCharacterState } from "./character-detail-actions";
import { loadCharacterDetails, readCharacterRecord, type CharacterDetailFetch } from "./character-detail-loader";
import type { DetailSlot } from "./render-detail";
import type { createScene } from "./scene";

type Scene = Pick<Awaited<ReturnType<typeof createScene>>, "setCharacterDetails" | "detailContext" | "renderer">;

/**
 * Browser device for the character-detail service: the host transport (same endpoint on both hosts)
 * and the renderer side (load a record, then swap it into the scene in one step). A load that is
 * cancelled or superseded is disposed and never reaches the scene.
 */
export const CHARACTER_ENDPOINT = "/api/preview-character";

function hostState(value: unknown): HostCharacterState {
  const state = value as HostCharacterState;
  if (!state || typeof state.key !== "string" || !["preparing", "ready", "failed", "unknown"].includes(state.phase))
    throw Error("The preview host sent an unexpected answer.");
  return { key: state.key, phase: state.phase, message: typeof state.message === "string" ? state.message : "",
    progress: state.progress && Number.isInteger(state.progress.index) && Number.isInteger(state.progress.total) && typeof state.progress.label === "string"
      ? { index: state.progress.index, total: state.progress.total, label: state.progress.label } : null,
    record: typeof state.record === "string" && /^[a-f0-9]{64}\.json$/.test(state.record) ? state.record : null };
}

export function createBrowserCharacterDetailDevice(scene: Scene, fetcher: CharacterDetailFetch = (url, init) => fetch(url, init)): CharacterDetailPort {
  const answer = async (response: Response) => {
    if (!response.ok) throw Error(`The preview host refused the request (${response.status}).`);
    return hostState(await response.json());
  };
  return {
    request: async (request, signal) => answer(await fetcher(CHARACTER_ENDPOINT, { method: "POST", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) })),
    poll: async (key, signal) => answer(await fetcher(`${CHARACTER_ENDPOINT}?key=${encodeURIComponent(key)}`, { signal })),
    async show(file, signal) {
      const record = await readCharacterRecord(file, fetcher, signal);
      const loaded = await loadCharacterDetails(record, { fetcher, signal, anisotropy: Math.min(8, scene.renderer.capabilities.getMaxAnisotropy()),
        context: (slot: DetailSlot) => scene.detailContext(slot) });
      if (signal.aborted) { loaded.dispose(); throw new DOMException("Superseded.", "AbortError"); }
      const placed = scene.setCharacterDetails(loaded);
      const limits = [...loaded.limits, ...(placed?.limits ?? [])];
      // Record outcomes, overridden by anything that failed to load in this browser; a shown slot with a part
      // the preview can't draw yet keeps its state and carries the limit codes (the presentation words them).
      // How the details landed in the scene is developer evidence, read in `?verify=1` (studio-startup.ts).
      return { choices: record.choices, override: record.character.override ?? null, slots: record.slots.map(slot => {
        const problem = loaded.problems.find(item => item.slot === slot.slot);
        if (problem) return { slot: slot.slot, state: "unavailable" as const, label: slot.label, message: problem.message };
        const codes = slot.state === "shown" ? [...new Set(limits.filter(item => item.slot === slot.slot).map(item => item.limit))] : [];
        return codes.length ? { ...slot, limits: codes } : slot;
      }) };
    },
    clear() { scene.setCharacterDetails(null); },
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
