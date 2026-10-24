// R8 / 0.8.15: only current UI observations identify a prompt. Attach intervals and
// waiting_for_input alone never qualify. Start/UI_Skip consumers are located but their
// event ABI/execution lifetime remains uncommissioned; this helper sends nothing.

import type { CommandContext } from "./catalogue.ts";

type Json = Record<string, any>;

/** How long the screen must be reported before the answer says the game waits on it. */
export const PROMPT_SETTLE_MS = 1500;
export const POLL_MS = 500;

const planError = (code: string, message: string) => Object.assign(new Error(message), { plain: { code, message } });

export const PRESS_ANY_KEY_NOTE =
  "The initial loading controller offers its continue panel: ask the player to press a key in the game. The located UI_Skip consumer is not commissioned for bridge invocation; game_wait with phase gameplay then follows.";

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
    const observation = { prompt_state: s.prompt_state ?? "unknown", prompt_observed: s.prompt_observed === true, ...(s.lifecycle ? { lifecycle: s.lifecycle } : {}) };
    if (phase === "gameplay") return { reached: "gameplay", waited_ms: waited, ...observation };
    if (s.prompt_observed === true && s.prompt_state === "initial_continue" && s.lifecycle?.fresh === true && s.lifecycle?.complete === true) {
      waitingSince ??= now();
      if (now() - waitingSince >= PROMPT_SETTLE_MS) return { reached: "press_any_key", waiting_for_input: true, waited_ms: waited, ...observation, note: PRESS_ANY_KEY_NOTE };
    } else {
      waitingSince = null;
    }
    if (now() - started >= options.waitMs) {
      return { reached: phase, waited_ms: waited, ...observation, note: "The game hasn't finished loading yet: game_wait with phase gameplay goes on waiting. Unknown UI state is not a prompt report." };
    }
    await sleep(POLL_MS, context.signal);
  }
}

/** game.continue: refused until the bridge has a route inside the game (no synthetic key; see the header). */
export function refuseContinue(): never {
  throw planError(
    "no_safe_route",
    "The Start/UI_Skip consumers are located, but their event ABI, executing thread and current-owner lifetime remain uncommissioned. game.lifecycle.probe records a read-only plan in the autonomous test build. No consumer is invoked; ask the player to dismiss an observed prompt.",
  );
}
