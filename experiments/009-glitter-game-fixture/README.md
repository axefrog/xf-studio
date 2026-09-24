# Glitter game-material comparison: offline fixture

The [25 September particle-decal audit](particle-decal-audit.md) checked another installed stock shader candidate. Its selected `mesh_decal_particles` programs add animated-atlas controls, not the browser's filtered, light-dependent fine-glint response; the production Glitter export guard remains.

## Recipe-driven boundary, 24 September

The new [recipe adapter study](recipe-driven-boundary.md) replaces this fixture's
synthetic *coverage* with the Studio's exact `raster(layer, size)` result for an
enabled direct-glint Glitter layer. It emits six independently generated PNG maps
and, optionally, imports them as six XBM textures and two `xfs_` material
instances against hash-checked current-game templates. The tracked
[source-map result](recipe-adapter-result.json) and
[serialization result](recipe-adapter-serialization.json) are reproducible
without distributing generated pixels or game resources. This is an explicitly
lossy material candidate, not a Studio exporter or a game-validated finish.

This is a **material-only** comparison for the current Cyberpunk 2077 2.31 stock templates. It generates its own eye-shaped test coverage and randomly seeded triangle/quadrilateral facets, then imports seven `xfs_` textures and three `xfs_` material instances. It does not change the studio's Glitter export guard, bind a mesh, make an appearance or selector, package an archive, or install anything. The outputs are ignored under `generated/`.

Two PBR instances use `base/materials/mesh_decal.mt`: dark pigment, an independently masked BC5 facet normal, red-channel roughness and metalness maps, and source alpha square-root compensation for the inspected decal coverage equation. They share seeded polygon placement and all other maps. The original uses one fixed normal per facet; the new `xfs_glitter_axial_pbr` uses an independent axial height ramp per facet, converted by finite differences to a normal map. This is a deliberately simple comparison of normal structure, not island_dancer's Substance graph or its rendered output. Both can only behave as *resolved* highlights; filtering several flakes to one texel loses their separate reflections. The third instance uses `base/materials/mesh_decal_emissive_subsurface.mt` with a sparse red-channel mask and bounded warm emission. That option deliberately tests an artistic light-independent sparkle, not reflected glitter. It requires a separate component on the same morphed plate for a combined trial. Its depth and overlap behavior on that plate still need runtime proof.

## Reproduce

Use WolvenKit 8.17.4 to extract the unmodified `base/materials/mesh_decal.mt` and `base/materials/mesh_decal_emissive_subsurface.mt` from the installed 2.31 game into a local directory. The latter currently resides in `memoryresident_1_general.archive`. Serialize each binary to adjacent `<filename>.json`. The script requires these binary SHA-256 values and `GameVersion: 2310`:

| Template | SHA-256 |
|---|---|
| `mesh_decal.mt` | `b1b181b70fd1b16393d626281eeff1d5fc99932f24868e55248d18a1abfbc019` |
| `mesh_decal_emissive_subsurface.mt` | `b590a2ee02497e7354e3ed2f83d4bfff42b08a7b2ee14f202c45f10ee799d699` |

From the repository root, with Pillow, the installed WolvenKit CLI and game at the paths in `fixture.py`:

```powershell
python experiments/009-glitter-game-fixture/fixture.py --build --pbr-template C:/local/mesh_decal.mt --emissive-template C:/local/mesh_decal_emissive_subsurface.mt
python experiments/009-glitter-game-fixture/fixture.py --verify --pbr-template C:/local/mesh_decal.mt --emissive-template C:/local/mesh_decal_emissive_subsurface.mt
```

Both templates are binary-hash checked before use. The verifier also checks version, MeshSkinned support, selected blended/depth-write-disabled pass, parameter names, material binary/JSON round-trip, every local texture reference, XBM size/compression/gamma/mip flags, decoded base-level scalar channels, pigment edge coverage and emissive-mask confinement. Template binaries and game-derived exports remain ignored; only the generator, findings and compact [result](result.json) are tracked. No community graph, texture or photograph pixels are copied. [island_dancer's graph analysis](../../research/materials/island-dancer-glitter-graph.md) informed the research question about tilted polygon facets, but this fixture uses independently written geometry, values and seeded placement.

## Current offline result

Seven 1024² textures and three material instances imported and serialized successfully. The material binary hashes are in [result.json](result.json); the original two are unchanged, and the new axial instance is `5a13e007…155`. The decoded pigment alpha squared differs from desired coverage by mean **0.00344** across 75,047 partially covered texels. The decoded emissive mask has **zero** texels above byte 8 outside shape coverage. Scalar base-level decoded red-channel mean errors are 0.0008–0.0352 bytes, depending on the map. Inside shape texels with at least half coverage, the new axial normal's decoded base-level R/G mean absolute byte errors are 2.07/2.12 (the fixed-normal control's are 0.41/0.41); these do not test lower compressed mips.

Each XBM reports a generated mip chain, but the CLI export used here exposes the base level. A separate BOX minification of the **source** emissive mask shows the high-contrast (byte ≥96) atlas fraction falling from 0.00625 at 1024 to 0 at 64. The axial map's strong-tilt fraction inside the mask falls from 57.9% at 1024 to 18.1% at 256 and 0% at 64; the fixed-normal control falls from 47.3% to 35.0% and 2.7%. The new internal gradient gives more fine structure at the source tier but loses it faster under this reduction. These are source-map diagnostics, not measurements of the game's compressed lower mips or lighting. The normal's green-channel convention, skin preservation, decal stacking, bloom and face-framed readability are likewise unverified. The [browser glint pilot](../007-irregular-glitter/uv-cell-glint-findings.md) computes per-fragment light/view response that neither stock material reproduces for subpixel flakes. [The proposed authoring bridge](authoring-export-bridge.md) keeps the editable direct-glint recipe distinct from this lossy material candidate.

The [2.31 shader and minification audit](shader-and-minification-audit.md) pins the selected compiled input paths and the emissive shader's otherwise easy-to-miss white `SecondaryMask` default. The verifier now asserts that default and records source BOX normal-tilt collapse alongside the sparse-mask diagnostic. These are offline source-map measurements, not captured game shading.

## One-session runtime gate

After the owned plate/morph pair passes its separate clearance and exact native-weight checks, bind this fixture to **six temporary comparison states** in one selector: Off; fixed-normal PBR; axial-height PBR; emission only; each PBR paired with emission. Keep all resource appearance names `xfs_`. Update the installed framework versions listed in [toolchain](../../docs/toolchain.md) before the session. Verify local material/texture references, all 105 morphs, preset clearing and logs before a game launch. Do not route these material candidates through the production compiler until the comparison is reviewed.

Capture the same eye at a fixed pose at close and face-framed distances. For each non-Off state, rotate the key light with the camera fixed, then move the camera with light fixed, include a dim-light case and a blink, and inspect near/far mip transitions. Switch through all states and back to Off to check stale components. Preserve game/framework versions, ArchiveXL/CET logs and frame captures. Compare facet response against the studio preview and photographic target, while explicitly recording whether the emissive specks remain bright under unfavourable light. A runtime appearance decision needs that evidence; this offline fixture alone cannot justify fine-glint parity or enable game export.
