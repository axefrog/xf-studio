// The in-game theme table (src/studio-ui/style-guide/in-game-theme.ts) is what the XF Runtime Bridge's theme generator reads, so it must
// resolve against studio.css and cover everything the generator writes. The generator is read here, never changed: its MAPPING, METRICS
// and RULE_COLOURS are the "present" state the table's `from` and `added` marks are checked against.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CET_SCALE_RANGE, IN_GAME_COLOURS, IN_GAME_METRICS, IN_GAME_MOTION, IN_GAME_RULE_COLOURS, IN_GAME_THEME, IN_GAME_TYPE } from "../src/studio-ui/style-guide/in-game-theme";
import { contrastRows, resolveColours, resolveMetrics, resolveRuleValues, rootTokens } from "../src/studio-ui/style-guide/in-game-resolve";

const css = readFileSync(resolve(import.meta.dir, "..", "public", "studio.css"), "utf8").replace(/\r\n/g, "\n");
const generator = await import(resolve(import.meta.dir, "..", "..", "..", "xf-runtime-bridge", "tools", "overlay", "theme.ts"));
const present = generator.buildTheme(css) as { colors: { name: string; token: string; dark: number[]; light: number[] }[]; metrics: { name: string; value: number; from: string }[] };

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
  const slots = new Set([...IN_GAME_COLOURS.map(c => c.slot), ...IN_GAME_RULE_COLOURS.map(c => c.slot)]);
  expect(present.colors.map(c => c.name).filter(name => !slots.has(name))).toEqual([]);
  const names = new Set(IN_GAME_METRICS.map(m => m.name));
  expect(present.metrics.map(m => m.name).filter(name => !names.has(name))).toEqual([]);
});

test("a slot or metric both carry has the same token, or the table says which token it replaces", () => {
  const entries = new Map(IN_GAME_COLOURS.map(c => [c.slot, c]));
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
  const failures = contrastRows(css).flatMap(r => (["light", "dark"] as const).filter(t => r[t] < r.min).map(t => `${r.fg} on ${r.bgs.join("+")} (${t}): ${r[t].toFixed(2)} < ${r.min}`));
  expect(failures).toEqual([]);
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
