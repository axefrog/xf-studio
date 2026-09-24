# Site QA: studio positioning revision, 24 September 2026

The product vision was clarified after the first site build. XF Studio is meant to let people customise many parts of Cyberpunk 2077, starting with their own V and expanding into other areas of the game. Eye makeup is its first working authoring feature, not the product's definition or limit. The revision changes positioning and structure only. It adds no release, download, game-test or dated feature claim. The technical project directory is unchanged; its planned move to `projects/xf-studio` is coordinated separately.

## Changes reviewed

- **Page title and description:** “XF Studio — a customisation studio for Cyberpunk 2077”, starting with the user's own V, with eye makeup as its first working feature.
- **Hero:**
  - Heading: “Customise your game, starting with your own V.”
  - The lede presents eye makeup as the first working feature.
  - The release statement now specifies the *eye-makeup* mod files as untested in game.
  - The spec strip has a visible “Eye makeup at a glance” label, and the illustration caption names eye makeup as the first feature.
- **New section 01, “The studio”:** three scope cards.
  - **Now:** Eye makeup, tagged *Works locally*, with a cyan live-state edge.
  - **Later:** More of your V.
  - **Longer term:** Beyond V.
  - Both later cards are dashed and tagged *Discussion first*.
  - A note says the brows, lashes, hair and piercings in the preview are context, not editors.
- **Section labels:** the eye-makeup sections are now “Eye makeup: how it works” and “Eye makeup today”. The top nav's **Capabilities** is now **Eye makeup** and links to `#eye-makeup`. Overview, Status, Directions and Credits are unchanged.
- **Directions section**, retitled “Where the studio could go”:
  - **Next for eye makeup:** unchanged.
  - **More of your V:** the six later areas, in their recorded order.
  - **Wider customisation:** character-creator choices (read-only research exists) and other areas of the game (quest design is one possibility).
  - The earlier vague “Broader appearance” card was replaced. Piercings now note that early design research exists but there is no editor.
- **Footer and docs:** the footer describes an independent customisation studio that starts with eye makeup. The docs grid links the product-direction record instead of the validation workflow, which the status document still links.
- **Guards:**
  - `data-future` marks the vision and directions sections. The new `FUTURE_SCHEDULE` check rejects years, months, quarters and schedule words inside them. The game title “Cyberpunk 2077” is exempt.
  - “Coming soon” joined `UNRELEASED_CLAIMS`.
  - A home page without `data-future` fails.
  - A unit test pins the positioning: the title and hero heading are not defined by eye makeup, and the description names V and eye makeup as the first feature.

Sources checked for wording: `docs/status.md`, the project README, `data/product-direction.md`, `data/naming.md` and `research/backlog/jewellery-and-customization.md`.

## Automated results

| Gate | Result |
|---|---|
| `bun test` | 11 tests, 48 assertions pass. Two tests are new: a positioning test, and a negative test for the no-dates guard and the missing marker. |
| `bun tools/check.ts` | Passes: 3 pages, 7 files, 86.0 KiB; 43 internal links, 15 repository links (all tracked), 29 other external URLs. |
| Base-URL simulation | Passes for `https://axefrog.github.io/xf-studio` and `https://www.example.com`. The 404 asset links followed each base. |
| `bun tools/qa.ts` | 24 scenarios (3 pages × 1440/834/390/320 × light/dark). No console, CSP or network errors, no horizontal overflow and no targets under 24 px. |
| Text contrast | 3,688 text runs, none skipped. Minimum 4.67:1 in light and 6.72:1 in dark, unchanged from the first build. |
| Theme, no-JS, keyboard | System to Light persisted across navigation and set `theme-color` `#fcfdff`. System cleared the override. Without JavaScript the switch is hidden. The skip link is the first focus stop, with a solid ring. |

Chrome was `HeadlessChrome/153.0.0.0` on Windows 11, with Bun 1.4.2. The ignored `.evidence/qa-2026-09-24/` folder now holds this revision's 123 PNGs plus `summary.json`; the first build's captures were replaced.

## Visual review

Desktop and tablet captures were inspected at normal size, in light and dark: the hero, studio, both eye-makeup sections, status, directions, docs and footer. Mobile captures were inspected at 2× device scale, in light and dark: the header, hero, studio and directions. Also inspected: the full light desktop page at reduced size, for section rhythm.

Defects found and fixed before commit:

- **Dashed later-area cards were filled in alt sections.** `.section.alt .step` outranked `.step.target`, so in light theme the later cards looked the same as the current one. The dashed target rule now also covers alt sections, so later areas read as outlines, as in the workflow's “Pick a look” step.
- **Redundant scope labels.** “Later · Your V” sat above “More of your V”, and the third card repeated a Directions heading. The labels are now simply Now / Later / Longer term, and the third heading is “Beyond V”.
- **Hero lede ran to six lines at desktop.** It was trimmed to five by dropping repeated library detail, which the workflow section still covers.
- **The first no-dates run flagged “2077”.** The game title is now exempt through a lookbehind, and the real page passes.

Observed and accepted:

- Section backgrounds alternate from the new studio section onwards. The eye-makeup workflow and capabilities stay visually adjacent.
- The mobile header's nav still scrolls horizontally, and Credits starts off-screen as before. “Eye makeup” is shorter than “Capabilities”.
- At 1440 px, the Wider customisation grid shows two cards in a three-column row.
- At desktop width, the hero lede breaks at the hyphen in “in-game”.

## Limits

Chromium only, as in the first build record: no Safari, Firefox, real-device or screen-reader pass. The workflow was not run, nothing was pushed and Pages was not enabled. The positioning test pins wording deliberately; a future positioning decision should update it together with the copy.
