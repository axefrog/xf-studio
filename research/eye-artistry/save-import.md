# Reading V from a save — 23 September 2026

**Proven locally:** the new TypeScript reader decodes the entire player appearance node in the newest local reference save, and Shape Studio applies all five saved facial morphs to the actual head and expanded plate. A full likeness still needs resource resolution/material assembly.

The saved Arkhe brow style 18 and Soft Natural lashes have now been traced into MO2 and rendered as optional reference details, preserving geometry/morphs/weights. The saved definition matches are checked in the UI; colours and material behaviour are approximate. See [head-details assembly](head-details.md).

## User-provided visual references

Two supplied views show the reference V's current in-game appearance: a close view and a wider view (private local photographs). Both are 2000×1600. Original paths, hashes and file metadata are recorded in [reference manifest](visual-reference-manifest.json); originals were not altered.

Visible comparison targets: long dark cool-toned hair, muted gray/green irises, relatively narrow dark brows, pronounced upper/lower lashes, dark teal/charcoal eye makeup, soft pale skin and subdued mauve lips. These are image observations under the photographed lighting, not decoded material values. The current preview has conspicuously warmer/yellower study eyes, different skin detail/specularity and no hair; it should not be presented as the finished likeness. Brow thickness/coverage also needs comparison after implementing the actual material channels, rather than editing geometry to compensate prematurely.

The long visible hair is another reason not to interpret the save's `Short` tag as a reliable description of final modded geometry. The [local saved-hair preview](saved-v-hair-preview.md) now resolves the mesh pair through the installed MELUMINARY package and displays it as optional context; exact dynamic colour, material and physics are still unverified. Do not assume the photos correspond exactly to AutoSave-12's moment or infer preset IDs from their pixels. Compare a similar camera/pose and lighting; reserve any fresh game captures for one batched fidelity check.

## Evidence

Source: `%USERPROFILE%/Saved Games/CD Projekt Red/Cyberpunk 2077/AutoSave-12/sav.dat`, last modified 13 September 2026, 19:47:06 Brisbane. Selected by `sav.dat` modification time, not just the folder name. There are 163 local save directories; this is the newest local save found, not a claim about cloud saves or unsaved game state.

Copied source, metadata and decoded appearance: [capture directory](../../captures/2026-09-23-save-appearance/appearance.json). SHA-256 of original and copy: `9e10c26476cb9e6d7a72164f7a2090ee3204c3fe4f23ea85c5353686da5c0748`. Original remained unchanged.

- Save version 269; game version 2310 / metadata patch 2.31; preset version 12.
- 33 compressed chunks; 8,509,596-byte expanded buffer including the prefix/table offset region.
- `CharacetrCustomization_Appearances` node: 9,109 bytes, all consumed, zero trailing bytes. The misspelling is the actual engine node name.
- 106 appearance entries across head, arms and body groups. These include perspective duplicates; they are **not 106 user presets**.
- Head includes `TPP`, `FPP`, `hairs`, `character_customization`, proxies, photo-mode and `face` groups. The editor currently uses `character_customization`, falling back to `TPP` for facial morphs.

| Region | Saved target | Blender preview before import |
|---|---|---|
| Eyes | `h091` → `h091_eyes` | Same |
| Nose | `h012` → `h012_nose` | `h032_nose` |
| Mouth | `h053` → `h053_mouth` | `h043_mouth` |
| Jaw | `h054` → `h054_jaw` | Same |
| Ears | `h145` → `h145_ear` | Same |

The saved customization group has 13 appearance references, including:

| Choice | Saved definition |
|---|---|
| Skin `skin_type_05` | `h0_000_pwa__basehead__01_ca_pale_00_warm_ivory` |
| Eyes | `eye_16_diffuse` |
| Hair `lm097_hair` | `38_ash_brown` |
| Brows `ark_eyebrows_02_ccxl_18` | `10_brown_ombre` |
| Lashes `icxrus_softnaturaleyelashes` | `05_brown_liquorice` |
| Eye Artistry `xfea_layer1_e04` | `xfea_layer1_006_matte` |
| Eye Artistry `xfea_layer2_s01` | `xfea_layer2_006_matte` |
| Eye Artistry `xfea_layer3_s02` | `xfea_layer3_033_matte` |

Each appearance also retains an unsigned 64-bit resource hash as a decimal **string**, avoiding JavaScript's numeric precision limit. The current procedural study does not silently replace its shapes with these old art designs.

## How import works

The format has a CSAV header, FZLC chunk table, LZ4-compressed 4ZLX blocks (or uncompressed chunks), and an indexed node directory at the end. The reader reconstructs the node-offset coordinate space, locates the appearance node, and reads its groups, appearance resource hashes, definitions, morph region/target pairs, perspectives and tags. It has bounded file/chunk/collection/string sizes and rejects incomplete appearance records. It has **no save-writing path**.

Current implementation: [reader](../../projects/xf-studio/authoring/src/save-reader.ts), [CLI](../../projects/xf-studio/authoring/tools/read-save.ts). Browser file selection is local; save bytes are never posted to the server. The CLI operates on the captured copy. Tested end-to-end on this 2.31 save; the supported version guard is not a claim of exhaustive compatibility with all older saves.

Format references, all read at WolvenKit commit `11720772f1e20581301b3dec88a59f7b5ee05675`:

- [CharacterCustomizationAppearancesParser.cs](D:/Dev/WolvenKit/WolvenKit.RED4/Save/Parser/CharacterCustomizationAppearancesParser.cs)
- [CyberpunkSaveReader.cs](D:/Dev/WolvenKit/WolvenKit.RED4/Save/IO/CyberpunkSaveReader.cs)
- [Compression.cs](D:/Dev/WolvenKit/WolvenKit.RED4/Save/Helper/Compression.cs)
- [BinaryReaderExtensions.cs](D:/Dev/WolvenKit/WolvenKit.Core/Extensions/BinaryReaderExtensions.cs)
- [LZ4 format specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md)

These sources establish format facts. The TypeScript reader is a narrow independent implementation, not a port of the entire save editor. Before distributing any future package, review licenses of actual incorporated dependencies/assets.

## What remains to render the current V faithfully

1. Build a resource resolver from save hash → `.app` → selected definition → component/mesh/morph/material dependencies. Keep full 64-bit identifiers throughout. WolvenKit CLI supports `unbundle --hash`; use it after identifying the relevant archives.
2. Account for the MO2 profile, overwrite, ArchiveXL registrations and replacement archives. A resource referenced by a save is an identifier, not an embedded copy of the asset or proof of which mod won. CCXL examples in this save confirm that vanilla-only resolution would miss major parts of V.
   Configurable sources for future public users are an explicit requirement: MO2, Vortex, or manual `archive/pc/mod` management. Treat non-vanilla references as likely mod assets/overrides; search installed names and hashes before classifying a save choice as unsupported. Manager adapters must resolve effective deployed/profile winners, not assume staging and active resources are identical.
3. Complete the selected skin, eye overlay, teeth, decals and rig, and calibrate the now locally resolved brows, lashes and hair. Handle component visibility and perspective groups deliberately. Saved clothing/equipment and script-driven appearance changes may need additional nodes or a runtime snapshot.
4. Map game material behavior into the browser and validate with a small batched game capture. The save does not include final renderer pixels, runtime lighting or all mod-managed state.
5. Add a resolved-character manifest with hashes, installed mod versions and explicit missing assets. For others, consume their own local game/mod data; do not bundle extracted game/third-party assets into the editor distribution.

The current save's appearance is a composite preset with multiple rendering groups. Separate user-managed preset collections may live outside saves. [CyberCAT documentation](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/main/for-mod-creators-theory/modding-tools/savegame-editor-cybercat.md) describes exported `.v2preset` files. [Character Preset Manager's source](https://github.com/DKLYNTLY/Character-Preset-Manager-CET-) is an additional research lead for CET-side preset capture. Neither file format has been integrated or tested here yet.

This work also supplies a concrete input to the queued [CCXL capability study](../backlog/ccxl-character-creator-capabilities.md): distinguish saved morph/appearance choices from game UI selectors and transient runtime state. No game launch was needed.
