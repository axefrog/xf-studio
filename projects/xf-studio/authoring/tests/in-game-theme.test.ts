// The in-game theme table (src/studio-ui/style-guide/in-game-theme.ts) is what the XF Runtime Bridge's theme generator reads, so it must
// resolve against studio.css and cover everything the generator writes. The generator is read here, never changed: its MAPPING, METRICS
// and RULE_COLOURS are the "present" state the table's `from` and `added` marks are checked against.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CET_SCALE_RANGE, IMGUI_COLOUR_SLOTS, XF_COLOUR_SLOTS, IN_GAME_COLOURS, IN_GAME_LABELLED_BAR_ALPHA, IN_GAME_METRICS, IN_GAME_MOTION, IN_GAME_RULE_COLOURS, IN_GAME_THEME, IN_GAME_TYPE } from "../src/studio-ui/style-guide/in-game-theme";
import { contrastRows, contrastLayerLabel, resolveColours, resolveMetrics, resolveRuleValues, rootTokens, ruleValue, type Rgba } from "../src/studio-ui/style-guide/in-game-resolve";
import { inGameCss } from "../src/studio-ui/style-guide/in-game";

const css = readFileSync(resolve(import.meta.dir, "..", "public", "studio.css"), "utf8").replace(/\r\n/g, "\n");
const generator = await import(resolve(import.meta.dir, "..", "..", "..", "xf-runtime-bridge", "tools", "overlay", "theme.ts"));
const present = generator.buildTheme(css) as { colors: { name: string; token: string; dark: Rgba; light: Rgba }[]; metrics: { name: string; value: number; from: string }[] };

test("the table has one entry per slot and per metric", () => {
  const dup = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);
  expect(dup([...IN_GAME_COLOURS.map(c => c.slot), ...IN_GAME_RULE_COLOURS.map(c => c.slot)])).toEqual([]);
  expect(dup(IN_GAME_METRICS.map(m => m.name))).toEqual([]);
});

test("every token the table names resolves in studio.css, for both themes", () => {
  const tokens = rootTokens(css);
  const missing = [...IN_GAME_COLOURS.map(c => c.token), ...IN_GAME_METRICS.map(m => m.token), ...IN_GAME_TYPE.map(t => t.token)].filter(t => !tokens.has(t));
  expect(missing).toEqual([]);
  const colours = resolveColours(css);
  expect(colours.length).toBe(IN_GAME_COLOURS.length + IN_GAME_RULE_COLOURS.length);
  for (const c of colours) for (const rgba of [c.light, c.dark]) expect(rgba.every(v => v >= 0 && v <= 1)).toBe(true);
  expect(resolveMetrics(css).every(m => m.px > 0)).toBe(true);
  const values = Object.fromEntries(resolveRuleValues(css).map(v => [v.name, v.value]));
  expect(values.DisabledAlpha).toBe(0.45);
  expect(values.SweepSeconds).toBe(1.1);
});

test("the table covers every colour slot and metric the generator writes", () => {
  const slots = new Set<string>([...IN_GAME_COLOURS.map(c => c.slot), ...IN_GAME_RULE_COLOURS.map(c => c.slot)]);
  expect(present.colors.map(c => c.name).filter(name => !slots.has(name))).toEqual([]);
  const names = new Set(IN_GAME_METRICS.map(m => m.name));
  expect(present.metrics.map(m => m.name).filter(name => !names.has(name))).toEqual([]);
});

test("the table covers exactly ImGui 1.92.9 docking's colours and the required XF semantic slots", () => {
  const slots = [...IN_GAME_COLOURS, ...IN_GAME_RULE_COLOURS].map(c => c.slot).sort();
  expect(slots).toEqual([...IMGUI_COLOUR_SLOTS, ...XF_COLOUR_SLOTS].sort());
});

test("root tokens preserve adjacent overrides and exclude nested and conditional roots", () => {
  const tokens = rootTokens(`
    @import url("other.css");
    :root { --x: first; } :root { --x: second; }
    @media print { .before { color: red; } :root { --x: print; --print: hidden; } }
    @supports (display: grid) { :root { --x: supports; } }
    .outer { :root { --x: nested; } }
    @layer conditional { :root { --x: layered; } }
  `);
  expect(tokens.get("--x")).toEqual(["second", "second"]);
  expect(tokens.has("--print")).toBe(false);
});

test("only the Studio's explicit theme roots override that theme, with CSS specificity and source order", () => {
  expect(rootTokens(`
    :root { --x: light-dark(first-light, first-dark); }
    :root[data-theme="dark"] { --x: dark; }
    :root[data-theme='light'] { --x: light-dark(light, unused); }
    :root { --x: later-base; }
    :root[data-theme="dark"] { --x: later-dark; }
    :root[data-theme="other"] { --x: unrelated; }
    @media print { :root[data-theme="dark"] { --x: print; } }
  `).get("--x")).toEqual(["light", "later-dark"]);
});

test("rule values ignore print-only and nested rules, preserving unconditional override order", () => {
  expect(ruleValue(`
    @media print { .before {} .btn.primary:hover { background: print; } }
    .outer { .btn.primary:hover { background: nested; } }
    .btn.primary:hover:not(:disabled):not([aria-disabled="true"]) { background: first; }
    .btn.primary:hover { content: "}; /* not structure */"; background: second; background: final; }
    @supports (display: grid) { .btn.primary:hover { background: conditional; } }
    .btn.primary:hovered { background: unrelated; }
  `, ".btn.primary:hover", "background")).toBe("final");
});

test("rule-derived colours agree with the bridge generator, even with print rules before them", () => {
  const withPrint = `@media print { .before {} .btn.primary:hover { background: oklch(.1 0 0); } }\n${css}`;
  for (const stylesheet of [css, withPrint]) {
    const written = generator.buildTheme(stylesheet).colors as typeof present.colors;
    const resolved = resolveColours(stylesheet);
    for (const entry of IN_GAME_RULE_COLOURS) {
      const r = resolved.find(c => c.slot === entry.slot)!;
      const g = written.find(c => c.name === entry.slot)!;
      expect(g).toBeDefined();
      expect(r.token).toBe(g.token);
      expect(r.light).toEqual(g.light);
      expect(r.dark).toEqual(g.dark);
    }
  }
});

test("a slot or metric both carry has the same token, or the table says which token it replaces", () => {
  const entries = new Map<string, typeof IN_GAME_COLOURS[number]>(IN_GAME_COLOURS.map(c => [c.slot, c]));
  const differs = present.colors.filter(c => {
    const e = entries.get(c.name);
    return e && e.token !== c.token && e.from !== c.token;
  }).map(c => `${c.name}: generator ${c.token}, table ${entries.get(c.name)!.token}`);
  expect(differs).toEqual([]);
  // Where the tokens agree the resolved colours agree too (the table's resolver is the generator's arithmetic).
  const resolved = new Map(resolveColours(css).map(c => [c.slot, c]));
  const unequal = present.colors.filter(c => {
    const e = entries.get(c.name), r = resolved.get(c.name);
    return e && r && e.token === c.token && (JSON.stringify(r.dark) !== JSON.stringify(c.dark) || JSON.stringify(r.light) !== JSON.stringify(c.light));
  }).map(c => c.name);
  expect(unequal).toEqual([]);
  const metrics = new Map(IN_GAME_METRICS.map(m => [m.name, m]));
  expect(present.metrics.filter(m => metrics.get(m.name)!.token !== m.from).map(m => m.name)).toEqual([]);
  const px = new Map(resolveMetrics(css).map(m => [m.name, m.px]));
  expect(present.metrics.filter(m => px.get(m.name) !== m.value).map(m => m.name)).toEqual([]);
});

test("`from` names a token the generator really maps, and a slot marked added is not yet written", () => {
  const writes = new Map(present.colors.map(c => [c.name, c.token]));
  const stale = IN_GAME_COLOURS.filter(c => c.from && writes.has(c.slot) && writes.get(c.slot) !== c.from && writes.get(c.slot) !== c.token).map(c => c.slot);
  expect(stale).toEqual([]);
  expect(IN_GAME_COLOURS.filter(c => c.from && !c.why).map(c => c.slot)).toEqual([]);
  expect(IN_GAME_COLOURS.filter(c => c.added && !c.why).map(c => c.slot)).toEqual([]);
  expect(IN_GAME_METRICS.filter(m => m.added && !m.why).map(m => m.name)).toEqual([]);
});

test("the text pairs the in-game surfaces draw meet their contrast minimums in both themes", () => {
  const failures = contrastRows(css).flatMap(r => (["light", "dark"] as const).filter(t => r[t] < r.min).map(t => `${r.fg} on ${r.bgs.map(contrastLayerLabel).join("+")} (${t}): ${r[t].toFixed(2)} < ${r.min}`));
  expect(failures).toEqual([]);
});

test("labelled bars check all tones and the track on both surfaces, using the specimen's fill alpha", () => {
  const bars = contrastRows(css).filter(r => r.use.startsWith("Labelled bar"));
  expect(bars).toHaveLength(8);
  for (const card of [false, true]) {
    const base = card ? ["WindowBg", "ChildBg", "XfLine"] : ["WindowBg", "XfLine"];
    expect(bars.some(r => JSON.stringify(r.bgs) === JSON.stringify(base))).toBe(true);
    for (const slot of ["PlotHistogram", "XfWarning", "XfDanger"]) {
      expect(bars.some(r => JSON.stringify(r.bgs) === JSON.stringify([...base, [slot, IN_GAME_LABELLED_BAR_ALPHA]]))).toBe(true);
      expect(inGameCss(css)).toContain(`background: color-mix(in oklab, var(--ig-${slot}) ${IN_GAME_LABELLED_BAR_ALPHA * 100}%, transparent)`);
    }
  }
  expect(ruleValue(inGameCss(css), ".ig-bar.labelled > i", "border-right")).toBeUndefined();
});

test("the type roles and motion constants stay subtle and inside the scale", () => {
  const sizes = new Map([...rootTokens(css)].map(([k, v]) => [k, parseFloat(v[1])]));
  const md = sizes.get("--fs-md")!;
  for (const role of IN_GAME_TYPE) {
    const factor = sizes.get(role.token)! / md;
    expect(factor).toBeGreaterThanOrEqual(CET_SCALE_RANGE[0]);
    expect(factor).toBeLessThanOrEqual(CET_SCALE_RANGE[1]);
  }
  expect(IN_GAME_THEME.motion).toBe(IN_GAME_MOTION);
  expect(IN_GAME_MOTION.pulseDepth).toBeLessThanOrEqual(0.5);
  expect(IN_GAME_MOTION.pulsePeriodMs).toBeGreaterThanOrEqual(2000); // under half a hertz: never a flash
  expect(IN_GAME_MOTION.settleGapMs).toBeGreaterThanOrEqual(1000);
});
