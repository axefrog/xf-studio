# Writing creator values back to a save: design

**Status: design proposal, 27 September 2026. Nothing is built.** How a set of character-creator values authored in XF Studio could reach the player's game, either by writing them into a **copy** of a save or, without touching any save file, by having the runtime bridge apply them through the game's own creator for the player to confirm. It answers the "later: save CC values back to a save file" requirement of the [CC controls and presets backlog](../backlog/cc-controls-and-presets.md) and follows its gate: *never modify a save in place without an explicit user action, a verified backup and a round-trip test.*

Facts come from the [save import](../eye-artistry/save-import.md) note, the [CC file chain](../../knowledge/cc-file-chain.md) (§2 presentation and links, §7 saves), [worn clothing](../../knowledge/clothing.md) §2 (the save's object packages), [photo mode and the creator from script](../../knowledge/photo-mode.md) §3 and [runtime access](../../knowledge/runtime-access.md), plus the new measurements in §2–§3 below. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** engine, framework or tool source or decompiled scripts; **[resource]** extracted game or mod resources, including bytes of real saves; **[wiki]** Modding Docs; **[runtime]** seen in the running game; **[hypothesis]** not yet established.

## 1. Summary

| Question | Answer | Grade |
|---|---|---|
| Can the Studio write creator values into a save at all? | Yes, structurally. The creator's state is one flat node, `CharacetrCustomization_Appearances`, of length-prefixed strings and integers. Re-encoding the decoded node of two real 2.31 saves reproduces it **byte for byte**. The container has no checksum; a rewrite changes one or two compressed chunks, the node table's offsets and the footer. | [source] [resource] |
| Does the game accept such a save, and does the mirror show the written choices? | **Unknown.** The node is read natively. The one community save editor with an appearance tab has had it disabled since 2.0 ("until it's fully fixed"), so nobody has published a working write for current saves. | [wiki] [hypothesis] |
| Is there a route that writes no save? | Yes: the bridge's `cc.apply` sets each option through the open appearance screen's own rows, and the player presses Confirm and saves. It has worked once in game (a value applied by the bridge was kept by Confirm). It can only change what the screen's mode allows. | [runtime] [source] |
| **Recommendation** | **Build the in-game route first** ("Apply in game") and use it to **generate ground truth**: the save the game writes after applying a preset is the reference an offline writer must reproduce. Build the offline writer as a pure, gated second phase that only ships after one batched session shows the game re-saving our node unchanged. Body gender and voice stay locked to the save's in both routes. | – |

## 2. The save container [source] [resource]

Sources: WolvenKit at commit `11720772` (`WolvenKit.RED4/Save/IO/CyberpunkSaveReader.cs`, `CyberpunkSaveWriter.cs`, `NodeWriter.cs`, `Save/Helper/Compression.cs`, `Save/CSAV/CyberpunkSaveHeaderStruct.cs`, `Save/Parser/CharacterCustomizationAppearancesParser.cs`), the Modding Docs [save file page](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/files-and-what-they-do/file-formats/save-file-.dat.md) (added by darkcart), the Studio's reader (`src/save-reader.ts`), and a read-only structural probe run on scratch copies of two private 2.31 saves (the reference save and the check save; the probe printed layout only, no personal values; the originals were not opened for writing).

A save is a folder holding `sav.dat`, `metadata.9.json` and `screenshot.png` [wiki: CyberCAT page]. `sav.dat`:

| Part | Layout | Measured on both saves |
|---|---|---|
| Header | `CSAV` magic; u32 save version; u32 game version; a length-prefixed string (the game definition path); u64 timestamp (packed time and date); u32 archive version. The wiki's "1 byte padding" is the empty string's length byte. | Save version 269, game version 2310, empty string, archive version 195; 25 bytes |
| Chunk table | `FZLC` magic, u32 chunks used, then 12-byte entries (u32 file offset, u32 stored size, u32 expanded size), zero-padded to a fixed capacity. WolvenKit derives the settings from the capacity: 256 or 512 entries with 256 KiB chunks, 1,024 with 512 KiB. The wiki page spells the magic reversed (`CZLF`). | Capacity 512, chunk size 262,144 bytes; data starts at byte 6,177 |
| Chunks | Each chunk is `4ZLX`, u32 expanded size, then one LZ4 block; the stored size includes those 8 bytes. WolvenKit also writes and reads **uncompressed** chunks (stored size equals expanded size, no magic). The expanded stream is simply cut into fixed-size chunks with no regard for node boundaries. | 33 and 25 chunks, all `4ZLX`, all 262,144 bytes except the last |
| Node table | Located by the footer. `EDON` magic, a VLQ count, then per node: a length-prefixed name, i32 next ID, i32 child ID, u32 offset, u32 size. Offsets are positions in the **expanded coordinate space**, which counts the header and table prefix as if it were expanded data. A node's data begins with its own u32 ID; a parent's size includes its children. | 330 and 169 nodes; IDs equal table positions; offsets strictly increasing |
| Footer | u32 offset of the node table, then `ENOD`. | Present; the node table directly follows the last chunk |
| Integrity fields | **None in `sav.dat`.** Neither WolvenKit's reader nor its writer computes or checks a hash, CRC or signature. | – |
| `metadata.9.json` | The load menu's summary: body and brain gender, level, location, quest, play time, build, `fileSize` and more. | `fileSize` equals the byte length of `sav.dat` in both saves |

**Where the creator node sits** [resource]: in both saves it is a **root-level node with no children**, between `PhotoMode_OutfitWeather` and `tierSystem`, with no gap after it. Only 26 and 25 later nodes follow it, and it lies entirely inside the **last chunk** (reference save: node at expanded offset 8,490,744, 9,109 bytes; the last chunk starts at 8,394,785). So changing its size shifts only the offsets of those later nodes and changes only the last chunk (or adds one more, if the tail grows past a chunk boundary). This position is observed on two saves of one game version, not guaranteed; the writer must compute it, never assume it (§5).

## 3. The creator node [source] [resource]

Layout (WolvenKit's parser and writer, and the Studio's reader, which agree):

| Field | Type | Notes |
|---|---|---|
| node ID | u32 | Written by the node writer, equals the node's table position |
| `DataExists` | bool | 1 for a created V |
| `Unknown1` | u32 | 0 in both saves; WolvenKit guesses "could be CookingPlatform". Preserve. |
| `version` | u32 | Preset version, 12. Equals the installed creator resource's `version` (`female_cco(_ep1)` 2.31: 12), whose `versionUpdateInfo` holds 12 migration steps. |
| `isMale` | bool | Body gender |
| `IsBrainGenderMale` | bool | Voice |
| head, arms, body groups | three lists: u32 count, then per group a string name, i32 appearance count, appearances `{u64 .app hash, string definition, string option name, u32 censorFlag, u32 censorFlagAction}`, i32 morph count, morphs `{string region, string target, u32 censorFlag, u32 censorFlagAction}` | The `.app` hash is FNV-1a 64 of the lower-case depot path |
| perspective info | u32 count, then `{name, fpp, tpp}` strings | |
| tags | VLQ count, then strings | |

Strings are a signed VLQ length (negative: that many UTF-8 bytes; positive: that many UTF-16 code units) and the text. Both saves use UTF-8 for all 309 and 297 strings.

**New observations** [resource: both saves and the installed 2.31 feminine creator resources]:

- **Round trip.** Parsing the node and writing every field back with the rules above reproduces all 9,109 and 8,485 bytes exactly. The node holds no padding, alignment or hidden data.
- **The node is a projection of the creator resource.** Its head, arms and body group lists are the resource's `headGroups`, `armsGroups` and `bodyGroups` (10, 18 and 7 names) in the same order, empty groups included (the feminine `breast` group has no entries); its perspective list equals the resource's `perspectiveInfo`; its version equals the resource's `version`. Within each group, the vanilla options appear in the resource's option order (every group of both saves checked, 102 vanilla entries in the check save; mod options sit among them).
- **Censor fields copy the option's own.** Body entries carry non-zero values: `body_color` (`Censor_Nudity`, `Deactivate`) is stored as (1, 1), `body_color_censored` (`Censor_Nudity`, `Activate`) as (1, 0). The node stores **both** the censored and uncensored variants, and the runtime picks one. (This corrects the CC file chain's note that all censor fields are zero.)
- **Tags come from hair choices.** The two tags are a hair colour name and a hair length (`Short`), and in the creator resource only hair colour definitions and hairstyle switcher choices carry tags.

What the node does **not** hold, as the CC file chain already records: switcher choices, link indices, colour-only controllers such as `skin_color`, and `None` choices. The game must infer those from which options are active and which definitions they hold.

## 4. What must change and what must stay byte for byte

The **minimal-diff write** changes only what the creator node forces:

| Part | Rule |
|---|---|
| Header (25 bytes) | Copied unchanged. |
| Chunk table | Entries before the chunk holding the node's first byte are copied unchanged. Entries from that chunk on are rewritten; the used count may grow by one. Refuse if it would exceed the capacity. |
| Chunks before the node's chunk | **Copied verbatim**, compressed bytes and all. |
| Chunk holding the node, and every chunk after it | Re-expanded, the node replaced, re-cut at the same chunk size from the same start, and re-compressed with LZ4 (the Studio needs a small block encoder; the reader already has the decoder). |
| Every other node's data | Byte-identical in the expanded stream, verified. |
| Node table | Names, next and child IDs and sizes unchanged, the creator node's size set to its new size, and every later node's offset moved by the size difference. Refuse if the node has children or any node's range encloses it. |
| Footer | The new node-table offset. |
| `metadata.9.json` | Copied, with `fileSize` set to the new length. Everything else unchanged: same body and brain gender (§9), same level and location. |
| `screenshot.png` | Copied unchanged. |

Why minimal rather than WolvenKit's full rebuild: a full rewrite recompresses every chunk and re-derives every node's parser output, so a single mis-parsed node anywhere in the file would corrupt quest or inventory state. The minimal diff touches no bytes the Studio doesn't understand.

## 5. Building the node from the Studio's character context

The Studio already derives everything the node needs except four small pieces. `deriveCharacter` (`src/character-context.ts`) turns the context (the save as base plus the person's choices) into the resolver's descriptors with rule R5 (`descriptorsFromUiState`, `src/cco-model.ts`): `{part, group, option, app, definition}` per active appearance and `{part, group, region, target}` per morph. With a save as the base it **keeps the save's own descriptors for every option no choice reaches** (CORE-58), including options the installation no longer offers.

| Node piece | Source |
|---|---|
| Group lists and their order | The merged creator resource's `headGroups`, `armsGroups`, `bodyGroups`, in order; within a group, R5's descriptors in resource option order. |
| Appearance entry | `.app` hash from the descriptor's depot path (FNV-1a 64, lower case); definition; option name; **censor flag and action from the option** (new: `Censor_Nudity` = 1; `Activate` = 0, `Deactivate` = 1). |
| Morph entry | Region and target; censor fields from the morph option. |
| Perspective info | The resource's `perspectiveInfo`. |
| Tags | The chosen hair colour definition's tags, then the chosen hairstyle switcher choice's tags [hypothesis: order, from one save]. Kept verbatim when no hair choice changed. |
| Version, `Unknown1`, `DataExists`, `isMale`, `IsBrainGenderMale` | Copied from the save. |

**The identity test** is the first gate: with no choices set, the planned node must equal the save's node byte for byte, and the whole written file must expand to the same stream. Any difference means the projection rules above are wrong for that save, and the write is refused with the differing group named.

**Preserve what isn't understood.** An entry whose option the merged resource doesn't know (a mod since removed) is kept as saved, in its saved position. A group the resource doesn't list is kept as saved. This follows the backlog's "round-trip unknowns" constraint.

## 6. Integrity checks

Before writing (refuse with one plain sentence each):

1. The save is a 2.x save the reader supports (game version in the researched range), and **exactly** the save version and preset version seen in testing (269 and 12 today). Any other version is refused until a session confirms it.
2. The preset version equals the installed creator resource's `version`.
3. The save's body gender matches the Studio's context and the chosen preset (§9).
4. The node decodes completely with no trailing bytes, and the identity test (§5) passes.
5. The chunk table capacity is one WolvenKit knows; every chunk decodes; the node table is consistent (IDs equal positions, offsets increasing, the creator node root-level and childless).
6. Every choice the person set resolves in the installation (`missing_target` and `invalid_value` as the context already reports them). A preset built on another installation writes only what this installation can honour and lists the rest.

After writing, on the new file only, re-read it with the Studio's reader and check:

- every node except the creator node is byte-identical in the expanded stream, and the node table differs only in the expected offsets and one size;
- the creator node decodes to exactly the planned node, and re-encoding it gives the same bytes;
- the original folder's files have the same SHA-256 as before the write.

An independent second reader (WolvenKit's save library through a small .NET harness) would be a stronger offline check, but WolvenKit's CLI has no save command, so it is optional. Offline checks never prove the game accepts the file (§11).

## 7. Never overwriting the original

- **Write a new save folder, never into the source folder.** Default name: the next free `ManualSave-<n>` in the same save directory, so the game lists it [hypothesis: the load menu lists only folders named in the game's own patterns]. The user can override the destination (defaults first, overrides available).
- **Refuse** if the destination exists, the source folder changes during the write, or the disk write can't be made atomic (write to a temporary name in the same directory, flush, then rename).
- **Keep a backup record:** the source folder's three files' SHA-256, the new folder's, the Studio version and the choices written, in the Studio's private data folder. The original is never modified, so no backup copy of it is needed; the record lets the user find which save a written copy came from.
- **Explicit action only:** one button in the Character panel ("Write to a new save…") with a summary of what changes, never automatic, never on a timer.
- **Private by design:** save bytes never leave the machine (the browser reader already keeps them local), and nothing from a save is committed or published.
- **Cloud sync:** Steam and GOG cloud saves will upload the new folder like any manual save. Say so once in the confirmation.

## 8. How the game validates the node on load

Nothing about loading is read; it is native [hypothesis throughout]. What the offline evidence suggests:

- The creator system exposes `InitializeOptionsFromFinalizedState` [source: RTTI dump `gameuiICharacterCustomizationSystem`, pre-2.3], which suggests the mirror rebuilds its option rows from the saved node rather than from stored indices. If so, a node whose active options don't correspond to one consistent switcher state could show wrong rows at the mirror even when V renders correctly. The CC file chain's test ask 4 already asks this.
- The creator resource's `versionUpdateInfo` lists option renames per preset version, so a node of an older version is probably migrated on load. The writer never writes a version other than the save's own, and refuses when it differs from the installed resource's.
- What the game does with an entry whose `.app` hash or definition no longer exists (a removed mod) is open (test ask 5 in the CC file chain). The writer never adds such entries; it only keeps ones already saved.
- The CyberCAT page's note that its appearance editor is "disabled until it's fully fixed", allowing only gender and voice, is the strongest warning available: something about writing appearance data broke for its authors after 2.0, and the reason is not documented [wiki].

## 9. Body gender and voice

- **Body gender** (`isMale`) selects a different creator resource (`male_cco`) and so a different group set; the Studio doesn't render the masculine head yet. Other state may also depend on it: quest facts set at the time, clothing variants and romance availability [hypothesis]. **Refused** in both routes: a preset for the other body gender can't be written into this save.
- **Voice** (`IsBrainGenderMale`, and `brainGender` in the metadata) is one byte, and CyberCAT allowed changing it [wiki]. It changes which voice lines play from then on, and the game itself only offers it in a new game. **Refused by default**; whether to offer it later is the maintainer's decision (§14).
- The in-game route can change neither: they are not creator options, and the voice switcher only appears in new-game mode [source: `characterCreationBodyMorphMenu`, photo-mode knowledge §3.2].

## 10. Interaction with mods

- **CCXL options present.** The node stores resolved output: `.app` hash, definition name and option name. A mod option is written exactly like a vanilla one. The writer uses the same merged resource ArchiveXL builds (`loadMergedCco`), so it writes what the game would.
- **CCXL options absent.** Choices from a mod this installation lacks can't be written (the context reports them as missing). Saved entries from such a mod are kept verbatim; the game treats the resulting save exactly as it would treat the original.
- **Reordering and reindexing.** ArchiveXL regenerates indices, so the writer never uses one; the node holds names.
- **Different installation at load time.** A save written on one installation and loaded with different mods behaves like any save made with those mods. The Studio should record the mods whose options it wrote, and name them in the confirmation ("This save now uses options from: …").
- **Frameworks.** Writing a save needs no framework. The in-game route needs the XF Runtime Bridge and its prerequisites (RED4ext, redscript, CET, Codeware); the Studio detects them and never installs or replaces them.

## 11. The alternative: apply in game, the player confirms

No save file is written; the game writes its own save.

1. The player opens the appearance screen at a mirror (mode `HairDresser`) or a ripperdoc (mode `Ripperdoc`). A later `cc.open` could open it from gameplay (bridge autonomy rank 4).
2. The Studio reads the live option list (`player.appearance` lists every option with its current value while the screen is open) and matches each authored choice **by identity** (option name plus definition name, or the options a switcher choice activates), never by the Studio's own positions, since the live list is the one the game built.
3. For each changed row it sends `cc.apply {option, index}`, which goes through the row's own controller so the label, the preview camera and the menu's busy state follow [source; the row route is built and untested in game; in session 2, before it was built, the row's label stayed stale while the value changed].
4. The player checks the preview and presses **Confirm** (`ReFinalizeState`), or Back to discard. The bridge's own `cc.confirm` stays a test-profile tool.
5. The player saves as usual. Whether the game autosaves after Confirm is open; the Studio says "Save your game to keep this look."

What it can reach [resource: 2.31 feminine creator resource, options not hidden]: at a mirror, the 321 options tagged `HairDresser` (hair, brows, makeup, piercings, nails and most face details); at a ripperdoc, also the 23 tagged `Ripperdoc` only (skin tone and type, eye shape, nose, mouth, jaw and other face shapes); never the 2 `NewGame`-only options, body gender or voice. CCXL options carry their own tags.

Evidence: in session 2, a value the bridge applied at the mirror was kept when the player confirmed [runtime, 26 September; experiment 020]. Applying a whole preset (tens of rows in sequence, with links and switchers) has not been tried.

## 12. Comparison and recommendation

| | Write a new save | Apply in game |
|---|---|---|
| Who writes the node | The Studio, by rules inferred offline | The game |
| Needs the game running | No | Yes, with the bridge installed |
| Reach | Every option, including ripperdoc-only ones, without a trip to a ripperdoc | The screen's mode (§11) |
| Mods | Must match the game's merge exactly (the Studio already replicates it) | Whatever the game loaded |
| Failure mode | A save that fails to load, loads wrongly, or breaks the mirror later | Wrong rows applied: visible before Confirm, undone by Back |
| Consistency (links, switchers, tags, censor variants, groups) | The Studio must get every rule right | The game's own |
| Proof needed before release | A session showing the game re-saves our node unchanged | A session applying one full preset |

**Recommendation:**

1. **Phase A: apply in game.** Build "Apply in game" on the existing bridge: live matching by identity, a whole-preset apply with progress, a plain summary of what the screen's mode couldn't change, and Confirm left to the player. It carries no save risk and needs one session to prove.
2. **Phase B: offline writer, gated.** Build the pure planner and writer (§5, §4) with the identity test as a unit test on real saves (private fixtures, never committed). Use Phase A to produce ground truth: after the game saves a V that the bridge dressed, the planner, given the same choices on the pre-apply save, must produce that save's node byte for byte. Ship the writer only once that holds for the test presets and the session in §13 passes. Until then it stays behind a developer flag.
3. **Share presets, not saves.** The `xfs/cc-preset-1` format already carries portable choices; either route turns a preset into a V on the receiving player's own save.

## 13. Risks

| Risk | Mitigation |
|---|---|
| The game rejects or crashes on the rewritten container (LZ4 encoding, chunk table, metadata `fileSize`) | Session step W0 checks the container alone, with no appearance change |
| The mirror shows different rows from the written node (options inferred from active entries) | Session steps W2 and W3 check the mirror; the ground-truth comparison (§12) catches rule errors offline |
| A removed or renamed mod option in a written save | Never added by the writer; saved ones kept verbatim |
| A future patch changes the node, version or order | Exact-version gate (§6, check 1); the identity test fails closed |
| The creator node moves into an enclosing node or away from the tail | Computed per save; refused when it has children or a parent |
| The user loses the original | Never written; new folder only; hashes checked before and after |
| Quest or romance state tied to gender or voice | Both locked (§9) |
| A save from another platform or a cloud conflict | Only the local PC save directory; one sentence about cloud sync |
| Hand-edited metadata confuses the load menu | Only `fileSize` changes; step W0 checks the listing |

## 14. Batched in-game test plan (one session)

Prepared by an agent, run by the maintainer on the XF test profile, on a **throwaway manual save** made at the start (the safety save stays untouched). Record game version, Phantom Liberty, ArchiveXL, TweakXL, Codeware, RED4ext and CET versions, the MO2 profile, and the SHA-256 of every file handed in or out. Every screenshot uses the same photo-mode camera preset and light.

| Step | Candidate (prepared offline, each in its own new `ManualSave-<n>` folder) | Check | Hand back |
|---|---|---|---|
| W0 Container | The throwaway save rewritten with **no** appearance change: tail chunk re-encoded, table and footer rebuilt, metadata `fileSize` updated | Listed in Load; loads; V looks unchanged; open and close the inventory | Screenshot |
| W1 One colour | Eye colour changed to another vanilla colour (definition name of a different length, so the node changes size) | V's eyes in photo mode; the mirror's eye-colour row shows the new colour; Back at the mirror | Screenshots |
| W2 Linked and switched | Skin tone changed (head, neck, arms, body follow the link), hairstyle and hair colour changed (tags change), one nose morph changed | Face and hands in photo mode; first-person hands; every changed row at the mirror (and a ripperdoc for skin and nose) | Screenshots and a manual save made after pressing **Confirm at the mirror without changes** |
| W3 Off | Every makeup row Off (entries removed; the node shrinks) | Nothing drawn; the mirror shows Off on each row | Screenshot and the same kind of re-save |
| R1 Apply in game | The W2 preset applied to the throwaway save through the bridge at a mirror and ripperdoc, then Confirm and a manual save | Rows follow; nothing left unchanged that the mode allowed | That save |

Offline afterwards: the node in the game's re-saves of W2 and W3 must equal the Studio's written node byte for byte (the game re-serialised exactly what we wrote), and the node in R1's save must equal W2's (both routes agree). Any difference names the rule to fix. Finish the session by loading the safety save.

## 15. Implementation outline

Per the [architecture contract](../authoring/architecture-contract.md):

- **Domain, pure and browser-safe:** `save-appearance-plan.ts` (context + merged resource + saved node → planned node and a change report; the identity test), `save-appearance-node.ts` (encode and decode the node; the reader's node parsing moves here), `lz4-encode.ts` (block encoder), and `save-rewrite.ts` (original bytes + new node → new file bytes by the minimal-diff rules, with the post-write checks). No file system access.
- **Host adapter:** finds the save directory, the next free folder name, atomic writes, hashing and the backup record. Desktop host first; the localhost Studio can offer a download of the new folder instead.
- **Application action:** `character.writeSave {source, destination?}` in the character namespace of the action catalogue, with refusals `not_ready`, `unsupported_version`, `body_gender_mismatch`, `missing_target`, `destination_exists` and `verify_failed`; and `character.applyInGame` for phase A over the bridge's `player.appearance` and `cc.apply`. Boundary tests as for the other character actions.
- **Presentation:** in the Character panel, "Apply in game" (enabled when the bridge reports the appearance screen open) and, after phase B passes, "Write to a new save…"; one summary sheet listing what changes, what can't be changed and where the new save goes.

## Open questions for the maintainer

1. Is phase A (apply in game, player confirms) acceptable as the first user-facing write path, with the offline writer kept behind a developer flag until the session in §14 passes?
2. Should voice ever be changeable through the Studio (a save edit only; the game offers it only in a new game)?
3. Default name and place of written saves: the next `ManualSave-<n>` beside the source (proposed), or a user-chosen folder?

## Related

[CC controls and presets backlog](../backlog/cc-controls-and-presets.md) · [Save import](../eye-artistry/save-import.md) · [CC file chain](../../knowledge/cc-file-chain.md#7-how-a-save-stores-cc-choices) · [Photo mode and the creator](../../knowledge/photo-mode.md#33-what-confirm-and-back-do) · [Runtime bridge design](../runtime/runtime-bridge-design.md) · [Choice icons design](choice-icons-design.md)

**Provisional decisions (coordinator, 27 September 2026, for the maintainer's review):** apply-in-game is the first way to write a look; voice (brain gender) stays as saved and isn't offered; offline-written saves default to the next `ManualSave-<n>` beside the original and never replace it.

