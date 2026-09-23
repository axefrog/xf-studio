# Glitter game-material comparison: offline fixture

This is a **material-only** comparison for the current Cyberpunk 2077 2.31 stock templates. It generates its own eye-shaped test coverage and randomly seeded triangle/quadrilateral facets, then imports six `xfs_` textures and two `xfs_` material instances. It does not change the studio's Glitter export guard, bind a mesh, make an appearance or selector, package an archive, or install anything. The outputs are ignored under `generated/`.

The PBR instance uses `base/materials/mesh_decal.mt`: dark pigment, an independently masked BC5 facet normal, red-channel roughness and metalness maps, and source alpha square-root compensation for the inspected decal coverage equation. The facets have varied sizes and fixed, varied tangent-space normals. They can only behave as *resolved* highlights; filtering several flakes to one texel loses their separate reflections. The second instance uses `base/materials/mesh_decal_emissive_subsurface.mt` with a sparse red-channel mask and bounded warm emission. That option deliberately tests an artistic light-independent sparkle, not reflected glitter. It requires a separate component on the same morphed plate for a combined trial. Its depth and overlap behavior on that plate still need runtime proof.

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

Six 1024² textures and two material instances imported and serialized successfully. The two material binaries have SHA-256 `7cd265521cd3a252b2053ea085038edf3f9401191486f8df68a0cf126045239b` (PBR) and `b152d3bcc78555f510f02dfacca1bab012ac72b416be1dc18d0a836eb805cdc7` (emission). The decoded pigment alpha squared differs from desired coverage by mean **0.00344** across 75,047 partially covered texels. The decoded emissive mask has **zero** texels above byte 8 outside shape coverage. Scalar base-level decoded red-channel mean errors are 0.0008–0.0352 bytes, depending on the map.

Each XBM reports a generated mip chain, but the CLI export used here exposes the base level. A separate BOX minification of the **source** emissive mask shows the high-contrast (byte ≥96) atlas fraction falling from 0.00625 at 1024 to 0 at 64. This signals likely distance loss; it is not a measurement of the game's compressed lower mips or lighting. The normal's green-channel convention, skin preservation, decal stacking, bloom and face-framed readability are likewise unverified. The [browser glint pilot](../007-irregular-glitter/uv-cell-glint-findings.md) computes per-fragment light/view response that neither stock material reproduces for subpixel flakes.

## One-session runtime gate

After the owned plate/morph pair passes its separate clearance and exact native-weight checks, bind this fixture to **four temporary comparison states** in one selector: Off; PBR only; emission only; PBR plus emission. Keep all resource appearance names `xfs_`. Update the installed framework versions listed in [toolchain](../../docs/toolchain.md) before the session. Verify local material/texture references, all 105 morphs, preset clearing and logs before a game launch. Do not route these material candidates through the production compiler until the comparison is reviewed.

Capture the same eye at a fixed pose at close and face-framed distances. For each non-Off state, rotate the key light with the camera fixed, then move the camera with light fixed, include a dim-light case and a blink, and inspect near/far mip transitions. Switch through all states and back to Off to check stale components. Preserve game/framework versions, ArchiveXL/CET logs and frame captures. Compare facet response against the studio preview and photographic target, while explicitly recording whether the emissive specks remain bright under unfavourable light. A runtime appearance decision needs that evidence; this offline fixture alone cannot justify fine-glint parity or enable game export.
