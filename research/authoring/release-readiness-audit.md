# Release readiness audit: "ready for Nexus?"

**Status:** first full audit against the [1.0 readiness bar](../../docs/release-readiness.md), run on 29 September 2026 at `main` `95e6d0a`. Read-only: no product code was changed. It measures the gap; it does not close it. The ranked closing list is at the [end](#6-ranked-closing-list). Tracks B, C and E (items 5–14 and 21–23) were closed on `claude/beta-polish-1` (`353d967`, `97e991a` and the follow-up commits named per item), and Track D's layout item 19 on `claude/track-d-layout`; each row below says what was done.

## How it was run

- **Build:** the localhost Studio from the main checkout (`bun server.ts`), on port 4331, never 4317. Headless Chrome (a throwaway profile), driven over the DevTools protocol with real mouse and keyboard input, always in a `?verify=1` workspace.
- **Two hosts:**
  - **First run:** an empty data folder (`XFAS_DATA_DIR`) and an empty settings folder (`XFS_SETTINGS_DIR`), which is what a new user sees: no game folder saved, no WolvenKit.
  - **With the game:** a fresh data folder holding a copy of the installed settings, with warm shared preview and resolver caches, to see the 3D view.
- **Memory:** a 3 GB budget under `tools/memory_guard.py`. That wasn't enough for a full V (see [limits](#limits-of-this-audit)).
- **Captures:** 1440 × 900 window. Each panel was floated at 300 px and 480 px, in light and dark, and every menu and dialog was opened. They're in the ignored `experiments/readiness-audit/generated/` folder (they hold game-derived imagery and a local path, so they stay local). File names below are relative to it. Montages are in its `m/` folder.
- **Timings:** taken in the page. Time zero is the `pointerdown` or `keydown` event. After it, the audit recorded:
  - the first DOM change and the frame after it;
  - the specific feedback (for example the tile's `aria-pressed`);
  - completion (for example the preview's `ready` badge);
  - any `longtask` entries.

  The DevTools round trip is not included.
- **Rules applied:** the style guide (`studio-ui/style-guide/`, referenced as [f-copy], [c-chips] and so on), the [visual QA checklist](ui-visual-qa-checklist.md) (items A1–I5), the AGENTS.md UX policies and the open UI findings in the [code-health ledger](code-health.md).

### Limits of this audit

- **No full V within 3 GB.** A warm V load needs more than 3 GB for the localhost host and the page together:
  - the host passed 1.4 GB while preparing V's details, and the guard stopped it;
  - Chrome passed 1.2 GB at the same stage, twice, even with the body turned off as early as the action was available.

  So the Character, Camera & light and Motion panels were reviewed in their no-game state only. The following weren't measured here:
  - hairstyle switching (PREV-189);
  - Colour-shifting with a full V and a concurrent hairstyle load (PREV-188);
  - Build, Add to my mod manager, the Expressions and Poses modules with data, and the Save Explorer with saves.

  They need a follow-up with about 4.5 GB (host 2 GB, page 2 GB), or the installed desktop app, which has no page bundler.
- **The first-run setup can't be walked in a verification workspace.** **Use this folder** saves the game folder only into the workspace's own settings copy (UI-98). The 3D preview host reads the host's settings, so it still reports `preview_game_missing`. The card comes back unchanged after every panel change or dialog (`nogame-dlg-import-collection.png`). The walkthrough in [§4](#4-first-timer-walkthrough) therefore combines what was observed with the flow's source (`preview-preparation.ts`) and the 29 September installed acceptance recorded in [status](../../docs/status.md).
- **Not driven:** drawing gestures (drag, Shift-rotate, warps), touch, and the desktop shell's own welcome and About.

## 1. Exportable-first inventory

Default path = what a new user sees: the Eye makeup module shown, and the Expressions, Poses and Save Explorer modules hidden (the factory state). Research tools (Settings › Appearance › **Show research tools**) already hide the glitter model studies, the compiler plan export, the optics diagnostics and developer IDs. That switch is the mechanism the "Move" recommendations use.

**Export status:**

- **In game:** exports and was seen working in game.
- **Exports, unverified:** exports and passes the independent verifier, but hasn't been seen in game.
- **Exports, failed in game:** exports, but was seen in game and failed.
- **Preview only:** shows only in the Studio.
- **Research:** for R&D or calibration.
- **Support:** needed to author, save or install, but not itself exported.

**Recommendation:**

- **Keep:** stays in the default path.
- **Move:** goes behind research tools.
- **Hide:** out of the default path, reachable from the palette or Settings.
- **Remove:** take it out.

### Eye makeup (the product)

| Feature or control | Where | Export status | Recommendation |
|---|---|---|---|
| Presets, the collection name, Add, Duplicate, Rename, reorder | Presets | Support (each preset is one selector choice) | Keep |
| Layers: add, duplicate, hide, reorder, finish submenu | Layers, row menus | Support (layers merge into the preset's textures) | Keep |
| Shape: points, Bézier handles, Smooth, Symmetric and Corner, Mirror across the face, editing gestures | Shape, UV map, 3D view | In game (baked into the mask) | Keep |
| Pigment strength, point blend, edge softness, per-point softness | Pigment & edge | In game (baked) | Keep; fix the `% UV` readouts ([§2](#2-consistency-sweep) C-12) |
| Mottle | Pigment & edge | Exports (baked by the preset compiler), unverified as a visible texture in game | Keep |
| Warps | Warp | In game (baked) | Keep |
| Colour and opacity | Colour & finish | In game | Keep |
| **Matte, Satin, Metallic** | Colour & finish | In game: the selector and switching were confirmed, and Metallic has no angular highlights. Matte and Satin were retuned after they read too glossy; the retune hasn't been seen in game yet | Keep; they're the product |
| **Colour-shift** | Colour & finish | Exports, experimental; seen in game "behaves as designed", one pigment per preset | Keep, under **Experimental** |
| **Glossy** | Colour & finish | Exports, experimental; Gloss A and C separate in close-up, B and D not seen yet; Help says it doesn't yet look different from Satin | Keep under Experimental for the beta, or Move if the rework misses the beta |
| **Shimmer** | Colour & finish | **Exports, failed in game** (session 6: "glossy vinyl"); being reworked | **Move** until the rework passes in game; the tile currently promises a finish that fails. **Moved** (`353d967`) |
| **Glitter** | Colour & finish, palette, Mod package list | **Preview only** (guarded from export; the in-game candidate failed) | **Move**, together with its model list. A preview-only finish in the main picker is the clearest breach of "exportable first". **Moved** (`353d967`) |
| Surface controls, Front view, Whole body, Play the game idle | 3D view toolbar | Support (preview) | Keep |
| Both eyes, Single eye, Other eye, Fit shape | UV map | Support | Keep |
| Import or export a collection, import or export a preset recipe | Library › Files | Support (portable files) | Keep |
| **Export layer mask** ("Export selected layer mask (2048²)" in the palette) | Library › Files, palette | Research (a raw texture) | **Move**. **Moved** (`353d967`) |
| Save, Save as new collection, saved collections, Reopen or Open, Recover previous draft | Library | Support | Keep; remove **Refresh** ([§5](#5-annoyances)). **Done** (`97e991a`): no Refresh; **Recent drafts** replaces Recover previous draft |
| Check, Build mod files…, Add to my mod manager, Show in folder | Mod package | Exports | Keep |
| "What can be packaged" (seven finishes with badges) | Mod package | Support | **Remove** or fold into Help: it repeats the finish picker's grouping (G3). **Removed** (`353d967`) |
| History | History | Support | Keep |

### Your V and the view (preview only by design)

These are preview only by nature: they let the user judge a look on a V. They stay, but the default path should carry only what serves judging the makeup.

| Feature or control | Where | Export status | Recommendation |
|---|---|---|---|
| Load a save…, Default V (feminine) and (masculine) | Character | Preview only | Keep |
| Creator options per part, search, Off, Reset, Undo | Character | Preview only (save write-back is later) | Keep |
| Load preset… and Save preset… (character presets) | Character | Preview only | Keep |
| Show my V's own makeup | Character | Preview only | Keep |
| Show my V uncensored | Character › Body | Preview only (policy: opt in) | Keep |
| Clothing and its switch | Character | Preview only (vanilla items only) | Keep |
| **Export appearance data** | Character › Files | Research | **Move**. **Moved** (`353d967`) |
| **Clear prepared game files** | Character › Files | Support (cache maintenance) | **Hide**: Settings › Tools or the palette only. **Done** (`353d967`): Settings › Tools and the palette |
| Field of view, Front view, Whole body | Camera & light | Preview only | Keep |
| Creator face and Creator hair cameras | Camera & light, palette | Preview only (for comparing with the game) | Keep; they help judge a look as the game frames it |
| Lighting setups: New setup, Rename, Reset, Delete, lights and the direction dial | Camera & light | Preview only | Keep, but show which setup is current ([§2](#2-consistency-sweep) C-20) |
| Exposure, Room light, Backdrop, Colour grade | Camera & light › Surroundings | Preview only | Keep |
| **Preview normal map** | Camera & light › Display | Research | **Move**. **Moved** (`353d967`) |
| Game idle (Still or Creator close-up), Pause, Body and Facial movement, Blink | Motion | Preview only | Keep |
| Hair physics (Early access) | Motion | Preview only | Keep, tagged |
| Texture size (512 to 4K) | Preview quality | Preview only | Keep |
| **Rebuild preview** | Preview quality, palette | Support (a recovery action) | **Hide**: make it the next step of an error state, not a standing button. **Done** (`353d967`): shown only when the textures failed; the palette keeps it |
| **Rendering: Skin scattering, Face shadows, Hair look (Crisp or Game-like)** | Preview quality, six palette commands | Research (fidelity experiments) | **Move**; keep one good default. **Moved** (`353d967`); the defaults stay |
| "About 23 MiB of memory at this size" | Preview quality | Support | Keep the fact; say it as "Uses about 23 MB of memory" (G4) |
| Activity | closed by default | Support | Keep |
| Settings, Help, Report a problem, Diagnostic mode | closed by default, header | Support | Keep |

### Modules hidden by default (Early access)

| Module | Export status | Recommendation |
|---|---|---|
| Expressions (Expression, Expression sets) | Expression sets **export** XF Expressions, unverified in game (Build-verified only) | Keep hidden and tagged for the beta; it isn't in the default path, which is right |
| Poses | Preview only | Keep hidden |
| Save Explorer | Research (a read-only save inspector) | Keep hidden; consider moving it under research tools rather than the Modules menu, since it isn't a user feature |

**Net effect of the recommendations:** the default Colour & finish picker drops from 7 tiles to 5 or 6. Preview quality loses its Rendering section, Camera & light loses one research switch, and Character loses its Files section. That also takes 8 research commands out of the palette's default list (six Rendering commands, the mask export and Export appearance data).

## 2. Consistency sweep

**How it was checked:**
- **Panels:** all 18 non-module panels, captured as `nogame-<panel>-<light|dark>-<300|480>.png` (72 captures).
- **Menus:** 13 menus and context menus (`nogame-menu-*.png`).
- **Dialogs and sheets:** four (`nogame-dlg-*.png`), plus the palette (`10-palette-light.png`).
- **The 3D view:** its status and context menus (`40-load3d-04.png`, `41-head-*.png`).

**The rule column** cites the visual QA checklist item, or the style guide entry in brackets. **Sizes:** S = under an hour, M = half a day, L = a day or more. Findings already in the ledger are marked with their ID.

### Terminology: one word per concept

| # | Inconsistency | Seen in | Rule | Size |
|---|---|---|---|---|
| C-1 | The Colour-shifting finish has three names: "Colour-shift" (tile), "Colour-shifting" (palette, Mod package list, Help) and "iridescent" (internal). AGENTS.md names it **Colour-shifting** | `nogame-finish-*`, `nogame-package-*`, `10-palette-light.png` | [f-copy], [r-terms] one name per thing | S. **Fixed** (`a6cf806`) |
| C-2 | Finish names differ between places: tiles say "Metallic", "Shimmer" and "Glossy"; the palette and Mod package say "Metallic / foil", "Shimmer / pearl" and "Glossy / wet look". [c-finish] puts synonyms in the tooltip only | palette, `nogame-package-dark-480.png` | [c-finish], G1 | S. **Fixed** (`a6cf806`) |
| C-3 | The export-status group heading is "Can be built" in the picker, "Exports" in the style guide's finish chooser specimen, and a "Can be built" badge in Mod package. The guide or the app is stale | `nogame-finish-light-300.png`, `style-guide/components.ts` `finishGroups` | [c-finish] | S (guide: UI component track). **Fixed** (`a6cf806`) |
| C-4 | "Experimental" is a badge in Mod package but not in [c-chips]'s fixed vocabulary (Working, Preview only, Can be built, Current, Stale, Blocked). [lib-stage-tag] does call it "a finish's export status". The guide contradicts itself | `nogame-package-dark-480.png` | C3, [c-chips] | S (guide). **Fixed** (`a6cf806`) |
| C-5 | The library state chip says "Unsaved changes" and "Saved". [c-chips]' specimen vocabulary is "Saved", "Not saved yet" and "Newer version saved" | header, Presets | [c-chips] | S. **Fixed** (`a6cf806`) |
| C-6 | Settings has "Game" in the panel, "Game & tools (Settings › Game)" in the palette, and "GAME & TOOLS" in Mod package | `nogame-settings-*`, `nogame-package-*` | [f-copy] use the exact names on the controls | S. **Fixed** (`a6cf806`) |
| C-7 | The 3D view is called "3D view" (panel), "the 3D head view" (a Help topic), "the head view" (a tour) and "the preview" ("Your V in the preview"). [lib-stage-tag] reserves "preview" for the 3D view, so the Help wording mixes both | `nogame-help-light-480.png` | [f-copy] | S. **Fixed** (`a6cf806`) |
| C-8 | Parallel objects use different verbs:<br>• layers "Bring forward"/"Send backward", presets "Move up"/"Move down";<br>• layers "Undo with Ctrl+Z", presets "Restorable from the Presets panel";<br>• "Recover previous collection draft" (Collection menu, palette) and "Recover previous draft" (Library) | `nogame-menu-layer-actions.png`, `nogame-menu-preset-more.png` | [f-copy], [r-terms] one name per thing | S. **Fixed** (`a6cf806`) |
| C-9 | The palette mixes "Go to X" and "Open X" for panels, and "Help: tours, answers and shortcuts" with "Help" | `10-palette-light.png` | G1 | S. **Fixed** (`a6cf806`) |
| C-10 | Point indices read "Point 1 / 4" in Shape and "Point 1 of 4" in Pigment & edge | `m/inspectors-light-300.png` | [f-copy] | S. **Fixed** (`a6cf806`) |
| C-11 | Help says Settings is "the gear button at the top right" (two topics, and the style guide's Settings entry), but the header icon is `settings`, drawn as sliders | `help-topics.ts`, `icons.ts:79` | I2, [f-copy] naming a control that doesn't exist | S. **Fixed** (`a6cf806`) |

### Copy: developer words, raw units, length

| # | Inconsistency | Seen in | Rule | Size |
|---|---|---|---|---|
| C-12 | Raw units in the default path: "Point blend 0.05% UV", "Edge softness 0.60% UV" | `nogame-edge-*` | G4 ("no raw units such as '% UV' outside research tools") | M (needs a unit the person can judge: mm on the face, or 0–100). **Fixed** (`a6cf806`) |
| C-13 | Developer and jargon words shown by default:<br>• "WolvenKit CLI" (Settings, Mod package);<br>• "Rebuild preview";<br>• "MiB";<br>• "Refresh" (library);<br>• "No active exportable layers remain" (Check);<br>• "preset(s)" (status line);<br>• "1 entries" (Report a problem);<br>• byte sizes such as "1006 B" and "357 B" on every report part | `nogame-package-*`, `nogame-quality-*`, `nogame-dlg-report-a-problem.png`, `21-after-check-save.png` | G4, [f-copy] | S each. **Fixed** (`a6cf806`) |
| C-14 | The Check status line runs past one line and ends in an ellipsis ("…whether the mod can also fi…") | `21-after-check-save.png` status bar | G1 (a status line is one line, about 70 characters), I3 | S. **Fixed** (`a6cf806`) |
| C-15 | Stale product text:<br>• the tour "What's new in 0.1.0-alpha.1" (alpha.2 is published; 1.0 needs a current one);<br>• Help › "What's not in this version yet" says the rebuilt Shimmer "hasn't been tried in the game yet", but session 6 tried it and it failed | `nogame-help-light-480.png`, `tours.ts`, `help-topics.ts` | [f-copy] honesty; the beta framing | S. **Fixed** (`97e991a`) |
| C-16 | The WolvenKit notice says "XF Studio can download it for you from the 3D preview card". It is shown in Settings › Game and Mod package while no such card is visible (the card appears only after the game folder is set) | `nogame-settings-light-480.png` | H4 (the one next step, with its button) | S. **Fixed** (`353d967`) |
| C-17 | The same sentence, "The 3D preview needs your Cyberpunk 2077 game folder", is repeated as a reason in six or more places at once:<br>• the 3D view;<br>• Character: Your V line and Eyes;<br>• Motion;<br>• the Preview quality line;<br>• about 25 palette reasons | `m/char-light-dark-300.png` | G3 (one place per state), B4 (a shared reason says it once) | M. **Fixed** (`a6cf806`) |

### States and badges

| # | Inconsistency | Seen in | Rule | Size |
|---|---|---|---|---|
| C-18 | One state in several places at once:<br>• "Unsaved changes" in the header and in Presets;<br>• "UV map 1K · ready" in the 3D view and the status bar;<br>• the V-details failure as a viewport note, a toast and the status line together, where the toast also covers the finish panel's note | `01-first-run-dark-1440.png`, `40-load3d-04.png` | G3 | M. **Fixed** (`a6cf806`) |
| C-19 | Help's tours each carry a "NOT STARTED" badge on every row, which isn't a vocabulary word. The Panels menu starts every row with "Open ·" | `nogame-help-light-480.png`, `nogame-menu-panels.png` | C3 (nothing repeats under every row) | S. **Fixed** (`a6cf806`) |
| C-20 | Camera & light › Light has New setup, Rename…, Reset and Delete, but no visible current setup to act on (no game) | `m/char-light-dark-300.png` | H6 (state visible where it applies) | S (re-check with the game) |
| C-21 | Unavailable menu entries give their reason in the warning colour ("This layer is already at the front." in orange). The Layouts precedent and UI-145 keep a reason that isn't a problem muted | `nogame-menu-layer-actions.png` | [lib-menu], UI-145 | S. **Fixed** (`a6cf806`) |
| C-22 | "Remove layer" is in the danger colour although Undo reverses it. [c-buttons] keeps danger for "destructive where Undo is not enough" | `nogame-menu-layer-actions.png` | [c-buttons], H5 | S. **Fixed** (`a6cf806`) |
| C-23 | Preview quality's Hair look shows "Crisp" as the readout and again as the slider's end label (a value shown twice) | `nogame-quality-dark-300.png` | C1 | S. **Fixed** (`a6cf806`) |
| C-24 | Pigment & edge has a Mottle heading over a switch also labelled "Mottle" | `nogame-edge-light-300.png` | C2 | S. **Fixed** (`a6cf806`) |
| C-25 | A primary Build button that is unavailable still reads as a yellow primary (dimmed yellow) | `nogame-package-dark-480.png` | [c-buttons], F4 | S. **Fixed** (`a6cf806`) |

### Layout and spacing

| # | Inconsistency | Seen in | Rule | Size |
|---|---|---|---|---|
| C-26 | Character at 300 px: the Your V buttons wrap onto four rows, and an empty band sits under Reset all | `nogame-character-dark-300.png` | I4 (no more than two rows of buttons), B4 | M. **Fixed** (`bd83678`): Undo and Redo beside the V's source, Reset all with the V's own makeup (the guide's Creator options); three lines of buttons at 300 px, two at 480 px; no status band before a V can load |
| C-27 | UV map toolbar at 300 px: **Fit shape** drops to a row of its own under Both eyes, Single eye and Other eye, and the disabled Other eye keeps full width beside them | `nogame-uv-dark-300.png` | [lib-segmented] hugging its choices, I4 | S. **Fixed** (`bd83678`): Fit shape shows its icon only in a narrow panel; one row |
| C-28 | Settings › Tools: "Your own WolvenKit (optional)" is an empty sunken field with no button or placeholder. Every other location uses the Folder setting component with **Choose another folder…** | `nogame-settings-light-480.png` | [lib-folder-setting], H1 | S. **Fixed** (`bd83678`): Folder setting for a file (Choose a file…, Don't use a file, "Not chosen: XF Studio sets up its own") |
| C-29 | "Extra mod folder (optional): Not chosen yet · Choose another folder…" says "another" when none is chosen | `nogame-settings-light-480.png` | [f-copy] | S. **Fixed** (`bd83678`): "Choose a folder…" until one is chosen, detected or found |
| C-30 | The Library's saved-collection row cuts off its "THIS DRAFT" chip at a normal panel height, and the date wraps to a second line ("9/29/2026, 12:45:10 PM", seconds included) | `21-after-check-save.png` | I3, I4 | S. **Fixed** (`bd83678`): the library's Record list: the badge beside the name, the meta line breaking between facts, times to the minute |
| C-31 | The Report a problem dialog has an empty "Always in the report" header band with nothing under it before its first group, a 0 B "Your mod setup" group, and native checkboxes where the Studio's parts use switches | `nogame-dlg-report-a-problem.png` | B4, component-first | S. **Fixed** (`bd83678`, `5400891`): chevroned groups and previews, empty groups not listed, the summary files after the parts, switches, the status line under the parts |
| C-32 | The Panels menu is taller than a 900 px window (about 25 rows plus hints) | `nogame-menu-panels.png` | [lib-menu] | M. **Fixed** (`bd83678`, `5400891`): one row per entry (descriptions as tooltips), fits a 900 px window (1655 → 887 px) |
| C-33 | The Rename layout popover, opened from the palette, appears under the 3D view's top-right corner, far from any layout control | `nogame-dlg-rename-layout.png` | H2, F5 | S. **Fixed** (`bd83678`): opens under the header's Layouts button |

**Open ledger items this sweep confirmed, not repeated above:**
- UI-139: empty "…" menus;
- UI-140 and UI-141: the Mod package line and the progress bar at 300 px;
- UI-144: parked Panels rows can't be acted on (seen: "Parked · comes back with Save Explorer");
- UI-147 and UI-148: Check already says "for a feminine and a masculine V" before any Build (seen);
- UI-150: the gap under Build;
- UI-151: toasts with paths;
- UI-153;
- UI-155 to UI-158;
- DESK-06: the header chips overlap at 1424 px;
- CORE-125: layer names repeat.

**What held up:**
- Hover and selection never moved layout in any capture.
- Light and dark have the same layout.
- Focus rings show on tabs.
- Every unavailable palette command states a reason.
- The empty states (History, Warp, Activity, an empty preset's Layers) follow [c-empty] with a title, one sentence and one action.
- Every panel opens in 12–32 ms.

## 3. Speed sweep

The **budgets** are from the [performance backlog](../backlog/performance.md) (same frame, under 100 ms, under 1 s) and the audit brief (100 ms to visible feedback, 1 s to completion). **Over** marks an interaction that misses its budget.

| Interaction | Feedback (ms) | Completion (ms) | Long tasks | Verdict |
|---|---|---|---|---|
| First paint (no game) | 44 | shell interactive at 180 | none | Within the "page shown → interactive < 1 s" budget |
| Page with the game (warm caches) | shell 500–900 | head drawn 2,500–2,900; V's details still preparing at 4,700–5,100 | not measured | **Over**: "restart, warm caches → own V complete < 2 s" is already missed by the bare head. Completion wasn't measurable within 3 GB |
| Reveal any panel (18 panels; the palette and Panels menu path) | 12–32 | same | none | Within budget |
| Command palette (Ctrl+K) / Help (F1) | 13 / 16 | same | none | Within budget |
| Finish switch, no 3D view (6 finishes) | 32–33 | UV map ready 48–49; Shimmer 232 | none | Within budget |
| Finish switch with the 3D head, repeat use | 31–33 | 48–60; Shimmer 245 | none | Within budget |
| **First Colour-shift with the 3D head** | **706** (the tile's selected state is blocked) | 716 | **689** | **Over** (feedback). The reduced form of PREV-188, head and plate only. With a full V and a hairstyle loading, the maintainer saw 5–10 s |
| **First Glitter with the 3D head** | 32 | **1,506** | **1,473** | **Over** (completion, and the UI is frozen for 1.5 s) |
| Add preset / switch preset / add layer / Undo | 30 / 32–33 / 32 / 32 | same | none | Within budget |
| Save (header) | 18 | 33 (chip reads Saved) | none | Within budget |
| Save as new collection | 15 | 48 | none | Within budget |
| Open a saved collection | 16 | first frame 16 | none | Within budget |
| Check (2 presets) | 32 (working) | 66 | none | Within budget |
| Package (header) opens Mod package | 5 | 14 | none | Within budget |
| Start of Build (installed app, item 4) | 21–28 (working line) | 64–80 s warm, 118 s first (two presets) | none | Feedback within budget; completion **over** (PIPE-130), with one unchanging progress line (PIPE-131) |
| Add to my mod manager (installed app, item 4) | 21–30 | plan 71–95; Add 93–159 | none | Within budget after PIPE-132 (was 0.8–0.9 s each) |
| Hairstyle switch (PREV-189) | — | — | — | Not measured (memory); open in the ledger as Medium |
| First-run game detection ("Looking for Cyberpunk 2077 on this computer…") | shown at once | found within about 15 s (not timed precisely) | none | Within the feedback budget; completion is borderline |

**Reading.** Everything that runs in the page's own model is fast, 30–70 ms end to end. The misses are all first-use GPU work (programs compiled on the main thread the first time a finish is drawn) and V preparation:
- **First-use GPU work:**
  - The measured 0.7 s and 1.5 s stalls block the optimistic selection itself. That's the "respond instantly" rule, not only speed.
  - The fix direction the backlog already lists for skin scatter applies: compile each finish's program in the background (`compileAsync`) once the 3D view is up.
  - Two variants are the obvious first candidates to precompile: Colour-shift and the Glitter model.
- **V preparation:**
  - The warm-restart budget (< 2 s to own V complete) is not met.
  - Localhost memory for a warm V is above 3 GB for the host and the page together. It isn't a user-facing time, but it limits what the audit machinery can measure, and the backlog's "memory of a fresh `?verify=1` load" row is still open.

## 4. First-timer walkthrough

**Path:** a new user, first run to a built mod. It's observed in the verification workspace up to the 3D preview's setup (the [limits](#limits-of-this-audit) explain why not further). The later steps come from the flow's source and the installed acceptance.

1. **The window opens (0.2 s).** Everything is visible at once: Presets, Layers, the 3D view, the UV map and eight inspector tabs. A layer called "Eye makeup" is already drawn on the UV map.
   - **Confusing:** the header and Presets both say **Unsaved changes** before the user has done anything. The Library says the draft "Changed since version 1" of a collection with "0 presets · version 1", which the user never saved.
2. **The "Turn on the 3D preview" card appears** ("Looking for Cyberpunk 2077 on this computer…", then "We found Cyberpunk 2077 at <folder>").
   - Good: one clear next step.
   - **Dead end / obstruction:** the card is fixed over the lower middle of the window. At 1440 × 900 it covers the **Glitter** tile, the finish description and the export note of Colour & finish. A click aimed at Glitter lands on the card instead. It comes back after every dialog while the game isn't set (`20-after-glitter.png`).
3. **Use this folder.**
   - **Missing guidance:** the card never asks *how you install mods*. The saved route stays "Vortex or by hand" even when Mod Organizer 2 was detected (Settings showed "GOG, Mod Organizer 2" beside a selected "Vortex or by hand").
   - The frameworks check then reports, for an MO2 user who has them in MO2: "XF Eye Artistry needs ArchiveXL 1.27.3 or newer, and it isn't installed in the game folder". That's a false alarm on the very first run.
   - Needs checking in the desktop app's welcome, which may ask. If it doesn't, this is the highest-value first-run fix.
4. **WolvenKit consent** (from source: "The 3D preview needs WolvenKit" › **Set up WolvenKit…**, a hash-pinned 45 MB download). Clear.
   - **Confusing** before this step: Settings and Mod package already talk about "WolvenKit CLI" and "the 3D preview card" while that card is showing a different step.
5. **Preparing** (about 55 s on first run, with steps and progress per the installed acceptance). Good: the UV map stays usable, and the card says so.
6. **Authoring.** The Getting started tour is offered in Help but doesn't start by itself, and nothing points to it on first run.
   - The finish picker offers Glitter (preview only) and Shimmer (fails in game) beside Matte. The difference between "Experimental" and "Preview only" is explained only in a help tip.
   - The Pigment & edge readouts are in "% UV".
7. **Add preset** creates an **empty** preset (0 layers). Check then reports "Whole preset 'Preset 2' — No active exportable layers remain". A new user expects a new look to start like the first one (with a layer) or as a copy.
8. **Save.** Fast and clear.
   - **Save as new collection** makes a second "Makeup collection" with the same name without asking (the same pattern as CORE-124 and CORE-125).
   - **Recover previous draft** then reads "1 of 4 drafts recoverable; recover again to walk through them", which is hard to follow.
9. **Check.** Instant and honest: "1 of 2 presets can become mod files. This check created no files."
   - It says "for a feminine and a masculine V" before any Build has decided (UI-148).
10. **Build mod files…** is disabled until WolvenKit is set. Its reason is clear.
    - After a Build, the installed acceptance shows **Add to my mod manager** and **Show in folder** working.
    - The Build result keeps its "Nothing is in your game yet" line after a successful add (DESK-05). The toast prints full folder paths (UI-151).

**Where a first-timer would get stuck:**
- **Step 3** for MO2 users: false framework warnings and the wrong route.
- **Step 2:** the card covers the finish picker.

**Jargon a first-timer meets in the default path:**
- UV, "% UV" and "UV map 1K · ready";
- WolvenKit CLI;
- MiB;
- "exportable";
- "Rebuild preview";
- "skin scattering".

## 5. Annoyances

**Waiting:**
- the first Colour-shift and Glitter freezes (0.7–1.5 s here, 5–10 s reported);
- the hairstyle switch (PREV-189);
- the first-run preparation (about 55 s, one time);
- first-run detection (up to about 15 s).

**Repeating themselves:**
- **Add preset starts empty,** so every new look means re-adding and re-styling a layer (or remembering Duplicate).
- **Two setup routes, one of them silent:** the first-run card saves only the folder, so the install route has to be found and set in Settings afterwards.
- **Duplicate collection names** after Save as new need a rename.

**Dismissing noise:**
- **The first-run card** returns after every dialog until the game is set. It can be dismissed with Not now, but it covers the inspector.
- **The failure toast repeats** what the viewport note and the status line already say (`40-load3d-04.png`).
- **Warning-coloured "already at the front" reasons** in menus.
- **Every palette search is crowded** by about 25 disabled 3D-view commands before the game is set, each with the same reason.

**Hunting:**
- **Settings** is a sliders icon described as a gear in Help.
- **The Panels menu** is longer than the window.
- **Library › Refresh** implies the list can be stale. It should update itself.
- **The Library's Recover draft cycle** gives no list of drafts to pick from.
- **Research switches sit beside real ones** (skin scattering, face shadows, normal map): a user can't tell which ones matter for the mod.

## 6. Ranked closing list

**Sizes:** S = under an hour, M = half a day, L = a day or more.

**Ranking:** by impact on "ready for Nexus", highest first within each track. The tracks are ordered by how directly they block a first public beta.

### Track A: speed and "respond instantly" (blocks: freezes are glitches)

1. **Precompile the finish programs** (Colour-shift, the Glitter model, Shimmer) in the background once the 3D view is ready, and never block the tile's selected state on them. PREV-188; this audit measured 689 ms and 1,473 ms main-thread stalls with the head alone. **M–L**
2. **Hairstyle switch** end to end (PREV-189): measure and set a budget, with 4.5 GB or the installed app. **L**
3. **Warm restart to own V under 2 s:** the head alone takes 2.5–2.9 s; V's details come after. Persist the resolved graph and mount plan (already the backlog candidate). **L**
4. **Re-measure the start of Build, Add to my mod manager and the 3D-dependent panels** on the installed app. This audit couldn't within 3 GB. **S** (measurement). **Done** (`75319ce`, `786b25a`, `7653b0a`), on an installed-layout app within 5 GB: every click shows its effect in 9–30 ms and no page task passed 50 ms; the 3D-dependent panels open in 26–71 ms; Check 57–125 ms; Add to my mod manager's plan 71–95 ms and Add 93–159 ms (0.8–0.9 s each before the `tasklist` fix, PIPE-132). Build itself takes 64–80 s warm and 118 s the first time with one unchanging progress line (PIPE-130, PIPE-131, open). Found on the way and fixed: every desktop build had failed since `97e991a` (DESK-12), and Build could stay "still checking your build tools" after a restart (DESK-11). Numbers in the [performance budgets](../backlog/performance.md#budgets-initial-targets)

### Track B: declutter, exportable first (blocks: "Exportable first" row)

5. **Move Glitter** (tile, palette command, Mod package row) and **Shimmer** (until its rework passes in game) behind research tools. Keep the three in-game finishes, plus Colour-shifting and Glossy under Experimental. **M** (catalogue flag and the Check and Help text follow). **Done** (`353d967`): the finish catalogue's `research` flag (`RESEARCH_FINISHES`); the picker, layer menu and palette offer them only with research tools on or on a layer already using one; Check and Build are unchanged
6. **Move the research controls:**
   - Preview quality › Rendering (skin scattering, face shadows, hair look) and its six palette commands;
   - Camera & light › Preview normal map;
   - Export layer mask;
   - Character › Export appearance data.

   **Hide** Clear prepared game files and Rebuild preview as standing buttons; offer them where they're the next step. **M**. **Done** (`353d967`)
7. **Drop Mod package's "What can be packaged" list:** the picker already groups finishes by status. **S**. **Done** (`353d967`)
8. **Palette hygiene:** stop listing about 25 3D-view commands as disabled until the game is set (show one "Set up the 3D preview…" command instead), and hide the research ones. **M**. **Done** (`353d967`): `withPreviewSetup` in `studio-ui/app.ts` folds every command refused as `asset_unavailable` (or with the head's own words) into one entry that carries their keywords

### Track C: discoverability and first run (blocks: "Discoverable" and "No annoyances" rows)

9. **The first-run card asks how you install mods** (MO2 profile or game folder) when MO2 is detected, so the route and the framework check are right on first run. Verify against the desktop welcome first. **M**. **Done** (`97e991a`): the desktop welcome doesn't ask; the card now does when Mod Organizer 2 manages the game (`previewSetup.chooseRoute`), defaulting to the instance found and its last-used profile, saved with **Use this folder**
10. **The first-run card never covers the inspector:** dock it inside the 3D view pane (where its subject is), and don't re-show it after dialogs once the person chose Not now. **M**. **Done** (`97e991a`, room check in the docs commit): docked whenever the pane is shown with room for it (floats otherwise); Not now is kept in the workspace
11. **Make the first run obvious:**
    - offer the Getting started tour on first run;
    - don't show "Unsaved changes" or a phantom "version 1 · 0 presets" for an untouched first draft. **S–M**. **Done** (`97e991a`): the offer shows beside the docked card; a fresh library starts empty, so the first draft reads "Not saved yet"
12. **Add preset starts from a useful default** (one layer like the first preset), and **Save as new collection asks for a name**, or makes it unique ("Makeup collection 2"). Same pattern as CORE-125. **S**. **Done** (`97e991a`): the starter look; "My collection 2" (`uniqueCollectionName`)
13. **The library updates itself** (remove Refresh). Recover draft becomes a small list of recent drafts with times. **M**. **Done** (`97e991a`) without times: the recovery queue keeps no time, and adding one changes the stored workspace format, left to the storage track. Each row names the draft, its presets and its version
14. **The WolvenKit notice names the one next step with its button** (Set up WolvenKit…), not "the 3D preview card". Drop "CLI". **S**. **Done** (`353d967`): the step button in Settings (Game and Tools) and Mod package; "CLI" dropped from those lines and the consent intro

### Track D: consistency (blocks: "Consistency" row; every UI finding closed)

15. **Terminology pass (C-1 to C-11):**
    - one name for Colour-shifting;
    - short finish names everywhere, with synonyms in tooltips;
    - Game & tools versus Game;
    - 3D view versus preview versus head view;
    - "Point 1 of 4";
    - parallel verbs for presets and layers;
    - "Go to" versus "Open";
    - Help's "gear".

    One PR with the style guide updated by the UI component track (C-3, C-4 and C-5 are guide corrections). **M**. **Done** (`a6cf806`): one name per finish, synonyms in tooltips and palette search; "3D view" throughout; Game and "Game folder and mod manager (Settings › Game)"; Move up and Move down for layers; Go to for every panel; the guide's Can be built, Experimental and Unsaved changes
16. **Units and developer words (C-12, C-13):** replace "% UV" with a person-facing unit, and "MiB", "CLI", "Refresh", "exportable", "preset(s)", "1 entries" and the byte sizes with plain words. **M**. **Done** (`a6cf806`): lengths on the face read 0–100 between the control's ends (research-only Glitter flake sizes keep "% UV")
17. **One place per state (C-17, C-18, C-19):**
    - say "needs your game folder" once per panel;
    - no duplicate chips or badges;
    - failure toasts don't repeat a viewport note;
    - no per-row "Not started" or "Open ·". **M**. **Done** (`a6cf806`): the readiness badge stays in the status bar, and the 3D view shows its own only while updating or failed
18. **States and colours (C-21 to C-25):** muted reasons, danger only where Undo can't help, no duplicate readout, no repeated Mottle label, and an unavailable primary that doesn't read as primary. **S–M**. **Done** (`a6cf806`)
19. **Layout (C-26 to C-33),** plus the open ledger items UI-139..158, DESK-05 and DESK-06:
    - Character's button rows at 300 px;
    - the Settings Tools field → Folder setting;
    - library row clipping;
    - the Report dialog's empty band;
    - the Panels menu height (group or scroll);
    - the popover anchoring. **M–L**

    **Done** on `claude/track-d-layout` (`bd83678`, `5400891`): C-26 to C-33 as each row above says, with UI-139..162 and DESK-06 in the [ledger](code-health.md#fixed-in-claudetrack-d-layout). C-29's "a folder" wording came with the Folder setting change. DESK-05 (the Build line after Add) was already fixed by `efb79ac`, verified on `claude/track-d-copy`.
20. **The status line fits one line** (C-14) and the ledger's UI-151 paths go. **S**. **Done** (`a6cf806`): Check and Build say one line of 70 characters or fewer; the result card holds the rest

### Track E: beta framing (blocks: "Beta scope" row)

21. **Current release texts:**
    - a "What's new" tour for the beta, replacing alpha.1's;
    - Help › "What's not in this version yet" corrected for Shimmer's session-6 result and the Glitter status;
    - the changelog's Known limitations kept in step (C-15). **S**. **Done** (`97e991a`; changelog in the docs commit)
22. **A visible beta marker** and an **update notice:** the readiness bar asks for "a way to learn about updates", and the updater is disabled (`updater_unavailable`). A minimum is a "new version available" check against GitHub Releases, or a Help link plus a line in About. **M**. **Done, minimum** (`97e991a`): a **Beta** badge beside the name, and **Check for updates** in Help and the palette, which opens the releases page (About already says updates are off and where to get them). No network check: nothing is designed for its consent (the settings' `updates.checkAutomatically` has no UI or host endpoint, and the signed updater gate isn't integrated), so it is the maintainer's call
23. **Report a problem stays the one obvious path** (it works). Surface it in the beta's first-run and What's new texts. **S**. **Done** (`97e991a`): the onboarding offer, the desktop welcome and the What's new tour's last step

**Size of the gap:**
- 23 items: 3 L, 11 M, 9 S (counting a range at its upper size).
- The first public beta needs, at minimum:
  - Track A items 1 and 4;
  - Track B items 5–7;
  - Track C items 9–12 and 14;
  - Track D items 15–18;
  - Track E items 21–22.
- Items 2, 3, 8, 13, 19–20 and 23 can follow in beta updates without misleading anyone.

## Related

[1.0 readiness bar](../../docs/release-readiness.md) · [Visual QA checklist](ui-visual-qa-checklist.md) · [Code-health ledger](code-health.md) · [Performance backlog](../backlog/performance.md) · [UI copy and layout review](ui-copy-and-layout-review.md) · [Status](../../docs/status.md)
