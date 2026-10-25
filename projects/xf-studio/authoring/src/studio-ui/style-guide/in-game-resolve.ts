/**
 * Resolves the in-game theme table (in-game-theme.ts) against public/studio.css: every token's light and dark colour as sRGB, every
 * metric in pixels, every rule-derived value. The style guide prints the result and tests/in-game-theme.test.ts checks it, so a token
 * the table names that the stylesheet lacks fails here and not in game.
 */
import { IN_GAME_THEME } from "./in-game-theme";

export type Theme = "light" | "dark";
export type Rgba = [number, number, number, number];

/** The declarations of every plain `:root { ... }` block, later blocks overriding earlier ones: token -> [light, dark] source text. */
export function rootTokens(css: string): Map<string, [string, string]> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, [string, string]>();
  for (const block of text.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const part of splitTop(block[1]!, ";")) {
      const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
      if (!m) continue;
      const ld = /^light-dark\(([\s\S]+)\)$/.exec(m[2]!);
      const pair = ld ? splitTop(ld[1]!, ",").map(s => s.trim()) : [];
      out.set(m[1]!, pair.length === 2 ? [pair[0]!, pair[1]!] : [m[2]!, m[2]!]);
    }
  }
  return out;
}

function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const c of text) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === separator && depth === 0) { out.push(current); current = ""; } else current += c;
  }
  if (current.trim()) out.push(current);
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** oklch(L C H [/ A]) to gamma-encoded sRGB (clipped per channel, as the generator does) and alpha. */
export function oklch(value: string): Rgba {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (!m) throw new Error(`not an oklch colour: ${value}`);
  const num = (s: string) => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s));
  const L = num(m[1]!), C = parseFloat(m[2]!), H = parseFloat(m[3]!) * Math.PI / 180, alpha = m[4] !== undefined ? num(m[4]) : 1;
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return [round(clamp01(encode(clamp01(r)))), round(clamp01(encode(clamp01(g)))), round(clamp01(encode(clamp01(bl)))), round(clamp01(alpha))];
}

export type ResolvedColour = { slot: string; token: string; alpha?: number; light: Rgba; dark: Rgba };

/** Every colour slot (token slots, then rule-derived ones) in both themes. Throws, naming the token, where studio.css lacks one. */
export function resolveColours(css: string): ResolvedColour[] {
  const tokens = rootTokens(css);
  const out: ResolvedColour[] = [];
  for (const entry of IN_GAME_THEME.colours) {
    const t = tokens.get(entry.token);
    if (!t) throw new Error(`studio.css has no token ${entry.token} (slot ${entry.slot})`);
    const scale = (c: Rgba): Rgba => [c[0], c[1], c[2], Math.round(c[3] * (entry.alpha ?? 1) * 10000) / 10000];
    out.push({ slot: entry.slot, token: entry.token, alpha: entry.alpha, light: scale(oklch(t[0])), dark: scale(oklch(t[1])) });
  }
  for (const entry of IN_GAME_THEME.ruleColours) {
    const value = ruleValue(css, entry.rule, entry.property);
    if (value === undefined) throw new Error(`studio.css has no ${entry.property} on ${entry.rule} (slot ${entry.slot})`);
    const ld = /^light-dark\(([\s\S]+)\)$/.exec(value);
    const pair = ld ? splitTop(ld[1]!, ",").map(s => s.trim()) : [value, value];
    out.push({ slot: entry.slot, token: `${entry.rule} ${entry.property}`, light: oklch(pair[0]!), dark: oklch(pair[1]!) });
  }
  return out;
}

/** A declaration's value on the first plain (not nested in an at-rule) rule that lists the selector. */
export function ruleValue(css: string, selector: string, property: string): string | undefined {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of text.matchAll(/(?:^|[};])\s*([^{};@][^{};]*)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").some(part => part.trim().startsWith(selector))) continue;
    const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule[2]!);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

export type ResolvedMetric = { name: string; token: string; px: number };
export function resolveMetrics(css: string): ResolvedMetric[] {
  const tokens = rootTokens(css);
  return IN_GAME_THEME.metrics.map(m => {
    const t = tokens.get(m.token);
    const px = t && /^([\d.]+)px$/.exec(t[1].trim());
    if (!px) throw new Error(`studio.css has no pixel token ${m.token} (metric ${m.name})`);
    return { name: m.name, token: m.token, px: parseFloat(px[1]!) };
  });
}

export type ResolvedRuleValue = { name: string; rule: string; property: string; value: number };
/** A rule's number: an opacity as written, an animation's duration in seconds. */
export function resolveRuleValues(css: string): ResolvedRuleValue[] {
  return IN_GAME_THEME.ruleValues.map(v => {
    const raw = ruleValue(css, v.rule, v.property);
    const m = raw && (v.property === "animation" ? /(?:^|\s)([\d.]+)s(?:\s|$)/.exec(raw) : /^([\d.]+)$/.exec(raw));
    if (!m) throw new Error(`studio.css has no number for ${v.property} on ${v.rule} (${v.name})`);
    return { name: v.name, rule: v.rule, property: v.property, value: parseFloat(m[1]!) };
  });
}

/** The colour as the guide prints it: #rrggbb, with the alpha in percent where it is not opaque. */
export function hex(c: Rgba): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${c[3] < 1 ? ` ${Math.round(c[3] * 100)}%` : ""}`;
}

/** `fg` laid over `bg` as the browser blends it, in gamma-encoded sRGB; opaque result. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

const luminance = (c: Rgba) => 0.2126 * decode(c[0]) + 0.7152 * decode(c[1]) + 0.0722 * decode(c[2]);
export function contrast(fg: Rgba, bg: Rgba): number {
  const f = luminance(over(fg, bg)), b = luminance(over(bg, [0, 0, 0, 1]));
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

/**
 * Text pairs the in-game surfaces draw: [foreground slot, background slots stacked bottom to top, minimum ratio, use]. The plate is
 * WindowBg over the game; its alpha is 0.97, so it is laid over the app background here as the nearest honest stand-in for "a scene".
 */
export const IN_GAME_CONTRAST: readonly [string, readonly string[], number, string][] = [
  ["Text", ["WindowBg"], 4.5, "Body text on the plate"],
  ["XfTextMuted", ["WindowBg"], 4.5, "Labels and hints on the plate"],
  ["TextDisabled", ["WindowBg"], 4.5, "Footers and the idle dot's words on the plate"],
  ["XfAccentText", ["WindowBg"], 4.5, "The heading and a question's label"],
  ["XfSuccess", ["WindowBg"], 4.5, "Connected"],
  ["XfWarning", ["WindowBg"], 4.5, "Changes allowed or paused"],
  ["XfDanger", ["WindowBg"], 4.5, "Stopped"],
  ["XfSignal", ["WindowBg"], 4.5, "Live data and the info chip's text"],
  ["Text", ["WindowBg", "ChildBg"], 4.5, "Body text in a card"],
  ["XfTextMuted", ["WindowBg", "ChildBg"], 4.5, "Labels in a card"],
  ["XfSuccess", ["WindowBg", "ChildBg", "XfSuccessBg"], 4.5, "The success chip's text"],
  ["XfWarning", ["WindowBg", "ChildBg", "XfWarningBg"], 4.5, "The warning chip's text"],
  ["XfDanger", ["WindowBg", "ChildBg", "XfDangerBg"], 4.5, "The danger chip's text"],
  ["XfSignal", ["WindowBg", "ChildBg", "XfSignalBg"], 4.5, "The info chip's text"],
  ["XfAccentInk", ["XfAccent"], 4.5, "Text on the primary button"],
  ["XfDanger", ["WindowBg", "ChildBg", "XfDangerBg"], 4.5, "The stop button's text on its hover wash"],
  ["Border", ["WindowBg"], 3, "A control's frame against the plate"],
];

export function contrastRows(css: string) {
  const bySlot = new Map(resolveColours(css).map(c => [c.slot, c]));
  const get = (slot: string, theme: Theme) => { const c = bySlot.get(slot); if (!c) throw new Error(`no slot ${slot}`); return c[theme]; };
  const app = rootTokens(css).get("--bg-app")!;
  const stack = (slots: readonly string[], theme: Theme) => slots.reduce<Rgba>((under, slot) => over(get(slot, theme), under), oklch(app[theme === "light" ? 0 : 1]));
  return IN_GAME_CONTRAST.map(([fg, bgs, min, use]) => {
    const value = (theme: Theme) => contrast(get(fg, theme), stack(bgs, theme));
    return { fg, bgs, min, use, light: value("light"), dark: value("dark") };
  });
}
