// Component-first UI (AGENTS.md; research/authoring/ui-component-library.md): panels and feature views compose the component library
// (src/studio-ui/components and the established primitives it re-exports) and build no controls of their own. This ratchet counts the
// ad hoc controls still built outside the library, per file. A file may not gain any (a new one is a review finding: ask the UI
// component track for the component), and when a file's count drops its allowance must drop with it, so the debt only shrinks.
import { expect, test } from "bun:test";
import { join, relative, resolve } from "node:path";
import { codeOnly } from "./fixtures/code-scan";
import { sourceFiles, sourceText } from "./fixtures/source-files";

const root = resolve(import.meta.dir, "..", "src");
const rel = (file: string) => relative(root, file).replaceAll("\\", "/");
/** The library: components/ and the established primitives it re-exports, plus the style guide that documents them. */
const LIBRARY = [/^studio-ui\/components\//, /^studio-ui\/(controls|expander|help-tip|reason-tip|item-list|menu|dom|icons)\.ts$/, /^studio-ui\/style-guide\//];
/** What counts as building a control: an interactive element, an interactive role, or a library class written by hand. */
const AD_HOC = [
  /\bh\(\s*"(button|input|select|textarea|dialog|details)"/g,
  /\bdocument\.createElement\(\s*"(button|input|select|textarea|dialog|details)"/g,
  /\brole:\s*"(tab|tablist|tabpanel|listbox|option|switch|progressbar|slider|combobox|tree|treeitem|radiogroup|radio|dialog|menu|menuitem|spinbutton|checkbox)"/g,
  /\bclass:\s*["`](btn|icon-btn|link-button|chip-button)\b/g,
];

/**
 * The debt at the time the ratchet was introduced (27 September 2026, after the first consolidation round), by file. Lower a number
 * when you move a control into the library; never raise one. The plan for each is in research/authoring/ui-component-library.md.
 */
const ALLOWANCE: Readonly<Record<string, number>> = {
  "features/eye-makeup/view/inspector.ts": 4,
  // The expressions drawer landed in main just before the ratchet (its branch is moving to the library's SearchField, Combobox and rows).
  "features/expressions/view/drawer.ts": 7,
  "features/save-explorer/view/panel.ts": 20,
  "studio-ui/app.ts": 2,
  "studio-ui/commands.ts": 6,
  "studio-ui/diagnostics/report-dialog.ts": 9,
  "studio-ui/dock/dock-view.ts": 1,
  "studio-ui/guidance/desktop-app-sheet.ts": 1,
  "studio-ui/guidance/help-panel.ts": 12,
  "studio-ui/guidance/overlay.ts": 1,
  "studio-ui/panels/character-choices.ts": 1,
  "studio-ui/panels/character.ts": 4,
  "studio-ui/panels/collection.ts": 2,
  "studio-ui/panels/game-setup.ts": 4,
  "studio-ui/panels/history.ts": 1,
  "studio-ui/panels/mod-install-sheet.ts": 1,
  "studio-ui/panels/preview.ts": 3,
  "studio-ui/preview-setup-card.ts": 3,
};

/** Every ad hoc control a composition file builds (outside comments and strings, so prose never counts). */
function adHoc(text: string): string[] {
  const code = codeOnly(text), found: string[] = [];
  for (const pattern of AD_HOC) for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    if (code[at] === text[at]) found.push(match[0].replace(/\s+/g, " "));
  }
  return found;
}
const composition = () => [...sourceFiles(join(root, "studio-ui")), ...sourceFiles(join(root, "features"))]
  .map(file => ({ file: rel(file), text: sourceText(file) }))
  .filter(({ file }) => (file.startsWith("studio-ui/") || /^features\/[^/]+\/view\//.test(file)) && !LIBRARY.some(pattern => pattern.test(file)));

test("panels and feature views build no new ad hoc controls: they compose the component library", () => {
  const grown = composition().flatMap(({ file, text }) => {
    const found = adHoc(text), allowed = ALLOWANCE[file] ?? 0;
    return found.length > allowed ? [`${file}: ${found.length} ad hoc controls (allowed ${allowed}): ${found.join(", ")}. Compose a library component `
      + "(src/studio-ui/components) or ask the UI component track for one."] : [];
  });
  expect(grown).toEqual([]);
});

test("the ratchet only tightens: every allowance matches its file's count", () => {
  const counts = new Map(composition().map(({ file, text }) => [file, adHoc(text).length]));
  const stale = Object.entries(ALLOWANCE).flatMap(([file, allowed]) => (counts.get(file) ?? 0) < allowed
    ? [`${file}: ${counts.get(file) ?? 0} ad hoc controls left; lower its allowance from ${allowed}`] : []);
  expect(stale).toEqual([]);
});

test("the scan sees controls in code and ignores prose", () => {
  expect(adHoc(`const a = h("button", { class: "btn" }); // h("input") in a comment\nconst b = "h(\\"select\\")"; const c = h("div", { role: "listbox" });`))
    .toEqual(["h(\"button\"", "role: \"listbox\"", "class: \"btn"]);
});
