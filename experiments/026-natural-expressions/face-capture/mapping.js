// ARKit-style blendshape coefficients (the 52 names MediaPipe Face Landmarker outputs) to V's main-pose controls.
// Experiment 026 (research/animation/natural-expressions.md, "ARKit to CP2077"). Weights are ours, from the control atlas and the
// round-trip test; `S` stands for the side (l or r). A blendshape's Left/Right is the subject's own side when `swapSides` is false.

/** blendshape -> [[control, weight], ...]; `S` is replaced by the blendshape's side, both sides for a centre blendshape. */
export const ARKIT_TO_CP2077 = {
  browDownLeft: [["eye_S_brows_lower", 0.8], ["eye_S_brows_lateral", 0.6]],
  browDownRight: [["eye_S_brows_lower", 0.8], ["eye_S_brows_lateral", 0.6]],
  browInnerUp: [["eye_l_brows_raise_in", 1.2], ["eye_r_brows_raise_in", 1.2]],
  browOuterUpLeft: [["eye_S_brows_raise_out", 1]],
  browOuterUpRight: [["eye_S_brows_raise_out", 1]],
  cheekPuff: [["cheek_l_puff", 1], ["cheek_r_puff", 1]],
  cheekSquintLeft: [["eye_S_oculi_squint_outer_lower", 1], ["eye_S_oculi_squint_outer_upper", 0.35]],
  cheekSquintRight: [["eye_S_oculi_squint_outer_lower", 1], ["eye_S_oculi_squint_outer_upper", 0.35]],
  // A fully closed V eye reads as about 0.5 (round trip), so blink is doubled; neutral correction removes the resting value.
  eyeBlinkLeft: [["eye_S_blink", 1.8]],
  eyeBlinkRight: [["eye_S_blink", 1.8]],
  eyeLookDownLeft: [["eye_S_dir_dn", 1]],
  eyeLookDownRight: [["eye_S_dir_dn", 1]],
  eyeLookInLeft: [["eye_S_dir_in", 1]],
  eyeLookInRight: [["eye_S_dir_in", 1]],
  eyeLookOutLeft: [["eye_S_dir_out", 1]],
  eyeLookOutRight: [["eye_S_dir_out", 1]],
  eyeLookUpLeft: [["eye_S_dir_up", 1]],
  eyeLookUpRight: [["eye_S_dir_up", 1]],
  // eyeSquint mixes AU6 and AU7; mapBlendshapes splits it by how much the mouth smiles (see SQUINT below).
  eyeSquintLeft: [],
  eyeSquintRight: [],
  eyeWideLeft: [["eye_S_widen", 1.5]],
  eyeWideRight: [["eye_S_widen", 1.5]],
  jawForward: [["jaw_mid_shift_fwd", 1]],
  jawLeft: [["jaw_mid_shift_l", 1]],
  jawRight: [["jaw_mid_shift_r", 1]],
  jawOpen: [["jaw_mid_open", 0.8]],
  mouthClose: [["lips_together_up", 1], ["lips_together_dn", 1]],
  mouthDimpleLeft: [["lips_S_corner_wide", 1]],
  mouthDimpleRight: [["lips_S_corner_wide", 1]],
  mouthFrownLeft: [["lips_S_corner_dn", 1]],
  mouthFrownRight: [["lips_S_corner_dn", 1]],
  mouthFunnel: [["lips_l_funnel", 1], ["lips_r_funnel", 1]],
  mouthLeft: [["lips_mid_shift_l", 1]],
  mouthRight: [["lips_mid_shift_r", 1]],
  mouthLowerDownLeft: [["lips_apart_dn", 0.5], ["lips_S_lower_raise", 0.5]],
  mouthLowerDownRight: [["lips_apart_dn", 0.5], ["lips_S_lower_raise", 0.5]],
  mouthPressLeft: [["lips_tighten_up", 0.5], ["lips_tighten_dn", 0.5], ["lips_suck_up", 0.1], ["lips_suck_dn", 0.1]],
  mouthPressRight: [["lips_tighten_up", 0.5], ["lips_tighten_dn", 0.5], ["lips_suck_up", 0.1], ["lips_suck_dn", 0.1]],
  mouthPucker: [["lips_l_purse", 1], ["lips_r_purse", 1]],
  mouthRollLower: [["lips_suck_dn", 1]],
  mouthRollUpper: [["lips_suck_up", 1]],
  mouthShrugLower: [["lips_chin_raise", 1]],
  mouthShrugUpper: [["lips_mid_shift_up", 0.5]],
  mouthSmileLeft: [["lips_S_corner_up", 0.9], ["lips_S_corner_sharp_up", 0.5], ["lips_S_nasolabialDeepener", 0.4], ["lips_apart_up", 0.3]],
  mouthSmileRight: [["lips_S_corner_up", 0.9], ["lips_S_corner_sharp_up", 0.5], ["lips_S_nasolabialDeepener", 0.4], ["lips_apart_up", 0.3]],
  mouthStretchLeft: [["lips_S_corner_stretch", 0.8], ["lips_S_stretch", 0.3]],
  mouthStretchRight: [["lips_S_corner_stretch", 0.8], ["lips_S_stretch", 0.3]],
  mouthUpperUpLeft: [["lips_S_upper_raise", 1], ["lips_apart_up", 0.3]],
  mouthUpperUpRight: [["lips_S_upper_raise", 1], ["lips_apart_up", 0.3]],
  noseSneerLeft: [["nose_S_snear", 1]],
  noseSneerRight: [["nose_S_snear", 1]],
  // tongueOut: MediaPipe's model card says the FaceMesh model predicts it; not mapped (the preview can't show the tongue well).
};

/** Region of a control, for per-region gain. */
export const regionOf = name => /brows/.test(name) ? "brows" : /^eye_.*_dir_/.test(name) ? "gaze" : /^eye_/.test(name) ? "eyes"
  : /^(nose|cheek)_|nasolabial/.test(name) ? "mid" : "mouth";

/**
 * Map one frame of blendshape scores to a sparse control vector.
 * @param {Record<string, number>} scores blendshape name -> score (already smoothed and neutral-corrected)
 * @param {{ swapSides?: boolean, gain?: number, regionGain?: Record<string, number>, floor?: number }} options
 */
export function mapBlendshapes(scores, options = {}) {
  const { swapSides = false, gain = 1, regionGain = {}, floor = 0.02 } = options;
  const out = {};
  // SQUINT: MediaPipe's eyeSquint answers to both the cheek raiser (AU6, a smile's narrowed eyes) and the lid tightener (AU7, a
  // frown's). While the mouth smiles, the squint goes to the cheek raiser; otherwise to the lid tightener.
  const smile = Math.min(1, Math.max(scores.mouthSmileLeft ?? 0, scores.mouthSmileRight ?? 0) * 1.6);
  for (const side of ["Left", "Right"]) {
    const score = scores[`eyeSquint${side}`];
    if (!(score > 0)) continue;
    let s = side === "Left" ? "l" : "r";
    if (swapSides) s = s === "l" ? "r" : "l";
    out[`eye_${s}_oculi_squint_outer_lower`] = (out[`eye_${s}_oculi_squint_outer_lower`] ?? 0) + score * (0.3 + 1.3 * smile);
    out[`eye_${s}_oculi_squint_outer_upper`] = (out[`eye_${s}_oculi_squint_outer_upper`] ?? 0) + score * 0.5 * smile;
    out[`eye_${s}_oculi_squint_inner`] = (out[`eye_${s}_oculi_squint_inner`] ?? 0) + score * (1 - 0.5 * smile);
  }
  for (const [shape, targets] of Object.entries(ARKIT_TO_CP2077)) {
    const score = scores[shape];
    if (!(score > 0)) continue;
    let side = shape.endsWith("Left") ? "l" : shape.endsWith("Right") ? "r" : null;
    if (side && swapSides) side = side === "l" ? "r" : "l";
    for (const [pattern, weight] of targets) {
      const names = pattern.includes("_S_") ? (side ? [pattern.replace("_S_", `_${side}_`)] : [pattern.replace("_S_", "_l_"), pattern.replace("_S_", "_r_")]) : [pattern];
      for (const name of names) out[name] = (out[name] ?? 0) + score * weight;
    }
  }
  const controls = {};
  for (const [name, value] of Object.entries(out)) {
    const v = Math.min(1, value * gain * (regionGain[regionOf(name)] ?? 1));
    if (v >= floor) controls[name] = Math.round(v * 1000) / 1000;
  }
  return controls;
}

/** Subtract a captured neutral face and re-stretch the remaining range, per blendshape (a common retargeting step). */
export function neutralCorrect(scores, neutral) {
  if (!neutral) return scores;
  const out = {};
  for (const [name, value] of Object.entries(scores)) {
    const base = neutral[name] ?? 0;
    out[name] = base >= 0.95 ? 0 : Math.max(0, (value - base) / (1 - base));
  }
  return out;
}
