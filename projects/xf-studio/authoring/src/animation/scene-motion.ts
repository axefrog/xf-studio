/**
 * A scene's motion as plain data (view-graph-design.md §3.1; experiment 043 §9): the idle on or off, its phase, pause and contributions,
 * which of the game's preview idles plays, the eyelid closure and Play blink, and the photo-mode pose V holds. It lives in the view graph's
 * scene node (`SceneState.motion`), so every runtime of the scene applies the same motion when it is built, and it outlives any one head.
 *
 * - **Not a look, not Undo.** Like camera navigation, the motion records no View and lighting step, and an Undo of another scene setting
 *   (eye shape, hair physics) keeps it as it is now (the scene codec lists it as unrecorded).
 * - **Read once from the workspace.** A scene node stored before motion moved has none: the main view's scene takes it from the workspace's
 *   legacy `preview` fields once (`previewMotion`), and from then on only the node is written. Those `preview` fields are frozen as read,
 *   so a build before the move opens the motion as it was at the upgrade (profiles design §2.4).
 * - **Stored as normalised**, by the rules the workspace reader always applied: while the idle plays the blink is open and still; while it
 *   doesn't, it isn't paused. The chosen idle is stored only when it isn't the default (the close-up).
 */
import type { PreviewState } from "../app/workspace/makeup-workspace";
import { DEFAULT_IDLE } from "./idle-catalogue";

/** The photo-mode pose a scene holds: its TweakDB record and label (pose-library-design.md Q9). */
export type StoredPose = { id: string; label: string };
export type SceneMotion = {
  idle: boolean; idleTime: number; idlePaused: boolean; idleBody: boolean; idleFace: boolean;
  blink: number; blinkPlaying: boolean;
  /** Which of the game's preview idles plays while the idle is on; absent: the default (`DEFAULT_IDLE`). */
  idleClip?: string;
  /** Present only while a pose is the body source (held, or stored and waiting for the Poses module). */
  pose?: StoredPose;
};
/** The motion a scene starts with (a fresh workspace's). */
export const DEFAULT_MOTION: Readonly<SceneMotion> = Object.freeze({ idle: false, idleTime: 0, idlePaused: false, idleBody: true, idleFace: true,
  blink: 0, blinkPlaying: false });

const bool = (value: unknown): value is boolean => typeof value === "boolean";
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
/** An idle's catalogue ID as a workspace may store it (idle-catalogue.ts). */
export const validIdleClip = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
/** A stored pose: a TweakDB record ID and a plain label. */
export function storedPoseOf(value: unknown): StoredPose | undefined {
  const pose = value as { id?: unknown; label?: unknown } | undefined;
  return pose && typeof pose === "object" && typeof pose.id === "string" && pose.id.length <= 512 && /^[A-Za-z0-9_.\-$#]+$/.test(pose.id) &&
    typeof pose.label === "string" && pose.label.length <= 200 && !/[\u0000-\u001f]/.test(pose.label) ? { id: pose.id, label: pose.label } : undefined;
}

/** A motion as stored: the normalising rules above, and the fields in one order (so a round trip keeps its bytes). */
function normalised(m: SceneMotion): SceneMotion {
  const idleClip = m.idleClip !== undefined && m.idleClip !== DEFAULT_IDLE ? m.idleClip : undefined;
  return { idle: m.idle, idleTime: m.idleTime, idlePaused: m.idle && m.idlePaused, idleBody: m.idleBody, idleFace: m.idleFace,
    blink: m.idle ? 0 : m.blink, blinkPlaying: !m.idle && m.blinkPlaying,
    ...(idleClip === undefined ? {} : { idleClip }), ...(m.pose ? { pose: { id: m.pose.id, label: m.pose.label } } : {}) };
}

/** A stored motion, validated and normalised (undefined: not one). The ranges are the workspace reader's (CORE-96). */
export function sceneMotionOf(value: unknown): SceneMotion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const m = value as Record<string, unknown>;
  if (!bool(m.idle) || !finite(m.idleTime, 0, Number.MAX_SAFE_INTEGER) || !bool(m.idlePaused) || !bool(m.idleBody) || !bool(m.idleFace) ||
    !finite(m.blink, 0, 1) || !bool(m.blinkPlaying) || (m.idleClip !== undefined && !validIdleClip(m.idleClip))) return undefined;
  const pose = m.pose === undefined ? undefined : storedPoseOf(m.pose);
  if (m.pose !== undefined && !pose) return undefined;
  return normalised({ idle: m.idle, idleTime: m.idleTime, idlePaused: m.idlePaused, idleBody: m.idleBody, idleFace: m.idleFace, blink: m.blink,
    blinkPlaying: m.blinkPlaying, ...(m.idleClip === undefined ? {} : { idleClip: m.idleClip as string }), ...(pose ? { pose } : {}) });
}

/** The motion settings as the person knows them (the Motion controls' sections), for a plain note when one is reset. */
export const MOTION_SETTING_NAMES = Object.freeze({ idle: "game idle", blink: "blink", pose: "pose" });
type MotionSetting = keyof typeof MOTION_SETTING_NAMES;

/**
 * A stored motion as a reader recovers it: each damaged field at its default (a damaged idle choice or pose left out), so one bad value never
 * costs the scene or the graph (undefined: not a motion at all, which a reader leaves out). Edits are refused by `sceneMotionOf` instead.
 * `reset` hears each setting that had a damaged value and was reset (an absent idle choice or pose is not damage).
 */
export function recoverSceneMotion(value: unknown, reset?: (setting: MotionSetting) => void): SceneMotion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const m = value as Record<string, unknown>, d = DEFAULT_MOTION;
  const pick = <T>(setting: MotionSetting, ok: boolean, stored: unknown, fallback: T): T => { if (ok) return stored as T; reset?.(setting); return fallback; };
  const pose = storedPoseOf(m.pose);
  if (m.pose !== undefined && !pose) reset?.("pose");
  if (m.idleClip !== undefined && !validIdleClip(m.idleClip)) reset?.("idle");
  return normalised({ idle: pick("idle", bool(m.idle), m.idle, d.idle), idleTime: pick("idle", finite(m.idleTime, 0, Number.MAX_SAFE_INTEGER), m.idleTime, d.idleTime),
    idlePaused: pick("idle", bool(m.idlePaused), m.idlePaused, d.idlePaused), idleBody: pick("idle", bool(m.idleBody), m.idleBody, d.idleBody),
    idleFace: pick("idle", bool(m.idleFace), m.idleFace, d.idleFace), blink: pick("blink", finite(m.blink, 0, 1), m.blink, d.blink),
    blinkPlaying: pick("blink", bool(m.blinkPlaying), m.blinkPlaying, d.blinkPlaying), ...(validIdleClip(m.idleClip) ? { idleClip: m.idleClip } : {}),
    ...(pose ? { pose } : {}) });
}

/** The motion a workspace's legacy `preview` fields hold (as `parseWorkspace` read them): what a scene stored before the move takes, once. */
export function previewMotion(preview: Pick<PreviewState, "idle" | "idleTime" | "idlePaused" | "idleBody" | "idleFace" | "blink" | "blinkPlaying" |
  "idleClip" | "pose">): SceneMotion {
  return normalised({ idle: preview.idle, idleTime: preview.idleTime, idlePaused: preview.idlePaused, idleBody: preview.idleBody, idleFace: preview.idleFace,
    blink: preview.blink, blinkPlaying: preview.blinkPlaying, ...(preview.idleClip === undefined ? {} : { idleClip: preview.idleClip }),
    ...(preview.pose ? { pose: preview.pose } : {}) });
}

/** A motion with `changes` applied, normalised (a pose or idle set to undefined is removed). */
export function withMotion(motion: SceneMotion, changes: Partial<SceneMotion>): SceneMotion {
  const next: SceneMotion = { ...motion, ...changes };
  if (next.pose === undefined) delete next.pose;
  if (next.idleClip === undefined) delete next.idleClip;
  return normalised(next);
}

/**
 * Where the motion service keeps a scene's motion settings, and reaches its other scene settings: the drawn view's scene node in the view
 * graph (`graphMotionScene`, app/trusted-preview-services.ts), or a private store (`localMotionScene`) for a service with no graph.
 */
export type MotionScene = {
  /** The drawn scene's motion settings (the default motion while its node holds none). */
  motion(): SceneMotion;
  /**
   * Store the drawn scene's motion settings: the device already shows them, so nothing is applied again.
   * `sample`: the device's live state read for a save in progress (the idle's phase): kept without publishing a change.
   */
  setMotion(motion: SceneMotion, options?: { sample?: boolean }): void;
  /** Whether a view's scene simulates its dangles, and turning it on or off (a recorded scene setting). */
  physics(view?: string): boolean;
  setPhysics(enabled: boolean, view: string): void;
};

/** A motion scene of its own (fixtures, a service with no view graph): plain data, starting at `motion`. */
export function localMotionScene(motion: Partial<SceneMotion> = {}, physics = false): MotionScene {
  let stored = withMotion({ ...DEFAULT_MOTION }, motion), on = physics;
  return { motion: () => ({ ...stored, ...(stored.pose ? { pose: { ...stored.pose } } : {}) }), setMotion: next => { stored = withMotion(next, {}); },
    physics: () => on, setPhysics: enabled => { on = enabled; } };
}
