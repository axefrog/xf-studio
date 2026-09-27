/**
 * Do V's neck and head controls move the head? Solves each at weight 1 with the live facial solver (lib.ts) and reports how far the
 * nose tip, chin and glabella move. They don't: these controls deform neck and jaw-line skin only (research/animation/natural-expressions.md §3.2).
 *
 *     bun experiments/026-natural-expressions/head-controls.ts --server http://127.0.0.1:4463
 */
import { displacement, face, index, solve } from "./lib";

const probes = { nose: index("mid_J_mug_nose_tip_rowA_0_JNT"), chin: index("mid_J_mug_chin_rowA_0_JNT"), glabella: index("mid_J_eye_brows_rowC_0_JNT") };
for (const control of ["neck_l_turn", "neck_r_turn", "neck_up_turn", "neck_dn_turn", "neck_l_tilt", "neck_r_tilt", "head_neck_up_turn", "head_neck_dn_turn",
  "head_neck_l_tilt", "head_neck_r_tilt"]) {
  const d = displacement(await solve({ [control]: 1 }));
  console.log(control.padEnd(20), Object.entries(probes).map(([name, i]) => {
    const v = face(d[i]!); return `${name} L${v.left.toFixed(1)} U${v.up.toFixed(1)} F${v.fwd.toFixed(1)}`; }).join(" | "));
}
