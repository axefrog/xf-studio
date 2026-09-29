// Component-first UI (AGENTS.md; research/authoring/ui-component-library.md): panels and feature views compose the component library
// (src/studio-ui/components and the established primitives it re-exports) and build no controls of their own. This ratchet counts the
// ad hoc controls still built outside the library, per file. A file may not gain any (a new one is a review finding: ask the UI
// component track for the component), and when a file's count drops its allowance must drop with it, so the debt only shrinks.
import { expect, test } from "bun:test";
import { join, relative, resolve } from "node:path";
import { codeOnly, withoutComments } from "./fixtures/code-scan";
import { sourceFiles, sourceText } from "./fixtures/source-files";

const root = resolve(import.meta.dir, "..", "src");
const rel = (file: string) => relative(root, file).replaceAll("\\", "/");
/** The library: components/ and the established primitives it re-exports, plus the style guide that documents them. */
const LIBRARY = [/^studio-ui\/components\//, /^studio-ui\/(controls|expander|help-tip|reason-tip|item-list|menu|dom|icons)\.ts$/, /^studio-ui\/style-guide\//];

/**
 * What counts as building a control: an interactive element (in any quotes, through an `h` alias, a tag held in a variable, any
 * document's `createElement`, or markup in a string), an interactive role (as a key, a quoted key or an attribute; a separator only
 * when it is focusable, i.e. a splitter), or a library class written by hand (anywhere in a class list, but never a longer class such
 * as `btn-row`). UI-121 closed the gaps the first version of the scan had.
 */
const TAGS = "button|input|select|textarea|dialog|details";
const ROLES = "button|tab|tablist|tabpanel|listbox|option|switch|progressbar|slider|combobox|tree|treeitem|treegrid|grid|radiogroup|radio|dialog|"
  + "alertdialog|menu|menubar|menuitem|menuitemcheckbox|menuitemradio|spinbutton|checkbox|searchbox|textbox|scrollbar";
const CLASSES = "btn|icon-btn|link-button|chip-button";
/** Any quote a literal can open with. */
const Q = String.raw`["'${"`"}]`;
/** A class list naming a library class: bounded by the list's start or a space, and by the list's end or a space. */
const CLASS_LIST = String.raw`${Q}(?:[^"'${"`"}\n]*?\s)?(?:${CLASSES})(?=[\s"'${"`"}$])`;
/** Where a property key starts: not part of a longer name, nor a member access. */
const KEY = String.raw`(?<![\w$.])`;
const adHocPatterns = (elementCalls: readonly string[]) => [
  new RegExp(String.raw`${KEY}(?:${elementCalls.join("|")})\(\s*${Q}(?:${TAGS})${Q}`, "g"),
  new RegExp(String.raw`\.createElement\(\s*${Q}(?:${TAGS})${Q}`, "g"),
  new RegExp(String.raw`(?:${KEY}role|${Q}role${Q})\s*:\s*${Q}(?:${ROLES})${Q}`, "g"),
  new RegExp(String.raw`\b(?:setAttribute|setAttr)\(\s*(?:[\w$.]+\s*,\s*)?${Q}role${Q}\s*,\s*${Q}(?:${ROLES})${Q}`, "g"),
  new RegExp(String.raw`(?:${KEY}(?:class|className)|${Q}class${Q})\s*:\s*${CLASS_LIST}`, "g"),
  new RegExp(String.raw`\.className\s*=\s*${CLASS_LIST}`, "g"),
  new RegExp(String.raw`\.classList\.(?:add|toggle)\(\s*(?:${Q}[^"'${"`"}]*${Q}\s*,\s*)*${Q}(?:${CLASSES})${Q}`, "g"),
];
/** A separator role; it counts only in an object literal that also sets a tab index (a focusable splitter, not a divider). */
const SEPARATOR = new RegExp(String.raw`(?:${KEY}role|${Q}role${Q})\s*:\s*${Q}separator${Q}`, "g");
/** Markup in a string or template (`innerHTML` and the like): a control element, or an interactive role attribute. */
const MARKUP = new RegExp(String.raw`<(?:${TAGS})[\s>/]|\brole\s*=\s*\\?["'](?:${ROLES})\\?["']`, "g");

/**
 * The debt at the time the ratchet was introduced (27 September 2026, after the first consolidation round), by file. Lower a number
 * when you move a control into the library; never raise one. The plan for each is in research/authoring/ui-component-library.md.
 */
const ALLOWANCE: Readonly<Record<string, number>> = {
  "features/eye-makeup/view/inspector.ts": 4,
  "features/save-explorer/view/panel.ts": 20,
  "studio-ui/app.ts": 2,
  "studio-ui/commands.ts": 6,
  "studio-ui/diagnostics/report-dialog.ts": 7,
  "studio-ui/dock/dock-view.ts": 1,
  "studio-ui/guidance/desktop-app-sheet.ts": 1,
  "studio-ui/guidance/help-panel.ts": 11,
  "studio-ui/guidance/overlay.ts": 1,
  "studio-ui/panels/character-choices.ts": 1,
  "studio-ui/panels/character.ts": 4,
  "studio-ui/panels/collection.ts": 2,
  "studio-ui/panels/game-setup.ts": 3,
  "studio-ui/panels/history.ts": 1,
  "studio-ui/panels/mod-install-sheet.ts": 1,
  "studio-ui/panels/preview.ts": 1,
  "studio-ui/preview-setup-card.ts": 3,
};

/** Every ad hoc control a composition file builds (in its code, so prose and messages never count; markup only inside literals). */
function adHoc(text: string): string[] {
  const code = codeOnly(text), literals = withoutComments(text), found: string[] = [];
  const inCode = (at: number) => code[at] === text[at];
  const tidy = (match: string) => match.replace(/\s+/g, " ");
  // `import { h as el }` makes `el(...)` an element call too.
  const elementCalls = ["h", ...[...code.matchAll(/\bimport\s*(?:type\s*)?\{[^}]*\}/g)]
    .flatMap(match => [...match[0].matchAll(/\bh\s+as\s+([\w$]+)/g)].map(alias => alias[1]!))];
  for (const pattern of adHocPatterns(elementCalls)) for (const match of text.matchAll(pattern)) if (inCode(match.index!)) found.push(tidy(match[0]));
  // A tag held in a variable: `h(tag, …)` where the file assigns `tag` a control's tag.
  const calls = new RegExp(String.raw`${KEY}(?:${elementCalls.join("|")})\(\s*([A-Za-z_$][\w$]*)\s*[,)]`, "g"), tag = new RegExp(String.raw`${Q}(?:${TAGS})${Q}`);
  for (const match of code.matchAll(calls)) {
    const name = match[1]!.replace(/\$/g, "\\$"), assignments = new RegExp(String.raw`${KEY}${name}\s*(?::[^=\n]+)?=(?![=>])([^;\n]*)`, "g");
    if ([...text.matchAll(assignments)].some(assigned => inCode(assigned.index!) && tag.test(assigned[1]!))) found.push(`h(${match[1]}`);
  }
  for (const match of text.matchAll(SEPARATOR)) {
    const at = match.index!;
    if (!inCode(at)) continue;
    const open = code.lastIndexOf("{", at), close = code.indexOf("}", at);
    if (/\btab[iI]ndex\b/.test(code.slice(open, close < 0 ? undefined : close))) found.push(`${tidy(match[0])} (focusable)`);
  }
  // Markup sits inside a literal: blanked in the code, kept once only comments are blanked.
  for (const match of literals.matchAll(MARKUP)) if (!inCode(match.index!) && literals[match.index!] === text[match.index!]) found.push(`markup ${match[0].trim()}`);
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

test("the scan sees every way of writing a control (UI-121), and nothing that only looks like one", () => {
  const sees: Record<string, string> = {
    singleQuoted: `const a = h('button', {});`,
    template: "const a = h(`input`, {});",
    variableTag: `const tag = "button"; const a = h(tag, {});`,
    aliasedH: `import { h as el } from "../dom"; const a = el("select", {});`,
    quotedRoleKey: `const a = h("div", { "role": "listbox" });`,
    setAttributeRole: `const a = h("div"); a.setAttribute("role", "tab");`,
    setAttrRole: `const a = h("div"); setAttr(a, "role", "switch");`,
    roleButton: `const a = h("div", { role: "button", tabindex: "0" });`,
    focusableSeparator: `const a = h("div", { class: "splitter", role: "separator", tabindex: "0" });`,
    roleSearchbox: `const a = h("div", { role: "searchbox", contenteditable: "true" });`,
    roleGrid: `const a = h("div", { role: "grid" });`,
    laterClass: `const a = h("span", { class: "small btn" });`,
    classListAdd: `const a = h("span"); a.classList.add("icon-btn");`,
    className: `const a = h("span"); a.className = "quiet btn";`,
    ownerDocument: `const a = el.ownerDocument.createElement("button");`,
    innerHTML: "host.innerHTML = `<button class=\"x\">Go</button>`;",
    markupRole: `host.innerHTML = '<div role="tab">A</div>';`,
    afterRegex: "if (x) { y(); }\n/`/.test(s);\nconst a = h(\"button\");\nconst b = `x`;",
  };
  expect(Object.entries(sees).filter(([, text]) => adHoc(text).length !== 1).map(([name, text]) => `${name}: ${JSON.stringify(adHoc(text))}`)).toEqual([]);
  const ignores: Record<string, string> = {
    longerClass: `const a = h("div", { class: "btn-row" });`,
    longerClassLater: `const a = h("div", { class: "row btn-group" });`,
    classListLonger: `a.classList.add("btn-row");`,
    divider: `const a = h("div", { role: "separator" });`,
    typeAttribute: `const a = button({ label: "Go", type: "button" });`,
    variableNotATag: `const tag = level > 1 ? "h4" : "h3"; const a = h(tag, {});`,
    markupInComment: "// host.innerHTML = '<button>';\nconst a = 1;",
    prose: `const message = "Press the button to choose a role: tab";`,
    arrowParameter: `const make = (tag: string) => h(tag, {}); const tagName = "button";`,
  };
  expect(Object.entries(ignores).filter(([, text]) => adHoc(text).length).map(([name, text]) => `${name}: ${JSON.stringify(adHoc(text))}`)).toEqual([]);
});

/**
 * A library button edited by hand (UI-173): its label `span` looked up to relabel it, or its variant classes toggled. The button's own
 * `setButtonLabel` and `setButtonVariant` do both in place; no composition file may reach inside a button again (no allowance).
 */
const BUTTON_INTERNALS = [
  new RegExp(String.raw`\.querySelector(?:All)?(?:<[^>]*>)?\(\s*${Q}[^"'${"`"}]*\bspan\b[^"'${"`"}]*${Q}`, "g"),
  new RegExp(String.raw`\.classList\.(?:add|remove|toggle|replace)\(\s*(?:${Q}[^"'${"`"}]*${Q}\s*,\s*)*${Q}(?:primary|quiet|danger|ghost)${Q}`, "g"),
];
function buttonInternals(text: string): string[] {
  const code = codeOnly(text);
  return BUTTON_INTERNALS.flatMap(pattern => [...text.matchAll(pattern)].filter(match => code[match.index!] === text[match.index!]).map(match => match[0]));
}

test("no panel or feature view relabels a button through its span or re-weights it by class: setButtonLabel and setButtonVariant do (UI-173)", () => {
  const edits = composition().flatMap(({ file, text }) => buttonInternals(text).map(found => `${file}: ${found}`));
  expect(edits).toEqual([]);
});

test("the button-internals scan sees span edits and variant toggles, and ignores prose and other classes", () => {
  expect(buttonInternals(`setText(add.querySelector("span")!, "Add");`)).toEqual([`.querySelector("span"`]);
  expect(buttonInternals(`const label = go.querySelector<HTMLElement>(':scope > span');`)).toEqual([`.querySelector<HTMLElement>(':scope > span'`]);
  expect(buttonInternals(`releases.classList.toggle("primary", newer);`)).toEqual([`.classList.toggle("primary"`]);
  expect(buttonInternals(`b.classList.remove("small", "quiet");`)).toEqual([`.classList.remove("small", "quiet"`]);
  expect(buttonInternals(`// a.querySelector("span")\nrow.classList.toggle("selected", on); const note = "classList.add(\\"quiet\\")";`)).toEqual([]);
});
