# Morph-aware crease candidate after resource packing

24 September 2026. **Research only; no plate replacement or game launch.** The exact [crease-interior numeric candidate](crease-surface-checkpoint.md) passed its numeric 107-shape / 73-pose gate but [failed after serialization](crease-resource-roundtrip.md). This follow-up searched local base and morph changes against both the float32 import GLB and measured WolvenKit packing, then converted independent mesh/morph resources with native head skin bytes restored in **both** buffers. A later candidate passes the full sampled resource gate with measurable slack, while nearby input tests still reveal a quantization threshold. Keep the owned master and distribution package unchanged.

## Search and result

The initial packed failure had 18 neighbor-limit violations concentrated in edges `119–322` and `321–322`, two new `h201_eyes` contacts, and five posed contact occurrences at frames 25/169/170. [The diagnostic script](postpack_diagnose.py) records each edge/pair. A three-vertex base correction fit a 3 µm local edge margin on both measured stages; it also produced new crease-fan contacts, so it was coupled to local morph edits. A 176-case deterministic `h091_eyes` sweep of small Y lifts showed that a broad lift traded contacts into adjacent faces. The retained search moved the inner vertices only, then fit `h091_eyes` and `h171_eyes` edge corrections. Its first new resource still had one frame-25 contact and three neighbor violations. A second local fit cleared those, and a final `h171_eyes`/`h101_eyes` endpoint fit widened the two smallest packed edge margins. The [search](postpack_search.py), [continuation](postpack_continue.py), [margin refinement](postpack_margin_refine.py) and [nearby variant probe](postpack_variant.py) keep all generated NPZ/GLB/resources ignored.

The final candidate is `generated/morph-aware/postpack-margin-refined.npz`, SHA-256 `971d7e725252d990abeb52fd0bb10f69e3e64efb0b72dc3f646e8df9d1951c74`. Its ignored build is `generated/roundtrip-crease-1790203305131926200/`. The [independent verifier](../verify_crease_roundtrip.py) read the **final serialized** buffers and exported bound GLB. All acceptance checks below passed:

| Check | Pre-import float32 | Post-WolvenKit |
|---|---:|---:|
| New nonadjacent contacts, 107 static cases | 0 | 0 |
| New nonadjacent contacts, 73 sampled idle poses | 0 | 0 |
| Static displacement / neighbor violations | 0 / 0 | 0 / 0 |
| Maximum static displacement | `0.00010808797` | `0.00010772600` |
| Minimum neighbor slack over every static edge/case | **1.129 µm** | **1.244 µm** |
| Minimum separating-axis gap at eight formerly failing triangle pairs | **2.118 µm** | **1.412 µm** |

The contact-gap number is the largest positive interval separation over normalized finite-triangle SAT axes for each named pair, then the minimum across those eight pairs. It certifies separation for the **previously failing pairs**; it is not the global closest distance between all plate/head triangles. The independent all-pair contact gate tests every static case and sampled pose. The postpacked maximum static neighbor difference is `0.0000487561` asset units; each edge is compared to its own cap, including the shorter-edge caps below `0.00005`.

The final mesh and morph embedded base buffer each match all eight native head skin slots at **all 1,635 mapped vertices**. Exported per-bone weights have maximum error `0`; all 3,010 plate triangles, both UV sets and all 105 morph names remain intact. Existing nonzero normal/tangent morph deltas are unchanged. Maximum base-position component roundtrip error is `2.611429e-6`; morph-position component error is `9.425217e-6`. Both are included in the measured final geometry, not assumed away.

## Actual nearby resource builds

The previous passing candidate (NPZ `b17664d262f5bd8bdbea539daff225e55dd8339a80be4b3090e1224e13acbdbe`) also passed every binary gate, but its packed minimum neighbor slack was only **0.0124 µm** at `h171_eyes` edge `845–848`. It was not retained as a robust checkpoint. A half-microunit input change at vertex 848 along the final `h171_eyes` correction was converted in **both** directions. Each variant still passed the 107/73 gates; the minus variant returned to **0.0124 µm** packed slack, while the plus variant retained **1.244 µm**. Its morph resource and exported GLB hashes changed. This is direct evidence that the packer's discrete bins can change the margin under a small input edit; it does not establish tolerance to every local perturbation, serializer version, or morph combination.

| Actual build | NPZ SHA-256 | Mesh SHA-256 | Morph SHA-256 | Postpack edge slack |
|---|---|---|---|---:|
| Passing but thin | `b17664d262f5bd8bdbea539daff225e55dd8339a80be4b3090e1224e13acbdbe` | `b0b316f55ec9e16b7c0a15a3155404c2b6d41e537ab9a221fdbd23c1a810e0bb` | `4f3295afd32a723852d284f4923519350ea81c5c7a4778c9471ba028f0b4c71b` | 0.0124 µm |
| **Retained research candidate** | `971d7e725252d990abeb52fd0bb10f69e3e64efb0b72dc3f646e8df9d1951c74` | `b0b316f55ec9e16b7c0a15a3155404c2b6d41e537ab9a221fdbd23c1a810e0bb` | `19edf3d8e16486958997ccfdc7b88d55ab7b60a8ab90056d0113b7623115a927` | 1.244 µm |
| Nearby −0.5 µm | `803794653357c596613a8a02aae18c333f71607769109958ae3a0364173184d4` | `b0b316f55ec9e16b7c0a15a3155404c2b6d41e537ab9a221fdbd23c1a810e0bb` | `c90c441443adb20c1c9eae3203bfb0bac507bf0c845bd8a8b50e09cdafc61a6f` | 0.0124 µm |
| Nearby +0.5 µm | `efafbb8f9f1cf3fb80924f9a154fe98a405fe2001daf4380c914239a1c89fa62` | `b0b316f55ec9e16b7c0a15a3155404c2b6d41e537ab9a221fdbd23c1a810e0bb` | `138eae63188c1754d8d1c1aa09a47cf085c11cb97bcdd69392e20a0ff1a4b95f` | 1.244 µm |

The retained candidate's exported bound GLB SHA-256 is `8f37b8a91f0a502ba8d586b5077c70dfce58f16fd76cc5593bef74aa460c6646`; the full ignored `verification.json` SHA-256 is `759bc6b03a94a80ab599aa3cff1054b14565e22b83ca21f9987f96f9fe8fa079`. The per-case reports, logs, buffer readbacks and `margin.json` stay in its ignored build. The other resource build IDs are `roundtrip-crease-1790203032080699700` (thin), `roundtrip-crease-1790203498327853800` (−0.5 µm) and `roundtrip-crease-1790203668819478400` (+0.5 µm).

All four builds used the same ignored source build `D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/build-1790134714546030800`, WolvenKit CLI file version **8.17.4.0** (exe SHA-256 `fdffea5f19a13a5abf57487acf4e9cffce35e789d8f0d8ef551130021a086201`), the project morph adapter DLL SHA-256 `5df36248fe10b1ac543b6c68776a488572cface3c293b33810b96a241f08f37c`, and .NET SDK `9.0.205`. Another serializer build, source head, mapping, or import configuration requires a fresh binary readback; these hashes and margins cannot be transferred by assumption. The current sampled idle is the decoded adapter, not the game's animation graph, and the 107 static cases do not cover every possible morph combination. Close-up visual inspection, unsampled phases, lighting/material tests and eventual batched runtime evidence remain. These limits and nearby-bin sensitivity keep the result research-only despite the passing sampled gates.

No new community resource informed this search; it extends the already credited WolvenKit, original head and existing project tools.
