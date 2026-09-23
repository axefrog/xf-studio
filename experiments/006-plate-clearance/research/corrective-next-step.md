# Separating offset transport from folded-surface contacts

2026-09-23. Diagnostic research only; no resource or master changed, no release candidate selected.

The next useful geometry experiment is a **bounded, pose-aware displacement feasibility test**, not another larger constant normal offset. New counterfactual measurements show two distinct problems: transporting a rest/customization-space offset through the eyelid animation does not keep it aligned with the deformed surface, and the deformed head itself contains folds where a smooth outward shell remains difficult even with an ideal post-animation correction.

## New evidence

`python experiments/006-plate-clearance/probe_posed_correction.py` reads the retained-weight build `generated/build-1790134714546030800`, its original head, exact plate-to-head mapping and previously sampled positions. It runs the existing contact/half-space synthetic checks, then compares:

- the actual converted plate;
- an **oracle** placed at the exact deformed head vertices plus angle-weighted normals freshly recomputed from the deformed full head;
- an oracle using shortest displacement outside all incident triangle planes, with explicit 4×, 5× and 8× displacement budgets. Unresolved/over-budget vertices retain the previous normal oracle, rather than being silently clamped or deleted.

These oracles remove position packing error, morph-offset approximation and pre-skin offset transport from the construction. They are not available animated game assets and are not an implementation proposal on their own. Original triangle topology is retained in every comparison; no triangles are removed. The 4×/5×/8× values are experimental budgets, not approved art tolerances.

The existing representative-frame selector yields frames 0 and 25 for both retained-weight candidates: first pose and the sampled worst/closure pose. All numbers below count intersecting **triangle pairs**, not pixels or distinct plate triangles.

| Amount | Frame | Actual | Posed normal oracle | 4× constrained oracle | 5× constrained oracle | 8× constrained oracle |
|---|---:|---:|---:|---:|---:|---:|
| 0.00005 | 0 | 14 | 14 | 6 | 0 | 0 |
| 0.00005 | 25 | 167 | 67 | 47 | 43 | 43 |
| 0.0001 | 0 | 14 | 14 | 6 | 0 | 0 |
| 0.0001 | 25 | 161 | 65 | 45 | 45 | 45 |

At frame 0 the constrained solution needs at most **4.15721354×** the requested amount; two vertices exceed 4×, none are numerically unresolved. The 5× result has every plate vertex outside its own source-triangle plane by at least the requested amount and has no detected head contacts in this one pose. Thus the previous four-times cutoff partly hid a small, bounded corner correction opportunity. It does not justify the unbounded 151× static-shape extrusion from the earlier audit.

At frame 25 one constrained vertex is unresolved and six finite solutions exceed 4×; the maximum finite multiplier is **49.48559418×**. Six actual plate displacement vectors point opposite the freshly computed posed geometric normal. The maximum disagreement is **102.24°** for 0.00005 and **98.63°** for 0.0001. The broad improvement from 167→67 / 161→65 therefore gives a practical reason to investigate pose-aware directions, rather than concentrating only on resource packing.

For 0.00005 at frame 25, the actual plate has 136 contact pairs involving source-adjacent triangles and 31 non-adjacent pairs. The posed-normal oracle has only 35 adjacent pairs, but **32 non-adjacent pairs**: 19 already intersect in the native head and 13 are newly intersecting. After the 5× constrained oracle, 43 pairs remain: 14 adjacent, 16 pre-existing non-adjacent folds and 13 new non-adjacent contacts. For 0.0001 the 5× oracle retains 45 pairs, including 14 pre-existing and 15 new non-adjacent contacts. Direction correction cannot be treated as a solution for all crease contacts.

Local output: `generated/build-1790134714546030800/posed-correction-probe.json`, SHA-256 `f4f8d9285b0f0cf17074d57a543e6988d3c6c877550f8df6b22e35386f81eae1`. It records input hashes, exact per-variant contact pairs and summary counts. Generated output is ignored; this note preserves the useful measurements.

## What this distinguishes

- **Original triangulation mismatch is not the cause:** every tested plate triangle still maps to its original head triangle. Splitting/retriangulating would be a new design choice, not a correction of an established mismatch.
- **Native weight re-quantization was real but insufficient:** both retained resource buffers now match the head, as established by the preceding paired audit. The new oracles demonstrate substantial residual contact even without offset resource conversion.
- **Pre-skin offset construction matters during closure:** geometric normals of a skin-deformed triangle surface are not obtained simply by transporting a precomputed offset. Customization also combines position morphs, whereas the current build combines individually normalized offset directions. This probe does not independently apportion the error between those two operations and packing.
- **Lighting normal/tangent differences are not causing these numerical intersections:** the oracle query uses positions and triangle winding only. Shading can still change their perceived appearance and must remain a separate fidelity check.
- **Some folds are native; not all new contacts can be dismissed as native folds.** The oracle still creates non-adjacent contacts. Earlier visibility evidence covers the actual candidates, not these new oracles; do not reuse its exposed-pair counts for the oracle geometry.

## Concrete next experiment

Keep the neutral and current retained-weight resources unchanged. Build a diagnostic pose-aware feasibility solver for the saved five-morph configuration before another WolvenKit import:

1. Export the effective **3×3 linear skin transform per mapped head vertex** at each of the existing 73 sample phases, using the same verified native weights and animation adapter. Check reconstruction against the existing sampled position files. This provides the actual mapping from a small pre-skin positional correction to its posed displacement.
2. Solve for a fixed pre-skin displacement at each mapped vertex against incident head triangle planes **across all those poses**, starting from the 0.00005 candidate. Use a magnitude bound of 0.00025 (the new 5× diagnostic budget), with a conservative adjacent-vertex smoothness constraint so a feasible solution does not create a sharp spike. Derive constraints in posed space and pull them back through the measured matrices. Do not substitute a solution independently changing per animation frame: that is only the oracle tested here.
3. Report infeasible/unresolved vertices and the minimum necessary constraint relaxation explicitly. The frame-25 oracle already predicts that a strictly positive shell everywhere is unlikely under this budget. Separate this failure region from the readily corrected first-pose corner region; preserve the full plate coverage and do not silently remove the difficult vertices/triangles.
4. Evaluate any feasible bounded correction with the exact full-head triangle query at all 73 poses, including non-adjacent pairs; then rerun visibility for the resulting candidate. A positive local plane margin is necessary for that local construction, not sufficient for clearance. If the bounds fail, stop before importing and document the smallest problem region plus its neutral UV footprint; this is the evidence needed to decide between a specifically authored crease correction and a different decal depth strategy.
5. Only after an actual fixed correction survives should it be generalized to the 105 morphs and customization combinations, converted through both mesh/morph buffers and independently retested. A saved-V-only successful fit is not a universal plate repair.

This is preferable to immediately building more offset variants because it first asks whether the chosen asset representation can meet the intended clearance while staying within a small, explicit shape budget. It can yield a bounded fixed correction or a concrete infeasibility result; either changes the next engineering decision. It does not require a game launch.

## Limits and provenance

This is an offline, two-pose counterfactual using the current saved shape and sampled animation adapter, not a continuous collision proof or a game graph/shader result. No new visibility sampling was performed. Numerical half-space failure does not alone prove mathematical impossibility. The 5× static result does not override the failed multi-shape and animated evidence.

The new probe and interpretation are project work. It builds on the already credited WolvenKit serialization, Cyberpunk Blender IO Suite facial bake and Three.js/full-influence pose sampler described in [the experiment](../README.md) and [the community learning record](../../../docs/community-credits.md). No new external code or assets were copied during this probe.
