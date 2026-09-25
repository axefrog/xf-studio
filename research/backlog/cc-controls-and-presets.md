# Character-creator controls and presets

**Status (26 Sep 2026): slice 2 is done — every creator option can be changed in the Character panel, with live preview, its own Undo and portable presets.** Track 3 in the [ranked queue](README.md). The Studio builds a typed catalogue of every creator option for either body gender from the installed game and CCXL mods (slice 1), and the Character panel now shows it: sections, rows, each row's current choice, Off, Reset to the V's own, provenance, search, paged choices with colour swatches, and a prominent **Hide my V's own makeup**. The character context owns every creator choice on the shown V; the host derives the V from it and re-resolves only what changed. Save write-back, the masculine head, body rendering and choice icons remain.

## Requirement

The Studio let a user choose only the **eye shape** and **preview piercing style/colour**, plus visibility toggles for brows, lashes and saved-V hair. Everything else came from an imported save, so makeup could only be judged on the author's own V.

1. **Expand to all character-creator options** so users can check their work on characters other than their own: skin tone/type, eyes and eye colour, brows and brow colour, lashes, hair and hair colour, facial morphs (nose, mouth, jaw, ears), piercings, teeth, cyberware/skin details and any CCXL options the user has installed. **Done (slice 2).**
2. **Later:** save CC values back to a save file.
3. **Share and load reusable CC presets** (a character look other users can load to test their makeup on the same face). **Done (slice 2):** `xfs/cc-preset-1` files through the file workflows.

Why it mattered now: rendering is data driven, so the V's own eye makeup (vanilla, or the legacy XF Eye Artistry CCXL build on the reference character) shows underneath the Studio's authored makeup, as the game draws it. Turning it off was the first priority.

## Current state

| Area | State |
|---|---|
| Saved-V import | Read-only decode of the whole appearance node; the preview resolves skin, face details, eyes, brows, lashes, hair and piercings through the generic resolver. [Save import](../eye-artistry/save-import.md). |
| Option discovery | `loadMergedCco` (`src/character-resolver.ts`) merges the installed base creator resource (the `_ep1` twin with Phantom Liberty) with every `.xl`-registered custom resource the way ArchiveXL does. A mod archive replacing the base resource names that mod as its options' source (PIPE-46). |
| **Creator catalogue** | `src/cc-catalogue.ts` (pure) and `src/cc-catalogue-host.ts` (host). Every option and choice with its type, order, row (options sharing a `uiSlot`), section, label, Off flag, swatch colour and icon reference, link, controlling switchers, consumer groups and provenance. Schema `xfs/cc-catalogue-1`; it shares no list with the merged resource (CORE-62) and carries no preview coverage (CORE-60). `bun tools/cc-catalogue.ts [--gender male]` prints it for the configured installation. |
| **Catalogue service** | `src/cc-catalogue-service.ts` builds each body gender's catalogue once per installation in the long-lived host (the registry's shared installation; rebuilt when the installation fingerprint changes) and answers the panel at `/api/preview-character/creator` (`src/cc-catalogue-server.ts`): the first-paint projection, paged choices, the view of a context, the head descriptors for a preparation, and presets. |
| **Panel projection** | `src/cc-panel.ts`, `xfs/cc-panel-1` (UI-59): sections → rows → options with label, type, choice count, Off and default keys, link, "turned on by", coverage and provenance, mods and notes in tables by index; choices in pages of 240. 300 KB for the reference installation's 943 options and 131,856 choices; a test keeps a 1,000-option, 130,000-choice creator under 600 KB. |
| **Labels** | The player's on-screen language from the game's settings (`gameLanguageOf`; `LOCALAPPDATA` unset or relative reads nothing, PIPE-51); English when the language's text archive isn't installed, with a gap. The game's `onscreens.json` texts plus every ArchiveXL `localization.onscreens` declaration, merged in the order and with the keying ArchiveXL uses (`textPlan`, `TextTable`; PIPE-47, PIPE-48). |
| **Sections and icons** | TweakDB's creator category list, matched to each option's `randomizeCategory`; a head option without a category joins its neighbours (UI-60); icon records to inkatlas parts. TweakDB counts are bounded (PIPE-49). The panel shows swatch colours; icons are not drawn yet. |
| **Character context** | `src/character-context.ts` (pure, shared): the state is the V's source (default, save, preset) and the choices a person set, by portable identity. `deriveCharacter` interprets it with the catalogue: the save's recovered state, the choices in order (one per link family; switcher link members by activated options, CORE-61), R5, and the save's own descriptors for every option the choices don't reach or change; with a view of every active row's current choice and the V's own, and the missing-choice report. `CharacterContextActions` (`src/character-context-actions.ts`) owns the state in the Studio: the `characterContext` family, its own Undo history, persistence and the panel's reads. |
| **Host request** | `xfs/character-request-4`: the save's descriptors of every part (`part` on each) and the choices. A request with choices is derived by the catalogue service; the preparation resolves and exports only what isn't in its cache yet. v1–v3 requests without a tried choice still parse. |
| **Character panel** | `src/studio-ui/panels/character.ts`. The V's source and Load a save / Load preset / Save preset / Default V, Undo and Redo, one status line (Updating…, a change that couldn't be shown, loading), Keep my changes after a new V, the missing-choice report; **Hide my V's own makeup**; search; the generated rows; then the 3D view's own controls (eye shape, visibility toggles). Keyboard: rows are buttons, choices a radiogroup with arrow keys, Home and End; Ctrl+Z / Ctrl+Y inside the panel step the character history. |
| **Preview coverage** | The preview side's projection (`catalogueCoverage`): `rendered` (morphs, skin, brows, lashes, hair, eyes, piercings), `conditional` (other face-group appearances; settled from the parts the shown record draws), `not-rendered` (body, arms, every masculine option), shown on the row as "Not shown in the 3D view yet". |
| **CC preset format** | `xfs/cc-preset-1` (`src/cc-preset.ts`): part, option and choice identities, the `.app` hash hint, the switcher's activated options, and the supplying mod's name and resource hash; only the choices set. Size counted in UTF-8 bytes, unknown data copied into prototype-free objects with bounded depth and size, JSON read once (CORE-54, CORE-55); what the reader would refuse is left out on writing and counted (CORE-53); the host leaves out a name or kept data naming a personal folder or address (`src/private-data.ts`, the repository's patterns; CORE-56). |
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
| Preview coverage of user-facing options | 623 rendered, 281 conditional, 39 not rendered | all not rendered (no masculine head) |
| Catalogue build in the host | 93 s cold (924 mod text files extracted once), 2.5–3.1 s warm | – |
| Panel first paint | 300,889 bytes | – |

### Measured in the browser (`?verify=1`, reference MO2 profile, 26 September)

| Change on the reference save's V | End to end, V on screen throughout |
|---|---|
| **Hide my V's own makeup** (5 rows: three legacy XF Eye Artistry layers, lipstick, blush) | 66 ms (cached); the host prepared it in 0.06 s |
| Undo / Redo of a cached change | 56–195 ms |
| A choice whose files were read before (hair colour, skin tone, eye colour, piercing style, brows Off) | 0.66–0.78 s |
| A choice needing new files from the game (WolvenKit export) | 3.7–19.5 s the first time |
| A view of the current choices (host) | 80 ms |

## Decisions (26 September)

- **Everything from data.** No module names an option, slot or mod; a boundary test checks the catalogue, context, panel and host modules against the vanilla option inventory and known mod names. The one named grouping is the game's creator category `Makeup` (`gamedataCharacterRandomizationCategory`), which the quick action turns Off.
- **Order** is the options' own `index`; head, body and arm options form one list, as the creator's `GetUnitedOptions` does. **Rows** are options sharing a `uiSlot`. **Sections** are the randomizer categories from TweakDB, in its order and with its titles. A row shows its active option (R5 activation); a row whose active option offers a single choice (an Off placeholder) is hidden, as the creator shows nothing to choose.
- **User-facing** options are those not `hidden`, not link followers, and editable in a new game (`NewGame`).
- **The context owns every creator choice for the shown V** (CORE-58). `character.tryChoice` is retired: a piercing style is the Piercings row. `CharacterDetailActions` only shows the V the context describes.
- **Only what the person set is stored** (CORE-50, CORE-51): one choice per link family; followers and other controllers are derived at request time; Reset recomputes the family; presets hold only these choices.
- **A choice changes only what it reaches.** With a save as the base, the save's own descriptors stay for every option a choice neither reaches (itself, its link family, what its switcher choice turns on) nor changes; a saved option the installation no longer offers still draws as saved.
- **The host does the interpretation.** The page holds the state and a compact projection; the host has the whole catalogue and derives views, descriptors and presets. The page checks a choice against the option's choices once they are all loaded; the host checks every choice and reports what it can't honour.
- **Own Undo history** (CORE-59): in memory, 100 steps, one step per change, per quick action, per V change (a save or preset load), with Keep my changes after a V change. Reset needs its part. Not persisted.
- **Persistence**: the workspace's preview state `character` (`{origin, name?, bodyGender?, choices, kept?}`) only once something was set; a newly loaded save clears the choices (Keep my changes brings them back); the retired piercing-style fields are written empty.
- **Live preview**: a change on the same V keeps it on screen (`updating`); only another V clears first. A change that can't be prepared keeps the V as shown and says why (CORE-63). The head's facial shape follows the context's view; the 3D view's own eye-shape control stays on top of it.
- **Presets store what people choose**: a switcher choice is matched by the options it activates first (mods renumber choices), then by name. What an installation can't honour is kept and written back on export.
- **Refusal codes:** `not_ready` before the preview and while the catalogue loads (CORE-64), `missing_target` for an option the installation lacks, `invalid_value` for a choice it lacks, a follower, or nothing to reset.

## Design constraints

- **Data-driven.** Discover groups, options, switchers and morphs from the user's effective vanilla plus modded `.inkcharcustomization` resources; never hardcode the vanilla list. Show missing or ambiguous resources explicitly and never silently choose the first filename match. (Carried from [the data-driven preset editor requirement](jewellery-and-customization.md#data-driven-character-customization-preset-editor).)
- **Provenance per choice.** Every option shows where it came from (vanilla, which mod, uncertain winner). An installed or enabled mod is a candidate, not a proven runtime winner.
- **Separate CC presets from makeup presets.** A CC preset is preview context; it must not enter makeup recipes, collections or game packages.
- **Portable presets.** Store portable option identities, not personal paths or extracted assets. A preset referencing a mod the loader lacks loads with an explicit missing-option report.
- **Round-trip unknowns.** Preserve unknown custom entries on import/export.
- **Save write-back is a separate, gated phase.** Never modify a save in place without an explicit user action, a verified backup and a round-trip test. Start read-only.
- **Label approximate rendering honestly** (the per-option coverage).
- Selector data, UI construction, saved-value translation and package generation stay separate layers, per the [architecture contract](../authoring/architecture-contract.md).

## Next

1. **Choice icons**: draw the TweakDB icon records' inkatlas parts in the swatches (skin tones and eye colours use icons, so their swatches show text today). Needs the atlas textures from the host.
2. **Face shape from the context**: the head's morphs follow the context's view; the preview's own eye-shape control still decides the eyes region. Decide whether the Eyes row and that control become one.
3. **PIPE-50**: a JSON-resource mode in the resolver's fetcher instead of the catalogue host's own WolvenKit batching for `.json` text resources. Left for the resolver owner (the fetcher lives in `resolver-host.ts`, which the claude/cleanup-hosts3 track owns).
4. **Masculine head**, body and arms rendering remain their own tracks; their rows already say they aren't drawn.
5. **Save write-back**, gated as above.

## Open questions and test asks

- Which options does the creator actually list? Link followers without labels are left out; `holstered_data` (arms, feminine) has no label, no link and is not hidden, so it is still listed. Test: count the rows on the creator's body page.
- Linked hairstyle switchers carry the style that turns on the same hair (CORE-61, [test ask 11](../../knowledge/cc-file-chain.md#in-game-test-asks)).
- Does Off on every makeup row leave nothing drawn on the legacy build ([test ask 12](../../knowledge/cc-file-chain.md#in-game-test-asks))?
- Does the game load `tweakdb_ep1.bin` with Phantom Liberty? Both blobs hold the same category list in 2.31, so sections don't depend on it.
- Gender variants of texts are untested (no creator text has one in 2.31).

## Related

[CC file chain](../../knowledge/cc-file-chain.md) (presentation, links, R5), [CCXL capabilities](ccxl-character-creator-capabilities.md), [preview fidelity](preview-fidelity.md), [catalogue probe (superseded)](../character-customization/catalog-prototype.md), [action catalogue](../authoring/ui-action-catalogue.md#the-character-namespace).
