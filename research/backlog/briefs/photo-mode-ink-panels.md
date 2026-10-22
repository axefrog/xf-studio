# Research brief: ink UI inside photo mode's menus

Requested by XF · Runtime bridge on 22 October 2026, through the [research queue](../research-queue.md). It serves the bridge's surface rule: XF's photo-mode controls (lights, framing, presets) and the ink panel live natively inside photo mode's ink menus, with the overlay panel as a fallback only. Not urgent; needed before XF Core C1.

## Sources and method

Study the mods in this order. All are in `research/consumers/mod-study/extracted/` (ignored; index `INDEX.tsv`), read-only and never run:

1. `34353-photomodeuiimprovements-1-3-3`: its side panels and its own layout format.
2. `35236-ascral-hud-editor-and-painter`.
3. `34310-charactercreatoruiimprovements-1-1-0`: the same technique in another menu.
4. `35013-advancedposemod` and `35483-mime`: input and focus inside photo mode.

Photo Mode Ex and Photo Mode Preferences only where [photo mode §11](../../../knowledge/photo-mode.md) doesn't already cover them.

Much of this material is probably vibe coded, so treat its code quality as suspect. Extract the knowledge: which classes and hooks they use, input handling, layout, and coexistence with other photo-mode mods. Never adopt their implementations. Grade source-only claims as such, and credit the mods.

## Questions

1. Where can a custom panel or page attach to photo mode's menu? Which controllers or widgets are involved, when they're created, and when they're torn down.
2. How does a panel get pointer and pad input and focus without breaking photo mode's own navigation, camera control or the screenshot key?
3. How does layout scale at 16:9, 21:9 (3840×1600, the maintainer's display) and 32:9? Compare with our HUD finding: the 2160 canvas is pinned top-left and shows its top 1600 units at 21:9.
4. How do several mods that add UI coexist: ordering, collisions, unhooking?
5. What breaks on load, on photo-mode exit and with the kill switch? Our scripts must never touch game systems outside the live guard.

## Out of scope

- The menu-row technique already covered in [photo mode §11](../../../knowledge/photo-mode.md) and [ink UI §3](../../../knowledge/ink-ui.md).
- Styling and aesthetics, which the UI track owns.

## Deliverables

- A new section in [ink UI](../../../knowledge/ink-ui.md), or [photo mode](../../../knowledge/photo-mode.md) §15, whichever fits. Claims are graded source-observed, community-claimed or runtime-proven, and pitfalls are flagged wherever a mod does something fragile.
- A recommended attach route for an XF photo-mode panel, in two or three paragraphs, naming the exact classes or hooks.
- Credits in [community credits](../../../docs/community-credits.md).
- A runtime-question list as session-card rows in the card's format, `| # | Who | Do | Expect | If not |`:
  - Who is C (Claude) or M (the maintainer);
  - Do names the MCP tools to use;
  - one observable outcome per row;
  - every instruction to the maintainer is given in the game;
  - a screenshot is asked for wherever layout matters.

## Done when

Each question is answered or explicitly marked as needing the game, and the recommended route names the exact classes or hooks to use.
