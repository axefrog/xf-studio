/**
 * Browser device for the character context's host side (cc-catalogue-server.ts): the installed creator options for the Character
 * panel, their choices page by page, searches over every choice, the view of a context, a portable preset of it, Try again after a
 * failed catalogue, the choices an earlier build's tried piercing style stands for, a row's choices prepared ahead and the prepared game
 * files' size and clearing. Same endpoint on both hosts. Answers are read
 * with the panel's own readers (cc-panel.ts); every refusal becomes one plain line by its code, never the host's own words (UI-69).
 */
import type { BodyGender } from "./cc-catalogue";
import { type CreatorState, type CreatorView, readChoicePage, readChoiceSearch, readCcPanel } from "./cc-panel";
import type { CreatorPort } from "./character-context-actions";
import { characterChoiceOf, type CharacterChoice } from "./character-context";
import type { CharacterRequest } from "./character-detail-request";

export const CREATOR_ENDPOINT = "/api/preview-character/creator";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const SKEW = "XF Studio was updated while it was running. Restart it to change your V's creator options.";
/** The host's refusal codes in plain words. */
const PLAIN: Record<string, string> = {
  unsupported_version: SKEW,
  not_ready: "Your game's character-creator options appear once your game folder and WolvenKit are set up.",
  failed: "XF Studio couldn't read your game's character-creator options. Try again, or restart XF Studio if it keeps happening.",
  missing_target: "That creator option isn't offered by your installed game and mods any more.",
  too_large: "That's more than XF Studio can send to its preview in one go. Reset some changes and try again.",
  invalid: "XF Studio couldn't use that creator choice. Undo the last change, or restart XF Studio if it keeps happening.",
  forbidden: "The creator options can only be changed from XF Studio itself.",
};
const UNREACHABLE = "XF Studio couldn't reach its preview host. Restart XF Studio if this keeps happening.";
/** The host's answer about choices prepared ahead (choice-prefetch.ts). */
const PREFETCH_SCHEMA = "xfs/choice-prefetch-1";

async function answer<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { code?: unknown } | null;
  if (!response.ok) throw Error(PLAIN[String(body?.code)] ?? UNREACHABLE);
  return body as T;
}
/** A reader's failure (an answer of an unexpected shape) is a page and a host of different versions. */
const read = <T>(reader: () => T): T => { try { return reader(); } catch { throw Error(SKEW); } };

export function createBrowserCreatorDevice(transport: Fetch = (url, init) => fetch(url, init)): CreatorPort {
  let mods = 0;
  // A network failure is one plain line too (an aborted request stays an abort, which its caller ignores).
  const fetcher: Fetch = (url, init) => transport(url, init).catch(error => { throw init?.signal?.aborted ? error : Error(UNREACHABLE); });
  const post = (body: unknown, signal?: AbortSignal) => fetcher(CREATOR_ENDPOINT, { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const state = async (response: Promise<Response>): Promise<CreatorState> => {
    const value = await answer<CreatorState>(await response);
    if (!value || !["preparing", "ready", "failed"].includes(value.phase)) throw Error(SKEW);
    if (value.phase !== "ready") return { phase: value.phase, message: typeof value.message === "string" ? value.message : "" };
    const panel = read(() => readCcPanel(value.panel));
    mods = panel.mods.length;
    return { phase: "ready", message: "", panel };
  };
  return {
    panel: (gender: BodyGender, signal: AbortSignal) => state(fetcher(`${CREATOR_ENDPOINT}?gender=${gender}`, { signal })),
    retry: (gender: BodyGender, signal: AbortSignal) => state(post({ kind: "retry", bodyGender: gender }, signal)),
    async page(gender, option, offset, signal, query) {
      const search = query ? `&search=${encodeURIComponent(query)}` : "";
      const value = await answer(await fetcher(`${CREATOR_ENDPOINT}?gender=${gender}&option=${encodeURIComponent(option)}&offset=${offset}${search}`, { signal }));
      return read(() => readChoicePage(value, mods));
    },
    async search(gender, query, signal) {
      const value = await answer(await fetcher(`${CREATOR_ENDPOINT}?gender=${gender}&search=${encodeURIComponent(query)}`, { signal }));
      return read(() => readChoiceSearch(value));
    },
    async view(request: CharacterRequest, signal: AbortSignal) {
      const view = await answer<CreatorView>(await post({ kind: "view", request }, signal));
      if (!view || typeof view.values !== "object" || !Array.isArray(view.faceMorphs) || !view.missing) throw Error(SKEW);
      return view;
    },
    async preset(request, name, kept) {
      return answer(await post({ kind: "preset", request, ...(name ? { name } : {}), ...(kept ? { kept } : {}) }));
    },
    async legacy(gender, style, definition) {
      const value = await answer<{ choices?: unknown }>(await post({ kind: "legacy", bodyGender: gender, style, definition }));
      return Array.isArray(value?.choices) ? value.choices.flatMap((item): CharacterChoice[] => { const choice = characterChoiceOf(item); return choice ? [choice] : []; }) : [];
    },
    async prefetch(request, option, positions, focus, signal) {
      const value = await answer<{ schema?: unknown; states?: unknown; stopped?: unknown; busy?: unknown }>(await post({ kind: "prefetch", request, option,
        positions: [...positions], ...(focus !== null ? { focus } : {}) }, signal));
      if (value?.schema !== PREFETCH_SCHEMA || typeof value.states !== "string" || !/^[?nqfrx]*$/.test(value.states)) throw Error(SKEW);
      return { states: value.states, stopped: value.stopped === "time" || value.stopped === "disk" ? value.stopped : null, busy: value.busy === true };
    },
    async stopPrefetch() { await answer(await post({ kind: "prefetchStop" })); },
    async preparedFiles(signal) {
      const value = await answer<{ bytes?: unknown }>(await post({ kind: "prepared" }, signal));
      if (typeof value?.bytes !== "number" || !Number.isFinite(value.bytes)) throw Error(SKEW);
      return { bytes: value.bytes };
    },
    async clearPrepared() {
      const value = await answer<{ freed?: unknown }>(await post({ kind: "clearPrepared" }));
      return { freed: typeof value?.freed === "number" && Number.isFinite(value.freed) ? value.freed : 0 };
    },
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
