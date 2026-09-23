# Community credits and learning record

XF Appearance Studio builds on the discoveries, tools and creativity of the Cyberpunk modding community. This living record gives credit for what we learn, including ideas that inform an independent implementation. It also identifies tools and assets used in our work so their contributions remain visible when preparing public acknowledgements.

Started 23 September 2026, with an initial backfill from existing research. This is not a claim that every earlier influence has already been recovered. Add missing contributions as they are identified. Authorship of the five Nexus mods below was checked against each page's **Created by** field on that date; installed versions describe our actual research inputs, not necessarily the latest release.

## Mods that taught us concrete techniques

| Source and credit | What it contributed | Use and evidence |
|---|---|---|
| [Hair Color Profiles CCXL](https://www.nexusmods.com/cyberpunk2077/mods/19115) — **island_dancer and psiberx**. Local folder: Hair Profiles CCXL; installed metadata `f1.02`. | A working example of shared material templates, dynamic material paths, resource scopes/patches, and explicit character-creator colour definitions. Helped distinguish reusable resource patterns from assumptions about arbitrary selector context. | **Learning from resource inspection.** [Consumer study](../research/consumers/README.md) and [ArchiveXL strategy](../research/archive-xl/eye-artistry-strategy.md). Extracted references stay local; no mod payload is packaged. |
| [Photoreal Eyes CCXL](https://www.nexusmods.com/cyberpunk2077/mods/22412) — **island_dancer and psiberx**. Inspected version 1.0. | Demonstrated 32 appearance stubs sharing one `@eyes` material template, with dynamic diffuse/normal paths. Concrete evidence that material duplication can be reduced dramatically. | **Learning from resource inspection.** [Consumer study](../research/consumers/README.md). Eye shading is not proof of makeup-decal behaviour. |
| [Heterochromia Eyes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/20349) — **icxrus**. Inspected installed version 2.0.0. | Separate left/right appearance routing and morph-skinned components supplied a real example of independently selected components. Its remaining static enumeration also helped separate framework capability from a consumer's implementation choices. | **Learning from resource inspection.** [Consumer study](../research/consumers/README.md). The public page listed 2.1.0 on the attribution check; that newer payload was not the inspected input. |
| [Beautiful EYEBROWS II - CCXL - Realistic Textures - BOTH V](https://www.nexusmods.com/cyberpunk2077/mods/26168) — **Arkhe** (uploader Arkhe0). Inspected version 1.0, Fuller variant. | Its copy/patch declarations showed how apparently incomplete resources become complete using vanilla geometry. Taught us to resolve component references and ArchiveXL assembly instead of trusting a stale dependency list. Style 18 provides nearby brow context when judging makeup on Nathan's V. | **Learning plus local reference-asset use.** Style texture used in the local preview with resolved vanilla geometry; see [head-details assembly](../research/eye-artistry/head-details.md). No redistribution permission is inferred from local use; derived preview assets remain excluded from Git/releases. |
| [Soft Natural Eyelashes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29582) — **icxrus**. Inspected version 1.0. | Supplied the saved V's lash geometry and deformation reference, making the makeup preview more useful. Its resource dependencies also exposed the need to resolve MO2 assets in an isolated export context rather than relying on the game folder alone. | **Learning plus local reference-asset use.** Mesh/morph data used locally; [head-details assembly](../research/eye-artistry/head-details.md) and [asset manifest](../projects/xf-appearance-studio/authoring/evidence/details-manifest.json). Excluded from redistribution; credit does not grant asset permission. |

## Frameworks, tools and shared documentation

### ArchiveXL — psiberx and contributors

[Repository](https://github.com/psiberx/cp2077-archive-xl), inspected release 1.27.3, commit `5474e34d56112f5d8843ae863e1e72ff510957c0`.

The customization, mesh and garment extension source established exactly how CCXL registers options, clones appearance templates, routes suffixes to mesh appearances, expands material paths, and splits composite material attributes. This is the central technical foundation for avoiding the old per-combination material matrix and for the proposed single-selector preset exporter. The author's wiki also helped distinguish garment context from character-creator capabilities.

**Use:** source-grounded learning and intended runtime dependency; not a claim that ArchiveXL source has been incorporated into our implementation. [Strategy and pinned source evidence](../research/archive-xl/eye-artistry-strategy.md) record functions, limits and unresolved game checks.

The [first one-selector fixture](../experiments/005-preset-collection/README.md) additionally uses the garment hook's missing-appearance guard to preserve an exact empty Off, a named component override for cloned presets, and shared material expansion with lightweight mesh stubs. Inspecting the first-override-array assumption informed the generated empty Off structure. Its source-derived checks remain distinct from game execution.

### WolvenKit — the WolvenKit team and contributors

[Repository](https://github.com/WolvenKit/WolvenKit). Save-format research used commit `11720772f1e20581301b3dec88a59f7b5ee05675`; conversion experiments use installed CLI 8.17.4. Do not conflate these revisions.

Its save parser supplied format facts for our narrow read-only TypeScript appearance reader. Shader-cache structures made the cache index/disassembly investigation possible. Mesh/morph and animation conversion exposed packing, bone-map, shading-delta and float-track details, while its CLI and libraries enabled extraction, serialization, round-trip verification and animation export. Facial-setup readers provided the first map of the game's pose/corrective data.

**Use:** learning plus executed tools and referenced .NET libraries. Evidence: [save reader research](../research/eye-artistry/save-import.md), [shader investigation](../research/materials/glitter-shader-investigation.md), and [plate conversion](../experiments/004-plate-import/README.md). Animation intake is ongoing. Any distributed dependency must retain its own applicable license/notices; this record is not a license inventory.

Its appearance preprocessor and RedPackage writer also taught us how newly authored component definitions become compiled `.app` data. [Experiment 005](../experiments/005-preset-collection/README.md) verifies that actual conversion, independent handle identities, packed resources and decoded texture channels rather than relying only on our generated JSON.

[Experiment 006](../experiments/006-plate-clearance/README.md) extends the resolver lesson to read-only head morph export: the original base mesh archive is needed to recover skin weights/bones, as well as for morph import. Its packing behavior also exposes the small nonzero lighting delta produced when newly introduced morph records encode an intended zero in the shifted 10-bit format. We separately record that quantization rather than claiming exact shading preservation for those new records.

### Cyberpunk Blender Add-on / IO Suite — its authors and RED Modding maintainers

[Repository](https://github.com/WolvenKit/Cyberpunk-Blender-add-on), intake commit `7a4ee793c36d9615946fe87ec9d42cde7568021d`, inspected 23 September 2026. Credit the [upstream author list](https://github.com/WolvenKit/Cyberpunk-Blender-add-on/blob/7a4ee793c36d9615946fe87ec9d42cde7568021d/i_scene_cp77_gltf/__init__.py) and contributors collectively; individual authorship of the facial solver has not yet been established. The manifest declares `GPL-3.0-or-later`.

The documentation and native facial solver provide a concrete route from animation float tracks through envelopes, limits and corrective poses to facial movement. This changed the idle investigation from treating flat exported bone channels as a dead end to investigating an existing community solver for mouth, blink and gaze playback.

**Use:** documentation/source study plus execution of the unmodified external numerical solver for a local facial-animation bake. Our adapter loads the pinned checkout without registering Blender UI; no solver implementation was copied into browser code. It produced 663 frames affecting 253 facial bones, now composed with the body idle in the preview. [Bake adapter](../projects/xf-appearance-studio/authoring/tools/bake_idle_face.py) and [provenance/limitations](../projects/xf-appearance-studio/authoring/evidence/idle-face-bake.json) record exact inputs and output. In-game parity, wrinkle rendering and scale-driven effects remain unproven; the upstream declaration does not by itself establish licensing of every possible distributed combination. Keep the local game-derived bake out of releases.

### Cyberpunk 2077 Modding Wiki — manavortex and the contributor community

[Documentation repository](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs) and [wiki](https://wiki.redmodding.org/cyberpunk-2077-modding). **Special thanks to manavortex for writing much of the wiki and helping maintain its availability as a resource for modders.** Nathan supplied this attribution on 23 September 2026. That sustained authorship and stewardship made the research below accessible to us. Credit also belongs to the wider community of authors and editors; authorship of each particular page has not yet been resolved, so this acknowledgement does not assign every page to manavortex.

- [CCXL hair guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-hairs): one-appearance app/mesh template patterns helped frame the dynamic makeup investigation.
- [Materials overview](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials) and [multilayered guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/multilayered), supplied by Nathan: clarified mask/setup/template roles and suggested variants to inspect. See [our assessment](../research/materials/multilayered-makeup-assessment.md).
- [FX material reference](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/configuring-materials/fx-material-properties): pointed to the glitter material family; current archive/shader inspection then narrowed what it actually does. See [glitter research](../research/materials/glitter-shader-investigation.md).
- CyberCAT documentation identified external `.v2preset` files as a separate research lead; that format has not been implemented. See [save research](../research/eye-artistry/save-import.md).

**Use:** learning and research leads. These guides inform hypotheses; current source/resource checks establish which claims apply to our specific assets and versions.

### Three.js — mrdoob and contributors

[Repository](https://github.com/mrdoob/three.js), installed version 0.186.0. The local `PerspectiveCamera` source explicitly defines FOV as vertical degrees; this informed the studio's labelled camera control and projection updates. OrbitControls' camera/target model underpins restoring orbit and distance, and the library's loaders, skinning, materials and animation mixers enable our browser preview. [Workspace and renderer implementation](../projects/xf-appearance-studio/authoring/README.md) records our custom adapters and limits. **Use:** executed dependency and API/source learning; this does not imply visual parity with REDengine shaders. Preserve the dependency's upstream license/notices when distributing the application.

## Other foundational contributions and unresolved attribution

- **CD PROJEKT RED:** the original game art, rigs, facial setups, animation and materials underpin our local preview and experiments. These remain game-derived references, not original XFAS art. CDPR's technical-art explanation in [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) contributed the rationale for shared surfaces, masks and a calibrated external preview; see the multilayered assessment above.
- **Nathan / axefrog:** the original Eye Artistry concept, generator and hand-painted art established the starting requirements; the expanded head-cut eye plate is the authored starting geometry. [Lineage](../research/eye-artistry/lineage.md) preserves sources and changes. This is distinct from authorship of the underlying CDPR head geometry/rig.
- **The modder who recommended ArchiveXL dynamic expansion to Nathan:** their advice motivated the central reduction investigation. Name/message link not supplied; preserve this credit pending identification.
- **The Discord member who suggested shimmer to Nathan:** contributed a finish-category idea. Name/message link not supplied; our later optical interpretation must not be attributed to her as if she specified it.
- **DKLYNTLY's [Character Preset Manager](https://github.com/DKLYNTLY/Character-Preset-Manager-CET-):** recorded as a lead for CET-side preset capture. No specific implementation lesson or reuse established yet; move into the substantive record when studied.
- **LZ4 authors/contributors:** the [block-format specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md) supported the independent decompression logic used by the save reader. Referenced in the save research above.

Other installed or surveyed frameworks/mods are not automatically claimed as studied influences. Add TweakXL, Codeware, RED4ext, redscript, CET or another source here when a concrete lesson is drawn from it, recording that lesson rather than merely copying the inventory. Runtime/package dependencies also need their own appropriate acknowledgements and notices when distributed.

## Entry checklist

For each new contribution record: **source/mod/repository and link; author/contributors or an explicit attribution gap; inspected version/commit/date; what it taught or enabled; where we used it; learning/tool/code/asset use; relevant reuse terms if applicable.** Amend existing entries when new lessons emerge. Keep unresolved leads visibly separate from completed study, and never erase credit because the eventual implementation took a different form.
