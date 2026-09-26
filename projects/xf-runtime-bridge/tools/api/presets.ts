// Named photo-mode camera presets, expanded by the command API into photo.camera.set values.
// Kept here (data, not DLL code) so the first in-game session can tune them without a rebuild.
//
// Photo mode has no camera position setter (research/runtime/runtime-bridge-design.md §7.3):
// the camera orbits V, and framing comes from the field of view plus V's own placement
// relative to the camera (the pose tab's rotation and offsets). These starting values assume
// photo mode's default framing (camera behind V, V facing away): turning V 180 degrees faces the
// camera, and a narrow field of view fills the frame with the head. They are UNCALIBRATED until
// session 1 checks them with captures; `calibrated` says so in every result.

export type CameraPreset = {
  description: string;
  params: Record<string, unknown>;
  calibrated: boolean;
};

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  face: {
    description: "V's face filling most of the frame, facing the camera.",
    params: { fov: 15, subject: { yaw: 180 } },
    calibrated: false,
  },
  eyes: {
    description: "A tight close-up of V's eyes, facing the camera.",
    params: { fov: 6, subject: { yaw: 180 } },
    calibrated: false,
  },
  "head-and-shoulders": {
    description: "V's head and shoulders, facing the camera.",
    params: { fov: 30, subject: { yaw: 180 } },
    calibrated: false,
  },
  "face-left": {
    description: "The face close-up with V turned 30 degrees to one side (a light sweep uses a series of these).",
    params: { fov: 15, subject: { yaw: 150 } },
    calibrated: false,
  },
  "face-right": {
    description: "The face close-up with V turned 30 degrees to the other side.",
    params: { fov: 15, subject: { yaw: -150 } },
    calibrated: false,
  },
  "open-defaults": {
    description: "Every camera and V-placement setting back to what photo mode opened with.",
    params: { reset: true },
    calibrated: true,
  },
};

/** Merges a preset with explicit values (explicit values win; subject fields merge). */
export function expandCamera(input: Record<string, unknown>): Record<string, unknown> {
  const { preset, ...rest } = input;
  if (preset === undefined) return rest;
  const base = CAMERA_PRESETS[preset as string];
  if (!base) throw new Error(`unknown camera preset "${String(preset)}"`);
  if (base.params.reset) {
    if (Object.keys(rest).length) throw Object.assign(new Error("The open-defaults preset can't be combined with other values."), { plain: { code: "bad_input", message: "The open-defaults preset can't be combined with other values." } });
    return { reset: true };
  }
  const subject = { ...(base.params.subject as object | undefined), ...(rest.subject as object | undefined) };
  return { ...base.params, ...rest, ...(Object.keys(subject).length ? { subject } : {}) };
}
