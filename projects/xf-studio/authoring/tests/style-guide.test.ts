import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { iconNames } from "../src/studio-ui/icons";
import { PANEL_IDS } from "../src/studio-ui/layout-defaults";
import { PANEL_META } from "../src/studio-ui/panel-meta";
import { finishCatalogue } from "../src/engines/layered-makeup/finish-catalogue";
import { contrastTable } from "../src/studio-ui/style-guide/contrast";

const root = resolve(import.meta.dir, "..");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const guide = lf(readFileSync(resolve(root, "public/style-guide.html"), "utf8"));
const css = lf(readFileSync(resolve(root, "public/studio.css"), "utf8"));
const has = (text: string) => guide.includes(text);

test("the committed style guide embeds the current design system verbatim", () => {
  // Regenerate with: bun tools/build-style-guide.ts
  expect(has(css)).toBe(true);
});

test("the style guide covers every panel, icon and finish, and labels pattern status", () => {
  const missing = [...PANEL_IDS.filter(id => !has(`<code>${id}</code></td><td>${PANEL_META[id].title.replace("&", "&amp;")}</td>`)),
    ...iconNames.filter(name => !has(`<code>${name}</code>`)), ...finishCatalogue().map(f => f.label).filter(label => !has(label))];
  expect(missing).toEqual([]);
  const patterns = [...guide.matchAll(/<article class="pattern[^"]*" id="([^"]+)" data-status="(implemented|future|rule)"/g)];
  expect(patterns.length).toBeGreaterThan(60);
  for (const required of ["d-group", "d-float", "d-composite", "d-feedback", "d-keyboard", "d-persist", "c-context", "c-popover", "c-toasts",
    "c-progress", "c-empty", "c-result", "c-handles", "t-saved", "t-undo", "t-async", "t-errors", "k-editing", "k-library", "k-package", "k-future"])
    expect(patterns.some(match => match[1] === required)).toBe(true);
  expect(patterns.find(match => match[1] === "k-future")![2]).toBe("future");
  // Guidance is concrete: every pattern states what and when; every non-rule pattern also says
  // how it combines, how it adapts to workspace size and which action or state drives it.
  const incomplete = guide.split('<article class="pattern').slice(1).flatMap(article => {
    const id = /id="([^"]+)"/.exec(article)![1], rule = article.includes('data-status="rule"');
    const fields = rule ? ["What", "When"] : ["What", "When", "Combine", "Adapt", "Driven by"];
    const missing = fields.filter(field => !article.includes(`<dt>${field}</dt>`));
    return missing.length ? [`${id}: ${missing.join(", ")}`] : [];
  });
  expect(incomplete).toEqual([]);
});

test("design tokens meet their contrast minimums in both themes", () => {
  const { failures } = contrastTable(css);
  expect(failures.map(([fg, bg]) => `${fg} on ${bg}`)).toEqual([]);
});

test("the style guide is self-contained", () => {
  expect(/<link[^>]+stylesheet/.test(guide)).toBe(false);
  expect(/<script[^>]+src=/.test(guide)).toBe(false);
  expect(guide.match(/https?:\/\/(?!www\.w3\.org)[^\s"')]+/g) ?? []).toEqual([]);
  // Exactly one closing tag: the inline module's own.
  expect(guide.match(/<\/script/gi)?.length).toBe(1);
});
