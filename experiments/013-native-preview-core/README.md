# Native female head, eyes and fixed vanilla maps — offline candidate

**Status:** superseded by the Studio's derived preview — the head, eye plate, eyes and maps are now derived in Bun/TypeScript with WolvenKit CLI only (see [Ported to the Studio](#ported-to-the-studio)). This Python/.NET candidate stays as the independent reference it was checked against. Eye shading (gradient, refraction, wetness) is still not assembled.

25 September 2026. This experiment extends the [native head bootstrap](../012-native-plate-bootstrap/README.md) toward a clean user's local preview. It takes **installed Cyberpunk 2077 2.31 files**, not the private `.blend` source or old atlas. All extracted resources, GLBs, PNGs and manifests are written beneath ignored `generated/`; only the project-authored builder, verifier and evidence are tracked. It does not install anything or alter Studio.

## Reproduce

With Python (NumPy and Pillow), .NET 9 and WolvenKit CLI **8.17.4** installed:

```powershell
$gameRoot = 'PATH_TO_CYBERPUNK_2077'
$wolvenKitCli = 'PATH_TO_WOLVENKIT_CLI_EXE'
python experiments/013-native-preview-core/candidate.py --game $gameRoot --wolvenkit $wolvenKitCli --output experiments/013-native-preview-core/generated/my-candidate
python experiments/013-native-preview-core/verify.py experiments/013-native-preview-core/generated/my-candidate
```

The output must be new and empty. The builder selects one fixed archive, `archive/pc/content/basegame_4_appearance.archive`, and rejects changed resource hashes. It checks the female head morph's actual linked mesh, then uses the project-local morph exporter to make a bone-bound head GLB. For eyes, CLI `uncook` with `MeshOnly` exports the native mesh with skin and bone data. The 8.17.4 CLI silently omits that GLB when `-s` is passed in the same call; the builder therefore serializes the eye mesh in a separate step and checks for the GLB. Uncooking only the long female path also omitted it, while the matching sibling `he_000_pwa_c__basehead.mesh` pair worked. The verifier checks the final GLBs, exact source/candidate hashes and every converted PNG pixel against its decoded XBM.

The fixed map chain is the base-game female D05 head albedo and normal plus inherited female roughness described in the [saved skin trace](../../research/eye-artistry/saved-skin-resource-chain.md), and the native eye mesh's `gradient_brown` material binding. The eye mesh itself names `brown_eye_gradient.mi`, base diffuse `he_000_base_d02.xbm`, packed normal `he_000_base_n01.xbm`, roughness `he_000_base_rm01.xbm`, and `eye_brown.gradient`; the builder checks those serialized links. This is a **vanilla reference choice**, not the reference save's installed modded appearance or a provider-winner resolver. The eye diffuse looks grey-blue by itself: the source brown gradient remains a separate shader input and is deliberately not presented as rendered brown.

## Measured result on this installation

The installed game archive SHA-256 is `9c20370467e71d49ffb0a6415fe0415b2349ac22fe5afd38daf2783f54f2443b`. WolvenKit CLI 8.17.4 exported the source; `manifest.json` records its executable hash, absolute provider, every depot path and source/output hash. Relevant source binary SHA-256 values:

| Resource | SHA-256 |
|---|---|
| Female head mesh / morph | `e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6` / `3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e` |
| Female eye mesh | `4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19` |
| D05 head colour / packed normal / roughness | `cc210b3f6b35c4081c7e75ff6db8a616722f58ecfc358137bb153e8e23b04e8f` / `8629f2213ad22c9ac33531377f3a12afa13aeca6cdb7d3b46bec59abe6b27415` / `13eefcecdb96bad238caa5feafe1bd361070bd6d6a1e29c789bdcbaf6f9f66f4` |
| Eye base diffuse / packed normal / roughness | `d1afea0622075a02c69110fbe390ba22d8c5275a6bce304d063def856f3888e1` / `837d21fb747ddeafb80cd5d338c51031cc0321f160c76e772da694c2c386df0d` / `fdd37f4a9644820042aaed4ab9410420a4340354ca8e489563bb3e9f51ab9784` |
| Eye brown gradient profile | `a0316560105d88121dab00467ed1ff22a361db528ce9d7db019717e12fea5e04` |

The bound head GLB is byte-identical to experiment 012 (`0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730`): 7,186 vertices, 13,186 triangles, 254 rig joints, 105 morphs and two skin-weight sets. The native eye GLB SHA-256 is `0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba`; its actual eye surface is `submesh_01_LOD_1` with 668 vertices, 1,292 triangles, 57 rig joints and one weight set. The GLB also contains eyelash and wetness chunks. Eye UV0 spans U `-1.6367…1.9912`, so a Three adapter must preserve and repeat the source's tiled coordinates; the current browser's folded UV eye is not the same mesh. The verifier confirms finite geometry, valid triangle/bone indices and normalized weights. No eye morph targets occur in this eye GLB; head morphs and gaze attachment need separate assembly validation.

Six 1024² head and 512² eye PNGs are private outputs. Both colour XBMs declare gamma/sRGB; normals and roughness declare linear data. Colour pixels are unchanged. The two packed RG normals become conventional RGB with reconstructed positive Z and a single green inversion for a **Three-style provisional adapter**. Head roughness copies source R to RGB because the inspected 2.31 skin variant uses R as its base term and Three reads roughness-map G; the source B/detail-bias interaction is not reproduced. Eye roughness copies G to RGB following the inspected eye adapter precedent; its game shader channel response remains unproven. Candidate PNGs have no game or REDengine equivalence claim. The ignored contact sheet was visually inspected at normal size: head/eye colour layouts are intact, converted normals have a plausible positive-blue baseline, and scalar roughness maps remain structured. This visual check is only a gross conversion check.

## Ported to the Studio

25 September 2026. The Studio now derives the preview core from each user's own installation without Python, .NET or prepared files (`projects/xf-studio/authoring/src/preview-core-*.ts`, `game-asset-export*.ts`; [desktop flow](../../projects/xf-studio/authoring/desktop/README.md#3d-preview-from-the-players-game-files-25-september)). Findings that changed the method:

- **No custom morph exporter is needed.** One stock CLI `uncook` of the morph target, head mesh and eye mesh with `--mesh-export-type MeshOnly -gp <game>` writes the bone-bound head GLB (WolvenKit resolves the morph's `baseMesh` and rig), the skinned eye GLB, each mesh's `.Material.json` (materials resolved through their `.mi` chains) and PNG decodes of every texture they use. With CLI 8.17.4 the head and eye GLBs are byte-identical to this experiment's (`0f14804b…`, `0e5420a7…`). With 9.0.1 (`d5779866…`, `8dcdefbf…`) geometry, UVs, influences and morph deltas are identical; only joint rest rotations and matching inverse binds differ. The 8.17.4 `-s` quirk above does not arise because nothing is serialized in that call.
- **Maps come from the game's own default appearance, not a fixed list.** The head mesh's `default` appearance resolves to `01_ca_pale`: `h0_000_pwa_c__basehead_d01.xbm`, `h0_001_pwa_c__basehead_n01.xbm` and the inherited `h0_000_wa_c__basehead_rm01.xbm`. This experiment's D05 was the reference save's tone. The eye albedo comes from the `gradient_brown` appearance (`he_000_base_d02.xbm`).
- **The plate is cut from the same exported rows** with the built-in eye plate recipe, which removes this experiment's "no accepted plate" blocker for the preview.
- **Normal sign.** The renderer's `normalScale` was tuned on the prepared head normal map, whose R and G correlate positively with the source n01 R and G (+0.34, +0.35 at 1024²). The derived map therefore keeps R/G and only rebuilds Z; this experiment's G inversion would have flipped it twice.
- **Parity with the prepared assets** (read-only comparison, 25 Sep): all 7,189 prepared head and 1,620 plate vertices match derived vertices exactly in position and UV (the prepared file splits three vertices); influences agree within 1.2×10⁻⁷ by joint name, morph deltas within 6×10⁻⁸, normals within 2.2×10⁻³; joint order and all 105 target names are identical. The prepared colour map is an upscale of D01 (mean absolute difference 0.73/255 after 2× box reduction) and its roughness is rm01 R (correlation 0.998). The prepared eye is a different, UV-folded mesh about 2.9 mm from the native eye.
- **Timing on the test PC:** first derivation 11 s (CLI 9.0.1) or 16 s (8.17.4); re-deriving from cached exports 1.1 s; reuse 0.1 s.

## Remaining gates

The brown gradient profile, eye refraction/cornea, wetness, skin subsurface/detail passes, precise normal tangent handedness and eyelid pose behavior are still not assembled; the Studio preview shows the eye's base albedo on the native eyeball chunk, attached rigidly to the gaze joints like the historical eye. The preview plate is the built-in neutral cut, which coincides with the skin; that is a Build-side clearance question ([experiment 012](../012-native-plate-bootstrap/README.md)), not a preview blocker. The derivation reads the base game's content archives, not the effective MO2 winner. None of this proves game rendering or permission to redistribute CD PROJEKT RED assets: every user derives the files privately from their own installation. No game launch was made.

[WolvenKit and game-asset credit](../../docs/community-credits.md) records the tool and source contributions. The prior [saved-eye adapter audit](../../research/eye-artistry/eye-preview-adapter-plan.md) and [compiled skin-channel trace](../../research/eye-artistry/saved-skin-shader-and-winner.md) informed the deliberately bounded map conversion; no guide images or third-party code/assets were copied into this experiment.
