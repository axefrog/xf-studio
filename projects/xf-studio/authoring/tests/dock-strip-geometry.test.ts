import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { Box, StripCase, StripProbe } from "./dock-strip-probe-page";

/**
 * The tab strip's laid-out geometry with the real studio.css (tests/dock-strip-probe-page.ts, in headless Chrome): a group folded to a
 * vertical strip, and the same group as a horizontal bar, at heights from roomy to cramped. Every tab's box holds its icon, label and
 * close mark with padding on every side; no two tabs overlap; the icons sit centred across the strip; the strip keeps one width
 * whichever tab is active; a strip too short for its labels drops to icon-only tabs that keep their names as tooltips rather than
 * clipping text; and the focus ring is drawn inside the tab, so the strip's clipping can't cut it. Needs a local Chrome; public CI has
 * none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "dock-strip-probe-page.ts");
/** The least room between a tab's edge and anything inside it (px): the smallest spacing token in use along the strip. */
const MIN_PAD = 4;
const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");
const token = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(css)![1]);

const overlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
/** Room on each side of `inner` inside `outer`: start and end along the strip, and either side across it. */
function insets(outer: Box, inner: Box, vertical: boolean) {
  const l = inner.left - outer.left, r = outer.right - inner.right, t = inner.top - outer.top, b = outer.bottom - inner.bottom;
  return vertical ? { start: t, end: b, sideA: l, sideB: r } : { start: l, end: r, sideA: t, sideB: b };
}

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("dock tab strip geometry", () => {
  let probe: StripProbe;
  beforeAll(async () => { probe = await runProbePage<StripProbe>(PAGE, "", 60_000, { STUDIO_CSS: JSON.stringify(css) }); }, 120_000);
  const strips = () => probe.cases.filter(c => c.name.startsWith("strip-"));
  const all = () => probe.cases;
  const vertical = (c: StripCase) => c.fold === "row";

  test("the page rendered every case", () => {
    expect(probe.failure ?? "").toBe("");
    expect(probe.ok).toBe(true);
    expect(strips().every(c => c.fold === "row")).toBe(true);
    expect(probe.cases.filter(c => c.name.startsWith("bar-")).every(c => c.fold === null)).toBe(true);
  });

  test("no two tabs overlap, and every tab stays inside its tab strip, clear of the header's actions", () => {
    const problems = all().flatMap(c => [
      ...c.tabs.flatMap((a, i) => c.tabs.slice(i + 1).filter(b => overlap(a.box, b.box)).map(b => `${c.name}: ${a.panel} overlaps ${b.panel}`)),
      ...c.tabs.filter(t => overlap(t.box, c.actions)).map(t => `${c.name}: ${t.panel} runs into the actions`),
      ...c.tabs.filter(t => t.box.left < c.strip.left - .5 || t.box.right > c.strip.right + .5 || t.box.top < c.strip.top - .5 || t.box.bottom > c.strip.bottom + .5)
        .map(t => `${c.name}: ${t.panel} leaves its strip`)]);
    expect(problems).toEqual([]);
  });

  test("each tab holds its icon, label and close mark with padding on every side", () => {
    const problems = all().flatMap(c => c.tabs.flatMap(t => (["icon", "label", "close"] as const).flatMap(part => {
      const inner = t[part];
      if (!inner) return [];
      const room = insets(t.box, inner, vertical(c)), least = Math.min(room.start, room.end, room.sideA, room.sideB);
      return least < MIN_PAD - .01 ? [`${c.name}: ${t.panel} ${part} has ${least.toFixed(1)} px to its tab's edge`] : [];
    })));
    expect(problems).toEqual([]);
  });

  test("icons are centred across the strip, and the parts of a tab don't touch", () => {
    const problems = all().flatMap(c => c.tabs.flatMap(t => {
      const out: string[] = [];
      if (!t.icon) out.push(`${c.name}: ${t.panel} has no icon`);
      else { const room = insets(t.box, t.icon, vertical(c)); if (Math.abs(room.sideA - room.sideB) > 1) out.push(`${c.name}: ${t.panel} icon is off centre (${room.sideA.toFixed(1)} / ${room.sideB.toFixed(1)})`); }
      const parts = [t.icon, t.label, t.close].filter((part): part is Box => !!part);
      for (let i = 1; i < parts.length; i++) {
        const gap = vertical(c) ? parts[i]!.top - parts[i - 1]!.bottom : parts[i]!.left - parts[i - 1]!.right;
        if (gap < MIN_PAD - .01) out.push(`${c.name}: ${t.panel} parts ${i - 1} and ${i} are ${gap.toFixed(1)} px apart`);
      }
      return out;
    }));
    expect(problems).toEqual([]);
  });

  test("the vertical strip is wider than a bar is tall and keeps one width whichever tab is active", () => {
    const widths = new Set(strips().map(c => Math.round(c.bar.width * 10) / 10));
    expect(widths.size).toBe(1);
    expect([...widths][0]!).toBeGreaterThanOrEqual(token("tab-h") + token("sp-2"));
    // Every tab fills the strip's width, so hover and selection backgrounds line up.
    expect(strips().flatMap(c => c.tabs.filter(t => Math.abs(t.box.width - c.strip.width) > .5).map(t => `${c.name}: ${t.panel}`))).toEqual([]);
  });

  test("the close mark is its own target of at least 18 px, on the active tab only", () => {
    const problems = all().flatMap(c => c.tabs.flatMap(t => {
      if (!t.selected) return t.close ? [`${c.name}: inactive ${t.panel} shows a close mark`] : [];
      if (!t.close) return c.activeIcon ? [] : [`${c.name}: active ${t.panel} has no close mark`];
      return t.close.width < 18 || t.close.height < 18 ? [`${c.name}: close mark is ${t.close.width}×${t.close.height}`] : [];
    }));
    expect(problems).toEqual([]);
  });

  test("a short strip drops to icon-only tabs named by their tooltips, never clipping a label mid-glyph", () => {
    // Roomy: full labels. Short: every inactive tab an icon. Shortest: some tabs move into the overflow menu, the active one stays.
    const at = (name: string) => probe.cases.find(c => c.name === name)!;
    expect(at("strip-first-900").stage).toBe("full");
    expect(["icons", "overflow"]).toContain(at("strip-middle-300").stage);
    expect(at("strip-middle-200").tabs.some(t => t.selected)).toBe(true);
    const problems = all().flatMap(c => c.tabs.flatMap(t => {
      const out: string[] = [];
      if (!t.title) out.push(`${c.name}: ${t.panel} has no tooltip`);
      // Only the truncated stage cuts labels, and then with an ellipsis; everywhere else a shown label is whole.
      if (t.labelClipped && c.stage !== "truncated") out.push(`${c.name}: ${t.panel} label is clipped at stage ${c.stage}`);
      if (!t.label && c.stage === "full") out.push(`${c.name}: ${t.panel} lost its label at the full stage`);
      return out;
    }));
    expect(problems).toEqual([]);
  });

  test("the focus ring is drawn inside the tab, so the strip's clipping can't cut it", () => {
    expect(new Set(all().map(c => c.focusOutlineOffset))).toEqual(new Set(["-2px"]));
    // The ring (2 px, :focus-visible) fits inside every tab, icon-only ones included.
    expect(all().flatMap(c => c.tabs.filter(t => Math.min(t.box.width, t.box.height) < 2 * 2 + 14).map(t => `${c.name}: ${t.panel}`))).toEqual([]);
  });
});
