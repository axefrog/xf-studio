# Expanded plate import

Rebuild the owned plate as actual game mesh and morph resources, without the legacy material matrix or any deployment. Source provenance and topology are in the [lineage record](../../research/eye-artistry/lineage.md).

## Pipeline

`python experiments/004-plate-import/run.py` from HQ exports the owned Blender master, exports the freshly extracted game head, retains corresponding game shading, prepares reduced resource templates, imports the mesh, packs a local bone-map resolver archive, imports the morph resource and compares a GLB round trip. It requires the installed Blender/WolvenKit/.NET toolchain, Python with NumPy and the local game extractions/JSON recorded by `template-preparation.json`. It writes only HQ experiment/project outputs. Nothing is installed into the game or MO2.

- Dense morph accessors avoid the installed SharpGLTF sparse-only POSITION accessor failure.
- The project-local WolvenKit adapter loads a mesh-only resolver archive: stock CLI morph import does not load archives and therefore lacks the required bone-name mapping.
- Templates come from the freshly extracted full head, with its 254 bones; the old small makeup mesh lacks 15 bones weighted by the expanded plate.
- One `xfas_plate_reference` appearance and one authoritative `mesh_decal.mt` material replace the head's material catalogue. Texture morph data for head skin is removed; geometric morphs are rebuilt against the plate.
- The source Displace is omitted in the neutral master. Layer separation and skin clearance are separate pending experiments.

## Shading correction

The first successful import preserved positions, UVs, 105 morphs and eight influences, but clipped 108 normal and 23 tangent morph components outside [-1,1]. WolvenKit packs these as shifted 10-bit values. The [initial comparison](blender-normal-baseline.json) records maximum errors of 0.649 and 0.819 in those deltas.

Because the plate is an exact head cut-out, `retain_head_shading.py` can preserve original game lighting vectors. It requires unique correspondence by position plus BOTH UV sets for every exported vertex and checks every customization position delta. It transfers base normal/tangent and all corresponding normal/tangent morph deltas, leaving geometry, UVs and weights untouched. This is a gated export adaptation, not a general sculpt-transfer algorithm. [Transfer evidence](head-shading-transfer.json).

`roundtrip-comparison.json` records the current numeric result; `build-evidence.json` identifies generated resources. `plate-export.json` identifies the Blender-only intermediate; `head-shading-transfer.json` identifies the corrected game input. The intake manifest's initial GLB hash is historical.

The corrected round trip preserves all morph normal/tangent deltas exactly. Maximum base position error is 3.80e-6 units; maximum morph position error is 1.26e-5. Both UV sets and triangle indices are identical. All 122 weighted bones and eight influences survive; maximum per-bone weight error is 0.00433 after packing/normalization. Automated acceptance bounds now reject the original clipped-lighting result.

## Still to prove

`python experiments/004-plate-import/verify_binding_clearance.py` now checks equivalent rig world/inverse-bind transforms by bone name, rather than requiring identical orphan-bone hierarchy. [Evidence](binding-clearance.json): maximum world-transform element error 8.67e-8, inverse-bind error 1.19e-7, and rest-skinning identity errors below 7.60e-8. Those numeric binding checks pass.

The zero-offset plate has no intentional clearance from its source head. Comparing corresponding vertex tangent planes across Basis, all 105 individual morphs and the saved five-morph combination found a minimum signed distance of -1.55e-5 units after packing. Thus quantization can put some vertices slightly beneath the head. Preserve this neutral control and build a controlled outward-offset candidate; this measurement is not a complete triangle-intersection or animated-contact test.

Closed/open eyelid clearance, posed overlap/intersections, deterministic material layering and actual in-game shading remain to prove. Some eye morphs rotate narrow faces through more than 90 degrees; this also comes from the parent head and is not alone evidence of broken geometry. One dropped secondary vertex-colour set also requires semantic review. Serialization and numeric agreement do not prove runtime rendering.

[Experiment 006](../006-plate-clearance/README.md) now builds two normal-offset strategies and samples the converted surfaces through the idle, including eyelid extrema. It confirms all 3,010 plate triangles correspond exactly to the head. Offsets reduce overlap greatly, but residual crease/corner contacts remain and a larger offset can introduce new contacts. No release offset has been selected; the neutral master remains the control.

No topology edits have been justified yet. Nathan authorizes necessary remediation while preserving source art and design intent.
