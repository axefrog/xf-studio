// 0.8.2 (session 9: after game_load the game sat on its "press any key" screen until the maintainer pressed one): pressing
// past the screen that ends a load, through photo.open's narrow key route (input/photo-key.ts: one key, only to the game's
// own window, only while it is in front, the game re-checked right before the key goes).
//
// When: the plugin's game.status, answered by the plugin while the game loads, says waiting_for_input once the loaded
// session's player puppet is in the world and the player hasn't attached yet (core/ScriptLayer.hpp; in session 9's load
// that stretch was the press-any-key screen [hypothesis]). After it has said so for a moment the key goes, and again every
// few seconds (three presses at most) while the screen stays.
//
// Which key: the game's skip_loading binding (r6/config/inputUserMappings.xml, IK_Space in 2.31; the settings menu offers no
// rebinding of it), read from the game's folder when it can be found, else IK_Space. In normal play Space jumps, so the key
// goes only while the game still reports the screen.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandContext } from "./catalogue.ts";
import { plainBridgeError } from "./errors.ts";
import { KeySendError, virtualKey, type FocusPolicy } from "../input/photo-key.ts";
import { processImagePath } from "../capture/win32.ts";

type Json = Record<string, any>;

export const PROMPT_SETTLE_MS = 1500;
export const PRESS_EVERY_MS = 6000;
export const MAX_PRESSES = 3;
export const POLL_MS = 500;

const planError = (code: string, message: string) => Object.assign(new Error(message), { plain: { code, message } });

/** The skip_loading key from the game's input mappings (the first keyboard key), or IK_Space. */
export function readSkipLoadingKey(mappingsPath: string | null): { name: string; source: "input_mappings" | "default" } {
  if (mappingsPath && existsSync(mappingsPath)) {
    try {
      const xml = readFileSync(mappingsPath, "utf8");
      const block = /<mapping\s+name="skip_loading"[^>]*>([\s\S]*?)<\/mapping>/.exec(xml)?.[1] ?? "";
      for (const match of block.matchAll(/<button\s+id="(IK_[A-Za-z0-9_]+)"/g)) {
        const name = match[1]!;
        if (!name.startsWith("IK_Pad") && virtualKey(name) !== null) return { name, source: "input_mappings" };
      }
    } catch {
      // unreadable: the default below
    }
  }
  return { name: "IK_Space", source: "default" };
}

/** <game folder>/r6/config/inputUserMappings.xml from the game process's image (<game folder>/bin/x64/Cyberpunk2077.exe). */
export function mappingsPathFor(pid: number | null): string | null {
  if (!pid) return null;
  const image = processImagePath(pid);
  return image ? join(dirname(dirname(dirname(image))), "r6", "config", "inputUserMappings.xml") : null;
}

/** The key goes the way photo.open's does: through the bridge's write gate (the save class, as game.load). */
export function continueKeyGate(status: Json, signal?: AbortSignal): void {
  const refuse = (code: string) => {
    throw Object.assign(new Error(code), { plain: plainBridgeError(code) });
  };
  const classes = Array.isArray(status.write_classes) ? (status.write_classes as string[]) : [];
  if (status.allow_writes !== true || !classes.includes("save")) refuse(status.allow_writes === true ? "write_class_disabled" : "writes_disabled");
  if (status.writes_paused === true) refuse("writes_paused");
  if (status.handed_over === true) refuse("handed_over");
  if (signal?.aborted) refuse("superseded");
}

export type ContinueOptions = { waitMs: number; focus?: FocusPolicy; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> };

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
 * Waits up to waitMs for gameplay, pressing past the press-any-key screen when the plugin reports it. Answers what happened:
 * {reached: "gameplay" | <phase>, presses: [{at_ms, key}], waited_ms, ...}; never throws for a slow load (the answer says
 * the game is still loading), only for a refusal (the write gate, a cancelled command) or a broken bridge.
 */
export async function pressPastLoadPrompt(context: CommandContext, options: ContinueOptions): Promise<Json> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? abortableSleep;
  const started = now();
  const presses: Json[] = [];
  const notes: string[] = [];
  let waitingSince: number | null = null;
  let lastPress = -Infinity;
  let phase = "unknown";
  let key: { name: string; source: string } | null = null;
  const status = async () => {
    const response = await context.api.callBridge("game.status", {}, context.cid, undefined, context.signal);
    if (response.ok) return response.result as Json;
    // While a save loads the engine may not tick for a moment: that is the loading screen, not a failure.
    if (["timeout", "timeout_after_start", "busy", "game_loading", "game_not_running"].includes(response.error.code)) return { phase: "loading" };
    throw Object.assign(new Error(response.error.message), { plain: response.error });
  };
  for (;;) {
    if (context.signal?.aborted) throw planError("interrupted", "Stopped before the game reached gameplay.");
    const s = await status();
    phase = String(s.phase ?? "unknown");
    const elapsed = now() - started;
    if (phase === "gameplay") {
      return { reached: "gameplay", presses, waited_ms: Math.round(elapsed), ...(notes.length ? { notes } : {}) };
    }
    if (s.waiting_for_input === true) {
      waitingSince ??= now();
      if (now() - waitingSince >= PROMPT_SETTLE_MS && now() - lastPress >= PRESS_EVERY_MS && presses.length < MAX_PRESSES) {
        continueKeyGate(s, context.signal);
        key ??= readSkipLoadingKey(mappingsPathFor(context.api.session()?.pid ?? null));
        const vk = virtualKey(key.name);
        const target = context.api.keyTarget();
        if (vk === null || !target) {
          notes.push(vk === null ? `The game's continue key (${key.name}) can't be sent safely.` : "The game has no visible window to send the key to.");
          return { reached: phase, presses, waited_ms: Math.round(now() - started), waiting_for_input: true, notes };
        }
        lastPress = now();
        try {
          await context.api.keySender()(target, vk, "sendinput", {
            focus: options.focus ?? "require",
            // The screen must still be there right before the key goes: in normal play the key would do something else.
            beforeSend: async () => {
              const again = await status();
              continueKeyGate(again, context.signal);
              if (again.phase === "gameplay" || again.waiting_for_input !== true) throw new KeySendError("The press-any-key screen had already gone, so no key was sent.", "prompt_gone");
            },
          });
          presses.push({ at_ms: Math.round(now() - started), key: key.name, key_source: key.source });
        } catch (error) {
          if (!(error instanceof KeySendError)) throw error;
          if (error.code !== "prompt_gone") {
            // not_foreground and the like: say so, keep waiting (the player may click into the game or press a key).
            if (!notes.includes(error.message)) notes.push(error.message);
            if (error.code === "input_disabled") return { reached: phase, presses, waited_ms: Math.round(now() - started), waiting_for_input: true, notes };
          }
        }
      }
    } else {
      waitingSince = null;
    }
    if (now() - started >= options.waitMs) {
      return {
        reached: phase,
        presses,
        waited_ms: Math.round(now() - started),
        ...(s.waiting_for_input === true ? { waiting_for_input: true } : {}),
        notes: [...notes, "The game hasn't reached gameplay yet: game_continue waits again and presses past the press-any-key screen; game_wait with phase gameplay only waits."],
      };
    }
    await sleep(POLL_MS, context.signal);
  }
}
