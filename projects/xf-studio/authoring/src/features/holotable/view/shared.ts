/** What the three Holotable panels share: number formats, V at the moment shown, and the layers' names. Pure. */
import type { HoloLayer, HoloState } from "../service";
import type { HoloVSample } from "../types";

export const f1 = (n: number) => n.toFixed(1);
/** A compass heading from the game's yaw (degrees anticlockwise from +Y). */
export const heading = (yaw: number) => `${String(Math.round(((-yaw % 360) + 360) % 360)).padStart(3, "0")}°`;
export const LAYER_LABELS: Readonly<Record<HoloLayer, string>> = { v: "V and trail", camera: "Camera", events: "Events with a place",
  gaps: "Recorder gaps", areas: "Districts", cells: "Streaming cells", solids: "Solid shapes" };

/** V's last sample at or before the moment shown. */
export function vAt(state: HoloState): HoloVSample | undefined {
  const s = state.open?.session; if (!s) return undefined;
  let lo = 0, hi = s.v.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.v[mid].t <= state.t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best < 0 ? undefined : s.v[best];
}
