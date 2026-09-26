# Reference save's modded eyes — 23 September 2026

**The saved choice resolves to Kala’s Eyes Standalone V2, exposed through nutboy’s Unique Eyes to CCXL.** It is not the Photoreal Eyes CCXL option initially suspected. Current installed-resource inspection and an existing September 16 runtime log agree on the CCXL material source. This does not yet establish browser rendering parity or a new live-game capture.

## Resource chain

The captured [save](save-import.md) selects appearance resource hash `7132639559252259433`, definition `eye_16_diffuse`, in the female character’s appearance groups.

1. That hash resolves to `archive_xl\characters\head\player_base_heads\appearances\head\he_000_pwa__basehead.app`. The unique on-disk provider in the scan is the installed ArchiveXL bundle, `F:/Games/MO2/mods/ArchiveXL/red4ext/plugins/ArchiveXL/Bundle/ArchiveXL.archive`. The definition is absent from the serialized base app: a raw app lookup alone would incorrectly report this valid saved eye choice as missing.
2. `F:/Games/MO2/mods/Unique Eyes to CCXL/archive/pc/mod/NUT_unique_eyes_ccxl.xl` registers `nutboy\ccxl_unique_eyes\eyes_ccxl.inkcharcustomization` and patches `player_wa_eyes.mesh` / `player_ma_eyes.mesh` with `nutboy\ccxl_unique_eyes\meshes\patch.mesh`.
3. That customization resource includes `eye_16_diffuse` (index 74). Its mesh patch has a matching appearance and local material entry `eye_16_diffuse@eyes`, index 15. The material inherits `nutboy\ccxl_unique_eyes\materials\eye_base.mi`, which inherits `base\materials\eye.mt`.
4. The local instance assigns these concrete resources:

| Parameter | Depot path | FNV-1a 64 resource hash |
|---|---|---|
| Albedo | `base\eyes\textures\eye_16_diffuse.xbm` | `7140168419554698265` |
| Normal | `base\eyes\textures\eye_16_normal.xbm` | `15957548315662394704` |
| Roughness | `base\eyes\textures\eye_16_roughness.xbm` | `15197097397900794989` |

All three have exactly one physical provider among the scanned archives: `F:/Games/MO2/mods/Kala's Eyes Standalone V2/archive/pc/mod/basegame_Kala Standalone Eyes V2.archive`. The bridge material and mesh patch likewise have one provider, Unique Eyes to CCXL.

The decoded diffuse is 512×512. Visually it has a muted blue/green/gray iris with warm radial detail, unlike the current yellow study eyes. This is compatible with the supplied photos, but matching colour by inspection is not proof of matching game shading. No application material or texture was changed in this research slice.

## Installed state versus historical runtime evidence

On September 23, `F:/Games/MO2/ModOrganizer.ini` names profile `2025 (again)`. Its modlist enables both Unique Eyes to CCXL and Kala’s Eyes Standalone V2 (lines 768 and 770 at inspection). Both report installed version `1.0.0.0`; Nexus pages currently label them 1.0. ArchiveXL’s inspected installed bundle remains the 1.26.3 installation, while the source reference is current 1.27.3 at `5474e34d56112f5d8843ae863e1e72ff510957c0`. The previously recorded ArchiveXL update is still needed before new runtime tests.

Archive-index scan coverage: 1,103 `.archive` files recursively under MO2/mods (including framework bundles), zero under MO2/overwrite, and 58 under the game/archive tree. No read errors. A separate check found no archives in MO2’s historical `_overwrite_` or the game’s REDmod `mods` tree. The scan examined index hashes, not all payloads; it deliberately included disabled staging mods to detect alternate providers. It did not mount MO2’s virtual filesystem or inspect arbitrary external configured sources. It establishes unique candidates in these roots, not a universal load-order resolver.

The existing local capture `captures/20260923-085239-949631-foundation-existing-logs/mo2-overwrite/archivexl/ArchiveXL-2026-09-16-11-14-16.log` supplies stronger evidence than the enable flags:

- Line 632 loads `NUT_unique_eyes_ccxl.xl`.
- Line 5422 adds `eye_16_diffuse` from nutboy’s patch to the female base-eye mesh; line 7439 repeats the patch later in the session.
- Line 9793 expands the female eye appearance using `blood_gradient_black`.
- Line 9903 successfully instantiates `eye_16_diffuse@eyes` using nutboy’s mesh patch.
- Lines 1018/1040 and 4455/4477 reject the bridge’s roughness/normal fallback links because those resource paths already exist.

Those link errors are relevant: the `.xl` supplies fallback normal/roughness aliases, but it does not replace Kala’s actual maps. Current ArchiveXL `src/App/Extensions/ResourceLink/Extension.cpp:99` explicitly skips a link whose path already exists. The logs corroborate that behavior in the installed older version. Do not “repair” these messages by dropping the real maps or blindly resolving every link to the generic fallback.

The log is September 16; the save is September 13; today’s installed scan is September 23. These dates must remain separate. The log proves historical registration/material instantiation, not that today’s exact texture bytes or final pixels were rendered in that session.

## Reproduction and local evidence

All extracted assets and serialized resources are ignored under `research/consumers/saved-v-eyes/raw/`. `app-scan.json`, `dependency-scan.json` and `manifest.json` preserve local matches and SHA-256 digests. No third-party binary is added to source control.

The narrow index scan follows WolvenKit’s `ArchiveReader.cs` at commit `11720772f1e20581301b3dec88a59f7b5ee05675`: header index position at byte 8; file count at index offset 16; file entries begin at index offset 28 and are 56 bytes each, starting with their unsigned 64-bit name hash. The initial app scan’s archive-entry SHA-1 field is not a payload validation checksum here (the bundle entry contained the empty digest); use the separately calculated extraction SHA-256 values.

To reproduce extraction with WolvenKit Console 8.17.4:

1. `unbundle <ArchiveXL.archive> -o <research-output> --hash 7132639559252259433`, then `convert s <extracted.app>`.
2. `unbundle <NUT_unique_eyes_ccxl.archive> -o <research-output> -r '.*(inkcharcustomization|mesh|mi)$'`, then `convert s <research-output>` for those three resources.
3. Extract each Kala texture by the table’s decimal hash. The CLI hash dictionary does not know these texture names and outputs `<hash>.bin`; a filename regex returned zero matches. Copy the extracted files to the evidenced `.xbm` names, preserving original outputs.
4. `export <eye_16_diffuse.xbm> --uext png -o <existing-output> -gp 'F:/Games/Cyberpunk 2077'` produces the inspected PNG. This CLI requires gamepath even for the narrow texture export.

| Local extracted resource | SHA-256 |
|---|---|
| Diffuse XBM | `80d293a483706af77868fc52b23dc89b18ceb0e8484c8dc971936c0a6ea85df1` |
| Normal XBM | `be2a754bbcc24312405ea01d47a3bf6eabaa61a673070019384936819ddaee00` |
| Roughness XBM | `abb4badb3842b1cbe220508041593770a5017eb92184af9e3db0035ab10e96bd` |
| Diffuse PNG | `cc06290fe63cba59b42f11b97c06e364661e704c206b1e63a3b2c9420bc84d35` |

## Rendering implication and next step

At the time of this study, `authoring/src/scene.ts` (since split into `src/platform/scene/`) loaded the fixed `eye-color` preview texture into a `MeshStandardMaterial`. A first correction can resolve the saved option to this extracted diffuse, retaining an explicit local-asset manifest and current placeholder only for unresolved choices. Verify current eye UV orientation and imported colour space before replacing it. <!-- historical-paths --><!-- /historical-paths -->

A faithful eye cannot be obtained by swapping diffuse alone. The actual material includes a reflection cubemap, `NormalBubble`, iris/refraction/parallax controls, `RoughnessScale` about 0.493421 and `SubsurfaceFactor` about 0.2. These are shader-specific parameters, not directly interchangeable with Three.js controls. Export and inspect the normal/roughness maps, inspect `eye.mt` and its shader behavior, and check any active Character Rendering Editor runtime changes before claiming parity. This supplies a concrete input for the already queued waxy-eye/fidelity investigation without introducing another feature editor.

For a general resolver, keep the distinction between the saved shared app, dynamically registered choice, material patch, fallback resource links and final texture provider. Texture naming alone will not reveal that chain.

## Community provenance for central credits

- [Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), **nutboy** (uploaded as brocreate), installed 1.0; author and current 1.0 page checked September 23. Resource inspection taught the bridge from legacy eye texture slots to additional CCXL choices, named material overrides and fallback maps. Its description credits psiberx, icxrus and redacted-c01 for the eye work, plus halvkyrie’s original framework. This slice is learning/resource inspection, with local extraction only; no code or resources incorporated into the app. The page requires permission for asset reuse/modification; do not redistribute these resources.
- [Kala’s Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), **Kala** (guidethisonekalaheria), installed 1.0; author/current 1.0 and permission statements checked September 23. Supplies the actual selected texture triplet and a local diffuse conversion for later preview fidelity. The page credits **Sarah Cartwright** for the source eye texture. Asset-use permission requires credit and prohibits commercial use/other-game conversion; no redistribution is performed or planned here, and those conditions need review before any future packaging.
- [ArchiveXL](https://github.com/psiberx/cp2077-archive-xl), **psiberx and contributors**, source revision above: scoped eyes, shared app, dynamic mesh material instantiation and existing-resource link rejection explain why a static app/texture lookup fails. Update its existing central credit entry with this finding.
- [WolvenKit](https://github.com/WolvenKit/WolvenKit), contributors, Console 8.17.4 and source revision above: index format, hash extraction, resource serialization and XBM conversion enabled the non-game investigation. Tool use and format learning; no implementation copied into the app.

Photoreal Eyes CCXL remains a valuable earlier dynamic-material reference, but the selected saved choice in this investigation is not supplied by it.
