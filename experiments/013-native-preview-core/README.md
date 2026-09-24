# Native female head, eyes and fixed vanilla maps — offline candidate

25 September 2026. This experiment extends the [native head bootstrap](../012-native-plate-bootstrap/README.md) toward a clean user's local preview. It takes **installed Cyberpunk 2077 2.31 files**, not Nathan's private `.blend` or old atlas. All extracted resources, GLBs, PNGs and manifests are written beneath ignored `generated/`; only the project-authored builder, verifier and evidence are tracked. It does not install anything or alter Studio.

## Reproduce

With Python (NumPy and Pillow), .NET 9 and WolvenKit CLI **8.17.4** installed:

```powershell
python experiments/013-native-preview-core/candidate.py --game 'F:/Games/Cyberpunk 2077' --wolvenkit 'F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe' --output experiments/013-native-preview-core/generated/my-candidate
python experiments/013-native-preview-core/verify.py experiments/013-native-preview-core/generated/my-candidate
```

The output must be new and empty. The builder selects one fixed archive, `archive/pc/content/basegame_4_appearance.archive`, and rejects changed resource hashes. It checks the female head morph's actual linked mesh, then uses the project-local morph exporter to make a bone-bound head GLB. For eyes, CLI `uncook` with `MeshOnly` exports the native mesh with skin and bone data. The 8.17.4 CLI silently omits that GLB when `-s` is passed in the same call; the builder therefore serializes the eye mesh in a separate step and checks for the GLB. Uncooking only the long female path also omitted it, while the matching sibling `he_000_pwa_c__basehead.mesh` pair worked. The verifier checks the final GLBs, exact source/candidate hashes and every converted PNG pixel against its decoded XBM.

The fixed map chain is the base-game female D05 head albedo and normal plus inherited female roughness described in the [saved skin trace](../../research/eye-artistry/saved-skin-resource-chain.md), and the native eye mesh's `gradient_brown` material binding. The eye mesh itself names `brown_eye_gradient.mi`, base diffuse `he_000_base_d02.xbm`, packed normal `he_000_base_n01.xbm`, roughness `he_000_base_rm01.xbm`, and `eye_brown.gradient`; the builder checks those serialized links. This is a **vanilla reference choice**, not Nathan's installed modded/saved appearance or a provider-winner resolver. The eye diffuse looks grey-blue by itself: the source brown gradient remains a separate shader input and is deliberately not presented as rendered brown.

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

## Remaining gates

The brown gradient profile, eye refraction/cornea, wetness, skin subsurface/detail passes, precise normal tangent handedness, gaze node transforms and eyelid pose behavior are not assembled. The candidate has **no accepted eye plate**: experiment 012's neutral cut coincides with the skin, and the available lift candidates fail finite posed-contact gates. Studio's required five-file preview intake cannot be satisfied by this candidate alone. Before product integration, validate the source head/eye transform and UV against the chosen renderer, derive a cleared plate through the existing static/morph/dense-pose checks, then test a private isolated viewport. None of this proves game rendering, current MO2 effective winners, or permission to redistribute CD PROJEKT RED assets. No game launch was made.

[WolvenKit and game-asset credit](../../docs/community-credits.md) records the tool and source contributions. The prior [saved-eye adapter audit](../../research/eye-artistry/eye-preview-adapter-plan.md) and [compiled skin-channel trace](../../research/eye-artistry/saved-skin-shader-and-winner.md) informed the deliberately bounded map conversion; no guide images or third-party code/assets were copied into this experiment.
