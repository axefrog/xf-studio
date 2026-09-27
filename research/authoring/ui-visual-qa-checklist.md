# UI visual QA checklist

The gate every UI change passes before it merges (AGENTS.md, "UI/UX review before delivery"). The UI design lead, never the author, applies it to the change's captures and answers **PASS** or a **numbered fix list**. Each fix cites the item it fails (for example "B2: 0 px between the panel edge and the status line; needs 12 px"). Fixes go back to the author or the UI track, and the branch is reviewed again. The [style guide](../../projects/xf-studio/authoring/public/style-guide.html) is the design authority; the item IDs in brackets are its entries. Where this list and the guide disagree, the guide wins and this list is corrected.

**Severity.** A **fix** fails a test below and blocks the merge. A **polish** note is a judgement call on visual quality: it blocks only when several together make the panel look unfinished. The reviewer says which each item is.

**Reference patterns.** Compare against the nearest existing pattern, not against a blank page:
- slider sections: Pigment & edge;
- headings, expanders, fact lists and the fixed status line: Character;
- switches and choice lists: Motion;
- master/detail and page headers: Save Explorer;
- folders and forms: Settings › Game.

## A. The capture set (reject the review if incomplete)

| # | Test |
|---|---|
| A1 | Light **and** dark, at a narrow panel (about 300 px) **and** a wide one (about 480 px or the default layout), from an isolated `?verify=1` workspace. |
| A2 | The changed panel is shown beside its reference pattern at the same width, in the same capture or a matching pair. |
| A3 | Every state the change touches has a capture: empty, loading or updating, filled, a value set away from its default, disabled with its reason, error with its next step, a search with no matches. Also a focused control (keyboard) and a hovered one. |
| A4 | Before and after, for a change to an existing panel. |

## B. Layout and spacing ([f-space], [lib-layout])

| # | Rule | Pass when |
|---|---|---|
| B1 | Panel padding | Content sits 12 px (`--sp-5`) from the panel's left, right and top edges, with 20 px (`--sp-7`) at the bottom. The root is `.panel-content` or a layout `stack` inside it. Nothing touches an edge except full-bleed lists that draw their own border. |
| B2 | Rhythm | Three gaps only. 16 px (`--sp-6`) between sections. 8 px (`--sp-4`) between controls in a section. 4–6 px (`--sp-2`/`--sp-3`) between the parts of one control: label to slider, icon to text, buttons in a toolbar. No other margins between siblings. |
| B3 | One idea per section | Each section has one heading and one job. A run of more than about seven like controls is split into titled subgroups. |
| B4 | No empty bands | No gap taller than 16 px that holds nothing. A reserved note line is allowed only on a control that can actually carry a note or reason. A list of like controls that share one disabled reason says it once, for the list ([c-slider]). |
| B5 | Alignment | Labels share one left edge. Values and trailing actions share one right edge, in a fixed-width column, so they line up down the list. Group bodies indent by exactly the chevron's width plus its gap (16 px). |
| B6 | Buttons keep their size | Buttons size to their label and never stretch to fill a row. A row of buttons is left-aligned, with the primary last. Buttons wrap onto a new row, never shrink or clip ([c-buttons]). |

## C. Values, tags and controls

| # | Rule | Pass when |
|---|---|---|
| C1 | One readout per value | Each value appears exactly once on screen. That is the monospaced readout, right-aligned on its label line ([f-type], [c-slider]). Exact entry edits that readout in place (Slider with value); it is never a second box beside it. |
| C2 | One name per control | A control's label appears once. No group label repeated in each row ("Inner brow raise" above "Inner brow raise, both sides"). Suffixes such as "both sides" live in the accessible name, not the visible label. |
| C3 | Tags and pills | A badge is only for the fixed status vocabulary: Working, Preview only, Can be built, Current, Stale, Blocked ([c-chips]). The library chip and the neutral **Soon** tag are the only other pills. Counts are plain muted mono text ("2 set"), never a tinted badge. A toggle's state is shown by the toggle itself (pressed, switch), never by a pill-shaped button. Nothing repeats under every row. |
| C4 | Control sizing | Controls are 28 px, or 24 px small; list rows 32 px; tree rows 28 px ([f-space]). Small and regular controls aren't mixed in one row. Fields are as wide as their content needs: a number box is 7 ch, and only search and name fields fill the width. |
| C5 | Reset and secondary actions | A per-row reset or trailing action takes its place without showing when it can't act (for example at the default). No column of faded, unavailable icons down a list. |

## D. Choosing the control ("Show the options, don't hide them")

| # | Situation | Use | Fails if |
|---|---|---|---|
| D1 | 2–4 short, parallel options | Segmented [lib-segmented] | A dropdown or a Choice list is used. |
| D2 | 5 or more options, or long labels | Choice list: chips, rows or tiles [lib-choice-list] | A dropdown, or a wrapped Segmented (it reads as a broken listbox). |
| D3 | Dozens to hundreds, grouped, one click applies | Search field and Tree view [lib-tree-view] | A select or combobox used as a command ("Start from: Choose…"). |
| D4 | An ordered collection the person reorders | Ordered list [lib-item-list] | Hand-built rows. |
| D5 | On or off, applies at once | Switch [lib-switch] | A button labelled with its state. |
| D6 | A value judged by eye | Slider (with value when people type exact numbers or it has a default) | A bare number box. |
| D7 | A dropdown | Only with a stated reason: an open-ended list of the person's own names, or no room at all | No reason recorded in the change. |

## E. Hierarchy and type ([f-type], [c-expanders])

| # | Pass when |
|---|---|
| E1 | Every heading level looks different from its parent and its children, following the expander levels: group › section › subsection › row › author group. Two nested headings never share one style. |
| E2 | Only three families. The display face is for short capitals (tabs, eyebrows, badges), UI text for labels and sentences, and mono for any value compared across rows. Labels are 12 px muted; body text is 13 px. |
| E3 | The thing the panel exists for comes first. At 300 × 600 px, the first control of its main task is visible without scrolling. |

## F. States and interaction ([f-focus], [t-disabled], [f-principles])

| # | Pass when |
|---|---|
| F1 | Selected is cyan (`--signal`): an underline, border or fill with an inset edge. Yellow is only for the primary action, keyboard focus and the active tab. |
| F2 | Hover changes the background or colour only, never size or position. |
| F3 | Every interactive element shows a 2 px focus ring, inset inside lists, trees and tab strips so it's never clipped. Tab order follows the visual order. |
| F4 | An unavailable action stays visible and focusable, and says why in words (`applyCapability`). Form fields may use native disabled, but show their reason in text. |
| F5 | **No layout shift.** Hover, focus, selection, loading, a note or refusal appearing, validation, or a mode toggle move nothing else on screen. Measure the next sibling's top before and after: 0 px. Only an explicit disclosure the person opened may push content down. |
| F6 | Every action shows its effect at once (optimistic), and the person's input pre-empts background work. Work longer than a moment says so in place, with a progress bar under the control that started it ([c-progress]). Nothing freezes. |

## G. Copy (style guide "Copy and wording" [f-copy])

| # | Pass when |
|---|---|
| G1 | Length limits hold: titles 1–3 words, labels 1–4, buttons 1–3 (verb first, "…" when a choice follows), a status line one line, a note one sentence. Parentheticals in labels move to the help tip. |
| G2 | No text explains what a visible control obviously does ("Move a control or start from…"). What a thing *is* goes in a help tip; only what the person can do now is inline ([c-help-tips]). |
| G3 | One place per state. The same state is not said by a badge, a note and a status line at once. |
| G4 | No developer words (host, server, adapter, SQLite, budget, phase, provisional, raw rig names outside tooltips), and no raw units such as "% UV" outside research tools. |

## H. UX: flow, discoverability, feedback and errors

| # | Pass when |
|---|---|
| H1 | The panel's main task takes the fewest steps from its default state. One click applies a list item, with no "choose, then press Apply". Defaults work untouched. |
| H2 | Every command is reachable from a visible control, and also from its context menu and the command palette where the guide says so. Context menus and hints are actionable only: no sections that just say nothing is available ([c-context]). |
| H3 | An empty area has a title, one sentence and at most one action, in place of what it stands for ([c-empty]). |
| H4 | Errors and blocks say what happened and the one next step, with its button. No bare error, log path or evidence caveat. |
| H5 | Only an action that Undo can't reverse asks first. It asks in place, names the object, and focus starts on Cancel. |
| H6 | Mode and state are visible where they apply: a group edited as a mirrored pair shows it on the group, not only in a global setting. |

## I. Themes, icons, truncation and access

| # | Pass when |
|---|---|
| I1 | Light and dark have the same layout and hierarchy. Every colour is a token, the guide's contrast table passes, and nothing is carried by colour alone ([f-color], [f-contrast]). |
| I2 | Icons are the project's 16 px line icons ([f-icons]), one meaning each within a panel. Icon-only buttons appear only in tool clusters, headers and row actions, each with an accessible name and a tooltip. |
| I3 | Truncation: one-line names (rows, tabs, tree items, headings) end with an ellipsis and carry the full text as a tooltip. Sentences, notes and reasons wrap and are never cut. Values and readouts never wrap or truncate. Paths wrap anywhere. |
| I4 | At 300 px: no horizontal scroll, no clipped control, no row of buttons wrapping to more than two lines, and no label truncated to fewer than about 12 characters. |
| I5 | The keyboard path is complete: every control is reachable and operable, Escape cancels, and focus returns to the invoker ([r-a11y]). |

## Review reply format

```
PASS — <branch> @ <commit>: <one line on what was checked>
```
or
```
FIX LIST — <branch> @ <commit>
1. [B1, fix] <where>: <what is wrong, measured> → <what it must be>.
2. [C3, polish] …
```
