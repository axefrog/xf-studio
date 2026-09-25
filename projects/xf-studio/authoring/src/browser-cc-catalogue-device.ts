/**
 * Browser device for the character context's host side (cc-catalogue-server.ts): the installed creator options for the Character
 * panel, their choices page by page, the view of a context, and a portable preset of it. Same endpoint on both hosts. Answers are
 * read with the panel's own readers (cc-panel.ts); a host of another version is reported in plain words.
 */
import type { BodyGender } from "./cc-catalogue";
import { type CreatorState, type CreatorView, readChoicePage, readCcPanel } from "./cc-panel";
import type { CreatorPort } from "./character-context-actions";
import type { CharacterRequest } from "./character-detail-request";

export const CREATOR_ENDPOINT = "/api/preview-character/creator";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const SKEW = "XF Studio was updated while it was running. Restart it to change your V's creator options.";

async function answer<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
  if (!response.ok) {
    if (body?.code === "unsupported_version") throw Error(SKEW);
    throw Error(typeof body?.error === "string" ? body.error : `The preview host refused the request (${response.status}).`);
  }
  return body as T;
}

export function createBrowserCreatorDevice(fetcher: Fetch = (url, init) => fetch(url, init)): CreatorPort {
  let mods = 0;
  const post = (body: unknown, signal?: AbortSignal) => fetcher(CREATOR_ENDPOINT, { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    async panel(gender: BodyGender, signal: AbortSignal): Promise<CreatorState> {
      const state = await answer<CreatorState>(await fetcher(`${CREATOR_ENDPOINT}?gender=${gender}`, { signal }));
      if (!state || !["preparing", "ready", "failed"].includes(state.phase)) throw Error(SKEW);
      if (state.phase !== "ready") return { phase: state.phase, message: typeof state.message === "string" ? state.message : "" };
      const panel = readCcPanel(state.panel);
      mods = panel.mods.length;
      return { phase: "ready", message: "", panel };
    },
    async page(gender, option, offset, signal) {
      return readChoicePage(await answer(await fetcher(`${CREATOR_ENDPOINT}?gender=${gender}&option=${encodeURIComponent(option)}&offset=${offset}`, { signal })), mods);
    },
    async view(request: CharacterRequest, signal: AbortSignal) {
      const view = await answer<CreatorView>(await post({ kind: "view", request }, signal));
      if (!view || typeof view.values !== "object" || !Array.isArray(view.faceMorphs) || !view.missing) throw Error(SKEW);
      return view;
    },
    async preset(request, name, kept) {
      return answer(await post({ kind: "preset", request, ...(name ? { name } : {}), ...(kept ? { kept } : {}) }));
    },
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
