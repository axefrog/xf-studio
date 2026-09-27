# Selectors: character customisation organised around creator rows

**Status:** design for discussion, 27 September 2026; nothing built. It turns an approved idea into a model, a UX, an export plan and phases: character customisation in the Studio is organised around **selectors**, meaning character-creator rows. It proposes replacing the "One selector" rule in [AGENTS.md](../../AGENTS.md) ([proposed wording](#9-proposed-agentsmd-wording)).

It extends the [feature-module platform](feature-module-platform.md) (§2 document model, §6 export) and the [view graph design](view-graph-design.md) (§3.9 contributions, §4 module activation). The game facts come from the [character-customisation file chain](../../knowledge/cc-file-chain.md), the [piercing feasibility study](../jewellery/ccxl-piercing-feasibility.md) and the [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md). Code paths are relative to `projects/xf-studio/authoring/src/`.

## Contents

- [0. Summary](#0-summary)
- [1. The model](#1-the-model)
- [2. Game rules](#2-game-rules)
- [3. UX](#3-ux)
- [4. Export](#4-export)
- [5. Phases and effort](#5-phases-and-effort)
- [6. Risks](#6-risks)
- [7. In-game checks to batch](#7-in-game-checks-to-batch)
- [8. Questions, with proposed defaults](#8-questions-with-proposed-defaults)
- [9. Proposed AGENTS.md wording](#9-proposed-agentsmd-wording)

## 0. Summary

**The idea (approved to design, 27 September).**

- The player sees the vanilla creator rows they can add to (cheek makeup, piercings, and so on).
- **Activating a selector** turns on every editing control for what it contains, and becomes the main way of switching between customisation modules.
- The player can **add their own selectors** of a feature type. With two eye makeup selectors (say eyeliner and eyeshadow), the two could be combined freely in game. Piercings work the same way: add to the vanilla piercing rows and/or add custom piercing rows.
- Each selector is an entry in its own panel, which holds its settings: included in the export or not, whether "XF" is shown, its name and its place in the creator.
- Views can be linked to a selector. Hiding the selector hides its views; other views stay as they are.

**The maintainer's constraints (27 September).**

- **Per-type caps.** A type can be capped. Eye makeup is capped at 1 for now, because the draw order of two XF eye plates on one skin is unknown in game.
- **No worry about row counts.** A crash report from someone who adds 50 rows would itself be useful.
- **Save identity is auto-generated**, with sensible values. The game silently ignores a saved reference to something missing.

**The model in one paragraph.** A **selector** is a document-level node in the reactive graph: a **feature type** × a **target**. The target is either a **new XF row** or an **existing vanilla row** that the selector adds choices to. A selector holds:

- its **looks** (the authored choices; a look belongs to exactly one selector);
- its **settings** (name, "XF" shown, placement);
- its **export membership**;
- a stable, auto-generated **identity** that never depends on the display name.

A **selector type registry** says, per feature type, which targets it allows, its caps and its defaults. Today's collection becomes one XF Eye Artistry selector with the same identity, so the export stays byte-identical and nothing is lost.

**UX in one paragraph.**

- A **Selectors** panel lists the collection's selectors, grouped by part of V like the Character panel. Under each group, it lists the game rows XF can add to there.
- **Clicking a selector activates it:** its module's panels, view tools and toolbar buttons appear, bound to it. The Presets panel lists its looks. The look you edit is the look V wears in that row.
- The eye toggle hides the selector's content and parks the views linked to it.
- **Add selector** picks a type and a target, and respects caps with a plain reason.
- Settings sit under the active selector in the same panel.
- The **Character panel** stays the creator's own values, and shows the collection's selectors where the game will show them.

**Export in one paragraph.**

- Products group **selectors**, not only features. The default is still one XF mod; splitting per feature or per selector is optional.
- Each selector's resources are named from its generated key (`xfs_s<uuid>`). The migrated eye makeup selector keeps `xfs_c<collection>`.
- Check resolves each row's place from the player's merged creator catalogue. Partial export reports excluded selectors as omissions.

**Plan.** Five phases after view graph P2 (S1–S5), about 18 agent-days. A sixth, vanilla-row emission, takes about 3 more and arrives with the first type that needs it (§5).

## 1. The model

### 1.1 What a selector is

| Part | What it holds | Where it lives |
|---|---|---|
| **Type** | A registered selector type (`eye-makeup`, `piercings`, `cheeks`, …), which names its feature module | Document |
| **Target** | `own` (a new XF row, with a placement) or `vanilla` (an existing row, named by its switcher's `uiSlot` and resolved against the merged catalogue) | Document |
| **Looks** | The authored choices: today's presets, each holding its feature's part | Document |
| **Settings** | Name, show "XF", placement, body genders | Document |
| **Export membership** | Included (default) or left out, and which product carries it | Document (in the package plan) |
| **Identity** | `SelectorId` (collection-scoped) and a resource key, both generated at creation and frozen | Document |
| **Activation** | Which selector the editing panels are bound to (one at a time) | Workspace (editor state; the application owns it) |
| **Worn look** | Which look (or Off) V wears in this row in the Studio | Workspace |
| **Visibility** | Whether the selector's content draws in the views | Workspace |

**Why it is a graph node.** The "Reactive graph by default" rule applies. A selector feeds several consumers, all derived rather than written:

- the scene nodes' content (its worn look, drawn by its feature's renderer);
- the Character panel's rows;
- the module contributions (panels, view tools, the crumb) while it is active;
- the Presets panel;
- the export products.

Hiding a selector withdraws its contributions. Nothing may assume one selector per feature, one live surface per feature, or one selector per collection. The singletons this rules out today are `STUDIO_LAYERED_SURFACES` and `liveSurface` (one layered surface; [view graph §2.7](view-graph-design.md#27-preview-jobs)) and the exporter's "one plate, one selector and one plan per collection" (`features/eye-makeup/export-info.ts`).

### 1.2 Types, targets and caps

```ts
// platform/api/selector.ts (sketch)
export type SelectorTypeId = string & { readonly __selectorType: unique symbol };   // "eye-makeup", "piercings"
export type SelectorId = string & { readonly __selector: unique symbol };           // collection-scoped
export type RowRef = { readonly slot: string };            // a creator row by its uiSlot ("piercings", "makeupCheeks")
export type VanillaShape = "sub-row" | "choice-per-look" | "slot-overlay";           // §2.2

export interface SelectorType {
  readonly id: SelectorTypeId;
  readonly feature: FeatureId;                  // the feature module whose part a look holds
  readonly module: ModuleId;                    // the Studio module whose panels activation shows
  readonly label: string;                       // "Eye makeup"
  readonly group: PartOfV;                      // Selectors panel grouping, from the Character panel's hierarchy
  readonly own?: { readonly anchor: RowRef;     // default placement: after this row
                   readonly category: string;   // randomizeCategory: "Makeup", "FaceModification"
                   readonly groups: readonly string[] };   // consumer groups: ["character_customization", "face"]
  readonly vanilla?: readonly { readonly row: RowRef; readonly shape: VanillaShape }[];
  readonly defaultTarget: "own" | RowRef;
  readonly caps: { readonly total?: number; readonly own?: number; readonly perRow?: number;
                   readonly reason?: string };  // the plain sentence shown when a cap is reached
  readonly bodyGenders: readonly ("female" | "male")[];
  readonly brand: string;                       // "XF Eye Artistry": the split mod's default name
  readonly stage: "stable" | "preview" | "dev";
}

export type SelectorTarget =
  | { kind: "own"; after?: RowRef | { selector: SelectorId }; index?: number }   // none: the type's anchor
  | { kind: "vanilla"; row: RowRef };
```

- **Registration.** A feature module registers its selector type in its core (`features/<id>/index.ts`, next to `exports`); `compose/` lists it. Only the type registration names a vanilla row, and it uses the game's own `uiSlot` constant, the way eye makeup's exporter already names the groups `face` and `character_customization`.
  - The Selectors panel, the Add dialog and the Character panel render the registry and name no row.
  - This keeps the Character panel's rule that "no module names an option, slot or mod" ([CC controls decisions](../backlog/cc-controls-and-presets.md#decisions-26-september)).
  - A row the player's installation lacks makes that target unavailable, with a reason; it is never guessed.
- **Caps** are enforced in the application's capability check (`limit` reason code), never only in the UI, so a future MCP client meets the same rule. `total` counts every selector of the type; `own` counts own rows; `perRow` counts selectors on one vanilla row.
- **`ExportInfo.selector`** ("own" or "vanilla") becomes the type's `defaultTarget`.

### 1.3 The types, and which targets each allows

| Type | Own row | Vanilla row(s) | Default | Cap | Source of the default |
|---|---|---|---|---|---|
| **Eye makeup** (XF Eye Artistry) | Yes | No | Own row | **1** total. Reason: "For now V can wear one XF eye makeup at a time: two XF eye plates on the same skin may draw in an unpredictable order in game." | Its custom face plate; the maintainer's cap |
| **Piercings** | Yes (rows per area: "XF Ears", "XF Nose") | `piercings` (sub-row) | Own row after Piercings | None | [Piercing decisions](../jewellery/ccxl-piercing-feasibility.md#decisions-26-september-2026): own rows per area; vanilla row allowed by the approved idea |
| **Cheek makeup** | Yes (layers over vanilla freckles) | `makeupCheeks` (sub-row) | Vanilla row | Own: 1 until two XF plates' order is known (cheek and eye plates overlap) | [Brows and cheeks decision 4](../backlog/brows-and-cheeks-brief.md#decisions-26-september-2026) |
| **Lip makeup** | Yes | `makeupLips`, `makeupLips_glossy`, `makeupLips_matte` (sub-row) | Vanilla row | Own: 1 | Settles the platform's §6/§9 inconsistency in favour of §6 (question Q13) |
| **Eyebrows** | No (a decal cannot remove the brow beneath it) | `eyebrows` (choice per look, with the creator's colour row) | Vanilla row | None | [Brows and cheeks: selector](../backlog/brows-and-cheeks-brief.md#selector) |
| **Hair colours** | No | Every `hair_color` row, with brows, lashes and beard following (slot overlay) | Vanilla rows | **1** total: colours are one set, and a second selector would only split it | [Hair colour study §3](../hair/hair-colour-authoring-feasibility.md#3-what-an-xf-export-would-emit) |
| **Nails** (Nail Salon) | No (a second nail mesh would draw over V's own; a lifted overlay is a later option) | `nails_color` with its first-person and cyberware followers (slot overlay, which patches new-named appearances into the nail `.app` and `.mesh` files) | Vanilla row | **1** total: every look sits in one grid | [Nail Salon §2](../nails/nail-salon-design.md#2-what-an-xf-export-is) (design, needs discussion) |
| **Tattoos** | Yes (the community rows 3300–3309 are candidate placements) | `facial_tattoo`, `body_tattoo` (sub-row) | Vanilla row | None | [Tattoos brief](../character-customization/tattoos-brief.md) |

**Not selectors.** Some modules have no creator row. They stay global modules, shown from the Modules menu ([view graph §4.2](view-graph-design.md#42-the-modules-menu)):

- **Poses and expressions** (photo-mode content): export products, but not creator rows;
- **World**;
- **Character** (the creator's own values).

Their export membership stays per feature in the package plan (§4.2).

### 1.4 Document model

```ts
export type StoredSelector = {
  id: SelectorId; type: SelectorTypeId; target: SelectorTarget;
  name: string;            // the Studio's name and the label's short part; "" = the type's default wording
  showBrand?: false;       // "XF" in the creator label; absent = shown
  exported?: false;        // absent = included
  key?: string;            // resource key; absent = derived (§1.5)
  bodyGenders?: ("female" | "male")[];   // absent = what the type supports
};
export type StoredCollection3 = { schema: "xfs/collection-3"; id: Uuid; name: string;
  selectors: StoredSelector[];                                   // panel order
  presets: (StoredPreset & { selector: SelectorId })[];          // each look belongs to one selector
  packagePlan?: ModPackagePlan };
```

- **A look belongs to one selector** and holds that selector's feature part. The in-game unit is the row: rows combine freely, and a look spanning two rows has no in-game meaning. This narrows the platform's sparse multi-part look (§2) without removing it: `parts` keeps its shape, so a later cross-selector idea (question Q11) needs no format change.
- **The implicit selector.** A stored collection without `selectors` (every `xfas/collection-1` and `xfs/collection-2` file, SQLite row and draft) is read as having one **implicit selector** per exporting feature present, with ID `default:<feature>`, default settings and every look of that feature in it. Nothing is written for it.
- **Oldest schema that holds the content** (the existing rule). A collection whose only selector is the implicit eye makeup selector, with default settings, is still written as `xfas/collection-1`, byte-identical to today. `xfs/collection-3` is written only once a person adds a selector or changes a selector setting. Builds before S1 refuse it as newer, as they refuse `collection-2`.
- **Look identity.** Preset UUIDs and revisions are unchanged. Moving a look to another selector of the same type is allowed. Because it changes the look's in-game identity, it says so first: "Players who chose this look in XF Eyeliner will need to choose it again in XF Eyeshadow."
- **Selector edits** are collection actions (`selector.add`, `remove`, `restore`, `rename`, `set`, `move`) with Undo policy `none`, like `preset.edit` and `package.*` today. Removal is **recoverable**: **Reopen removed selector** keeps the last five, looks included, as removed presets are kept. `selector.activate`, `selector.wear` and `selector.setVisible` are editor and workspace actions with no Undo, like selection today ([platform §3](feature-module-platform.md#3-undo-history-and-persistence-budgets-core-02)).
- **Workspace.** `xfs/workspace-2` gains an optional `selectors` block, written only when it differs from the default:
  - `active` (default: the first selector);
  - `worn` (per selector: a look ID or `off`; default: today's selected preset for the implicit selector);
  - `hidden`.

  Per-look editor memory is unchanged.

### 1.5 Identity

| Identity | Implicit (migrated) eye makeup selector | Any other selector |
|---|---|---|
| `SelectorId` | `default:eye-makeup` | A new UUID |
| Resource key (namespace, option name, `uiSlot`) | `xfs_c<collection>`: exactly today's | `xfs_s<uuid-without-hyphens>` |
| Depot folder | `axefrog/appearance_studio/collections/<collection>/`: today's | `axefrog/appearance_studio/selectors/<uuid>/` |
| Look appearance | `xfs_c<collection>__xfs_p<preset>`: today's | `xfs_s<uuid>__xfs_p<preset>` |
| Placement | Index 311: today's constant, kept until the person moves the row | Resolved at Check (§2.3) |
| Creator label | "XF": today's | "XF " + name (§3.4) |
| Save as copy | Follows the new collection ID, as today | Fresh UUIDs, as `copyPackagePlan` does for split mods |

The display name never enters an identity, and renaming changes only text. Keys are frozen at creation. No two selectors in a collection, or in two copies of one, share a key, so a saved choice keeps pointing at the same look while its selector is renamed, moved between mods or re-placed ([platform §6](feature-module-platform.md#moving-a-feature-between-mods-without-breaking-saves)). When a save references a selector or look that is no longer installed, the game silently ignores it (the maintainer's observation, to be recorded as runtime evidence in check G3). So the Studio does not ship the tombstone definitions the piercing study proposed.

### 1.6 Migration: today's collection becomes one XF Eye Artistry selector

| What | Before | After |
|---|---|---|
| Stored collections, SQLite rows, drafts, exported files | `xfas/collection-1` / `xfs/collection-2` | Read unchanged, with one implicit eye makeup selector; written unchanged until a selector is added or a setting changed |
| The looks | Presets with eye makeup parts | The implicit selector's looks, same UUIDs, same order, same revisions |
| Selected preset | `selected` per collection | The implicit selector's worn look, and the active selector |
| Package plan | `xfs/package-plan-1`, products by feature | Read unchanged; the implicit selector follows its feature's assignment |
| Export | One `xfs_c<collection>` option at index 311, label "XF", 21 members for the finish board | **Byte-identical**: same plan, members, `.archive.xl` and manifest fields (gate: `tools/compare-package-candidates.ts`, as in platform step 8) |
| UI | Presets panel, eye makeup panels | The same panels, bound to the one active selector; the Selectors panel shows one entry, "Eye makeup (XF)" |

No appearance changes, nothing is lost and no stored byte is rewritten. The parity gates of [platform §2](feature-module-platform.md#2-document-model) apply to S1 and S3.

## 2. Game rules

### 2.1 What adding to a vanilla row means

- **One choice per row.** A creator row is the set of options sharing a `uiSlot`, and it shows one active option at a time. A switcher's targets are active only while its current choice names them ([file chain: slots and switchers](../../knowledge/cc-file-chain.md#slots-switchers-and-visibility-resource)). An XF choice added to a vanilla switcher therefore **replaces** the vanilla choice while it is chosen: an XF blush look hides V's vanilla blush or freckles, and choosing a vanilla choice again hides the XF look.
- **Additive in data, exclusive in use.** ArchiveXL merges switcher choices by `localizedName` and definitions by `name`. A new key is appended, but an existing key **replaces** the vanilla or other mod's entry ([file chain §5](../../knowledge/cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)). So every key we emit is unique by construction (§2.4), and the [additive audit](../jewellery/ccxl-piercing-feasibility.md#4-additive-audit-what-would-replace-or-shadow-existing-choices) applies to every type.
- **An own row layers.** A new row is another slot, so its look is worn **together with** whatever V wears in the vanilla rows. That is the reason to choose one.

### 2.2 How a selector reaches a vanilla row (three shapes)

| Shape | What Build emits | In the creator | Types |
|---|---|---|---|
| **Sub-row** (default for makeup-like rows) | The vanilla switcher, by its own name and type, merged with **one** new choice keyed `xfs_s<key>`. That choice turns on one new appearance option `xfs_s<key>` in the switcher's target slot (`makeupCheeks_color` for cheeks), with the selector's looks as definitions and `useThumbnails = 0`. The option has no link key, joins the vanilla targets' groups (cheeks: `face`, `character_customization`) and has a free index. | One entry, "XF Blush", at the end of the style row; its looks in the second row as a stepper, where the colours would be | Cheeks, lips, piercings (vanilla), tattoos (vanilla) |
| **Choice per look** | One switcher choice per look, each turning on its own option whose definitions are the creator's colours (brows through ArchiveXL's brow scope and `@brows`) | Each look is a style at the end of the row; the colour row still applies | Eyebrows |
| **Slot overlay** | Anonymous options by exact `uiSlot`, one `xfs_h<look>` definition per look, appended to every matching option | Each look is a colour at the end of every matching colour grid | Hair colours |

Two selectors on one vanilla row (sub-row) are two entries in that row, still one worn at a time. The anonymous overlay is allowed **only** for the slot-overlay shape. That shape exists to reach every hairstyle, and its unique `xfs_` names keep it additive, as every proven hair-colour pack does.

### 2.3 Placement, sections, links and switchers

- **Order.** The creator shows head, body and arm options as one list ordered by each option's `index`, with no section headers. Two top-level options with the same index show only the first [wiki + hypothesis on the native sort] ([file chain: presentation](../../knowledge/cc-file-chain.md#presentation-order-rows-sections-labels-and-swatches)).
- **An own row's place** is stored relative to another row: after a vanilla row by `uiSlot`, or after another selector. Check resolves it against the player's merged catalogue (which the Character panel already builds), per body gender: the first index after the anchor row's last option that no top-level option of the installation or of this build uses. It says what it chose ("After Piercings, position 306"). If the gap before the next vanilla row is full, it takes the nearest free index after and says so. The implicit selector keeps index 311 until moved. Check newly warns if that index is taken, which changes no bytes.
- **Sections.** The Studio files rows under the creator's randomizer categories (`randomizeCategory`). An own row takes its type's category (Makeup, FaceModification), so the Character panel and the randomizer file it with its neighbours.
- **Consumer groups.** An own row joins its type's groups (`face` and `character_customization` for makeup and piercings; brows would use the TPP groups). A row missing `face` renders in the creator but not in photo mode ([runtime], 25 September).
- **Links.** Our options never carry a vanilla link key. A link propagates the **choice index** to every follower, so a look option on `makeupCheeks color` would drag the vanilla colour index along. Shapes that need the creator's colours reuse the vanilla definition list or ArchiveXL's dynamic templates.
- **Switchers.** We never replace or reorder a vanilla choice. We never use `resource.fix.paths`, `resource.patch` on vanilla resources, or a vanilla depot path.
- **Edit contexts.** Our rows use `editTags` `NewGame`, `HairDresser` and `Ripperdoc`, like vanilla makeup and piercings, so they can be changed at a mirror.
- **Old saves.** A new own row joins a save made before it existed at its default, Off (ArchiveXL `OnInitAppOption` [source]).

### 2.4 Labels and keys

- **An own row's label** is the option's `localizedName`, written as the composed label ("XF", "XF Ears"; §3.4). Look names are the definitions' `localizedName`, as today. Neither is a merge key: definitions merge by `name`, which is the look's appearance identity.
- **A vanilla-row choice's label is a merge key.** A switcher choice labelled "XF Blush" by two XF builds from different collections would make one replace the other, and a look named "05" would overwrite vanilla style 5. So the choice's `localizedName` is the secondary text key `xfs_s<key>`, and the build ships an ArchiveXL `localization.onscreens` file mapping it to the label. The file is given as a bare path, so English is the fallback for every language. The label can then change without touching the key. ArchiveXL's text merge is read in source ([file chain: presentation](../../knowledge/cc-file-chain.md#presentation-order-rows-sections-labels-and-swatches)), but whether a switcher choice's label resolves this way in game is check G1.

### 2.5 Saying it plainly

| Where | Wording (proposed) |
|---|---|
| Add selector, target choice | "**Add to the game's Blush row.** Your looks appear as one more choice at the end of Blush. The game shows one choice per row, so while V wears an XF look there, her own blush or freckles aren't shown." / "**New XF row.** Your looks get their own row, so V can wear one with any blush or freckles." |
| Selectors panel, under the name | "In the game's Blush row · replaces V's own blush while worn" / "Own row · after Piercings" |
| Character panel, the displaced row | "Blush: XF Blush · Rose. V's own Blush 05 isn't shown while this is worn." with **Wear V's own** |
| A cap reached (Add dialog, disabled type) | "You already have an eye makeup selector. For now V can wear one XF eye makeup at a time: two XF eye plates on the same skin may draw in an unpredictable order in game." |
| A vanilla row missing from the installation | "This game doesn't have a Blush row to add to. A new XF row works instead." with **Use a new XF row** |

## 3. UX

### 3.1 The Selectors panel

A shell panel, placed in the `inspect` slot beside Character. It replaces the header's authoring-category label as the primary way to switch modules; the view graph design's Modules menu would have taken that place ([view graph §4.2](view-graph-design.md#42-the-modules-menu)).

```text
Selectors                                             [Add selector]
HEAD
  Makeup
  > Eye makeup (XF)            Own row, position 311      [shown]
      Wearing Smoky · 6 looks
    XF Blush                   In the game's Blush row    [shown]
      Wearing Off · 3 looks · Not exported
    + Add to Lipstick
  Face modifications
    XF Ears                    Own row · after Piercings  [hidden]
      Wearing Hoops · 2 looks
    + Add to Piercings   + New piercing row
BODY
  Tattoos
    + Add to Body tattoos
---------------------------------------------------------------
Eye makeup (XF): settings                          (the active one)
  Name        [                ]  Shown in the creator as "XF"
  [x] Show "XF" in the creator
  Place       After [Teeth v]     (position 311 on this game)
  [x] Include in the mod          In mod: XF Eye Artistry
  Remove selector
```

- **Grouping** follows the Character panel's hierarchy (top level by part of V: Head, Body; then the creator's sections), so both panels read alike. It is being reworked in parallel ([CC controls, next item 4](../backlog/cc-controls-and-presets.md#next)).
- **Each entry** shows the name, the target line and a visibility toggle. The second line gives the worn look and the look count. Chips appear only when something differs from the default ("Not exported", "In mod: XF Piercings"). A selector whose rows a type or installation can't use says so in the same line, in the Studio's usual plain words.
- **Clicking an entry activates it** (§3.3). Arrow keys move and Enter activates. The entry's menu has only what applies: Rename, Hide, Leave out of the mod, Move to mod ▸ (only with more than one mod), Duplicate, and Remove.
- **"+ Add to <row>"** lists, per group, the vanilla rows some type can target that aren't at their cap. **"+ New <type> row"** appears where a type allows own rows. Both are actionable shortcuts into the Add flow with the target preselected. A group with nothing to add shows nothing, following the rule that menus and hints only offer actions.
- **The visibility toggle** hides the selector's content in every view and parks the views linked to it (§3.5). It is workspace state and never changes the export.

### 3.2 Add selector

1. **Type.** A grid of the registered types, grouped by part of V, each with one line of what it makes. A type at its cap is shown disabled, with the cap's plain reason under it (§2.5). Types at stage `preview` carry the badge.
2. **Target.** Only the targets the type allows on this installation, with the type's default preselected and the consequence under each (§2.5). For an own row: the placement, defaulting to the type's anchor.
3. **Name.** Optional, prefilled with a sensible default: empty for the first eye makeup selector (the label stays "XF"), the row's name for a vanilla row ("Blush"), and "Ears" and "Nose" style suggestions for piercing rows.

**Create** adds the selector with one starter look (the type's `starter()`), activates it and makes the look worn, so there is something to edit at once. The type decides the defaults, so accepting every default takes two clicks: the type, then Create.

### 3.3 Activation drives modules, panels, views and toolbars

- **One active selector** is application state (`selector.activate`, editor state, no Undo). The feature panels' live document is the active selector's worn look, so the application routes feature actions and Undo by it, and an MCP client can activate selectors too.
- **Modules follow activation.** The presentation derives module visibility from the active selector: its type's module is shown and bound to it. Modules of inactive selector types park their editing panels, with layouts remembered per size class, as [view graph §4.3](view-graph-design.md#43-hiding-a-module) specifies.
  - A module can be **pinned** from the Modules menu. It then stays shown, bound to the last selector of its type that was active.
  - Global modules (Poses, World) are shown and hidden from the Modules menu, independently of selectors.
  - This combines the view graph's options: exclusive switching for editing, the maintainer's idea, and combinable modules for everything else (Q2).
- **Panels bind to the selector.** One set of panels per module serves every selector of its type and rebinds on activation, so two selectors of one type never duplicate panels. The Presets panel lists the active selector's looks, headed "Looks in XF Eyeliner".
- **Worn is edited.** Selecting a look in the Presets panel makes it the look V wears in that row (`selector.wear`), so the view always shows what the game will show. Each selector keeps its own worn look when another is activated.
- **Toolbars and menus** are derived as in [view graph §3.9](view-graph-design.md#39-how-modules-contribute-to-each-view). A view's tools come from the modules shown for its scene kind; a module's tools act on the selector it is bound to. The crumb becomes "Selector › Look › Layer" ("XF · Smoky › Layer 2"). Readiness aggregates per selector renderer.
- **Content.** A character scene draws, for each visible selector, its worn look through its feature's renderer. Renderers are created per (scene node, selector): `FeatureRendererFactory.create(port, selector)`. A vanilla-row selector's renderer `supersedes` the vanilla row while one of its looks is worn, so the preview shows exactly the one-choice-per-row rule.

### 3.4 Per-selector settings

| Setting | Default | Notes |
|---|---|---|
| **Name** | Type's default (empty for the first eye makeup selector) | Studio name and the label's short part. Plain text, 40 characters. |
| **Show "XF"** | On | Creator label = `"XF"` + (name ? `" "` + name : ""). With XF off, the label is the name alone, and an empty name is refused with a plain reason. The resource builder's `assertBrandedPlan` accepts the plan's composed label instead of requiring the prefix, as platform step 8 anticipated. |
| **Place in the creator** | Type's anchor; the implicit selector at 311 | Own rows: "After ▸ <row>", from the merged catalogue. Vanilla rows: "At the end of <row>", not choosable. |
| **Include in the mod** | On | Off leaves the selector and its looks out, reported as an omission ("left out by choice"). |
| **Mod** | The collection's default mod | Read from and written to the package plan (§4.2); shown only when there is more than one mod. |
| **Body genders** | What the type supports (female only today) | Appears once a type supports both ([masculine V plan](../character-customization/male-v-plan.md)). |
| **Identity** | Generated | Read-only, copyable, shown only with *Show research tools* on. |

### 3.5 Views linked to a selector

- A view's `tools` node ([view graph §3.1](view-graph-design.md#31-node-types)) gains a binding: `selector: "active" | SelectorId`, default `active`. A view bound to a specific selector keeps showing that selector's tools, and its editor where the module has one, whichever selector is active. An example is a second view pinned to XF Ears while XF Eyeliner is edited in the main view.
- **Hiding a selector** parks every view bound to it, as a hidden module parks its own views ([view graph §4.3](view-graph-design.md#43-hiding-a-module)), and removes its content from the other views' draws. Other views stay as they are.
- The UV map becomes eye makeup's flat view kind in view graph P6. Until then it is a panel of the eye makeup module and follows the active selector like any panel.

### 3.6 The Character panel, and modules that aren't selectors

| | Character panel | Selectors panel |
|---|---|---|
| Holds | The creator's own values for the shown V: vanilla and installed mods | What this collection adds to the creator |
| Kind of state | Preview context, its own Undo, never exported | Document, exported |
| Shows XF | The collection's own rows at their placement, marked "XF · this collection"; XF entries at the end of the rows they join | Every selector, grouped the same way |
| Choosing an XF entry | `selector.wear`: wear it in the preview. **Edit** on the row activates the selector | Activates, then wear from the Presets panel |
| An installed build of the same selector | Superseded by the collection's selector of the same key, so it never shows twice and the preview draws the authored version | — |

Poses, World, Camera & light, Motion and Quality stay global modules or shell panels, and are unaffected by activation.

## 4. Export

### 4.1 From selectors to plans

- **Per selector.** Each exported selector with at least one eligible look is planned by its type's exporter. `FeatureExporter.plan` receives a `SelectorPlanInput` instead of the collection's presets:
  - `id`, `key`, the composed `label`;
  - the resolved target: an own row's `index`, `category` and `groups`, or a vanilla row's switcher name, slot and shape;
  - the looks.

  An exporter never reads another selector.
- **Shared prerequisites** are prepared once per feature and reused by each of its selectors. Eye makeup's plate is the example; with the cap at 1, only one selector ever uses it.
- **The implicit eye makeup selector plans exactly today's `xfas/export-plan-1`.** `modName` stays the brand, and the plan stays product-independent.
- **Vanilla-row emission** (the three shapes of §2.2 plus the localization file of §2.4) is one pure helper in `platform/api/`, shared by every type, so exporters don't each rebuild creator resources.

### 4.2 Products and the package plan

```ts
export type ModPackagePlan2 = { schema: "xfs/package-plan-2"; products: ModProductPlan2[] };
export type ModProductPlan2 = { id: Uuid; name?: string;
  features?: FeatureId[];      // every selector of the feature, and a non-selector feature (poses)
  selectors?: SelectorId[] };  // a selector named here overrides its feature's assignment
```

| Choice | Default | Override |
|---|---|---|
| Which selectors ship together | **One product** holding every exported selector and exporting feature | Split per feature (all its selectors), or per selector |
| Product identity and archive | Default product ID = collection ID, archive `xfs_c<collection>` (today's) | — |
| Mod name | One type: its brand ("XF Eye Artistry", "XF Piercings"); several types: "XF Looks"; a single split-off selector: "<brand> (<selector name>)" | Rename freely |
| Namespace rule | A **selector key** may be present in only one installed XF mod (today's rule per feature, now per selector) | "Replace both" when moving, as today |

`xfs/package-plan-1` is still read, and still written while no plan names a selector. That keeps the step-8 rule that an unknown field means a newer plan. The collection actions gain `package.assignSelector` beside `package.assign`, and the Mod package panel offers "Move to mod ▸" per selector once the collection holds more than one exported selector.

### 4.3 Check, Build, verification and partial export

1. **Check**, per product:
   - each selector's eligibility and plan;
   - placement: an index free per body gender against the merged catalogue and the product, never shared with another top-level option;
   - uniqueness of every option name, choice key, text key and depot path across selectors, the product and the installed XF mods other than this build;
   - the `.xl` merge (several customization resources per gender as a YAML list, already built in step 8 and untested in game);
   - requirements.

   Check lists where each own row lands and which vanilla rows receive entries.
2. **Build** unchanged in shape: every selector's resources in the product's one staging tree, one pack.
3. **Verification.**
   - The product verifier requires the members to be exactly the union of the selectors' inventories, with one merged `.xl`.
   - Each feature verifier runs **per selector** on its subset.
   - A new creator-resource check confirms that every emitted switcher choice, option and definition key is new against the base resources the verifier reads. It is independent of the exporter, and it proves nothing replaces a vanilla entry.
4. **Partial export.** A selector left out by choice, a selector with no eligible looks, and a look without an adapter are each reported in Check, Build and the manifest, with the reason. A product left with nothing is refused, as today. Check and Build agree on the filtered snapshot and the identities.
5. **Manifest.** `xfs/local-package-2` gains a `selectors` list per feature: ID, key, label, target and resolved index or row, looks, omissions. For a build holding only the implicit selector, the `features` entries it already records are unchanged.

The [Studio-to-mod pipeline](studio-to-mod-pipeline.md) and its diagrams are updated, with visual review, in the checkpoint that builds S3, not by this design.

## 5. Phases and effort

All phases come after **view graph P2** (modules, parked layouts, derived tools); S5 also needs P4. Each leaves `main` green. Effort is in agent-days.

| # | Phase | Scope | Gates | Effort |
|---|---|---|---|---|
| S0 | Design | This page; the questions | The maintainer's answers | done |
| S1 | Selector domain model | `platform/api/selector.ts`; the type registry in `compose/`; eye makeup's type (own row, cap 1); the implicit selector; `xfs/collection-3` read and write under the oldest-schema rule; the `selector.*` actions with caps and plain refusals; workspace `selectors` block; renderers per (scene, selector) with the single-surface assumption removed | Collection-1 and collection-2 fixtures round-trip byte-identical; the SQLite fixture's rows unchanged; the registry golden changes only by the `selector.*` kinds; `raster()` and plan parity for the implicit selector | 4 |
| S2 | Selectors panel and activation | The panel, Add selector, settings, activation-driven module visibility (on P2's parked layouts), pinning, the Presets panel scoped to the active selector, the crumb | Pure derivation tests (activation × pin × module); `?verify=1`: add a second type's placeholder, switch, reload, layout returns | 4 |
| S3 | Export by selector | `SelectorPlanInput`; `xfs/package-plan-2`; label composition and the verifier's label rule; placement from the merged catalogue; the creator-resource uniqueness check; manifest `selectors` | **Byte-identical** finish-board build for the implicit selector (`tools/compare-package-candidates.ts`); a two-selector synthetic product with a stub type; split per feature and per selector; namespace-duplication refusal per selector | 5 |
| S4 | Character panel integration | XF rows and XF entries in the Character panel; wear and displacement text; the installed build superseded by the collection's | The context's derivation with XF rows; `?verify=1` with the reference save | 3 |
| S5 | Views bound to selectors | The tools node's binding; hiding parks bound views | Graph tests; `?verify=1` with two views | 2 |
| S6 | Vanilla-row emission | The shared sub-row, choice-per-look and slot-overlay helper with localization; its verifier checks | A stub type in each shape, verified offline; in-game check G1 before any type ships it | 3 |

S1–S5 take about **18 days**, with 16–20 as the range. S1 can start as soon as P2 lands. S2 needs S1 and P2; S3 needs S1; S4 needs S1 and the Character panel rework; S5 needs P4. S6 is built with the first type that targets a vanilla row.

**How later features arrive as selector types.** Each is a feature module plus a type registration. The acceptance test is the platform's: only the `compose/` lists change outside its folder.

| Type | When | Target work |
|---|---|---|
| Piercings | After its in-game probe ([experiment 024](../../experiments/024-ccxl-piercings/README.md)) and the construction set | Own rows per area first (probe rows "XF Ears" and "XF Nose" already have this shape); the vanilla `piercings` sub-row after S6 |
| Cheek makeup | After the cheek plate and S6 | Vanilla `makeupCheeks` sub-row by default; own row capped at 1 until check G4 |
| Eyebrows | After the brow editor | Vanilla `eyebrows`, choice per look |
| Hair colours | After the gradient editor | Slot overlay, capped at 1 |
| Lips, tattoos | Later | Vanilla sub-rows; own rows allowed |

## 6. Risks

| Risk | Mitigation |
|---|---|
| The look model narrows (one selector per look) against the platform's sparse multi-part looks | `parts` keeps its shape; cross-selector sets can return as a preview-only "combination" (Q11) with no format change |
| The migrated export drifts by a byte | The implicit selector has no stored settings, and its key, index and label are today's constants; the S3 byte-identity gate |
| Older builds can't open a collection with selectors | `collection-3` is written only when needed; older builds refuse it plainly, as `collection-2` today |
| A vanilla-row entry replaces someone else's entry | Unique `xfs_s` keys and text keys; Check's collision scan against the merged catalogue; the verifier's independent key check |
| Players don't expect an XF entry to hide V's own blush | The Add dialog, the panel line and the Character panel say it plainly; **Wear V's own** is one click; own rows stay available |
| The native row sort isn't by index, or a free index still collides | Check reports the resolved position; G2 and G4 observe it; the placement is a setting, so a fix is a rebuild |
| Exclusive activation annoys someone working across two modules | Pinning keeps a module shown; global modules are unaffected |
| GPU and memory cost grows per selector | Renderers per selector share the scene's caches; the eye makeup cap; the view graph's frame budget |
| ArchiveXL's handling of several customization resources per gender, or of text keys on switcher choices, differs in game | G1 and G2 before a type ships the shape; the platform §6 validation items |
| Uninstalled selectors leave odd state in a vanilla row | The maintainer reports the game ignores missing references; G3 confirms what the row shows |
| Masculine V needs separate resources per selector | `bodyGenders` per selector; the masculine plan's `male:` resources share textures |

## 7. In-game checks to batch

One prepared session, female V, with a throwaway **XF Selectors Probe** mod built by a script (no editor, owned primitive assets). Record the game, ArchiveXL, TweakXL and Codeware versions, and whether Phantom Liberty is installed. Where the runtime bridge can drive captures it does; creator clicks stay manual. G2 can reuse [experiment 024](../../experiments/024-ccxl-piercings/README.md)'s two piercing rows if that session runs first.

| # | Check | Expected | Settles |
|---|---|---|---|
| G1 | **An XF entry in a vanilla row.** The probe adds a sub-row entry keyed `xfs_s…` to `makeupCheeks`, turning on an option with two looks, labelled through a text file. In the creator: find it, choose it, step its looks, choose vanilla Blush 05, then the XF entry again; save, reload, open a mirror; photo mode. | One "XF Probe" entry at the end of the Blush row with its label shown (not the raw key); its looks in the second row as a stepper; choosing it hides vanilla blush, and choosing Blush 05 hides the XF look; persistence and the mirror selection hold; photo mode matches | The sub-row shape, text keys on switcher choices, a stepper replacing a colour grid in one slot, one choice per row |
| G2 | **Two custom rows of one type.** Two own rows with indices right after Piercings, registered as two customization resources in one `.xl`. | Both rows at the expected positions, switching independently and drawn together; each survives save and reload | Several resources per gender (platform §6 item a); placement by index; independence |
| G3 | **Missing selector on load.** A throwaway save wearing the G1 XF entry and a G2 row. Disable the probe, load, open the mirror; re-enable and load the original save (never overwrite it). | Nothing from the probe drawn and no warning (the reported behaviour). Record what the Blush row shows: V's earlier vanilla choice, the default or Off. The original save loads intact. | The missing-reference rule, and whether a vanilla row needs a fallback |
| G4 | **Placement and order.** One own row with an index between two vanilla rows, and the probe's G2 rows renamed and rebuilt at other indices. Also, cheaply: eye and cheek probe plates overlapping in the under-eye band. | The row appears between them; the renamed rows move without losing the saved choice. Record which plate draws on top. | Native sort by index; label and index changes are cosmetic (platform §6 items c, d); whether the eye makeup and cheek own-row caps can rise |

## 8. Questions, with proposed defaults

| # | Question | Proposed default |
|---|---|---|
| Q1 | Does a look belong to one selector, or can one look span several selectors? | One selector per look. Rows combine freely in game, so a cross-row look has no in-game meaning. |
| Q2 | Is activation exclusive? | Exclusive for editing panels (activating switches modules), with **Pin** in the Modules menu to keep a module shown; global modules unaffected |
| Q3 | How do XF looks appear in a vanilla row? | Per type: sub-row (one "XF <name>" entry, looks in the second row) for makeup-like rows, piercings and tattoos; choice per look for brows; slot overlay for hair colours |
| Q4 | What does hiding a selector do? | Hides its content in every view and parks the views bound to it; never changes the export (that is **Include in the mod**) |
| Q5 | Creator label with "XF" shown? | "XF" + " " + name; the migrated eye makeup selector keeps "XF" (empty name) so its row doesn't change |
| Q6 | How is an own row's place stored? | Relative ("after Piercings"), resolved at each Check against the installation and reported; the migrated row keeps 311 until moved |
| Q7 | Is the edited look the worn look? | Yes: selecting a look to edit makes V wear it in that row |
| Q8 | Does a new selector start empty? | With one starter look, activated and worn |
| Q9 | Are selector edits undoable? | Not in look history: removal is recoverable (Reopen removed selector, last five), like presets |
| Q10 | Package split granularity? | One mod by default; split per feature or per selector both offered once there is more than one |
| Q11 | Should the Studio save combinations of worn looks across selectors? | Later, as preview-only sets alongside CC presets; never exported |
| Q12 | Body genders per selector? | What the type supports (female only today); both once the masculine V lands |
| Q13 | Lips: vanilla rows or own selector (platform §6 against §9)? | Vanilla lipstick rows by default, own row allowed, as for cheeks |
| Q14 | Hair colours: one selector covering hair, brows, lashes and beard? | Yes, capped at 1, a slot overlay |
| Q15 | Ship tombstones for removed looks? | No: the game ignores missing references; revisit only if G3 shows a vanilla row misbehaving |

## 9. Proposed AGENTS.md wording

Replace the **One selector** bullet under "Mod pipeline and packaging" with the following. The links are relative to the repository root, where AGENTS.md sits:

```markdown
- **Selectors.** Character customisation is organised around selectors, meaning character-creator rows. A selector is a feature type (eye makeup, piercings, cheeks, …) on a target, either its own XF row or an existing vanilla row it adds choices to, and it holds the complete looks users author for it in the Studio and keep in the local SQLite library. Each exported selector switches between its complete looks in game, with Off; users may add several selectors of a type up to the type's cap (eye makeup: one, until the draw order of two XF eye plates is known). A selector's identity is generated and never depends on its name. Compile only authored looks. Prefer merged material output where faithful; do not assume REDengine multilayered shading supports mixed finishes or transparency. See the [selectors design](research/authoring/selectors-design.md) and the [product direction](projects/xf-studio/data/product-direction.md).
```

The existing **Selectors** product decision should then say which target a type defaults to, rather than whether a feature may have a selector:

> - **Selector targets.** Each feature type defaults to the target that is genuinely best: its own XF row where layering or custom geometry needs one (XF Eye Artistry, because of its face plate; piercings, so they layer with vanilla ones), otherwise extra choices in the matching vanilla row. Users may pick any target the type allows. Every addition is additive: unique keys, never a replaced vanilla or mod entry.

When both are accepted, [product direction](../../projects/xf-studio/data/product-direction.md) step 4 ("One character-creator selector") and the ArchiveXL strategy follow in the same checkpoint.

## Related pages

- [Feature-module platform](feature-module-platform.md): §2 document model and §6 export, which this page extends
- [View graph design](view-graph-design.md): nodes, module activation, parked layouts and derived tools
- [Studio-to-mod pipeline](studio-to-mod-pipeline.md): updated when S3 is built
- [Character-customisation file chain](../../knowledge/cc-file-chain.md): rows, switchers, links, ArchiveXL merges
- [CCXL capabilities](../backlog/ccxl-character-creator-capabilities.md), [piercing feasibility](../jewellery/ccxl-piercing-feasibility.md), [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md), [hair colour study](../hair/hair-colour-authoring-feasibility.md), [tattoos brief](../character-customization/tattoos-brief.md)
- [CC controls and presets](../backlog/cc-controls-and-presets.md): the Character panel
- [Naming](../../projects/xf-studio/data/naming.md) and [product direction](../../projects/xf-studio/data/product-direction.md)
