/**
 * View actions routed by the view they name (profiles design §3.6, §4.5; experiment 043 §13). DOM-free: the window's scene runtime owner
 * (browser-scene-heads.ts) says which resident runtime holds a view, and the application sends the view's camera, preview and motion
 * actions to that runtime's services. Nothing reaches the shown runtime for a view it doesn't hold.
 *
 * What a family does on each reach (decided in 4a-vi, and why):
 *
 * | Reach | Camera | Preview (eye shape, details, hair; light and display settings) | Motion |
 * |---|---|---|---|
 * | `drawn` | the device frames it | checked against the head, applied | applied |
 * | `scene` | the camera node only (unless the view shares the drawn view's camera) | checked against the shown head, applied | applied (one scene, one motion) |
 * | `warm` | the camera node only | checked against the warm head, applied (it follows hidden) | refused |
 * | `loading`, `absent` | the camera node only | checked against the stored ranges only, applied | refused |
 *
 * - **Camera.** The pose of a view no runtime draws lives in its camera node (decision D3): a restore, an orbit step, Back and Forward
 *   edit the node, and the runtime that draws the view later starts there. Such an edit is published as one no device applied, so a device
 *   drawing another view through the same camera node moves with it (and never writes its old pose back). Framing (Front view, Whole body, the creator cameras, the lens)
 *   is computed by a device from its live camera, its lens and the subject's bounds: a view not drawn has none to compute with, so it is
 *   refused plainly (`not_ready`) until the view is shown.
 * - **Preview settings** are graph edits a runtime follows. A resident runtime of the view's V and body checks them against what its head
 *   offers (a warm one applies them hidden, and shows them when shown); with none resident the stored ranges are checked, and the head built
 *   later shows its own fallback while the node keeps the choice (experiment 043 §10).
 * - **Motion** is what a device plays now: the idle's clip and phase, a pose loading, the blink. Its checks read the device (an idle
 *   playing for a pause, the blink while the idle plays), and a hidden runtime's motion is released until it is shown, when it restores the
 *   scene node's motion. Applying it to a hidden runtime would bypass those checks, so it is refused plainly (`not_ready`).
 */
import type { ViewId } from "../platform/api/view-graph";
import { refusal, type Capability } from "../platform/api";
import type { PreviewActions } from "./preview-actions";
import type { MotionActions } from "../animation/motion-actions";

/**
 * How the runtime a view action reaches holds the view it names:
 * - `drawn`: the shown runtime draws that view now;
 * - `scene`: the shown runtime draws the view's scene, through another view;
 * - `warm`: a hidden resident runtime holds what the view's scene shows now (its V and body);
 * - `loading`: none does, and one is being built or prepared for that scene;
 * - `absent`: none does.
 */
export type ViewReach = "drawn" | "scene" | "warm" | "loading" | "absent";
/** The runtime's services an action naming a view reaches (with `loading` and `absent`, the shown runtime's, for graph edits only). */
export type ViewRoute = { readonly reach: ViewReach; readonly preview: PreviewActions; readonly motion: MotionActions };
/** The resident runtimes as the application routes to them (undefined: no runtime is shown yet, or the view doesn't exist). */
export type ViewRuntimes = { route(view: ViewId): ViewRoute | undefined };

/** Why a device action naming a view no runtime draws is refused (the view's V is resident, or nothing is being made for it). */
export const VIEW_HIDDEN = "That 3D view isn't shown now. Show it first.";
/** Why it is refused while the view's V is being made ready. */
export const VIEW_LOADING = "That view's V is still loading.";

/** Whether a reach holds the view's head (its V and body), so what the head offers can be checked. */
export const holdsHead = (reach: ViewReach) => reach === "drawn" || reach === "scene" || reach === "warm";
/** The refusal of a device action (framing, motion) for a view the reach doesn't draw. */
export const notDrawn = (reach: ViewReach): Capability & { available: false } => refusal("not_ready", reach === "loading" ? VIEW_LOADING : VIEW_HIDDEN);
/** Motion acts on a view whose scene is on screen; otherwise it is refused (see the header). */
export const motionRefusal = (reach: ViewReach): (Capability & { available: false }) | undefined =>
  reach === "drawn" || reach === "scene" ? undefined : notDrawn(reach);
