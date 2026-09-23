# Colour-shifting eye makeup: 2.31 stock-material feasibility

24 September 2026. Read-only inspection of the installed Cyberpunk 2077 2.31 resource archive and compiled shader cache. No material instance, archive, selector, game installation or game capture was made. This is a candidate for a later controlled test, not production export support.

## Decision

`base\materials\mesh_decal_gradientmap_recolor_blendable.mt` is a concrete **view-dependent two-tone tint** lead for the owned skinned eye plate. The current template includes `MVF_MeshSkinned`, a `renderstage_post_gbuffer` pass with depth writes off and three independently alpha-blended targets, a gradient-map base colour and `FresnelColor`, `FresnelColorIntensity` and `FresnelExponent` controls. The selected compiled pixel program derives a camera-to-surface vector, dots it with the processed surface normal, raises `abs(1 - dot)` to the Fresnel exponent, multiplies by the Fresnel colour and intensity, and **adds that RGB to the gradient/base RGB** before the colour output. Its colour target alpha is calculated separately from the diffuse/mask coverage. This is actual angle-dependent shader arithmetic, rather than a fixed pigment that merely looks different as an ordinary metallic highlight moves.

It is **not** the studio browser's `MeshPhysicalMaterial` thin-film iridescence (constant 400 nm thickness, IOR 1.3), nor evidence for an arbitrary duochrome/multichrome pigment. The game program provides one fixed additive secondary colour with an angle-controlled weight; it does not expose interference thickness, spectral bands or a selectable multi-hue angular palette. Saturation, clipping, lighting, normal blending, gradient-map interpretation and the perceptual strength of a chosen pair remain untested on the plate. Keep the compiler's `iridescent` / Colour-shifting rejection until a deliberately labelled approximation is accepted after game comparison.

## Reproducible installed evidence

| Source | Exact inspected fact |
|---|---|
| `F:/Games/Cyberpunk 2077/archive/pc/content/memoryresident_1_general.archive` → `base\materials\mesh_decal_gradientmap_recolor_blendable.mt` | Extracted with WolvenKit CLI 8.17.4; binary SHA-256 `13ec8047ffa5a21d4afcdc3066b8bfffb5c8ded40e09ab44eb9feadfd776d1cc`. Its serialized JSON says `GameVersion: 2310` and lists the MeshSkinned factory, the post-G-buffer pass, three source-alpha/inverse-source-alpha RGB blend targets and no depth write. All extracted binaries/JSON remain ignored under `research/consumers/colour-shift/raw/`. |
| `F:/Games/Cyberpunk 2077/engine/shader_final.cache` | Existing [cache index](evidence/shader-cache-index.json) identifies the installed RDHS v10 cache (SHA-256 `339145371a3b5aaa08eb4ef82d558f445b632e28603ee0f3b4860270dfc3ccfa`). Its un-discarded `VF: MeshSkinned` post-G-buffer compilation has vertex GUID `7066617541061519457` and pixel GUID `3456408455936683438`. |
| Selected DXIL pixel container | Extracted read-only from that cache; SHA-256 `f20c757cfaca151107b85136fe2f30ecbee8d7d3fd96d8aab7d9af9042e1167f`. Windows SDK `dxc -dumpbin` shows the view-normal dot and power at disassembly lines 422–450, the Fresnel RGB addition at 416–449, and colour/normal/surface outputs at 472–483. The dump stays ignored beside the binary. |

The scalar/color register mapping comes from the current template's parameter order: material `cb4` register 1 is `FresnelColor`, 2 is `FresnelColorIntensity`, and 3 is `FresnelExponent`. The program loads a shared camera position, subtracts the interpolated world position, normalizes that vector, and combines it with the processed normal. The relevant shape is approximately

```text
angleWeight = saturate(pow(abs(1 - dot(normal, viewDirection)), FresnelExponent))
rgbBeforeOutput = gradientBaseRGB + FresnelColor * FresnelColorIntensity
                                 * interpolatedFactor * angleWeight
```

The `interpolatedFactor` comes from the vertex program's `TEXCOORD3.w` and includes fade controls; its full game-space interpretation is not yet established. The output also applies a square root to RGB. This shorthand describes the observed branch, not a faithful browser implementation or calibrated colour transform. In this compilation, colour-target alpha is the mask/contrast path (`%185`), and surface-target alpha is `RoughnessMetalnessAlpha × %185` (`%302`). That makes it plausible to confine colour and ordinary PBR surface changes to an authored makeup shape. Actual edge filtering and overlap still need measurement, particularly because the mask contrast path is nonlinear.

Template defaults are not a usable makeup instance: `FresnelColorIntensity` is 8, `FresnelExponent` is 2, while `DiffuseAlpha` and `RoughnessMetalnessAlpha` are both 0. A controlled candidate must set its own bounded colours/intensity and explicitly enable only the covered output channels it intends to use. The eightfold default could wash out an intended two-hue transition.

The ordinary `mesh_decal.mt` route can change roughness, metalness and normals through coverage; a blue/copper texture in that route is still a **fixed tint with moving PBR highlights**, not a pigment hue that varies by view. `mesh_decal_gradientmap_recolor.mt` has a skinned post-G-buffer variant but no exposed Fresnel colour controls in its current template. `eye_shadow_blendable.mt` does expose Fresnel colour yet its current template lists only `MVF_MeshStatic`/`MVF_MeshExtSkinned` and a one-target transparent-back-face pass. `base\fx\shaders\simple_fresnel.mt` has MeshSkinned support but a one-target transparent pass and no established authored mask/PBR decal path. Those names are weaker plate candidates than the gradient-map blendable decal.

The 2.31 comparison templates were all extracted from the same `memoryresident_1_general.archive` and serialized locally: `mesh_decal_gradientmap_recolor.mt` SHA-256 `dbcb59a035fe583d6dd3a06b60786288e5e5957384519475c3e21279336fe176`, `eye_shadow_blendable.mt` SHA-256 `0a46a2179583382c7ee37eb16ae65c4e0cf04a24a2f8eb59dd8f13acb0e37982`, and `simple_fresnel.mt` SHA-256 `e79e7531800762703c60b8a616c9ec28505c65700b17dca267b282da724018ee`. This replaces reliance on older game-2200 JSON for the candidate's pass/factory facts.

## Practical boundary and next gate

No offline serialization fixture was added: the current template already establishes parameter availability and the compiled pixel program establishes the angle term. A generated `.mi` round-trip would show only that values serialize, not that the eye plate renders a useful colour transition. The next useful fixture should bind a small authored mask to the **owned, morph-skinned plate** and compare three separate material states in one package: fixed-pigment `mesh_decal` baseline, gradient-map blendable with Fresnel intensity zero, and the same gradient-map blendable with a visibly distinct moderate Fresnel colour. Add Off and preserve identical geometry, normal maps, light and base pigment across those states. Independently verify resource links, exact native skin bytes in mesh and morph base, all 105 morphs, no bare-skin coverage outside the mask, and clearing/order before requesting a game launch.

Then capture the same eyelid with a fixed light while moving the camera, followed by a fixed camera while moving the light, at close and face framing and during blink. A real view tint should shift as camera angle changes even under fixed light; ordinary metal/roughness highlights should follow lighting. Inspect the contour edge, bare skin beside it, overlap with another finish, and preset/Off clearing. Record effective template/instance bindings and game/framework versions with the capture. This can establish a limited duochrome-like **approximation**, not parity with the browser thin-film model or a general multichrome export. Keep the existing production guard and editable source recipe intact meanwhile.

## Provenance

The material and shader facts come from CD PROJEKT RED's locally installed 2.31 binaries. WolvenKit CLI supplied read-only archive extraction and serialization, and the Windows SDK `dxc` disassembled the compiled program; no external code or assets were copied into Git. WolvenKit's existing tool/dependency credit is in [the central record](../../docs/community-credits.md). No new community guide or mod informed this finding. The ignored game binaries and dumps are private reproduction inputs, not distribution assets.
