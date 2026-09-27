# XF Studio component library

All of XF Studio's UI is composed from one component library, documented in the [style guide](../../projects/xf-studio/authoring/public/style-guide.html#library) (section 05, "Component library"). Panels and feature views compose components and wire them to actions and snapshots. They don't build controls themselves. A feature that needs a control the library lacks specifies it (behaviour, states, accessibility), and the UI component track builds it here, with its style-guide entry. This is the **Component-first UI** rule in [AGENTS.md](../../AGENTS.md) and the [UI architecture boundary](ui-architecture-boundary.md#component-first-ui).

## Structure

**Where it lives.** Everything is in `projects/xf-studio/authoring/src/studio-ui/`.
- `components/`: the library's own folder, and its one entry point `components/index.ts`. New code imports from there.
- The established primitives predate the folder and stay in place for now: `controls.ts`, `expander.ts`, `help-tip.ts`, `reason-tip.ts`, `item-list.ts` and `menu.ts`. Moving them would break branches that import them. `index.ts` re-exports them.
- `dom.ts` and `icons.ts` are the toolkit underneath.

**Categories.**
- **General:** controls, lists, tabs, menus, tips and status.
- **Layout:** stack, block section, page header, property list, code block and split view.
- **Feature-specific:** components only one feature needs. They still live in the library. There are none yet; the migration plan below fills this category.

**API conventions.** Every component follows these.
- A class (or a factory for stateless ones) exposes `element` and `update(state)`. `update` is idempotent: it changes only what differs, never rebuilds what someone may be reading or focusing, and keeps a value the person is editing.
- Behaviour is typed options and intents:
  - `onSelect`, `onActivate`, `onToggle`, `onChange`;
  - a begin/edit/commit/cancel `Transaction` for continuous values (one Undo step per gesture);
  - an `Outcome` for owner actions whose refusal the component shows in place.
- Components own no validation, persistence or Undo. Availability comes from the application's capability (`applyCapability`, the UI-84 main-action pattern). An unavailable action stays focusable and says why.
- Accessibility is part of the contract: every component follows its WAI pattern and its entry says so.
- No layout shift: note and refusal lines are reserved, popups float, and hidden actions keep their place.

**Catalogue and style guide.**
- `style-guide/library.ts` is the catalogue: per component, its module and exports, what it is, anatomy, variants, states, sizes, when to use it, composition, how it adapts, what drives it, keyboard and access, do and avoid.
- `style-guide/library-demo.ts` mounts a live specimen of each from the production component.
- `bun tools/build-style-guide.ts` regenerates the page.
- `tests/ui-component-library.test.ts` checks three things: every value `components/index.ts` exports is documented, every entry is complete and has a specimen, and the committed guide carries them.

**Components now in the library.**

| Category | Components |
|---|---|
| General | `button` / `applyCapability`, `iconButton`, `Toggle`, `Slider`, `SliderWithValue`, `PairControl`, `Segmented`, `ColorField`, `SelectField`, `Combobox`, `SearchField`, `expander` / `ExpandAll`, `GroupSection`, `helpTip`, reason tip, `openMenu` / `openValuePopover` / `openConfirmPopover`, `ItemList`, `TabStrip`, `PanelHeader`, `TreeView` / `favouriteToggle`, `FolderSetting`, `badge` / `note` / `emptyState` / `EmptyState` / `progressBar` / `section` |
| Layout | `stack`, `blockSection`, `PageHeader`, `propertyList`, `codeBlock`, `SplitView` |
| Feature-specific | none yet |

Components added on request:
- For the expressions panel (`claude/expressions-p1`): SliderWithValue, PairControl, GroupSection (the expander with a count and reset), SearchField and Combobox.
- For the Poses panel (`claude/pose-panel`): TreeView, favouriteToggle, and SearchField's Down into the list.
- For settings discoverability and Game & tools: FolderSetting.
- For the expression drawer's rebuild (`claude/expressions-drawer`, UI-108): `openConfirmPopover` (ask before an action that can't be undone, in place of the browser's `confirm`) and TreeView's `onMenu` (an item's context menu by right-click, Shift+F10 or the Menu key).
- For the Save Explorer: the layout primitives. It is now their reference composition.

## The ratchet

`tests/ui-component-ratchet.test.ts` scans every composition file: `src/studio-ui/**` outside the library and the style guide, and `src/features/*/view/**`. It counts the ad hoc controls each one builds:
- raw interactive elements (`h("button"|"input"|"select"|"textarea"|"dialog"|"details")`, or the same through `createElement`);
- interactive roles (tab, listbox, option, switch, progressbar, slider, combobox, tree, dialog, menu and the rest);
- library classes written by hand (`btn`, `icon-btn`, `link-button`, `chip-button`).

Comments and strings don't count. The test enforces three rules:
- A file may not exceed its allowance, and a file missing from the allowlist is allowed none. A new one-off control fails with a pointer to the library.
- An allowance must equal its file's count. When a control moves into the library, its file's allowance must be lowered in the same change, so the debt only shrinks.
- The scan itself is tested on prose and code.

Debt at introduction (27 September 2026, after the first consolidation round and the merge of `main` that brought the expressions drawer and the Settings links in Help): 88 ad hoc controls in 18 files. The table lists what is left; the expressions drawer was cleared by UI-108 (81 in 17 files).

| File | Count | What is left |
|---|---|---|
| `features/save-explorer/view/panel.ts` | 20 | tree rows (role tree), link buttons, filter inputs, `details` disclosures |
| `studio-ui/diagnostics/report-dialog.ts` | 9 | the sheet shell, raw checkboxes, `details` ×5, textarea |
| `studio-ui/guidance/help-panel.ts` | 12 | search input, link buttons, topic `details`, buttons |
| `studio-ui/panels/game-setup.ts` | 7 | hand-copied select markup ×3, text fields ×3, `details` section |
| `studio-ui/commands.ts` | 6 | the palette (dialog, combobox, listbox, options), the reference sheet |
| `studio-ui/panels/character.ts` | 5 | heading switch, search field, off chip, row buttons |
| `features/eye-makeup/view/inspector.ts` | 4 | finish chooser, choice chips, help `details` |
| `studio-ui/panels/character-choices.ts` | 3 | the creator choice listbox and its options |
| `studio-ui/preview-setup-card.ts` | 3 | consent sheet, link buttons |
| `studio-ui/panels/preview.ts` | 3 | choice chips, `details` section |
| `studio-ui/app.ts` | 2 | the category menu trigger, the status-bar message button |
| `studio-ui/panels/collection.ts` | 2 | the collection title field, result `details` |
| `studio-ui/dock/dock-view.ts`, `guidance/desktop-app-sheet.ts`, `guidance/overlay.ts`, `panels/history.ts`, `panels/mod-install-sheet.ts` | 1 each | a sheet shell or row button each |

## Audit (27 September 2026)

A read-only inventory of every control and pattern in `studio-ui` and the feature views, grouped by kind and ranked by how visible the inconsistency is. "Shared" means it came from the library; "ad hoc" means built in the panel.

1. **Tab strips and panel headers (dock).**
   - One implementation, but the header's action buttons were flex items that shrank (a 24 px icon button measured 16 px). The tab list scrolled instead of condensing, so on a crowded or collapsed header the expander could be squeezed or pushed out of reach.
   - Tabs condensed only to shortened labels, never to icons (the earlier UI-96 decision, which the maintainer has reversed).
   - A panel summoned while its group was collapsed, or with no home, was dropped into an arbitrary group (Help's `opensBeside` pointed at the inspectors).
   - Fixed this round: UI-110, UI-111.
2. **Dialogs and sheets.**
   - Five `.sheet` dialogs each re-implement open, close, focus restore and cancel: mod install, problem report, desktop app, keyboard reference and the consent sheet.
   - Footer order differs: `report-foot` puts the primary first, the consent sheet puts it last. The consent sheet has no close button, and only two close on a backdrop click.
   - Open: a `Sheet` component is next.
3. **Icon buttons: two systems.**
   - `button({ iconOnly })` (bordered, styled for `aria-disabled`) versus hand-built `.icon-btn` (borderless, styled only for native `disabled`).
   - Titles were missing on sheet closes, the toast dismiss and the composite options.
   - Menu triggers lacked `aria-haspopup`.
   - Consolidated this round (`iconButton`, `button({ menu })`).
4. **Hand-built `.btn`.**
   - Toast actions, Character's Details and "Show more", the empty dock's Reset and the tool strip's toggles skipped `button()`'s guard, so an unavailable one still ran.
   - Consolidated this round.
5. **Progress bars.**
   - Three builds, one without `role=progressbar` (the head pane).
   - Consolidated this round (`progressBar`).
6. **Status lines.**
   - About ten classes for the same idea (`cc-status`, `setup-status`, `state-line`, `install-status`, `report-status`, `progress-text` …). `state-line` and `setup-status` look the same with different tone names.
   - Live-region roles are inconsistent.
   - Open: a `StatusLine` component.
7. **Single-choice pickers.**
   - Four patterns: `Segmented`, `chip-button` rows, the finish grid, the creator choice listbox.
   - They differ in arrow-key support, disabled pattern and "on" look (the Character "Off" chip even inverts it).
   - Open: `ChoiceChips` (general) and the finish chooser and creator choice grid as feature-specific components.
8. **Disclosure.**
   - 13 native `details` with the browser's marker, next to the shared expander and two hand-built `aria-expanded` buttons.
   - Open: convert them to `expander` or `GroupSection`.
9. **Search and text fields.**
   - Five hand-built fields. Searches behave differently: Character and Help filter as you type, the Save Explorer filters on change.
   - The collection title is 32 px against 28 px elsewhere.
   - Open: `SearchField` exists now; migrating the three searches changes their timing, so it waits for its own change.
10. **Selectable rows.**
    - `ItemList`, `history-step`, `save-row`, the save tree and palette items differ in roving focus and heights.
    - Open: the save tree moves to `TreeView`; history rows to `ItemList` or a row component.
11. **Selects.** Game & tools hand-copies `SelectField`'s markup twice and has one bare select. Open: `FolderSetting` replaces the folder fields.
12. **Empty states, list heads, badges and chips.**
    - `.chip` duplicates `badge`, and there are seven copies of `list-head`.
    - Partly consolidated: `EmptyState`, used for the Layers panel's newer-version state. The rest is open.
13. **Panel content spacing.**
    - Save Explorer: the title overlapped the back button, the meta line was cramped, the tree touched the inspector, and there was no space under a node's title or above its bytes.
    - Fixed this round through the layout primitives (UI-114).

**Consolidated this round** (user-visible first):
- **Dock:** the tab strip and panel header, the summon rule, header actions that never shrink.
- **Icon buttons:** sheet and toast closes, the guidance close, the composite options and the layer visibility toggle use `iconButton`.
- **Menu triggers:** every "More" and header menu trigger says it opens a menu.
- **Hand-built buttons:** those in toasts, Character, the empty dock and the viewport tool strip now use `button()`.
- **Progress bars:** all three use `progressBar`; the head pane's gained its role.
- **History panel:** Undo and Redo use the main-action pattern like the header's; blocked history rows show their reason in the reason tip.
- **Layers panel:** its newer-version notice is an `EmptyState`.
- **Save Explorer:** recomposed from the layout primitives with unchanged behaviour.

**Plan for the rest, in order:**
1. `Sheet` for the five dialogs, with one footer order (primary last, right-aligned), a close button and Escape and backdrop rules.
2. `StatusLine` (tone, live region, optional action) for the ten status classes.
3. The feature-specific finish chooser and creator choice grid, plus general `ChoiceChips`, retiring `chip-button`.
4. `details` to `expander` / `GroupSection`: Game & tools, Preview, the result details, the report dialog, Help topics and the Save Explorer.
5. Migrate searches to `SearchField` (Character, Help, the Save Explorer filters), agreeing the debounce with each owner.
6. The Save Explorer tree to `TreeView` and its link lists to a link-button component; history rows to `ItemList` or a row component.
7. Game & tools to `FolderSetting`; its selects to `SelectField`.
8. `list-head` to a `ListHeader`, and `.chip` into `badge`.
9. Move the established primitives into `components/` once no parallel branch depends on their paths, leaving re-export shims for one round.

Each step lowers the ratchet's allowances in the same change.

## Evidence

The isolated `?verify=1` checks ran on a server with its own data folder (port 4391, never 4317). Before and after captures, with measurements in `run.json`, are in the ignored `projects/xf-studio/authoring/evidence/screenshots/ui-components/`, and can be reproduced with `bun tools/dock-look.ts` and `bun tools/save-explorer-look.ts`.
- **Dock:** in the default wide layout with the right column's lower group collapsed, Help now opens in a floating window with its search focused; before, it was added as a tab to the lower-right group.
- **Collapse and menu buttons:** they stay inside every group at 1600, 1280 and 1120 px, and on the compact layout's 34 px vertical strip.
- **Tab strips:** they condense to `icons` (and the active tab to an icon at 1120 px) instead of scrolling.
- **Save Explorer:**

  | Gap | Before | After |
  |---|---|---|
  | Back button to title | −8 px | 13 px |
  | Title to meta | 0 px | 13 px |
  | Tree to inspector | 12 px, no gutter (touching in the maintainer's report) | 16 px gutter |
  | Node title to its rows | 0 px | 8 px |
  | Above the hex dump | 0 px | 8 px |

  The hex dump still scrolls horizontally.
