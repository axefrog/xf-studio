# Colour-shifting (duochrome)

**Status:** experimental export (Fresnel gradient-recolour decal), game-matched model only, one colour-shift pigment per preset. Not seen in game.

## Intended look

The pigment's hue changes with viewing angle: a duochrome shows its base colour face-on and turns toward a second colour where the lid curves away from the viewer; a multichrome passes through several ([finish taxonomy](../makeup-finish-taxonomy.md)). The shift must follow the **camera**, not the light: an ordinary metallic highlight also changes as the view moves, but its colour does not.

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| **1 (implemented)** | `base/materials/mesh_decal_gradientmap_recolor_blendable.mt`, `renderstage_post_gbuffer`, one local material instance per colour-shift preset | Pixel program `3456408455936683438` (SHA-256 `f20c757c…167f`), decompiled: base colour = `DiffuseColor × GradientMap(DiffuseTexture.r, 0.5)`; GBuffer0.rgb = sqrt(base + `FresnelColor × FresnelColorIntensity × w × saturate(|1 − N·V|^FresnelExponent)`), with N the decal-processed normal and V toward the camera. Colour coverage = `DiffuseAlpha × GradientMap.a × MaskTexture.r` (linear, **not** squared as in `mesh_decal`); surface alpha = `RoughnessMetalnessAlpha` × that coverage. [source] | A real view-dependent two-tone tint added before lighting, so it is lit, shadowed and split by metalness like any base colour. One fixed shift colour and exponent per material: not thin-film, not multichrome. |
| 2 | Two draws: a flat `mesh_decal` preset plus a separate colour-shift component for its colour-shift layers | — | Would allow colour-shift layers inside mixed presets, but draw order between two coincident post-G-buffer decals is unknown and each needs its own mesh component. Not built. |
| 3 | `eye_shadow_blendable.mt` or `base/fx/shaders/simple_fresnel.mt` | [Feasibility note](../colour-shift-game-feasibility.md). [resource] | No MeshSkinned post-G-buffer route or no mask/PBR decal path. Rejected. |

### Findings that shaped the adapter

- **The distance fade would have hidden the shift.** The vertex program `7066617541061519457` (SHA-256 `77e887ec…cb3`) writes `w = max(1 + MaterialModifiersConsts[2].x − saturate((d − FadeOutOffset)/FadeOutDistance), 0)`, where d is the horizontal (XY) distance from the camera to the object's origin, and the pixel program multiplies the Fresnel intensity by `w`. With the template defaults (0.2 m, 0.5 m) the tint is gone beyond 0.7 m, i.e. at almost every third-person and photo-mode distance from the player's root. The export sets `FadeOutOffset` 1000 and `FadeOutDistance` 1. The earlier feasibility note had left this factor unexplained. [source]
- **Head-UV textures.** Unlike `mesh_decal`, this template has no `UVScale`/`UVOffset`: its pixel program `3456408455936683438` computes the UV only through the flipbook, t = (floor(F) + u)/`AnimationFramesWidth`. So colour-shift presets keep the 1024 head-atlas mask (about 0.56 × 0.40 mm per texel on the lids) while flat and faceted presets use the plate-local window. Fractional frame counts would act as a pure UV scale, but that repurposes animation parameters and is untested ([experiment 019](../../../experiments/019-uv-window/README.md#what-changed-per-route)).
- **One constant per draw.** `FresnelColor`, intensity and exponent are material constants; nothing per texel scales the shift (w is per instance). One preset is one draw, so every covered texel of the preset gets the same tint. The adapter therefore exports a colour-shift preset only when all its active layers are Colour-shifting with the same base colour, shift colour and strength; otherwise the colour-shift layers are omitted with that reason and the rest of the preset still exports.
- **Base colour through a texture, not a constant.** The base colour goes into a uniform 16 × 16 sRGB `GradientMap` (so its encoding is certain), with `DiffuseColor` white; `MaskTexture` carries linear coverage and needs no square-root encoding. Roughness 0.32 and metalness 0.25 come from `Scale` 0 plus `Bias`, so no surface maps are written.
- **Colour-parameter encoding is an assumption.** `eye_shadow` linearises its `ShadowColor` in the shader (exponent 2.2), which suggests `Color` parameters reach shaders as byte/255 without sRGB decoding. The export writes `FresnelColor` as the shift colour's **linear** value normalised to its peak channel (best byte precision) and moves the peak into the intensity, so under that assumption the added colour is 2 × strength × linear(shift colour). If the engine decodes sRGB instead, the in-game tint will be darker and more saturated than the preview. [hypothesis]
- `MaterialModifiersConsts[2].x` also scales the shift at runtime. It is probably 0 outside scanning effects, but its value on the player head is unknown. [hypothesis]

## What the preview does

The game-matched model injects the same term before lighting: `diffuseColor += shift × 2 × strength × saturate(|1 − N·V|²)` ([`fresnel-tint.ts`](../../../projects/xf-studio/authoring/src/fresnel-tint.ts)), with roughness 0.32 and metalness 0.25, and no thin-film iridescence. The Colour & finish panel gains a shift colour and strength. Earlier layers keep the thin-film study.

## Risks

- Colour-parameter encoding and the modifier constant (above).
- The tint is added in linear space before the square root, so a strong shift over a dark base can wash toward the shift colour rather than read as a hue change.
- Preset-wide rule: users cannot combine a duochrome with other finishes in one preset yet.

## Single most informative in-game test

On the finish board, **Board 3** against **Board 4** (same lid shape and base, shift strength 0.8 vs 0): hold the light fixed and orbit the camera from front to profile, then hold the camera and sweep the light. The route passes if Board 3's lid edges turn teal as the lid curves away from the camera and the teal follows the camera, not the light, while Board 4 stays plum. If Board 3 and 4 look the same, check the fade/modifier first; if the teal is much darker than the preview, the `Color` encoding assumption is wrong.
