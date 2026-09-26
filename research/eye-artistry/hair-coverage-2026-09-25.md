# Hair coverage and the theme-dependent hair colour (25 September 2026)

**Question.** Saved hair in the 3D preview looked much lighter in the light UI theme than in the dark one, and thinner than in game. A dark, jagged patch also showed at the parting. Why, and what does the game's coverage actually do?

**Answer.** The page showed through the hair. The fix is an opaque canvas with the stage drawn in the scene, plus coverage that follows the game's shared-threshold dither. The jagged parting was the hair cap's alpha test. Current truth lives in [hair shading §2 and §8](../../knowledge/hair-shading.md#2-passes); this note keeps the evidence.

## 1. Cause of the theme dependence [observed]

- Three.js 0.186 always creates its WebGL context with `alpha: true` (`WebGLRenderer.js`, context attributes). Its `alpha: false` option only changes the clear alpha. A live check of the Studio canvas reported `getContextAttributes().alpha === true`.
- The strands used MSAA alpha-to-coverage and the cap an opaque alpha-tested material. Both wrote their partial alpha into the drawing buffer, even over the head. The browser composites the canvas over the page, so the CSS `--stage` gradient behind the canvas showed through by `1 − alpha`.
- The effect was strongest where many semi-transparent strands cross the scalp: the gaps took the page colour (near-black in the dark theme, light grey in the light theme). Brows and lashes were alpha-blended, which accumulates alpha to one over the head, so they barely changed.
- A same-page check confirmed it. With the stage already drawn in the scene but the context still `alpha: true`, switching the emulated colour scheme without reloading changed about 36% of the viewport pixels, all in the hair; skin did not change. With the opaque context, a magenta test background showed only at the hair's outer edge.

## 2. The game's dither [source]

Programs `renderstage_hair_alpha_accum` `2782105832921211528` and `renderstage_hair_gbuffer_solid` `2903833597335136032` (MeshSkinned, 2.31; disassembled privately, [hashes](hair-colour-pipeline-2026-09-25.md)) both compute the threshold from `SV_Position` and one integer from a camera-constant buffer:

```
t = 0.16535948 · (5·frac(0.2·(x + 2y − 1.5 + f)) + frac(2.4084506·x + 3.2535212·y)) + offset
alpha_accum: offset 2/255 (0.0078431);  gbuffer_solid: offset 0.0088431
```

The float constants are the exact values of the IEEE literals in the DXIL. `f` is `cb[51].z` of the camera constants; reading it as a frame counter is a [hypothesis]. The coarse term takes five values per pixel and cycles with `f`. The fine term is a fixed per-pixel offset. So `t` is close to uniform on [0.0088, 0.8356).

Consequences, derived from that arithmetic:

- **Layers are nested, not independent.** All layers in a pixel meet the same `t`. `gbuffer_solid` then writes only the most opaque of the two front k-buffer entries, and that entry has already survived. A pixel is covered when `max a > t`. That fraction is lower than `1 − Π(1−a)`, which is what independent (hashed) thresholds or alpha blending give.
- **Coverage is stretched.** Averaged over the cycle (TAA/DLSS), the covered fraction is `saturate((max a − 0.0088)/0.8268)`. At `a = 0.5` that is 0.59, and from `a ≈ 0.84` a layer is solid.
- The model is `HAIR_DITHER`, `hairDitherThreshold`, `hairResolvedCoverage` and `hairPixelCoverage` in `src/hair-colour-model.ts`. Its tests check the threshold range, the five-frame cycle, the pass rate against the resolved formula, and that two layers of 0.5 cover exactly as much as one.

## 3. Changes

- `src/platform/scene/scene-host.ts` creates the WebGL 2 context itself with `alpha: false`, so the canvas is opaque whatever alpha the fragments write.
- `src/stage-backdrop.ts` (pure) and `src/viewport-backdrop.ts` (Three adapter) draw the `--stage` radial gradient as the scene background. Its colours are interpolated in OKLab, as CSS does for `oklch()` stops. It is an sRGB texture, so Three draws it without tone mapping. `scene.environment` is unchanged, so lighting does not depend on the theme. A test keeps the token values in step with `public/studio.css`.
- `src/stage-theme-binding.ts` resolves the UI theme preference (with the OS scheme for "system") and passes it to the renderer's typed `setStage` input. `studio-main.ts` wires it.
- **Strands and saved lashes** use `STRAND_COVERAGE_MATERIAL`: opaque, depth-writing, alpha-to-coverage, no alpha test. Their alpha is `hairResolvedCoverage(remapped Strand_Alpha)`. The lashes had been alpha-blended; they are `hair.mt` in game, so they now share the hair coverage. They stay in Three's transparent queue without blending (`STRAND_COVERAGE_OVER_MAKEUP_MATERIAL`), so they still draw after the editable makeup layers, as before. As fully opaque objects, the makeup plate painted over lash roots behind its surface.
- **The cap** uses `HAIR_CAP_DECAL_MATERIAL`, a mask-blended decal with no depth write, as `mesh_decal_gradientmap_recolor.mt` is in game.

Stochastic (hashed) alpha with temporal accumulation was considered and rejected. Its per-layer thresholds are independent, which contradicts §2, and it would need change tracking in a render loop that does not yet render on demand. Alpha-to-coverage keeps the nesting and has no grain.

## 4. Measurements [observed; private renders]

Method: `tools/hair-colour-look.ts` (reference save, isolated `?verify=1` workspace, headless Chrome with ANGLE D3D11 on an RTX 4070, three fixed cameras, exposure 1.2, key angle 0), once per UI theme (new fourth argument). Then `python tools/hair-colour-stats.py --themes <light> <dark>`. The developer-prepared core head was served through `XFS_ASSET_OVERLAY`. Captures stay in the ignored `evidence/screenshots/hair-coverage/`.

**"Hair" means every pixel that hiding the hair changes.** That includes strand edges over the stage, which legitimately take the stage colour. **"Hair@subject"** keeps only pixels whose no-hair frame is identical in both themes, that is hair in front of the character. Luminance ratios are relative to the mean of three skin boxes in the face view. Skin measured (223,197,183) in every run.

| Face view | Hair / skin | Hair@subject (sRGB) | Hair@subject / skin | Lashes / skin | Brows / skin |
|---|---:|---|---:|---:|---:|
| Before, dark theme | 0.093 | (89,74,67) | 0.125 | 0.177 | 0.330 |
| Before, light theme | 0.299 | (122,107,101) | 0.264 | 0.186 | 0.352 |
| After, dark theme | 0.081 | (84,68,61) | 0.107 | 0.184 | 0.333 |
| After, light theme | 0.170 | (84,68,61) | 0.107 | 0.184 | 0.333 |

- In the other two views, hair@subject after the fix is also identical between themes: eye (81,63,57) vs (81,63,57), and three-quarter hair (66,52,46) vs (66,52,46). Before, it was eye (93,75,68) vs (123,106,99), and hair (72,59,53) vs (105,93,87).
- The light and dark themes now differ only in the pixels where strands cross the stage.
- Stretching coverage over the dither range, on its own (dark theme, opaque canvas both ways), moves face hair@subject/skin from 0.114 to 0.107 and lashes/skin from 0.203 to 0.184.

## 5. The parting patch [observed]

Before the fix, the parting showed hard, saw-toothed dark notches along the hairline. That was the cap: opaque, alpha-tested at 0.08, and writing its partial mask into the canvas alpha. As a mask-blended decal the edge is soft, and the notches are gone in both themes. The crown still reads near-black. A capture with the cap hidden stays near-black there, so the colour comes from the strands: `ash_brown.hp` has a black root band ([calibration note](hair-calibration-2026-09-25.md#1-which-profile-the-save-uses)), and near the parting the roots are what is visible. This is the asset's colour, not a blend or sorting error. It still needs comparing with a matched in-game frame.

## 6. Performance [observed]

Frame cost was measured on the same headless setup at 510×888 device pixels, in the three-quarter hair view, with idle off. The measure is the rAF callback plus `gl.finish()`, over about 340 frames. The median was 1.1–1.2 ms before and 1.2–1.5 ms after, with p95 1.4–1.9 ms before and 1.4–2.3 ms after. The runs are within run-to-run noise of each other. Regenerating the 256² backdrop on a theme change is a one-off CPU cost.

## 7. Limits

- These are browser raster measures, not game evidence. The in-game comparison still needs the [capture request](hair-calibration-2026-09-25.md#refined-capture-request).
- Alpha-to-coverage has four samples, and the driver chooses the patterns. Colour within a pixel is not the game's alpha-weighted average of the three nearest layers.
- The cap blend is linear, not sqrt-space.
- The 1.33 coverage flag remains unknown.
