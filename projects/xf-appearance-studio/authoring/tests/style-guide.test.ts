import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { iconNames } from "../src/studio-ui/icons";
import { PANEL_IDS } from "../src/studio-ui/layout-defaults";
import { PANEL_META } from "../src/studio-ui/panel-meta";
import { finishCatalogue } from "../src/finish-catalogue";

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
  // Guidance is concrete: every pattern states what and when.
  const incomplete = guide.split('<article class="pattern').slice(1)
    .filter(article => !article.includes("<dt>What</dt>") || !article.includes("<dt>When</dt>")).map(article => article.slice(0, 80));
  expect(incomplete).toEqual([]);
});

test("the style guide is self-contained", () => {
  expect(/<link[^>]+stylesheet/.test(guide)).toBe(false);
  expect(/<script[^>]+src=/.test(guide)).toBe(false);
  expect(guide.match(/https?:\/\/(?!www\.w3\.org)[^\s"')]+/g) ?? []).toEqual([]);
  // Exactly one closing tag: the inline module's own.
  expect(guide.match(/<\/script/gi)?.length).toBe(1);
});
