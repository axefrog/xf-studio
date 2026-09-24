# Isolated D05 source-map comparison — 24 September 2026

`/render-fidelity-study.html` now optionally loads an **ignored, local** `assets/skin-study/manifest.json` and five PNGs. Every URL and SHA-256 must match the tracked intake contract, and the head GLB hash is checked before either pane renders. Missing private intake leaves the prior Blender-map/eye comparison available; changed or corrupted intake fails visibly. `bun tools/stage-private-skin-study.ts <private saved-skin/raw path>` verifies the existing preview GLB and all five input PNGs before copying the maps and writing the ignored manifest. The path is an already extracted local research directory, not an archive downloader. No extracted image, mesh, manifest or screenshot is tracked or packaged. The page remains outside the editor and cannot read or save the working draft.

## Geometry gate

The unchanged browser head GLB is SHA-256 `72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8`. The Experiment 004 `vanilla_head.glb` is SHA-256 `e4fd734c2028fea9bc496bd7c65cfe7224c39cd75b8fab958e004bfc78e5f0fc`; it was exported from a base-game morph resource whose local SHA-256 is `3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e`, **byte-identical** to the base-game morph extracted for the D05 chain this day. An ignored NumPy probe (`research/consumers/saved-skin/raw/check_uv_correspondence.py`) compared all head primitive position+UV0 signatures and triangle signature multisets at 1e-7 decimal rounding. Both have exactly **6,917 unique position+UV0 signatures and 13,186 matching triangles**, with zero signatures or triangles unique to either. The preview export has 7,189 vertices versus native 7,186 because of three additional splits; it does not change those signatures. This establishes base-game native **head surface/UV0** correspondence for the static preview geometry, not skinned byte parity, modded morph geometry, tangent-frame identity, texture orientation in game, or a saved-pose match.

The installed 2.31 compiled `skin` G-buffer variant inspected in [the source trace](../../../../research/eye-artistry/saved-skin-shader-and-winner.md) samples its primary maps at UV0. Its roughness texture uses **R** as base and **B** to weight a spatial detail-bias factor; its packed normal uses **RG**, remaps them to signed XY and reconstructs nonnegative Z. The page converts these channels into Three-compatible RGB normal and green roughness data maps locally. The inherited roughness has G=0, so directly giving it to Three's `roughnessMap` would be false. The source material instance has `DetailRoughnessBiasMin=1`, `Max=0.93`; the labelled R+B bracket uses `R × (1 − 0.07 B)` with B normalized. This selects one constant lower bound; it **does not reproduce** the game's spatial bias computation, microdetail, detail/wrinkle normal, tangent handedness, skin profile, translucency or deferred lighting. The same browser `normalScale=(0.35,-0.35)` is retained across map sets as a controlled preview convention, not a proven game scale.

## Private intake and provider boundary

The staged PNGs are local WolvenKit conversions of these source candidates. The current MO2 profile suggests Arkhe as the mod alternative, but its file time postdates the captured save and no runtime resource binding has been observed. "Arkhe candidate" in the UI is deliberate; it is **not** called the saved V's effective winner. Roughness is inherited base-game in both map sets.

| Private local map | PNG SHA-256 | Source role |
|---|---|---|
| `base-albedo.png` | `2e066e187efcde185c254ec722308e84e360cd7f30625319167af755e785af4b` | Base D05 albedo, 1024² |
| `base-normal.png` | `015f9b8f730cb01ffc6f1bef543e83ce48b2c999850a485394dce586bbfc648e` | Base packed RG normal, 1024² |
| `arkhe-albedo.png` | `a89753c3e5b4126fd12d6caed1c75c48f160726040907640f41a4a66e634522c` | Arkhe Complexion III candidate, 4096² |
| `arkhe-normal.png` | `0b1b0d68691abba974dbc3b1ff3c9b67f6193582445eeed227aab057025b59e5` | Arkhe Face Details candidate, 4096² |
| `base-roughness.png` | `5a258560cb9b7056159d28d0f17dd9f90aad5caf833760c3562779a57dd102d4` | Inherited base roughness, 1024², R 41–255 and B 115–255 |

The original XBM resource and provider hashes, plus the current-profile route limits, are in [the prior audit](../../../../research/eye-artistry/saved-skin-shader-and-winner.md). The old browser maps retain their [separate Blender-master provenance](../../../../research/eye-artistry/eye-lip-optics-audit.md). The new study does not stage head or teeth resources for release.

## One fixed browser view

Chrome, neutral static head, 30° vertical FOV, target `(0,1.55,0)`, distance 0.44, key −31°, exposure 1.20, both panes otherwise sharing the scene/light setup. One 1265×650 browser viewport yielded a **broad fixed screen lip crop of 13,475 pixels per pane**. The counter tests all display RGB channels >220; the mean is linearized sRGB luminance. This rectangle includes lip context and is **not** a segmented white-seam count. Resizing or changing camera framing changes the sample population; the UI suppresses metrics when framing controls move from zero. The left old-map baseline measured 97 bright pixels and 0.3321 mean linear luminance in each comparison.

| Right-pane input | Bright pixels | Mean linear luminance |
|---|---:|---:|
| Base D05, R roughness, reconstructed packed normal | 17 | 0.3994 |
| Base D05, R+B constant-bias bracket, packed normal | 35 | 0.4022 |
| Base D05, R roughness, flat normal | 0 | 0.3694 |
| Arkhe candidate, R roughness, packed normal | 3 | 0.3566 |
| Arkhe candidate, R+B constant-bias bracket, packed normal | 6 | 0.3601 |
| Arkhe candidate, R roughness, flat normal | 0 | 0.3198 |

I visually inspected the base and Arkhe two-pane views. The old Blender lip has a conspicuous narrow white highlight; the base source set changes it to a softer pink boundary, while the Arkhe candidate shows a few local glints instead of that continuous white stroke. Both source sets alter colour, normal and roughness at once against the old baseline. Within a source set, flat-normal and R/B variants isolate those narrower terms. The base and Arkhe source-map captures are private ignored files `evidence/screenshots/source-base-r-packed.png` (SHA-256 `c1c516e80ee400fc6168ea05fd4b478d78d3468091f8baccfbe8728a8e683e93`) and `source-arkhe-r-packed.png` (`e94374a0450c6b824e0f0d657b8f083b86ef3ace2405fb790cb933f82220ead3`). Their source pixels stay out of Git.

The source maps improve this one browser lip view but do not establish the cause of the reference **game screenshot** or yield a release material. The current experiment omits the resolved teeth/mouth geometry, saved morph and idle pose, explicit game tangent basis, microdetail and skin translucency. Native UV0 geometry correspondence and map hashes do not prove current MO2 runtime winners. The next gate is a matched saved-V game capture with effective resource/log provenance and a view/lighting matrix; only then can an approximation be assessed for production. Until then, keep this opt-in study page and do not change the production renderer.

Validation: 277 authoring tests pass, TypeScript check and browser build pass. The page displayed all six source variants and updated metrics without an asset or shader failure. No game launch or installation occurred.

**Central credit request:** extend existing CD PROJEKT RED source-resource and WolvenKit tool-use entries with this UV/channel adapter and private extraction; extend Arkhe's entry with the current-profile candidate A/B and explicit missing runtime winner; credit Three.js contributors for the browser material/channel convention (dependency use). No external assets or code were copied into tracked output.
