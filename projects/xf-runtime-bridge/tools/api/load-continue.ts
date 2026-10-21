// 0.8.2 (session 9: after game_load the game sat on its "press any key" screen until the maintainer pressed one): waiting
// for the end of a load and saying plainly when the game waits on that screen.
//
// When: the plugin's game.status, answered by the plugin while the game loads, says waiting_for_input once the loaded
// session's player puppet is in the world and the player hasn't attached yet (core/ScriptLayer.hpp; in session 9's load
// that stretch was the press-any-key screen [hypothesis]).
//
// No key is pressed (the 0.8.2 review's High finding): a synthetic key goes through Windows' global input, after checks made
// a moment earlier, so it could reach another window if the focus moved, or gameplay if the player had already pressed one.
// The bridge dismisses the screen only once it has a route inside the game (the loading screen's own controller on the game
// thread), which session 10's I4 looks for; until then the answer asks the player to press a key.

import type { CommandContext } from "./catalogue.ts";

type Json = Record<string, any>;

/** How long the screen must be reported before the answer says the game waits on it. */
export const PROMPT_SETTLE_MS = 1500;
export const POLL_MS = 500;

const planError = (code: string, message: string) => Object.assign(new Error(message), { plain: { code, message } });

export const PRESS_ANY_KEY_NOTE =
  "The save has loaded and the game is waiting on its press-any-key screen: ask the player to press a key in the game (the bridge doesn't press it: no route inside the game is known yet that can't reach another window or gameplay). game_wait with phase gameplay then follows.";

export type ContinueOptions = { waitMs: number; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> };

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Waits up to waitMs for the load to end: answers {reached: "gameplay"} once the game is in normal play, {reached:
 * "press_any_key", waiting_for_input: true, note} once the plugin has reported the press-any-key screen for a moment, or
 * {reached: <phase>, note} when the time is up. Sends nothing to the game; never throws for a slow load, only when the
 * command is cancelled or the bridge fails.
 */
export async function waitForLoadEnd(context: CommandContext, options: ContinueOptions): Promise<Json> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? abortableSleep;
  const started = now();
  let waitingSince: number | null = null;
  for (;;) {
    if (context.signal?.aborted) throw planError("interrupted", "Stopped before the load ended.");
    const response = await context.api.callBridge("game.status", {}, context.cid, undefined, context.signal);
    let s: Json = { phase: "loading" };
    if (response.ok) s = response.result as Json;
    // While a save loads the engine may not tick for a moment: that is the loading screen, not a failure.
    else if (!["timeout", "timeout_after_start", "busy", "game_loading", "game_not_running"].includes(response.error.code)) {
      throw Object.assign(new Error(response.error.message), { plain: response.error });
    }
    const phase = String(s.phase ?? "unknown");
    const waited = Math.round(now() - started);
    if (phase === "gameplay") return { reached: "gameplay", waited_ms: waited };
    if (s.waiting_for_input === true) {
      waitingSince ??= now();
      if (now() - waitingSince >= PROMPT_SETTLE_MS) return { reached: "press_any_key", waiting_for_input: true, waited_ms: waited, note: PRESS_ANY_KEY_NOTE };
    } else {
      waitingSince = null;
    }
    if (now() - started >= options.waitMs) {
      return { reached: phase, waited_ms: waited, note: "The game hasn't finished loading yet: game_wait with phase gameplay goes on waiting (the player may need to press a key on the press-any-key screen)." };
    }
    await sleep(POLL_MS, context.signal);
  }
}

/** game.continue: refused until the bridge has a route inside the game (no synthetic key; see the header). */
export function refuseContinue(): never {
  throw planError(
    "no_safe_route",
    "The bridge can't press past the press-any-key screen yet: the only way it has is a synthetic key press, which could reach another window or gameplay, so it never sends one. Ask the player to press a key in the game; game_wait with phase gameplay then follows.",
  );
}
