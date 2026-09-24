# Isolated eye and lip lighting comparison — 24 September 2026

`/render-fidelity-study.html` is a separate, static-pose browser experiment. It never loads the collection editor, its draft, or its storage. Both panes use the same local `head.glb`, cropped Blender-master skin colour/normal/roughness, exact hash-verified Kala eye-16 diffuse/roughness, camera, key/fill lights, room environment and exposure. The left pane holds the present browser material. Only the labelled right-pane term changes. The head/eye material setup follows `src/scene.ts`; the full-weight skinning adapter is reused. This is a comparison of **browser inputs**, not a reconstruction of a REDengine material.

The five paired browser PNG captures are local, ignored evidence at `screenshots/xfs-render-study-*.png`; they contain game/mod-derived pixels and are not committed. Capture resolution is 1564×1230, with 782×1230 panes. Lip captures used neutral pose, 30° vertical FOV, 1.20 exposure, key angle −31°, camera target y=1.55 and distance 0.44. Eye captures used target y=1.67, x=−0.036, distance 0.44 with the same light and exposure. Both views were inspected in Chrome, not a game session. The final page uses 0.44 as its default distance.

| Capture filename suffix | SHA-256 |
|---|---|
| `lip-uniform-roughness.png` | `6cc3d79ec71b42aa04bcd27280945378a4ea1bff98435347e72c2c3659686f0d` |
| `lip-flat-normal.png` | `90dc7e70b7aceb60e1d7e48e65ca8791e5918b098aa2e5daaeb4496626ef6475` |
| `lip-no-environment.png` | `b18e49fe3788b12fbe5783e93b7270f10768ec1a50d3211ca9cead65bac8be04` |
| `eye-roughness-red.png` | `b0b8889779a7fb000eeed149c1e5babbe2c86d6a1e363bddfaf27f4914f0d150` |
| `eye-roughness-green.png` | `80af0fe69a4321e91cbbd222bf90a108ded7d7c53bda39f3fcbc1d52d9042f7c` |

## Observed browser result

- The baseline has a bright, narrow, near-white lower-lip highlight. With the right pane's **uniform roughness 0.85** and the same lighting, the highlight disappears; the mauve lip colour and dark mouth gap remain. In a fixed 265×67 capture crop over the lip (`x=260..524, y=145..211` within each pane), pixels with all RGB channels above 220 change from **182 baseline to 0**. This implicates the current skin roughness map in the browser artifact at this pose and light. It does not justify raising every skin pixel's roughness in production.
- Turning off the head normal map leaves that bright line visually present; the same threshold gives 182 baseline versus 183 in the right pane. The map changes broader shading and fine surface response, so this is a controlled rejection of *the normal map alone* as the source of this particular bright line. It does not establish that the mesh normals or mouth geometry are correct.
- Removing the room environment reduces that threshold count from 182 to 23, but also darkens the entire face. Three's environment contributes diffuse as well as specular lighting; the experiment labels this as removing **all image-based lighting**, not a pure specular isolation.
- The exact saved-eye roughness map read as R or G at the recorded 0.493 scale makes a small visible change against constant browser roughness 0.18 under this fixed view. The R and G right-pane captures differ by less than 0.002 mean 8-bit levels per channel over the full pane, while their left baseline panes are byte-identical. The source channel decision still follows the inspected game shader's **R** read; the near-identical browser pictures do not validate G or establish eye material parity.

## Limits and next gate

The reference head is neutral and uses the old Blender-master tile, rather than the saved `skin_type_05` material and saved morphs. The page renders neither inner-mouth components nor the game's skin translucency. The saved eye normal was not available in the verified local manifest, so this page does not invent a normal/bubble/refraction approximation. The game's eye shader uses a distinct UV transform and eye-specific normal path; a roughness-map switch cannot explain the full “waxy” report. The user-supplied screenshots are a separate visual reference, and no matched game screenshot or runtime material winner was established here.

Next, resolve the effective saved skin and mouth resource chain, then compare a matched game view at controlled pose/camera/light. For the browser, investigate the lip-region roughness encoding and its multiplication/filtering before changing the skin material. For eyes, stage a hash-verified packed normal only after its side/tangent mapping can be tested on both eyes and through gaze.

**Provenance for the parent checkpoint:** existing `docs/community-credits.md` entries for CD PROJEKT RED resources, Kala / guidethisonekalaheria, nutboy / brocreate, WolvenKit contributors and Three.js contributors need the additional concrete lessons from this comparison. The exact source/use distinction and links are in `research/eye-artistry/eye-lip-optics-audit.md`; no third-party pixels, code or extracted resource was added to Git.

Verification in the isolated worktree: TypeScript check and browser build pass; 251 Bun tests pass after staging the ignored local brow/lash GLBs required by two existing asset tests. Chrome displayed both comparisons without a shader or asset-load error. No game launch or install occurred.
