import type { HoloState } from "./service";
export type ClockFamily = "recording" | "game";
export type PlaybackMemory = { recording: number; game: number };
export const SPEEDS = {
  recording: [{ value: 1, label: "1×" }, { value: 4, label: "4×" }, { value: 16, label: "16×" }],
  game: [{ value: 1, label: "1×" }, { value: 60, label: "1 min/s" }, { value: 600, label: "10 min/s" }, { value: 3600, label: "1 h/s" }],
} as const;
export const clockFamily = (state: Pick<HoloState, "open">): ClockFamily => state.open?.session.meta.standalone?.clock === "game" ? "game" : "recording";
export function playbackMemory(value?: Partial<PlaybackMemory>): PlaybackMemory {
  return { recording: SPEEDS.recording.some(s => s.value === value?.recording) ? value!.recording! : 4,
    game: SPEEDS.game.some(s => s.value === value?.game) ? value!.game! : 600 };
}
/** Binary search each visible history; no sorting or scanning all item times per button update. */
export function changeMoment(state: Pick<HoloState, "agents" | "agentEnabled" | "t"> & {changeScope?:string|null}, direction: -1 | 1, allVisible = false): number | undefined {
  let result: number | undefined;
  for (const layer of state.agents.layers) {
    if (state.agentEnabled[layer.id] === false || !allVisible&&state.changeScope&&layer.id!==state.changeScope) continue;
    const times = layer.changes ?? []; let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo+hi) >>> 1, value = times[mid]; if (value < state.t || direction === 1 && value === state.t) lo = mid+1; else hi = mid; }
    const candidate = times[direction === 1 ? lo : lo-1];
    if (candidate !== undefined && (result === undefined || (direction === 1 ? candidate < result : candidate > result))) result = candidate;
  }
  return result;
}
