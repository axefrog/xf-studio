# UI copy and layout review

**Status:** audit, plan and implementation, 27 September 2026, branch `claude/ui-copy-polish` ([§7](#7-implementation-status)). It covers every panel, sheet, menu, toolbar, status line, empty state and hint of XF Studio as it stood at `f4f21a7`, which is `main` with the component library merged. The review rewrites text and presentation only; behaviour stays as it is. It also plans the **Coming soon** placeholders for features whose design is agreed ([§6](#6-coming-soon-placeholders)). The copy rules that come out of it are in [§2](#2-copy-style-guide) and in the style guide ("Copy and wording", section 01). Progress on the plan is recorded in [§7](#7-implementation-status).

**How it was made.** The live UI was walked in an isolated `?verify=1` workspace, on its own port, with scratch settings and data. A screenshot and the visible text of every panel were captured under the worktree's ignored `evidence/screenshots/ui-copy-polish/before/`. Four read-only inventories of the source then listed every user-visible string with its file, line, conditions and the tests that assert it. Screenshots and text captures stay local because they show installed mods' names.

**Verdicts.**

| Code | Verdict | Meaning |
|---|---|---|
| **K** | Keep | Right as it is. |
| **S** | Shorten | Say the same thing in fewer words, or in plainer words. |
| **H** | Help tip | What it *is* or how it works: move it into the help tip of the nearest heading or control. |
| **D** | Structured display | A run of facts: show them as a labelled list, chips or a badge, with details on demand. |
| **A** | Make actionable | Tell the person the one thing they can do, with the control if there is one. |
| **R** | Remove | Redundant, wrong, or developer-facing. |

**Visibility tiers** rank the work:
- **T1**: visible in the default wide layout without a click (header, status bar, Presets, Layers, 3D view, UV map, Colour & finish).
- **T2**: a tab in the default layout, one click away (Library, Mod package, History, Shape, Pigment & edge, Warp, Character, Camera & light, Motion, Preview quality).
- **T3**: closed panels, hidden modules and dialogs (Settings, Help, Activity, Expression, Save Explorer, the install, report and desktop sheets, the command palette).
- **T4**: transient text (toasts, refusal reasons, announcements).

## 1. Summary

**Counts by verdict.** The count covers the rows in §3, where one row may stand for a family of strings, for example "every finish description". A row with two verdicts is counted under its first.

| Verdict | Rows |
|---|---|
| Keep | 101 |
| Shorten | 71 (5 of them also move text into a tip) |
| Help tip | 19 |
| Structured display | 1 (the V summary) |
| Make actionable | 4 |
| Remove | 12 |
| **Total** | **208** |

**The five largest problems**, in order of how many people see them:

1. **Notes that explain controls sit inline under them.** The Pigment & edge notes, the Curve path note, the Motion status line, the Blink paragraph, the field-of-view note, the Untinted lights note and the lighting preset note all do this. Each explains *what a control is*. The help-tip rule (`controls.ts`, style guide "Help tips") already says that belongs in a tip. Each note costs two to four lines of every panel's height and is read once.
2. **The V summary is a wall of text.** The Character panel's `characterDetailLine` joins every slot, every slot message, every limit sentence and a caveat into one paragraph that can run past 600 characters. It is a list of facts and should be displayed as one: a folded, labelled list, with the reason for each "not shown" row in its own help tip.
3. **Status lines repeat the controls.** "Idle playing · body moves · face moves" restates the two switches above it. "Setup: Soft studio" repeats the pressed chip. "Editing point 1 of 4 · select points in the UV map or on the head" pairs the counter with instructions.
4. **Buttons that belong together are stacked in rows of different widths.** Check and Build are two full-width buttons of different sizes. So are Save to library and Save as new collection. The Your V row wraps five buttons of mixed purpose (source, presets, defaults).
5. **Developer words reach the person.** "Point blend 0.05% UV", "provisional roughness and metalness", "single-lobe gloss", "Fresnel", "SQLite", "studio server", "private local mod candidates", "import budget", "phase" and "a Studio choice".

**Duplicated states**, each said two or three times at once:
- Glitter's preview-only status (group tag, badge, refusal and warning note).
- The library state (header chip, Presets chip, Library line).
- "No changes yet" (History eyebrow and empty-state title).
- The Motion unavailable reason (select, switches and note line).
- The WolvenKit need (Character status line and summary note).

## 2. Copy style guide

These rules are also the style guide's "Copy and wording" entry (section 01, `f-copy`).

**Voice.**
- Plain, calm, second person: "your V", "your game files", "your mod".
- Say what happens and what to do, not how it is implemented.
- Present tense and active verbs. Avoid "XF Studio" as the subject of every sentence: say it once where it matters, and otherwise leave it out ("Couldn't read…").
- No blame, no exclamation marks, no emoji.

**Words.**
- Use the names on the controls. A sentence that names a control uses its exact label ("Turn on **Smooth point gradients**"). Never name a control that doesn't exist ("Save collection", "Build setup", "the Finish panel").
- One name per thing:

| Say | Not |
|---|---|
| 3D view | viewport, pane, preview head |
| UV map | UV pane, UV editor |
| game files | game resources, archives |
| version | revision |
| Settings › Game | Build setup |
| Turn on / turn off | Enable / disable (in running text) |
| mod files | mod candidates, private local mod |

- Units a person uses: %, °, px, MB (1 MB = 1,000,000 bytes, or say MiB consistently). Never a raw internal unit such as "% UV" unless the control is a research tool.
- No developer vocabulary: host, adapter, server, SQLite, budget, phase, candidate, provisional, lobe, Fresnel, LUT (say "colour grade"), manifest, fingerprint (outside the Details block), "a Studio choice". `USER_FACING_JARGON` in `alpha-availability.ts` enforces part of this list for capability reasons.
- Evidence and honesty stay, briefly: "not yet checked in game" is one clause, once per place, never a paragraph.

**Length limits.**

| Kind | Limit | Form |
|---|---|---|
| Panel, section or group title | 1–3 words | Title case for panel tabs; section eyebrows are set in capitals by CSS |
| Control label | 1–4 words | Sentence case, no colon, no trailing full stop |
| Button | 1–3 words | Verb first; "…" when it opens a choice before acting |
| Status line | One line, about 70 characters | A state, then at most one next step |
| Inline note (actionable) | One sentence, about 100 characters | Only a limit, a refusal or the one thing to do now |
| Help tip | A title (optional) and 1–2 short paragraphs, 300 characters in all | What it is, how it behaves, what it doesn't do |
| Reason (unavailable) | One sentence, about 90 characters | Why, and what makes it available |
| Toast | Title plus 1–2 sentences | What happened, what was kept, the recovery button |
| Empty state | Title of 2–4 words, one sentence, one button | What goes here and how to start |
| Coming soon | "Coming soon: \<what it will let you do\>", under 80 characters | On a disabled control or planned entry |

**Where text goes.**

| The text says… | Put it in |
|---|---|
| What a control or section *is*, how it works, a caveat | A **help tip** on its label or heading |
| What the person can or must do now | An **inline note** (reserved line) or the **status line**, with the button |
| A changing state (loading, playing, updating) | The **status line** of fixed height, or the control's own label ("Pause idle" / "Resume idle") |
| A set of facts about the subject (the V's details, a build's files) | A **structured display**: property list, chips, badges |
| Why a control is unavailable | The **reason tip** (`applyCapability`), which is focusable |
| The outcome of an action | A **toast**, recorded in Activity |
| A keyboard shortcut list | The Keyboard & mouse reference, with a help tip pointing to it; never a permanent footer |
| A feature that is designed but not built | A **Coming soon** disabled control or a planned entry (§6) |

**Never:**
- repeat a label in the note below it;
- say the same state in two places at once;
- explain what a visible control obviously does ("Pick a setup, then adjust it");
- leave an empty section that only says there is nothing here;
- let showing or hiding text move the layout: reserve the line (`NoteLine`, `reserveNote`) or float the text (tips).

## 3. Audit by panel

Each row gives the tier (§ intro), where the text sits, the current text (abridged), the verdict and the proposed text or treatment. "Tip" means the help tip of the named label or heading. File references are relative to `projects/xf-studio/authoring/src/`.

### 3.1 Header, status bar and shell (T1)

| Where | Current | V | Proposed |
|---|---|---|---|
| Modules button | "{modules}" / "Modules" + tooltip | K | Keep |
| Crumbs | collection › preset, "Loading…" / "No preset" | K | Keep |
| Library chip | "Unsaved changes" + long tooltip | K | Keep the label; the tooltip follows the shortened Library line (§3.9) |
| Verification flag | "Verification workspace" | K | Keep |
| Undo / Redo tooltips | "Undo: {step} (Ctrl+Z)\nCovers your makeup and presets. Changes in the Character panel have their own Undo there." | K | Keep (a tooltip, two lines) |
| Save / Package / Commands | labels and tooltips | K | Keep |
| Settings tooltip | "Settings: your game and mod manager, saves folder, WolvenKit and appearance" | S | "Settings: game, mod manager, saves, tools and appearance" |
| View preferences menu hints | "Corner strip and target tooltips that follow the pointer and held keys" | S | One wording for input hints everywhere: "Hints in the 3D view and UV map that follow the pointer and the keys you hold" |
| Modules menu row hint | "Preview · {description} Adds 1 panel." | S | Keep the description to one clause; see the module descriptions below |
| Save Explorer module description | "A read-only look inside your saves: every node, the objects in them and the data your script mods keep there." | S | "Look inside your saves, read-only." |
| Expressions module description | "V's facial expression: the face's own controls, start from any installed photo-mode expression, a live solved preview." | S | "Pose V's face with the game's own face controls." |
| Eye makeup module description | "Layered eye makeup: the layer stack, the UV map, four inspectors and two view tools." | S | "Design layered eye makeup for your V." |
| Status bar | "Ready", last log message, "▲ {autosave}", readiness | K | Keep |
| Panel descriptions (Panels flyout hints) | "Game close-up idle and the game's blink." | S | "The game's idles and blink." |
| | "Check and build private local mod candidates." | S | "Check and build your mod files." |
| | "Field of view, framing, exposure, key light and display studies." | S | "Camera framing, lighting and display." |
| | "Local library revisions, recovery and portable files." | S | "Saved versions, recovery and files." |
| | "Resolution of generated preview textures, readiness and resource use." | S | "Makeup texture size and memory." |
| Command palette footer | "↑↓ choose · Enter run · disabled commands explain why" | K | Keep |
| Palette "Unavailable" vs menus "Unavailable." | two fallbacks | S | One: "Not available right now." (the `dom.ts` fallback) |

### 3.2 Presets (T1)

| Where | Current | V | Proposed |
|---|---|---|---|
| Eyebrow + chip | "Collection" + state chip | K | Keep |
| Presets heading tip | "Each preset becomes one choice in the game's single eye-makeup selector, alongside Off." | K | Keep |
| Row meta | "{n} layer(s)" / "Made with a newer XF Studio · kept as it is" | K | Keep |
| Footer | "Restore removed" / "Import recipe as preset…" | K | Keep |
| Empty (no presets) | "No presets yet" / "A preset is one complete look — one choice in the in-game selector." | K | Keep |
| Empty (library failed) | "…retry once the studio server is running." | S | "Library unavailable" / "Your library couldn't be read. Your draft still works. Try again, or restart XF Studio." |

### 3.3 Layers (T1)

| Where | Current | V | Proposed |
|---|---|---|---|
| Head | "Stack {n}" + Add layer + icons | K | Keep |
| Footer note | "Top = front. Drag the grip or use Alt+↑ / Alt+↓ to reorder · F2 renames · Delete removes (Ctrl+Z undoes)." | H | Tip on "Stack": "The top layer is in front. Drag a row's grip or press Alt+↑ / Alt+↓ to reorder; F2 renames; Delete removes." The shortcuts come from the bindings catalogue |
| Row meta | "Matte · 85%" | K | Keep |
| Eye tooltip (shown) | "Shown. A hidden layer is kept, but left out of your mod files." | S | "Hide layer (a hidden layer isn't built into your mod)" |
| Eye tooltip (hidden) | "Hidden: left out of your mod files. Click to show it." | K | Keep |
| Warning flag | "Left out of your mod files: {reason}" | K | Keep |
| Empty (no layers) | "Layers stack like makeup: the top of the list is applied last and appears in front." | S | "Layers stack like makeup: the top one sits in front." |
| Empty (no preset) | "Layers belong to a preset. Add or select one to edit its layers." | K | Keep |
| Locked look | "This look needs a newer XF Studio" + body | K | Keep |

### 3.4 3D view and UV map (T1)

| Where | Current | V | Proposed |
|---|---|---|---|
| Crumb | "{preset} › {layer}" / "No layer selected" | K | Keep |
| Hint strips | "Drag orbit view · Wheel zoom view · …" | K | Keep (the input-bindings contract) |
| Blocked notes | "Surface controls are off · turn them on to edit on the head" | K | Keep (actionable) |
| Readiness badge | "Preview 1K · ready" | K | Keep (UI-92) |
| Loading overlay | status + "You can keep working in the UV map." + button | K | Keep. Its hide test (the message containing "UV") is fragile; see §4 |
| Detail overlay | long composed detail sentences | S | Shows only the first line of the V's detail state (preparing, failed, WolvenKit), clamped to one line, with the button. The full list lives in Character (§3.10) |
| UV toolbar | "Both eyes", "Single eye", "Other eye", "Fit shape" | K | Keep |
| UV off-view notice | "Selected point is outside this view · F: fit shape · O: other eye" | K | Keep |
| Toolbar idle tooltip | set once as "Play the game idle" | A | Follow the state as the aria label does ("Pause idle" while playing) |

### 3.5 Colour & finish (T1)

| Where | Current | V | Proposed |
|---|---|---|---|
| Layer strip | "{name}" + "1 of 1 from front" | K | Keep |
| Empty | "No layer selected" / "Select a layer in the Layers panel, or add one to this preset." | K | Keep |
| Pigment section | "Colour", "Opacity" | K | Keep |
| Group tags | "Exports" / "Experimental" / "Preview only" | S | "Can be built" / "Experimental" / "Preview only", the same words as the export badge |
| Finish card tooltip | "Metallic / foil — Exports. A continuous metallic sheen…" | S | "Metallic / foil. A continuous metallic sheen without separate flakes." The group tag already says the export state |
| Description line | "Colour-shift (also duochrome). A duochrome: the colour turns…" | S | "Colour-shift (duochrome): the colour turns toward a shift colour as the lid curves away." Other finishes: keep their one sentence |
| Glossy description | "…In game this is one sharp reflection; there is no separate clear coat." | S | "A smooth, wet-looking shine over colour." The game note moves to the export line |
| Export line, Matte/Satin/Metallic note | "Flat colour with provisional roughness and metalness." | S | "Built as a flat colour. Not yet checked in game." |
| Export line, experimental notes | "Experimental single-lobe gloss: one smooth reflection, no separate clear coat. Needs in-game confirmation." (and facet, Fresnel) | S | Glossy: "Built as one smooth reflection. Not yet checked in game." Shimmer: "Built as fine facets that merge into a sheen at a distance. Not yet checked in game." Colour-shift: "Built as one shift tint for the whole preset. Not yet checked in game." |
| Export line, preview only | "Preview only for now. Check and Build leave out layers with this finish and tell you which." | S | "Not built into mods yet: Check and Build leave these layers out." |
| Earlier-model reason | "…Switch it to the game-matched model in the Finish panel to include it." | A | "This layer uses an earlier preview model the game can't draw. Choose **Use game-matched model** to include it." |
| Colour-shift preset rule | 2 sentences, 190 characters | S | "Built only when every drawn layer of this preset is Colour-shift with the same colours: the game adds one tint to the whole preset." |
| Glitter warning note | "Preview only: Glitter can't be built into a mod yet, so it is left out of your mod files. Layer colour sets the base colour; facet colour is separate." | R + H | Remove the note (the badge and export line say it). Tip on "Glitter": "Layer colour is the base; the flakes have their own colour." |
| Flakes tip | "Turn the head to see the flakes catch the light." / "Experimental: may look different in game." | S | First paragraph kept. The second shows only for Shimmer (Glitter is preview only, not experimental) |
| Colour shift tip | "…the way the game's gradient-recolour decal adds its Fresnel colour." / "…not thin-film or multichrome." | S | "The shift colour shows toward the lid's edges as the view angle grows." / "One shift colour per preset is built into your mod." |
| Irregular flakes measurement | "{n} approximate flake centres in this painted shape from {m} retained in the eye UV regions…" | K | Keep (a research study control) |
| Open mod package / Use game-matched model | buttons | K | Keep |

### 3.6 Shape (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Contour point | "Point 1 / 4", Remove point | K | Keep |
| Curve, Bézier note | "Drag the gold tangent handles in the UV map or on the head. Smooth keeps arms aligned; Symmetric also matches lengths; Corner moves each independently. Handles may cross the eye opening — they are guides, not surface anchors." | H | Tip on "Selected point handles": "Smooth keeps both handles in line. Symmetric also keeps them the same length. Corner moves each on its own." / "Handles are guides: they may cross the eye opening." |
| Curve, automatic note | "This saved shape uses automatic curves. Enable Bézier handles to edit tangents; the curve is preserved, though finer sampling can change edge pixels slightly. Undo restores it." | A | "This shape uses automatic curves. Choose **Enable Bézier handles** to edit them; Undo takes it back." |
| Segment tooltips | "Aligned arms with independent lengths" … | S | "Handles in line, lengths free" / "Handles in line, same length" / "Each handle free" |
| Symmetry | heading + "Mirror across the face" | K | Keep |
| Editing gestures (folded) | a list built from the bindings | K | Keep |
| Gestures footer | "The same gestures work in the UV map and on the head. Press ? for every binding." | K | Keep |

### 3.7 Pigment & edge (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Point line | "Editing point 1 of 4 · select points in the UV map or on the head" | S + H | "Point 1 of 4". "Select points in the UV map or on the head" goes into the tip on "Pigment strength" |
| Selected point pigment | slider | K | Keep |
| Smooth point gradients | switch | H | Tip: "Blends pigment smoothly between points. Off keeps this layer's original blending." |
| Point blend | slider "0.05% UV"; reason only in the tooltip | H + A | Tip: "How far pigment blends between neighbouring points. More blend softens the differences; a point at 0% may keep a little pigment." Reserve its note line, so the reason shows while unavailable: "Turn on Smooth point gradients to blend points." |
| Note (smooth on) | "Point strength blends pigment across the shape. More blend softens differences between nearby points; a zero point may retain some pigment. Edge softness controls the outline separately." | R | Removed: its content is in the two tips above |
| Note (smooth off) | "Original point blending is preserved for this layer. Enable smooth gradients to remove internal strength seams; Undo restores the previous look." | R | Removed: the reserved reason on Point blend says the one thing to do |
| Per-point edge softness | switch | H | Tip: "Give each point its own edge width. Widths blend between points. Turning this off keeps your point settings." |
| Edge softness slider | "Edge softness" / "Selected point softness" | H | Tip on the slider: "How far the edge fades out, all the way round." |
| Note (per-point on) | "Widths blend between points; very soft edges can influence nearby sharp edges in narrow shapes. Turning this off keeps your point settings." | R | Removed (now in the switch's tip) |
| Note (per-point off) | "One fade width around the whole shape. Enable per-point softness to vary the edge independently of pigment strength." | R | Removed (now in the slider's tip) |
| Three wordings of one reason | "Enable smooth point gradients to adjust blending." / "Turn on smooth point gradients first." / "Enable smooth point gradients before adjusting their blend." | S | One wording: "Turn on Smooth point gradients to blend points." (the engine string stays for `spec-fields.json` until regenerated; the panel shows the panel wording) |

### 3.8 Warp (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Warps tip | "A warp bends the makeup mask, not the face. Its pull fades smoothly beyond the reach ring; overlapping warps add together." | S | "A warp bends the makeup, not the face. Circle: position · square: pull · dashed ring: reach. Overlapping warps add together." |
| Warp chips, Add warp | "Warp {n}", "Add warp" | K | Keep |
| Legend note | "Circle: position · square: pull · dashed ring: reach. {n} warps on this layer." | R | Removed: the legend moves into the tip, and the chips show the count |
| Empty | "No warps. Add a warp, then drag its square in the UV map or on the head to pull the makeup." | S | "No warps yet. Add one, then drag its square to pull the makeup." |
| Selected warp | "Reach", "Reset warp pull", "Remove warp" | K | Keep |

### 3.9 Library and Mod package (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Library state line (unsaved) | "Last saved as version 1 in your library; saving creates version 2. Changed since then: the collection name or preset order and 1 preset. Your draft autosaves on this computer." | S + H | "Changed since version 1: the name or order, and 1 preset." "Your draft autosaves on this computer" goes into the Local library tip, which already explains saving |
| Library state line (not saved) | "This collection hasn't been saved to your library yet. Your draft autosaves…; Save to library keeps a version you can return to." | S | "Not in your library yet. Save to keep a version you can return to." |
| Library state line (autosaved) | "Started from version {n} in your library. Your draft autosaves…; Save to library keeps a new version." | S | "Started from version {n}. Save to keep a new version." |
| Library state line (newer) | "Your library has a newer version of this collection (version {n}) saved elsewhere; your draft started from version {m}. Saving will report a conflict — save a copy or reopen it." | A | "Version {n} was saved elsewhere; your draft is from version {m}. Save as a new collection, or reopen it." |
| Save to library / Save as new collection | stacked, different widths | K | One row (layout, §4) |
| Saved collections note | "Opening keeps your current draft recoverable." | H | Tip on "Saved collections" |
| Saved row | "0 presets · version 1 · 9/27/2026, 9:03:52 AM" | K | Keep |
| Recover note | "Next draft: “{name}” (version {r}). {k} of {limit} drafts recoverable; recover again to walk through them." | K | Keep |
| Files tip | three sentences | K | Keep |
| Replace confirmations | 2–3 sentence menu details | K | Keep (a confirmation must say what is lost) |
| Mod package tip | three paragraphs | S | "Builds your own copy of your XF mods from your current draft, unsaved edits included." / "Each eye makeup preset becomes one choice in the character creator's “XF” selector." Drop "Your collection and library are never changed." (Build's result says it) |
| Check / Build | stacked, different widths | K | One row, Build primary (layout, §4) |
| Build confirmation | "Uses the current draft, including unsaved edits. Takes a few minutes and can't be cancelled once started. Nothing is added to your game or mod manager until you choose to." | K | Keep |
| Progress line | "{progress} A started build can't be cancelled, and closing XF Studio doesn't stop it." | S | "{progress}" plus "It can't be cancelled once started." |
| Empty result | "No check yet" / "Run Check to see which presets and layers can become mod files. Check creates no files." | K | Keep |
| Result card | "Build result", badge, "{k} of {n} presets can become mod files." | K | Keep |
| Build note | "Your mod was built and checked. Nothing is in your game yet: add it to your mod manager, or show its folder to copy it by hand. How it looks in game hasn't been checked yet." | K | Keep (the honesty rule) |
| Stale note | "This result describes an earlier snapshot of the draft. Run Check again before relying on it." | S | "Your draft changed after this result. Run Check again." |
| Game & tools section | tip + status + Open Settings | K | Keep; its place is discussed in §4 |
| What can be packaged tip | three paragraphs | S | "Check decides what is built; this list is a guide." / "Preview-only layers are left out and named in the result. Experimental finishes may look different in game." |

### 3.10 Character (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Source line | "Your V from your save (game 2.31)." / "The character creator's default feminine V." / "The V from the preset “{name}”." | S | "From your save · game 2.31" / "The creator's default feminine V" / "From the preset “{name}”" |
| Buttons | Load a save…, Load preset…, Save preset…, Default V (feminine), Default V (masculine), wrapping | K | Keep the labels. Layout: two rows, "V" (Load a save…, Default V (feminine), Default V (masculine)) and "Presets" (Load preset…, Save preset…, with Undo/Redo and Reset all at the right). See §4 |
| Status line | fixed height with Try again / Keep / Details | K | Keep |
| First-time status | "Updating… A first-time choice is read from your game files, so it takes a few seconds; after that it's instant." | S | "Updating… The first time takes a few seconds." |
| Details warnings | "Your V uses a choice the installed game and mods don't offer…" | K | Keep (behind Details) |
| **V summary** | "Skin: pale warm ivory, skin type 5 · Face details: … · Clothes: not shown. XF Studio can't draw your V's clothes (item) (items a mod adds aren't read yet) yet, so they aren't shown. Shading and lighting are approximate." | D | A folded list, **"In the 3D view"**, with a count ("10 details · 1 not shown"). Open, it is a property list: Skin → "Pale warm ivory, skin type 5"; Clothes → "Not shown", with a help tip holding that slot's message. The preview limits ("A piercing part stays in place…") become one "Limits" row, each sentence in its tip. "Shading and lighting are approximate." goes into the list's heading tip |
| Detail preparing / failed / WolvenKit lines | "Preparing your V's skin, face details, eyes, brows, lashes, hair, piercings and body from your game files…" | S | "Preparing your V's details from your game files…"; failed: "Your V's details couldn't be prepared. The head still works."; WolvenKit: shown once, in the status line with **Set up WolvenKit…**, not repeated in the summary |
| Doubled "yet" | "…(items a mod adds aren't read yet) yet, so they aren't shown." | S | "XF Studio can't draw your V's clothes ({list}) yet: items a mod adds aren't read yet." |
| Show my V's own makeup + tip | toggle + tip | K | Keep |
| Reset all | alone on a row | K | Keep the label; it moves beside Undo/Redo (§4) |
| Search legend | "○ Not prepared yet: the first time, XF Studio reads it from your game files, which takes a few seconds. ◌ Being prepared in the background." | S + H | "○ Not prepared yet · ◌ Preparing", with a tip: "Choosing a choice that isn't prepared reads it from your game files, which takes a few seconds the first time." |
| Legend, stopped | "Preparing ahead has paused: it used its disk space for this session. Every choice still works; the first time takes a few seconds." | S | "Preparing ahead has paused (disk space for this session is used). Every choice still works." |
| Heading switches | visible "Shown" | K | Keep (the switch's name is "Show hair in the 3D view") |
| Hair tip | "Hair physics is not simulated: the 3D view shows each hairstyle at rest, as it is modelled." | K | Keep until hair physics lands (`claude/hair-physics`), which rewrites it |
| Eye shape label + tip | "Eye shape in the 3D view" | K | Keep |
| Eye shape note | "Overriding the saved eye shape (Eye shape 3) in this viewport only." | S | "Your V's own is Eye shape 3; this changes the 3D view only." |
| Uncensored toggle | "Show my V uncensored, as the game can" | S | "Show my V uncensored" (the tip says what it does) |
| Clothes label + tip | "Clothes in the 3D view" + tip | K | Keep |
| Default V clothing note | "The default V wears nothing of her own; Underwear only dresses her in the game's basic underwear." | K | Keep: it is one of the application's clothing notes (the others are actionable), so moving only this one would need a new field |
| Other clothing notes | "This save was loaded before XF Studio read clothes. Load it again to see what your V wears." | K | Keep (actionable) |
| Files tip | "A save is read on this computer and never changed or uploaded." | K | Keep |
| Prepared files line | "Prepared game files on this computer: 8.9 GB." | S | "Prepared game files: 8.9 GB", beside Clear |
| Clear tooltip | two sentences | K | Keep |
| Undo tooltip | "…Covers creator options and Clothing; the header's Undo covers your makeup." | K | Keep |

### 3.11 Camera & light (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Camera tip | "Camera and light are workspace settings: they persist locally and never enter recipes, the look's Undo or export." / "Undo here (Ctrl+Z) steps back through view and lighting changes, which keep their own history." | S | "Saved with your workspace; they never change your looks or your mod." / "Ctrl+Z in this panel undoes view and lighting changes, which have their own history." |
| FOV note | "The camera moves closer or further as you change the lens angle, so your V's face stays the same size." | H | Tip on "Field of view (vertical)". The line under the slider is kept (reserved) for the limit messages, which are actionable |
| FOV limit messages | "This pane is too narrow to fit the full Front view within the camera range. Widen the pane or increase FOV." | S | "Too narrow for the whole front view. Widen the panel or raise the field of view." (and the same for the whole body) |
| Framing buttons | Front view, Whole body, Creator face, Creator hair | K | Keep |
| Studio preset note | "The Studio's own lighting, for authoring. Pick a setup, then adjust it as you like." | R | Removed (the segment's tooltip says it) |
| Creator preset note | "The game's character-creator lights (female rig) on black, with fixed exposure. {grade} Shadows are not simulated, and light strengths are still being calibrated." | S + H | Line: the grade state only ("Colour grade: the game's own", "Colour grade: from {mod}", "Loading the game's colour grade…"). Tip on "Light": "Character creator: the game's creator lights for your V's body, on black, with fixed exposure." / "Shadows aren't drawn yet, and light strengths are still being calibrated." |
| Setup label + readout | "Setup" … "Soft studio" / "Adjusted" | K | Keep (the readout shows "Adjusted") |
| Room light slider | "Room light (ambient and reflections)" | S + H | "Room light", with a tip "Ambient light and reflections." |
| Untinted lights note | "Grey lights of the same brightness instead of the warm key and cool fill, for judging colour." | H | Tip on the switch |
| Restore defaults ×2 | same label in two sections | K | Keep (research-only duplicate) |
| Research calibration | "Φ ÷ 4π", "Stored cone angles are", "Creator exposure (k)" | K | Keep (research tool, shown only with research tools on) |
| Display: Surface controls, Preview normal map | switches | K | Keep |
| Eye's own roughness notes | four notes (research only) | K | Keep |
| Label mismatch | Undo label "Environment strength" / "Normal map preview" | S | "Room light" / "Preview normal map", matching the controls |

### 3.12 Motion (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Game idle | heading | H | Tip: "Idles the game plays on V in its character creator and inventory, made from your game files. Their timing may differ slightly from the game's." |
| Body select | "Body" + tip "Still, or one of the idles the game plays on V in its creator and inventory screens." | R (tip) | Label kept; its tip removed (the heading's tip says it) |
| Pause idle | button | K | Keep |
| Body movement / Facial movement | switches | H | Tip on Facial movement: "Turn off either to hold that part still. The idle keeps time, so it carries on smoothly when you turn it back on." |
| Status note (idle on) | "Idle playing · body moves · face moves. Muting both holds the pose without losing its phase." | R | Removed: the switches and Pause/Resume show the state. The line's place becomes the Facial movement switch's reserved note, which shows only "Loading that idle…" or why motion is unavailable |
| Status note (Still) | "The game's own idles, made from your game files: the creator's stand on the creator's lifted feet, the inventory's on V's own. Their timing may differ slightly from the game's." | H | Into the Game idle tip (the feet detail is dropped) |
| Loading note | "Loading that idle; the previous one plays until it's ready." | K | Keep, in the reserved note |
| Unavailable reason | "The character creator's idle couldn't be prepared from your game files, so your V holds still. Everything else works." | K | Keep (once, in the reserved note) |
| Blink | heading | H | Tip: "The game's own blink, made from your game files: lids, lashes, brows and makeup move together." / "Closure scrubs the closing half. Play blink plays it at the game's speed, every 2.45 s." |
| Blink paragraph | "The game's own normal blink, solved from your game files: … (a Studio choice: the idle's average blink spacing). Off while the idle plays, which blinks on its own." | R | Removed: the explanation goes into the tip, and "off while the idle plays" is the reason shown in Closure's reserved note while it applies |
| Blink errors | "The prepared blink is damaged; prepare it again." | K | Keep. The UI offers no "prepare again" for the blink; see §4 |

### 3.13 Preview quality (T2)

| Where | Current | V | Proposed |
|---|---|---|---|
| Section tip | "Applies to generated masks and optical maps only. Head, eye and imported textures keep their detail." / "Preview quality is a local preference: it never changes recipes, Undo, library revisions or the 2048² export." | S | "Sets the size of the makeup textures in the 3D view. The head and eyes keep their own detail." / "Saved on this computer; your looks and your mod are unchanged." |
| Segmented | "Generated texture resolution" | S | "Texture size" |
| State line | badge + detail + "The makeup textures use about {n} MB of memory at this size." | K | Keep; "MB" is computed as MiB, so say "MiB" or compute MB |
| Rebuild preview | button | K | Keep |

### 3.14 History and Activity (T2, T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| History eyebrow | "{n} steps · {m} undone" / "No changes yet" | K | Keep |
| History tip | three sentences | K | Keep |
| History empty | "No changes yet" / "Your edits to this preset appear here, oldest first. Click any step to go back to it." | R (title) | The eyebrow already says "No changes yet": the empty state keeps its sentence only. The same applies to "No preset" and "No preset selected" |
| Trimmed note | "Older steps were not kept. Only the latest changes are kept for each preset." | S | "Only the latest steps are kept." |
| Activity tip | "This log lasts only until XF Studio closes. Results that matter (library revisions, package manifests) are stored by their own services." | S | "This log is cleared when XF Studio closes. Your saved versions and built mods are kept elsewhere." |
| Activity empty | "Nothing yet" / "Saves, checks, imports, exports and errors appear here for this session." | K | Keep |

### 3.15 Settings (T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| Game tip | "Saved on this computer as you choose. XF Studio finds your game and mod manager for you; change a choice only if it picked the wrong one." | K | Keep |
| Game status | "Ready: XF Studio can build your mods and add them to Mod Organizer 2." | K | Keep |
| Field tips | folder, instance, profile, extra folder | K | Keep |
| Head used for the eye plate | bare label | H | Tip: "Build cuts the eye plate from this head. Use the unmodified head only if a head mod stops Build." |
| Your own WolvenKit | label, no placeholder | K | Keep |
| Saves status, buttons | "Detected: …", "Choose another folder…" | K | Keep |
| Saves typed-box note | "Paste the folder that holds your save folders (ManualSave-0, AutoSave-1 and so on). In File Explorer, open that folder and copy its address bar." | K | Keep (actionable) |
| Developer override note | "XFS_SAVES_DIR is set, so this server reads that folder instead." | K | Keep (developer only) |
| Appearance tips | three | S | Input hints: the one wording (§3.1) |
| Privacy note | "Diagnostics stay on this computer. A problem report is prepared for you to review and save; nothing is sent by itself." | R | Removed; the group tip becomes "Diagnostics stay on this computer. A report is prepared for you to review; nothing is sent by itself." |
| Diagnostic mode tip vs report dialog tip | two explanations | S | One: "Keeps more detail about what XF Studio does, for a day, to help find a problem. It stays on this computer." |

### 3.16 Help (T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| Search, tours, topics | titles, summaries | K | Keep |
| Keyboard & mouse note | "Generated from the Studio's own bindings. ? opens the same list as a sheet." | S | "? opens this list anywhere." |
| More help details | one muted line each | K | Keep |
| Settings topic | "*Settings*" asterisks render literally | S | Use the supported bold token |
| Make your mod tour step | "…Nothing is installed in your game for you." | S | "…**Add to my mod manager** adds it when you choose to." (the flow now exists) |

### 3.17 Expression (T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| Status (solver missing) | "The live face preview needs the facial solver from the Cyberpunk Blender add-on, which this version of XF Studio can't set up by itself yet. You can still set every control: your expression is saved with the look." | S | "The live face preview isn't available in this version. Every control still works and is saved with the look." The Blender add-on detail moves to "How live expressions work" |
| Status (ready) | "Showing your expression on the 3D head, solved with the game's own face rig." | K | Keep |
| Footnote | "A solved preview of the game's facial rig on your V; not yet compared with the game in photo mode. Updates in about {n} ms." | H | A tip on the status line's help icon: "Solved with the game's own face rig. Not yet compared with photo mode." The timing moves to the tip too |
| Start from, Save expression, Find a control, Mirror, Reset all | labels | K | Keep |
| Linked / Separate | toggle text and tooltips | K | Keep |
| Control tooltips | raw rig names | K | Keep (useful to modders; tooltip only) |
| Pupil / tongue notes | "The preview doesn't show pupil size." | K | Keep (a limit, one line) |

### 3.18 Save Explorer (T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| Count, Refresh, Open a save file… | labels | K | Keep |
| Footer | "Read-only: XF Studio never changes a save here. Script mods' data is shown as the save names it." | H | Tip on the count heading |
| Tree keys note | "{keys} move, {keys} open and close, Enter shows the node." | H | Tip on the tree's heading |
| Empty states | "No saves found in …" + Open Settings › Saves | K | Keep |
| Node and object notes | "{n} world objects (of {n} slots); {n} read completely. An object that isn't read completely is kept exactly as the game wrote it." | K | Keep (a research tool; precise on purpose) |
| Mod data intro | "Script mods keep their data in the save as ordinary objects…" | H | Tip on the Mod data view |

### 3.19 Sheets, dialogs and the palette (T3)

| Where | Current | V | Proposed |
|---|---|---|---|
| Add your mod sheet | heading, lead, changes, buttons | K | Keep |
| Report a problem | intro, groups, warnings | K | Keep (consent needs the words) |
| Desktop app sheet | leads and notes | K | Keep |
| WolvenKit download dialog | facts list | K | Keep (a consent dialog) |
| Onboarding offer | "A short tour shows where everything is…" | K | Keep |
| Palette titles | "Export compiler plan (saves first; not a mod)" … | K | Keep |
| Palette "Build mod files" vs button "Build mod files…" | ellipsis differs | S | "Build mod files…" in both |

### 3.20 Toasts, reasons and announcements (T4)

| Family | Example | V | Proposed |
|---|---|---|---|
| Library toasts naming absent controls | "Save collection to store this arrangement." / "Save a copy creates a separate collection. Undo collection open recovers the previous draft." | S | Name the real controls: "Save to library", "Save as new collection", "Undo open" |
| Library jargon | "Collection draft restored without replacing unsaved edits from SQLite." | S | "Your draft was restored; your unsaved edits are kept." |
| Revision vs version | "Saved “{name}” · revision 4." | S | "Saved “{name}” · version 4." |
| Import limit | "Collection exceeds the current 16 MB import budget." | S | "That collection is larger than 16 MB, the most XF Studio can import." |
| Server words | "Restart the studio server to enable local package builds." / "Could not reach install detection. Restart the studio server and retry." / "Install detection is unavailable on this host." | S | "Restart XF Studio to build mod files." / "XF Studio couldn't look for your game. Restart XF Studio and try again." / "Looking for your game isn't available here." |
| Mask export | "Exported 2048² white + alpha mask; palette remains separate." | S | "Exported the layer's shape as a 2048 × 2048 mask." |
| Dock announcement | "…Use Move window from its menu…" | S | "…Use Move or resize window from its menu…" |
| Build setup | "Your build settings file is damaged. Restore the previous copy in Build setup." | S | "…in Settings › Game." |
| Everything else | refusal reasons in the application and engines | K | Keep; they follow the reason rules and many are asserted by tests |

## 4. Layout issues

Ranked by visibility.

| # | Tier | Where | Issue | Plan |
|---|---|---|---|---|
| L1 | T2 | Pigment & edge, Shape, Motion, Camera & light | Inline explanation notes add 2–4 lines under controls and push the next section down | Help tips (§3); lines kept only where a reserved note carries an actionable limit or reason |
| L2 | T2 | Character › Your V | Five text buttons of three purposes wrap onto two lines, with an empty status line and a long summary before the first control. Reset all sits alone in its own box | Two labelled rows: "V" (Load a save…, both Default V buttons) and "Presets" (Load preset…, Save preset…). Undo, Redo and Reset all go at the right of the first row. The summary becomes the folded list |
| L3 | T2 | Mod package | Check (outline) and Build (primary) are stacked at different widths. A tall reserved gap sits before "No check yet" | One row, Build primary at the right. The progress line stays reserved but only one line high |
| L4 | T2 | Library | Save to library and Save as new collection are stacked at different widths | One row |
| L5 | T2 | Motion | Select, a lone button row, two switches and a note line: four vertical groups for one idea | The free note line is gone (its text is the Facial movement switch's reserved note). The Body select becomes a button set on `claude/hair-physics`; its row is settled there |
| L6 | T2 | Camera & light › Light | Seven studio sliders in one run with no grouping | A "Key light" subgroup (direction, height, strength) and a "Fill and room" subgroup (room, fill, rim); Exposure stays at the top. Presentation only |
| L7 | T1 | Colour & finish | The export line's badge, note and button wrap into a box whose note wraps to two lines at the default width | With the shortened notes (§3.5) it fits one line at the default width |
| L8 | T2 | Mod package | Game & tools sits below the result card, so a Build blocker shows far from Build | The setup line moves directly under Check / Build while it blocks Build; when ready it stays in its section |
| L9 | T2 | History | The eyebrow and empty-state title say the same thing | The empty state's title is dropped (§3.14) |
| L10 | T1 | 3D view overlay | The UV line is hidden by testing whether the message mentions "UV", which breaks when the copy changes | The overlay takes an explicit flag from the setup service. This touches behaviour, so it is recorded for a follow-up |
| L11 | T2 | Character | Toggles and selects are natively disabled (not focusable, reason only in the tooltip), while buttons use the focusable reason tip | Library follow-up: a focusable disabled state for Toggle and SelectField. Requested from the component track |
| L12 | T3 | Settings › Saves | The typed-box guidance is permanently inline | Kept: it is actionable and shows only while the box is open |
| L13 | T2 | Motion › Blink | Errors ask to "prepare it again", but the UI offers no way to do that for the blink alone | Follow-up: point the person at Character › Files › Clear prepared game files, if that re-prepares the blink (to be confirmed) |

## 5. What the tests pin

These strings are asserted by tests and change deliberately with the plan. Anything not listed is free to reword.

| Test | Pinned text |
|---|---|
| `tests/game-blink-composition.test.ts` | the Blink paragraph fragment "repeated every 2.45 s (a Studio choice…)" and `blinkNoteLine` returning the missing message |
| `tests/detail-limits.test.ts` | `characterDetailLine` output and that `DETAIL_LIMIT_TEXT` is used only in `preview.ts` |
| `tests/character-panel-dom.test.ts` | "Show my V uncensored, as the game can", "Reset all", the legend "Not prepared yet", "Prepared game files on this computer: 1.5 GB." |
| `tests/studio-ui-logic.test.ts` | "Last saved as version 3 in your library; saving creates version 4" |
| `tests/history-panel.test.ts` | "Older steps were not kept", "No changes yet" |
| `tests/ui-polish-dom.test.ts` | readiness labels, install sheet labels, Settings folder labels |
| `tests/golden/spec-fields.json` | engine reasons ("Turn on smooth point gradients first.") |

## 6. Coming soon placeholders

**The product shows only what exists** (the 1.0 "honest surfaces" default, 28 September 2026). The catalogue below is the roadmap record: its entries appear only while **research tools** are on (View preferences › Show research tools), as disabled rows with a neutral **Soon** tag and a short **"Coming soon: \<what it will let you do\>"** reason. With research tools off, which is the default, nothing unbuilt is listed. Module views show none of them. Nothing speculative is recorded: every entry below has an agreed design.

**One catalogue.** Every placeholder is an entry in `src/studio-ui/coming-soon.ts`, and each planned module is an entry in `PLANNED_MODULES` (`compose/modules.ts`). Each names the key of the live feature that replaces it:
- a module ID (`module:`);
- an action kind (`action:`);
- a view tool ID (`tool:`);
- an exporter's feature (`exporter:`).

**How they disappear.**
- **At runtime,** the presentation lists placeholders only with research tools on (`comingSoon(id, live, research)` and `plannedShown`), and hides one whose feature is registered (`plannedModules()` drops a planned module whose ID is a live module; the placeholder helper checks the action registry).
- **In tests,** `tests/coming-soon.test.ts` fails while a placeholder and its live feature both exist. It checks module IDs against `STUDIO_MODULES`, exporters against `STUDIO_EXPORTERS`, and action kinds and tool IDs against the source. So the feature that lands deletes its placeholder in the same change, and no dead UI survives.

| Placeholder | Where (research tools on) | Key | Owning design |
|---|---|---|---|
| Nail Salon | Modules menu › Character, Planned | `module:nails` | [Nail Salon design](../nails/nail-salon-design.md) |
| Hair colours | Modules menu › Character, Planned | `module:hair-colours` | [Hair colour authoring feasibility](../hair/hair-colour-authoring-feasibility.md) |
| Brows | Modules menu › Character, Planned | `module:brows` | [Brow editor design](../brows/brow-editor-design.md), [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md) |
| Cheeks | Modules menu › Character, Planned | `module:cheeks` | [Brows and cheeks brief](../backlog/brows-and-cheeks-brief.md) |
| Tattoos | Modules menu › Character, Planned | `module:tattoos` | [Tattoos brief](../character-customization/tattoos-brief.md) |
| New view | Panels flyout › Views | `action:view.create` | [View graph design](view-graph-design.md) P4 |
| Duplicate view (shared camera) | Panels flyout › Views | `action:view.duplicate` | [View graph design](view-graph-design.md) P4 |
| Face handles | Not shown (module views show no placeholders) | `tool:expressions.handles` | [Expression editor design](../animation/expression-editor-design.md) phase 2 |
| Sculpt | Not shown | `tool:expressions.sculpt` | [Expression editor design](../animation/expression-editor-design.md), "sculpt mode (Option 3)", confirmed as a later mode |
| Edit values | Not shown | `action:saves.setValue` | [Save editor design](../save/save-editor-design.md) §7.2 (the writer's phase 1: scalar values) |

**Not placed, and why:**
- **Pose (body source)**: the Poses module landed with a real "Pose: …" choice in Motion › Body, so no placeholder is needed.
- **Hair physics**: being built for real on `claude/hair-physics` (the Motion panel's switch and `motion.setPhysics`), so a placeholder would be dead on arrival.
- **Selectors panel, "Add selector"**: waits for the Selectors panel ([selectors design](selectors-design.md) S1). A panel holding only a disabled button would be an empty section.
- **Shadows (key light)**: no agreed design. The [creator lighting](../../knowledge/creator-lighting.md) page says the first release goes without shadow maps. The Light tip says shadows aren't drawn yet.

**For the teams building these:** the key in the table is what the placeholder waits for. If a feature lands under another name, change the key in `coming-soon.ts` (or remove the entry) in the same change. Feature views don't import the catalogue (`tests/studio-ui-boundary.test.ts`): only the shell lists placeholders.

## 6a. Show the options, don't hide them (dropdowns)

The rule (AGENTS.md): show every choice at once (a button set, a swatch row, an expandable tree for long or grouped lists) unless a dropdown has a real reason. Every dropdown in the UI:

| Dropdown | Verdict | To | State |
|---|---|---|---|
| Motion › Body (Still or an idle) | Convert | `ChoiceList` (chips) | **Done**. It had become a wrapped `Segmented` on `claude/hair-physics`, which read as a broken listbox (a sunken box of centred rows, the chosen one only underlined); `Segmented`'s `wrap` mode is removed |
| Character › Eye shape in the 3D view (1–22 by head) | Convert | `ChoiceList` (tiles), each tile named "Eye shape n" | **Done** |
| Character › Clothes in the 3D view (up to 4 states, only those offered) | Convert | `ChoiceList` (rows) | **Done** |
| Settings › Head used for the eye plate (2 long options) | Convert | `ChoiceList` (rows) | **Done** |
| Colour & finish › Glitter preview model (research only, 5 long options) | Convert | `ChoiceList` (rows) | **Done** |
| Settings › Cyberpunk 2077 folder, Mod Organizer 2 instance, extra mod folder | Convert | `FolderSetting` with every found folder shown as a choice | **Done**: the library's FolderSetting gained `found`/`onSelect` and an optional folder's `onClear`; the first found folder is saved while none is chosen (defaults first) |
| Settings › Mod Organizer 2 profile | Keep | — | An open-ended list of the person's own profile names, which can run to dozens. A short list (5 or fewer) as buttons is optional later |
| Expression › Start from (about 100 grouped expressions, used as a command) | Convert | `SearchField` plus `TreeView` grouped by provider | Folded into the expressions drawer follow-up |

## 7. Implementation status

Phase 2 applied §3–§6a with the component library's help tips, sections, property list and disabled states, one area per commit on `claude/ui-copy-polish`. Behaviour is unchanged, with one deliberate exception asked for with the dropdown pass: Settings › Game saves the first folder XF Studio found while none is chosen (defaults first). Before and after screenshots of every panel are under the worktree's ignored `evidence/screenshots/ui-copy-polish/` (`before/`, `after/`), with the Modules and Panels menus.

| Area | State |
|---|---|
| Copy style guide (style guide `f-copy`) | Done |
| Motion | Done (idle and blink explanations in tips, one reserved line; the Body select left to `claude/hair-physics`) |
| Camera & light, Preview quality, Activity | Done (L6's slider sub-groups not done: a later layout pass) |
| Pigment & edge, Shape, Warp | Done |
| Colour & finish, Layers | Done (finish descriptions and export notes shortened in the engine's finish table) |
| Character | Done (the V's details list, two button rows, legend tip) |
| Library, Mod package, History | Done. L3: Check and the primary Build mod files… share one row at every width down to 300 px, and the progress takes the rest of that row (one line, reserved), so there is no band before the result. L8 not done |
| Shell, Settings, Help, Expression, Save Explorer | Done (Save Explorer's tree keys note kept: the tree has no heading to hold a tip) |
| Toasts and reasons (§3.20) | Done |
| Coming soon placeholders (§6) | Done |
| Dropdowns (§6a) | Done except the MO2 profile (kept) and Expression › Start from (the drawer follow-up). The library's `ChoiceList` (chips, rows, tiles) is the single-select control for more than four options or long labels, in the Character panel's choice look (the creator choices are built from the same `choiceItem`); `Segmented` is for two to four short options |

**Follow-ups done in the same pass:** the library's TreeView gives a row's label priority over its secondary text (the secondary text takes only the room left, hides in a tree narrower than about 320 px, and the full text is the tooltip), and the Character panel's search is the library's SearchField (icon, clear button, Escape clears, the same pause as Poses). The reserved empty note line under a choice list or switch was kept at its height: collapsing it to the section gap would move the next control when a note appears.

**Review round (coordinator):**
- The Character panel's empty band is gone: the "In the 3D view" heading leads the panel's fixed-height status line, so an empty status no longer leaves a band of its own, and the folded list's wrapper takes no room.
- FolderSetting reserves its refusal line only while its text box is open, so Settings › Game keeps the normal rhythm between folders.
- Planned entries in menus carry a neutral **Soon** tag and their "Coming soon: …" in the muted colour (menu `tag`, `quietReason`), never the warning colour. Since the 1.0 honest-surfaces pass they are listed only with research tools on (§6), and early-access modules carry the **Early access** stage tag instead of a "Preview ·" hint prefix.
- Creator choice rows show every choice: "Show N more" is gone, the row loads its pages one after another, and when a row opens the V's choice is scrolled into view and the maker group holding it opens. Measured on the reference setup (the Hairstyle row, 283 choices): every page loaded in about 0.3–0.4 s, and reopening the row (every choice rendered from the cached pages) took 26 ms to the next painted frame, so no virtualisation is needed.

**Gate review fixes (UI visual QA checklist):** the Field of view note line is gone (a framing limit is a notice); the Setup readout that repeated the pressed chip is gone; the Character legend is one line and the status line gives back 4 px, so both gaps read 16 px; every note line is one 16 px line, clamped with its text in the tooltip, so a reason appearing never moves the next section (measured: Blink's heading stays put when the Hair physics reason shows); waits and information (Hair physics, Body before the preview, Blink) use the muted note tone (`quietReason` on Toggle, Slider and ChoiceList); the Colour & finish export line drops the badge that repeated the finish's group; the Poses module line is one sentence; the MO2 profile reads "2025 (again) · last used"; a found folder's path wraps between folders.

**Still open:** L6 (studio slider sub-groups, now UI-126), L8 (the setup line beside Build while it blocks), L10 (the 3D view overlay's UV-line flag), L11 (a focusable disabled state for Toggle and SelectField), L13 (the blink's "prepare it again"), and Expression › Start from (§6a).
