import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { iconNames } from "../src/studio-ui/icons";
import { PANEL_IDS, PANEL_META } from "../src/compose/views";
import { contrastTable } from "../src/studio-ui/style-guide/contrast";
import { finishCatalogue } from "./fixtures/eye-region";
import { notDrawnStateMarkup } from "../src/studio-ui/components";

const root = resolve(import.meta.dir, "..");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const guide = lf(readFileSync(resolve(root, "public/style-guide.html"), "utf8"));
const css = lf(readFileSync(resolve(root, "public/studio.css"), "utf8"));
const has = (text: string) => guide.includes(text);

test("c-setup uses the library's resting state and the app's game-folder next step", () => {
  const setup = guide.split('id="c-setup"')[1]!.split("</article>")[0]!;
  expect(setup).toContain(notDrawnStateMarkup({ title: "3D view 2", shows: "Valerie · Smoky" }));
  expect(setup).toContain("The 3D view needs your Cyberpunk 2077 game folder.");
  expect(setup).toContain("You can keep working in the UV map.");
  expect(setup).toContain("Set up 3D view");
  expect(setup).not.toContain("V · Valerie");
});

test("d-summon groups early-access panels with their stages and documents the fixed anchor", () => {
  const summon = guide.split('id="d-summon"')[1]!.split("</article>")[0]!;
  for (const name of ["Save Explorer", "Expressions", "Poses"]) {
    expect(summon).toContain(`<div class="menu-heading"><span>${name}</span></div>`);
    expect(summon).toContain(`<span class="menu-label">${name}<span class="stage-tag menu-tag" data-stage="preview">Early access</span></span>`);
  }
  expect(summon).toContain("stays under its button");
  expect(summon).toContain("scrolls inside");
});

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

test("the guide names the site link and closes a tab opened by the localhost Studio", () => {
  expect(has('<a class="guide-back" href="./"')).toBe(true);
  expect(has("XF Studio site</span></a>")).toBe(true);
  expect(has("Close this guide and return to XF Studio")).toBe(true);
});


test("Review A design 3: entry text never opens a raw-text title or script element", async () => {
  const { LIBRARY } = await import("../src/studio-ui/style-guide/library");
  const unsafe = LIBRARY.flatMap(entry => Object.entries(entry).flatMap(([field, value]) =>
    typeof value === "string" && /<(?:title|script)(?:\s|>)/i.test(value) ? [`${entry.id}.${field}`] : []));
  expect(unsafe).toEqual([]);
  // Cover every generated pattern too; the document's head title and its one script live outside these articles.
  const entries = [...guide.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)];
  expect(entries.length).toBeGreaterThan(60);
  expect(entries.filter(([html]) => /<(?:title|script)(?:\s|>)/i.test(html)).map(([html]) => /id="([^"]+)"/.exec(html)?.[1])).toEqual([]);
});
