# Character-creator controls and presets

**Status (26 Sep 2026): the data layer is done; the panel and live preview are next.** Track 3 in the [ranked queue](README.md). The Studio now builds a typed catalogue of every creator option for either body gender from the installed game and CCXL mods, with labels, sections, swatches, provenance and preview coverage, and a character context service holds one choice per option, loads a save or a portable preset, and derives the resolver's request. No control is on screen yet.

## Requirement

The Studio lets a user choose only the **eye shape** and **preview piercing style/colour**, plus visibility toggles for brows, lashes and saved-V hair. Everything else comes from an imported save, so makeup can only be judged on the author's own V.

1. **Expand to all character-creator options** so users can check their work on characters other than their own: skin tone/type, eyes and eye colour, brows and brow colour, lashes, hair and hair colour, facial morphs (nose, mouth, jaw, ears), piercings, teeth, cyberware/skin details and any CCXL options the user has installed.
2. **Later:** save CC values back to a save file.
3. **Later:** share and load reusable CC presets (a character look other users can load to test their makeup on the same face).

## Current state

| Area | State |
|---|---|
| Saved-V import | Read-only decode of the whole appearance node; the preview resolves skin, face details, eyes, brows, lashes, hair and piercings through the generic resolver. [Save import](../eye-artistry/save-import.md). |
| Option discovery | `loadMergedCco` (`src/character-resolver.ts`) merges the installed base creator resource (the `_ep1` twin with Phantom Liberty) with every `.xl`-registered custom resource the way ArchiveXL does. Its optional reader lets the catalogue carry presentation fields through the merge. |
| **Creator catalogue** | `src/cc-catalogue.ts` (pure) and `src/cc-catalogue-host.ts` (host). Every option and choice with its type, order, row (options sharing a `uiSlot`), section, label, Off flag, swatch colour and icon reference, link, controlling switchers, consumer groups, provenance (vanilla, or mod and custom resource) and preview coverage. Schema `xfs/cc-catalogue-1`. `bun tools/cc-catalogue.ts [--gender male]` prints it for the configured installation. |
| **Labels** | The player's on-screen language from the game's settings; the game's `onscreens.json` texts (base and EP1) plus every ArchiveXL `localization.onscreens` declaration, merged as ArchiveXL does (`src/game-text.ts`). Values that aren't keys (`01`) show as written, as the creator does; unresolved keys get a readable name. |
| **Sections and icons** | TweakDB's creator category list (`CharacterRandomization.CharacterRandomizationCategories`), matched to each option's `randomizeCategory`; icon records to inkatlas parts (`src/tweakdb-flats.ts`, `src/cc-presentation.ts`). |
| **Character context** | `src/character-context.ts`: one value per option by portable identity; from the default V, a decoded save or an `xfs/cc-preset-1` preset; typed actions with capabilities; link propagation; missing-choice report; save check; the R5 request and today's preview request. |
| **CC preset format** | `xfs/cc-preset-1` (`src/cc-preset.ts`): part, option and choice identities, the `.app` hash hint, the switcher's activated options, and the supplying mod's name and resource hash. Unknown fields and entries round-trip. |
| **Preview coverage** | Per option: `rendered` (morphs, skin, brows, lashes, hair, eyes, piercings), `conditional` (other face-group appearances: drawn only when their parts are face decals, which teeth are not), `not-rendered` (body, arms, every masculine option). `refineCoverage` settles `conditional` from the preview plan. |
| Source resolution | MO2 and direct routes as before ([mod loading](../../knowledge/mod-loading.md)); Vortex, REDmod, `.ent` patches and TweakXL records are open. |
| Save write-back | Not started. |

### On the reference installation (26 September, MO2 route, English)

| | Feminine | Masculine |
|---|---|---|
| Custom creator resources merged | 242 | 27 |
| Options (user-facing) | 1,341 (943) | 666 (510) |
| Choices (from mods) | 131,856 (124,328; 14,055 of them on vanilla options) | 46,958 (37,604; 20,934 on vanilla options) |
| Options added by mods | 831 | 108 |
| Sections (rows) | Skin 2, Hair 4, Eyes 2, Eyebrows 3, Face 5, Scars 2, Tattoos 2, Face Modifications 4, Makeup 17, Nails 2, Body 7 | Skin 2, Hair 2, Eyes 2, Eyebrows 3, Face 5, Facial Hair 3, Scars 2, Tattoos 2, Face Modifications 4, Makeup 9, Nails 2, Body 5 |
| Option labels | 848 from the game's texts, 1 from a mod's, 92 written out, 2 derived | 508 game, 1 mod, 1 derived |
| Preview coverage of user-facing options | 623 rendered, 281 conditional, 39 not rendered | all not rendered (no masculine head) |
| Texts | 70,579 game entries (base and EP1) plus 924 mod text files from 735 archives | the same |

The first run extracts every mod text file once (about a minute with batched WolvenKit calls); later runs take about 4 s. 534 feminine and 335 masculine icon records are not in the compiled TweakDB (TweakXL-added); their swatches show the colour only. The reference save round-trips through the context: 61 of its 62 saved choices are reproduced, and the one it lacks is a selector of the legacy eye-makeup generator that is no longer installed, reported as missing.

## Decisions (26 September)

- **Everything from data.** No module names an option, slot or mod; a boundary test checks the catalogue and context modules against the vanilla option inventory and known mod names.
- **Order** is the options' own `index`; head, body and arm options form one list, as the creator's `GetUnitedOptions` does. **Rows** are options sharing a `uiSlot`: the creator swaps a row's option by slot. **Sections** are the randomizer categories from TweakDB, in its order and with its titles; a row goes under the category most of its options name. The creator itself has no section headers, so sections are the Studio's grouping, taken from the game's own category data. No mapping table was needed.
- **User-facing** options are those not `hidden`, not link followers, and editable in a new game (`NewGame`). Link followers (the neck, FPP twins, the skin types' tone) take their controller's position.
- **CC context is preview context.** It lives beside the look, not in it: no recipe, collection or package field. The platform design's `xfs/character-part-1` ("include character in this look") can embed the same values later.
- **Presets store what people choose**: user-facing options only; followers are filled by link on load. A switcher choice is matched by the options it activates first (mods renumber choices), then by name. What an installation can't honour is kept and written back on export.
- **Refusal codes:** `asset_unavailable` until a body gender's catalogue is loaded (feature-module platform §9), `missing_target` for an option the installation lacks, `invalid_value` for a choice it lacks or a follower.

## Design constraints

- **Data-driven.** Discover groups, options, switchers and morphs from the user's effective vanilla plus modded `.inkcharcustomization` resources; never hardcode the vanilla list. Show missing or ambiguous resources explicitly and never silently choose the first filename match. (Carried from [the data-driven preset editor requirement](jewellery-and-customization.md#data-driven-character-customization-preset-editor).)
- **Provenance per choice.** Every option shows where it came from (vanilla, which mod, uncertain winner). An installed or enabled mod is a candidate, not a proven runtime winner.
- **Separate CC presets from makeup presets.** A CC preset is preview context; it must not enter makeup recipes, collections or game packages.
- **Portable presets.** Store portable option identities, not personal paths or extracted assets. A preset referencing a mod the loader lacks loads with an explicit missing-option report.
- **Round-trip unknowns.** Preserve unknown custom entries on import/export.
- **Save write-back is a separate, gated phase.** Never modify a save in place without an explicit user action, a verified backup and a round-trip test. Start read-only.
- **Label approximate rendering honestly** (the per-option coverage).
- Selector data, UI construction, saved-value translation and package generation stay separate layers, per the [architecture contract](../authoring/architecture-contract.md).

## Next slice: the panel and live preview

Starts once the in-flight host and presentation tracks merge (`character.tryChoice` and single-slot re-resolution, the long-lived installation, the presentation rework).

1. **Wire the family.** Add `CHARACTER_CONTEXT_FAMILY` to `STUDIO_OWNERS` with a `StudioApplication` handler and the golden registry update; decide whether the context's `character.*` kinds and the cleanup track's `character.tryChoice` share one family.
2. **Host request.** Replace `previewRequestFor`'s saved-V shape with a request carrying the whole creator state (a new `xfs/character-request-3` source), resolved by the host with the same R5 call; re-resolve only the slots whose descriptors changed (compare `CharacterContextRequest`s by slot).
3. **Host catalogue.** Build the catalogue once per installation in the long-lived host (`loadCreatorCatalogue`), expose it through a typed read-only capability, and hand the context its `CharacterSource`. Keep the full catalogue host-side where it is large (130,000 choices here); send the panel rows and the choices of the rows it shows.
4. **Generated panel.** Sections → rows → the active option's choices (swatch grid when `useThumbnails`, stepper otherwise), label, provenance badge and coverage note; Off choices first; the missing-choice report and save check as plain lines. Load/save preset files through the file workflow.
5. **Coverage from the plan.** Feed each resolved record's planned components to `refineCoverage` so `conditional` rows settle to shown or not shown.
6. **Male head**, body and arms rendering remain their own tracks; their rows already say they aren't drawn.

## Open questions and test asks

- Which options does the creator actually list? Link followers without labels are left out; `holstered_data` (arms, feminine) has no label, no link and is not hidden, so it is still listed. Test: count the rows on the creator's body page.
- Does the game load `tweakdb_ep1.bin` with Phantom Liberty? Both blobs hold the same category list in 2.31, so sections don't depend on it.
- Gender variants of texts are untested (no creator text has one in 2.31).

## Related

[CC file chain](../../knowledge/cc-file-chain.md) (presentation, links, R5), [CCXL capabilities](ccxl-character-creator-capabilities.md), [preview fidelity](preview-fidelity.md), [catalogue probe (superseded)](../character-customization/catalog-prototype.md).
