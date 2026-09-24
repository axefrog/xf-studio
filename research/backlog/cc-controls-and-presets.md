# Character-creator controls and presets

**Status (25 Sep 2026): open — requirement captured, implementation not started.** Track 3 in the [ranked queue](README.md).

## Requirement

The Studio currently lets a user choose only the **eye shape** (base mesh plus 21 shapes) and **preview piercing style/colour**, plus visibility toggles for brows, lashes and saved-V hair. Everything else comes from an imported save. That means makeup can only be judged on the author's own V.

1. **Expand to all character-creator options** so users can check their work on characters other than their own: skin tone/type, eyes and eye colour, brows and brow colour, lashes, hair and hair colour, facial morphs (nose, mouth, jaw, ears, cheeks, etc.), piercings, teeth, cyberware/skin details and any mod-added CCXL options that the user has installed.
2. **Later:** save CC values back to a save file.
3. **Later:** share and load reusable CC presets (a character look that other users can load to test their makeup on the same face).

## Current state

| Area | State |
|---|---|
| Saved-V import | Read-only decode of the whole appearance node; five facial morphs applied to head and plate; eye diffuse, brows, lashes, hair and piercings resolved for the captured reference save with documented fidelity gaps. [Save import](../eye-artistry/save-import.md). |
| Selectable in the Studio | Eye shape; preview piercing style and colour (vanilla female, colours 8–16 from source palette tints); brow/lash/hair/piercing visibility. |
| Option discovery | [Read-only catalogue probe](../character-customization/catalog-prototype.md) normalises vanilla `female_cco.inkcharcustomization` plus one mod-added resource (Unique Eyes) into options/choices with provenance. No effective archive-winner claim. |
| Source resolution | [Source discovery foundation](../authoring/source-discovery-foundation.md) inventories direct-game and MO2 candidates; [resolver contract](../character-customization/mod-source-resolution.md) proposed. Vortex, REDmod and ArchiveXL transformations open. |
| Save write-back, CC presets | Not started. |

## Design constraints

- **Data-driven.** Discover groups, options, switchers and morphs from the user's effective vanilla plus modded `.inkcharcustomization` resources; never hardcode the vanilla list. Show missing or ambiguous resources explicitly and never silently choose the first filename match. (Carried from [the data-driven preset editor requirement](jewellery-and-customization.md#data-driven-character-customization-preset-editor).)
- **Provenance per choice.** Every option shows where it came from (vanilla, which mod, uncertain winner). An installed or enabled mod is a candidate, not a proven runtime winner.
- **Separate CC presets from makeup presets.** A CC preset is preview context (who the makeup is shown on); it must not enter makeup recipes, collections or game packages.
- **Portable presets.** Store portable option identities (resource/app hash plus definition name, morph names and values), not personal paths or extracted assets. A preset referencing a mod the loader lacks must load with an explicit missing-option report.
- **Round-trip unknowns.** Preserve unknown custom entries on import/export.
- **Save write-back is a separate, gated phase.** Never modify a save in place without an explicit user action, a verified backup and a round-trip test; a malformed write can corrupt a character. Start read-only.
- **Rendering depends on track 2.** A selectable option is only as useful as its preview. Label approximate materials honestly.
- Selector data, visual UI construction, saved-value translation and package generation stay separate layers, per the [architecture contract](../authoring/architecture-contract.md): options and presets reach the UI through typed actions/capabilities, not direct state.

## Suggested slices

1. Enumerate every vanilla female head option group from the catalogue probe and render the ones whose assets already load (morphs, eye shapes, skin tone), with provenance shown.
2. Add mod-added options through the provider-neutral resolver, including uncertain-winner reporting.
3. Define a portable CC preset format (`xfs/cc-preset-1` or similar) and load/save it locally.
4. Male/body/arms groups.
5. Save write-back behind the gate above; sharing format after that.

## Related

[CC file chain](cc-file-chain.md) (track 5) supplies the resource relationships; [CCXL capabilities](ccxl-character-creator-capabilities.md) (track 8) establishes what ArchiveXL merges; [preview fidelity](preview-fidelity.md) (track 2) covers rendering.
