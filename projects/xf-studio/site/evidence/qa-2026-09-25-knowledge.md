# Site QA: knowledge section, 25 September 2026

## Changes reviewed

- **New Knowledge section** (`knowledge/`, header nav item Knowledge, home page documentation list): an index and one page per Draft-or-better topic, generated from `knowledge/*.md` at build time. Six pages published; three Seed topics listed as not yet published.
- **Each page:** caveat banner, evidence-grade legend, maturity tag, last-commit date, links to the source Markdown, a prefilled issue and an edit, a contents list (sticky beside the article from 64rem, a collapsible box above it on narrower screens), and a corrections-and-credit footer.
- **Content rendering:** tables in keyboard-scrollable regions with a column-count minimum width; ASCII diagrams and code in horizontally scrolling blocks; evidence grades as coloured labels (source cyan, resource neutral, wiki outline, runtime green, hypothesis dashed amber); Mermaid flowcharts as numbered arrow and box lists with the source in a disclosure and a link to GitHub's drawing.
- **Header:** seven nav items. Nav padding, letter spacing and header gaps were tightened slightly so the header stays on one row at desktop width.
- **Shared token:** `--signal-text` (a slightly deeper cyan in light mode) for small labels on a cyan tint, used by the source grade and the existing “in development” tag. It fixes that tag's 4.32:1 light-mode contrast on the home page, a failure that predates this change. Tags may also wrap below 22rem, which fixes a 7 px overflow at 320 px, also on the home page.

## Results

- `bun run verify` passes: build, check and 26 tests (11 new for the knowledge generator, the caveat and date guards and the personal-data guard).
- `bun run qa` passes: 56 page scenarios (index, credits, 404, knowledge index and three knowledge pages at four widths in light and dark). Minimum text contrast is 4.67:1, with no horizontal overflow. Inline links in table cells and list items fall under the inline-text exemption, as links in paragraphs already did.
- Screenshots were checked at desktop, tablet and 390 px in light and dark: knowledge index, the file-chain diagram, the mod-loading and materials tables, the materials ASCII diagram and the hair-shading pass table. Found and fixed during review:
  - the date running into “Last updated”;
  - lost spaces around code in the contents list (flex items);
  - identifiers breaking mid-word in narrow table columns (now `<wbr>` after `\`, `/` and `_`);
  - repeated full labels in the diagram text (now short box names, plus a Boxes list).
- Full-page captures of the longest pages at 390 px exceed the headless capture height and come out blank. Those pages were checked with viewport captures scrolled to the tables, code and diagrams instead.
