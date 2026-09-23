# Full baked-frame idle contact gate for the packed crease candidate

24 September 2026. **The retained research candidate fails the denser animation gate.** The [post-packing checkpoint](postpack-crease-checkpoint.md) passed 107 static cases and 73 selected idle poses. Sampling every baked 30 Hz facial frame of that same decoded character-creator idle finds three **new nonadjacent plate/head triangle contact occurrences** in two previously untested frames. The owned plate master, package and game files were not changed.

The focused sampler uses the same hash-verified body and facial GLBs, saved five-morph combination, `IdleAnimation` composition, restored full skin weights and Three.js skinning as the original 73-pose sampler. It exports all 7,186 head positions and the 1,635 mapped-vertex affine skin matrices at frames 0–663, then applies those matrices to the **final serialized** candidate's plate/head residual. Every one of the original 73 head-position and matrix samples agrees **exactly** (maximum component difference 0). The one-head sampler maps 254 bones; the previous four-surface sampler counted the same bindings four times (1,016).

| Gate | Result |
|---|---:|
| Frames checked | 664 at 30 Hz, 0–663 (0–22.1 s) |
| Original samples reproduced | 73/73, exact positions and affine matrices |
| Frames with new nonadjacent contacts | **2: 298 and 299** (9.933 and 9.967 s) |
| New pair occurrences | **3**: two at frame 298, one at frame 299 |
| Other frames with new contacts | 0/662 |
| Candidate status | **Fails denser contact gate; research only** |

The three pairs are plate face 792/head face 2421 and plate face 800/head face 1987 at frame 298; plate face 793/head face 2421 at frame 299. Their plate vertices lie in the narrow crease region around vertices 118/119/156/322. A separate finite-triangle separating-axis calculation has maximum interval gaps of **−2.513, −1.372 and −1.488 µm**, respectively (negative on every tested axis means overlapping intervals). The corresponding native head face pairs have positive separating gaps of **1.723, 5.094 and 0.795 µm**. This independently confirms that the three contacts are introduced by the candidate rather than inherited head self-intersections. The [machine-readable report](dense-idle-contact-gate.json) lists face/vertex IDs, every frame count, hashes and precise values.

The packed candidate GLB SHA-256 is `8f37b8a91f0a502ba8d586b5077c70dfce58f16fd76cc5593bef74aa460c6646`; its mesh and morph resource hashes match the post-packing checkpoint. The dense position and affine files are ignored local research data, with SHA-256 `2525a6ff36953b5149778a864853ebd5dad6cf4e9c71eac692f6af23319f8628` and `a0f951850b0f8229794f5ad1c19e6115c31aac541c9abacdee4c08d7b3c59e7c`. The tracked report SHA-256 is `09643b780e737db88b6fd67516e87009c067aa217dd7e620d0e18a2b4212440f` before any later documentation edits.

## Reproduction

From this worktree, with the original ignored source build, packed candidate build and idle assets preserved at the indicated local paths:

```powershell
cd D:/Dev/worktrees/plate-animation-gate/projects/xf-appearance-studio/authoring
bun install --frozen-lockfile
bun tools/sample_plate_dense_idle.ts D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/build-1790134714546030800 D:/Dev/cp2077-modding-hq/projects/xf-appearance-studio/authoring/public/assets D:/Dev/worktrees/plate-animation-gate/experiments/006-plate-clearance/generated/dense-idle
cd D:/Dev/worktrees/plate-animation-gate
python experiments/006-plate-clearance/research/verify_dense_idle.py --source-build D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/build-1790134714546030800 --candidate-build D:/Dev/worktrees/plate-postpack/experiments/006-plate-clearance/generated/roundtrip-crease-1790203305131926200 --dense D:/Dev/worktrees/plate-animation-gate/experiments/006-plate-clearance/generated/dense-idle --output experiments/006-plate-clearance/research/dense-idle-contact-gate.json
```

The verifier asserts source/head/animation and candidate resource hashes, exact 73-frame overlap, and separate SAT evidence for each reported contact. It uses the existing all-pair grid/narrow-phase contact checker and excludes source-adjacent pairs and native head intersections. The result is limited to the decoded adapter, the baked 30 Hz frames and one saved morph combination. It does not prove collision at all times between frames, the live REDengine animation graph, or visible in-game artifacts. The newly failed finite gate already prevents promotion; further unsampled or runtime uncertainty does not soften that result. No new community tool or technique informed this check beyond the already credited WolvenKit, Blender IO Suite and Three.js pipeline.
