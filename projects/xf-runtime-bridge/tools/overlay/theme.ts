// The XF ImGui theme (bridge 0.7): XF Studio's design tokens mapped to a Dear ImGui style, for the bridge's own overlay
// host (native, core/overlay/ThemeTable.inc) and its Cyber Engine Tweaks window (cet/xf_runtime_bridge/theme.lua).
//
// One data-driven table, generated from the Studio's tokens so the two never drift: the :root blocks of
// projects/xf-studio/authoring/public/studio.css (the style guide's authority) is parsed, every light-dark(light, dark)
// token is split into its two themes, oklch() is converted to sRGB (Björn Ottosson's OKLab matrices, gamut-clipped per
// channel), and MAPPING below says which token each ImGui colour and metric takes. Dark is the default theme and light is
// a manual choice ([overlay] theme in config.ini); nothing switches automatically.
//
//   bun tools/overlay/theme.ts            writes both generated files
//   bun tools/overlay/theme.ts --check    exits 1 when either differs from what the tokens give (CI's authoring workflow
//                                         and tools/test check it too); --css <file> reads another stylesheet (the tests)
//
// Only the mapped tokens' resolved values count (RB-104): the generated files carry their hash, not the stylesheet's, so
// a rule elsewhere in studio.css never fails the check. Every plain :root block is read (RB-116), and a mapped token set
// in a theme-qualified or @media :root rule is refused (the generator wouldn't see it).
//
// 0.8.22: the mapping is the Studio's own table, the style guide's "In-game surfaces" section: IN_GAME_THEME in
// projects/xf-studio/authoring/src/studio-ui/style-guide/in-game-theme.ts (plain data, no browser imports), imported below by a
// relative path (the Studio's tests read this generator back, so the two cannot drift). The style guide is the design authority;
// this file only carries it out: every ImGui 1.92.9 colour slot and the XF semantic slots, every metric, the numbers the Studio
// sets on a rule (DisabledAlpha, the indeterminate sweep), the motion constants and the type roles. ImGui has no bevelled
// corners, so widgets take the Studio's 2 px radius; the host draws the chamfers (chips, the mark) by hand.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CET_SCALE_RANGE, IN_GAME_LABELLED_BAR_ALPHA, IN_GAME_THEME } from "../../../xf-studio/authoring/src/studio-ui/style-guide/in-game-theme";

export const PROJECT_DIR = resolve(import.meta.dir, "..", "..");
export const STUDIO_CSS = resolve(PROJECT_DIR, "..", "xf-studio", "authoring", "public", "studio.css");
export const NATIVE_OUT = join(PROJECT_DIR, "native", "src", "core", "overlay", "ThemeTable.inc");
export const LUA_OUT = join(PROJECT_DIR, "cet", "xf_runtime_bridge", "theme.lua");

export type Rgba = [number, number, number, number];
export type Token = { light: string; dark: string };

type Rule = { selector: string; body: string; media: boolean };

/** The style rules of a stylesheet, comments removed, with the selectors of rules nested in @media and other at-rules. */
export function cssRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const walk = (from: number, to: number, media: boolean) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const raw = text.slice(i, open);
      const selector = raw.slice(raw.lastIndexOf(";") + 1).replace(/^[}\s]+/, "").trim(); // after a block-less at-rule (@import)
      let depth = 1, j = open + 1;
      while (j < to && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      if (selector.startsWith("@")) walk(open + 1, j - 1, true);
      else out.push({ selector, body: text.slice(open + 1, j - 1), media });
      i = j;
    }
  };
  walk(0, text.length, false);
  return out;
}

function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  for (const declaration of splitTop(body, ";")) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
    if (m) out.push([m[1]!, m[2]!]);
  }
  return out;
}

/**
 * The custom properties of every plain `:root` block (RB-116: all of them, in order, a later one overriding an earlier;
 * 0.7.0 read only the first), each split into its light and dark values (a plain value serves both).
 */
export function parseRootTokens(css: string): Map<string, Token> {
  const out = new Map<string, Token>();
  const roots = cssRules(css).filter((r) => !r.media && r.selector === ":root");
  if (!roots.length) throw new Error("studio.css has no :root block");
  for (const rule of roots) {
    for (const [name, value] of declarations(rule.body)) {
      const ld = /^light-dark\(([\s\S]+)\)$/.exec(value);
      const parts = ld ? splitTop(ld[1]!, ",") : [];
      out.set(name, parts.length === 2 ? { light: parts[0]!.trim(), dark: parts[1]!.trim() } : { light: value, dark: value });
    }
  }
  return out;
}

/**
 * Where a token is set in a root-scoped rule other than a plain :root (a theme override such as :root[data-theme="dark"],
 * or a :root rule inside @media): token -> the selectors. The generator reads plain :root only, so a mapped token set in
 * one of these would drift from what the Studio shows; buildTheme refuses that (RB-104).
 */
export function scopedRootTokens(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rule of cssRules(css)) {
    if (!rule.selector.split(",").some((part) => part.trim().startsWith(":root")) || (!rule.media && rule.selector === ":root")) continue;
    for (const [name] of declarations(rule.body)) out.set(name, [...(out.get(name) ?? []), (rule.media ? "@media " : "") + rule.selector]);
  }
  return out;
}

/** Splits on a separator outside parentheses. */
function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const c of text) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === separator && depth === 0) {
      out.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim()) out.push(current);
  return out;
}

const encode = (linear: number) => (linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** oklch(L C H [/ A]) with L as a number or a percentage, to sRGB (0-1, gamma-encoded) and alpha. */
export function oklchToSrgb(value: string): Rgba {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (!m) throw new Error(`not an oklch colour: ${value}`);
  const num = (s: string) => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s));
  const L = num(m[1]!), C = parseFloat(m[2]!), H = (parseFloat(m[3]!) * Math.PI) / 180;
  const alpha = m[4] !== undefined ? num(m[4]) : 1;
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return [round(clamp01(encode(clamp01(r)))), round(clamp01(encode(clamp01(g)))), round(clamp01(encode(clamp01(bl)))), round(clamp01(alpha))];
}

/** A pixel length such as "12px". */
export function px(value: string): number {
  const m = /^([\d.]+)px$/.exec(value.trim());
  if (!m) throw new Error(`not a pixel length: ${value}`);
  return parseFloat(m[1]!);
}

/**
 * Which token each ImGui colour (and each XF semantic colour, prefix Xf) takes: the Studio's in-game table, which maps every slot of
 * ImGui 1.92.9 docking's ImGuiCol_ enum, so no widget ever shows ImGui's default blue. `alpha` multiplies the token's own alpha.
 * A name an older ImGui (Cyber Engine Tweaks' 1.91.1) lacks is skipped by its consumer (panel.pushTheme), not here.
 */
export const MAPPING: readonly { name: string; token: string; alpha?: number }[] = IN_GAME_THEME.colours.map((c) => ({
  name: c.slot,
  token: c.token,
  ...(c.alpha !== undefined ? { alpha: c.alpha } : {}),
}));

/** Colours the Studio sets on a component's rule rather than as a token, read from that rule's declaration. */
export const RULE_COLOURS: readonly { name: string; rule: string; property: string }[] = IN_GAME_THEME.ruleColours.map((c) => ({
  name: c.slot,
  rule: c.rule,
  property: c.property,
}));

/** ImGui style metrics from the spacing, size and radius tokens (at the Studio's own 1x; the host scales them). */
export const METRICS: readonly { name: string; from: string; note: string }[] = IN_GAME_THEME.metrics.map((m) => ({
  name: m.name,
  from: m.token,
  note: m.use,
}));

/** Numbers the Studio sets on a rule (an opacity as written, an animation's duration in seconds). */
export const RULE_VALUES: readonly { name: string; rule: string; property: string }[] = IN_GAME_THEME.ruleValues.map((v) => ({
  name: v.name,
  rule: v.rule,
  property: v.property,
}));

/** The typography the Studio names, as Windows font files (the host loads the first it finds, else ImGui's default). */
export const FONTS = IN_GAME_THEME.fonts;

export type TypeRole = { role: string; face: "ui" | "display" | "mono"; weight: number; token: string; size: number; scale: number; caps: boolean };

export type Theme = {
  /** RB-104: the SHA-256 of the mapped tokens' resolved values (colours, metrics, rule values, motion and type), not of the
   * whole stylesheet, so an unrelated rule in studio.css never makes the tables "drift". */
  tokens_sha256: string;
  colors: { name: string; token: string; dark: Rgba; light: Rgba }[];
  metrics: { name: string; value: number; from: string }[];
  /** Numbers read from a Studio rule (DisabledAlpha, SweepSeconds), then the design constants of the spec (motion, labelled bar). */
  values: { name: string; source: string; value: number }[];
  /** The type roles: size in the Studio's pixels at 1x, and the CET scale (size over the body size, kept inside CET_SCALE_RANGE). */
  types: TypeRole[];
};

/**
 * The last unconditional declaration of a property on a rule whose selector is `selector` or `selector:` + a pseudo-class (the
 * Studio's own reading: tests/in-game-theme.test.ts resolves the same table against the same stylesheet).
 */
export function ruleDeclaration(css: string, selector: string, property: string): string | undefined {
  let value: string | undefined;
  for (const rule of cssRules(css)) {
    if (rule.media) continue;
    if (!splitTop(rule.selector, ",").some((part) => part.trim() === selector || part.trim().startsWith(`${selector}:`))) continue;
    for (const declaration of splitTop(rule.body, ";")) {
      const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
      if (m && m[1] === property) value = m[2]!;
    }
  }
  return value;
}

export function buildTheme(css: string): Theme {
  const tokens = parseRootTokens(css);
  const scoped = scopedRootTokens(css);
  for (const token of [...MAPPING.map((m) => m.token), ...METRICS.map((m) => m.from)]) {
    const where = scoped.get(token);
    if (where) throw new Error(`studio.css sets the mapped token ${token} outside a plain :root block (${where.join("; ")}); the overlay theme reads plain :root only, so it would drift from what the Studio shows. Move the value into :root (with light-dark()) or change the mapping.`);
  }
  const colour = (token: string, which: "light" | "dark", alpha = 1): Rgba => {
    const t = tokens.get(token);
    if (!t) throw new Error(`studio.css has no token ${token}`);
    const [r, g, b, a] = oklchToSrgb(t[which]);
    return [r, g, b, Math.round(a * alpha * 10000) / 10000];
  };
  const colors = MAPPING.map((m) => ({ name: m.name, token: m.token, dark: colour(m.token, "dark", m.alpha ?? 1), light: colour(m.token, "light", m.alpha ?? 1) }));
  for (const r of RULE_COLOURS) {
    const value = ruleDeclaration(css, r.rule, r.property);
    if (value === undefined) throw new Error(`studio.css has no ${r.property} on ${r.rule}`);
    const ld = /^light-dark\(([\s\S]+)\)$/.exec(value);
    const parts = ld ? splitTop(ld[1]!, ",") : [value, value];
    colors.push({ name: r.name, token: `${r.rule} ${r.property}`, light: oklchToSrgb(parts[0]!.trim()), dark: oklchToSrgb(parts[1]!.trim()) });
  }
  const metrics = METRICS.map((m) => {
    const t = tokens.get(m.from);
    if (!t) throw new Error(`studio.css has no token ${m.from}`);
    return { name: m.name, value: px(t.dark), from: m.from };
  });
  const values: Theme["values"] = RULE_VALUES.map((v) => {
    const raw = ruleDeclaration(css, v.rule, v.property);
    const m = raw && (v.property === "animation" ? /(?:^|\s)([\d.]+)s(?:\s|$)/.exec(raw) : /^([\d.]+)$/.exec(raw));
    if (!m) throw new Error(`studio.css has no number for ${v.property} on ${v.rule} (${v.name})`);
    return { name: v.name, source: `${v.rule} ${v.property}`, value: parseFloat(m[1]!) };
  });
  const motion = IN_GAME_THEME.motion;
  values.push(
    { name: "PulsePeriodMs", source: "spec", value: motion.pulsePeriodMs },
    { name: "PulseDepth", source: "spec", value: motion.pulseDepth },
    { name: "SettleMs", source: "spec", value: motion.settleMs },
    { name: "SettleGapMs", source: "spec", value: motion.settleGapMs },
    { name: "ChipBorderAlpha", source: "spec", value: motion.chipBorderAlpha },
    { name: "LabelledBarAlpha", source: "spec", value: IN_GAME_LABELLED_BAR_ALPHA },
  );
  const bodyToken = tokens.get("--fs-md");
  if (!bodyToken) throw new Error("studio.css has no token --fs-md");
  const body = px(bodyToken.dark);
  const [low, high] = CET_SCALE_RANGE;
  const types: TypeRole[] = IN_GAME_THEME.type.map((t) => {
    const entry = tokens.get(t.token);
    if (!entry) throw new Error(`studio.css has no token ${t.token}`);
    const size = px(entry.dark);
    return { role: t.role, face: t.face, weight: t.weight, token: t.token, size, scale: Math.round(Math.min(high, Math.max(low, size / body)) * 10000) / 10000, caps: t.caps };
  });
  const tokens_sha256 = createHash("sha256").update(JSON.stringify({ colors, metrics, values, types })).digest("hex");
  return { tokens_sha256, colors, metrics, values, types };
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0f` : `${v}f`);

export function nativeTable(theme: Theme): string {
  const lines = [
    "// GENERATED by tools/overlay/theme.ts from projects/xf-studio/authoring/public/studio.css and the Studio's in-game theme table",
    "// (projects/xf-studio/authoring/src/studio-ui/style-guide/in-game-theme.ts); do not edit.",
    `// Mapped tokens' SHA-256 ${theme.tokens_sha256}. Regenerate with bun tools/overlay/theme.ts (CI and the tests check it).`,
    "// Colours are sRGB (gamma-encoded) RGBA, dark then light; metrics are the Studio's pixels at 1x.",
    "// XF_THEME_COLOR(name, token, dark r, g, b, a, light r, g, b, a)",
    ...theme.colors.map((c) => `XF_THEME_COLOR(${c.name}, "${c.token}", ${c.dark.map(f).join(", ")}, ${c.light.map(f).join(", ")})`),
    "// XF_THEME_METRIC(name, token, value)",
    ...theme.metrics.map((m) => `XF_THEME_METRIC(${m.name}, "${m.from}", ${f(m.value)})`),
    "// XF_THEME_VALUE(name, source, value): numbers read from a Studio rule, then the spec's motion constants",
    ...theme.values.map((v) => `XF_THEME_VALUE(${v.name}, "${v.source}", ${f(v.value)})`),
    "// XF_THEME_TYPE(role, face, size, weight, caps): one baked font per role (the face's file is the first XF_THEME_FONT of that face that exists)",
    ...theme.types.map((t) => `XF_THEME_TYPE(${t.role}, ${t.face}, ${f(t.size)}, ${t.weight}, ${t.caps ? "true" : "false"})`),
    "// XF_THEME_FONT(face, file)",
    ...(Object.entries(FONTS) as [string, readonly string[]][]).flatMap(([face, files]) => files.map((file) => `XF_THEME_FONT(${face}, L"${file}")`)),
    "",
  ];
  return lines.join("\n");
}

export function luaTable(theme: Theme): string {
  const rgba = (c: Rgba) => `{ ${c.join(", ")} }`;
  const lines = [
    "-- GENERATED by tools/overlay/theme.ts from projects/xf-studio/authoring/public/studio.css and the Studio's in-game theme table",
    "-- (projects/xf-studio/authoring/src/studio-ui/style-guide/in-game-theme.ts); do not edit.",
    `-- Mapped tokens' SHA-256 ${theme.tokens_sha256}. Regenerate with bun tools/overlay/theme.ts (CI and the tests check it).`,
    "-- The XF Studio theme for the bridge's CET window: ImGui colours (sRGB RGBA) per theme and the Studio's metrics in pixels, the",
    "-- numbers read from a Studio rule and the spec's motion constants, and the type roles with the CET font scale of each.",
    "return {",
    "  colors = {",
    ...theme.colors.map((c) => `    ${c.name} = { token = "${c.token}", dark = ${rgba(c.dark)}, light = ${rgba(c.light)} },`),
    "  },",
    "  metrics = {",
    ...theme.metrics.map((m) => `    ${m.name} = ${m.value},`),
    "  },",
    "  values = {",
    ...theme.values.map((v) => `    ${v.name} = ${v.value},`),
    "  },",
    "  types = {",
    ...theme.types.map((t) => `    ${t.role} = { face = "${t.face}", size = ${t.size}, weight = ${t.weight}, scale = ${t.scale}, caps = ${t.caps} },`),
    "  },",
    "}",
    "",
  ];
  return lines.join("\n");
}

export function generated(css = readFileSync(STUDIO_CSS, "utf8")) {
  const theme = buildTheme(css);
  return { theme, native: nativeTable(theme), lua: luaTable(theme) };
}

if (import.meta.main) {
  const cssAt = process.argv.indexOf("--css");
  const { native, lua } = generated(readFileSync(cssAt >= 0 ? process.argv[cssAt + 1]! : STUDIO_CSS, "utf8"));
  if (process.argv.includes("--check")) {
    const same = (path: string, text: string) => {
      try {
        return readFileSync(path, "utf8").replace(/\r\n/g, "\n") === text;
      } catch {
        return false;
      }
    };
    const ok = same(NATIVE_OUT, native) && same(LUA_OUT, lua);
    console.log(ok ? "theme tables match the Studio's tokens" : "theme tables are out of date: run bun tools/overlay/theme.ts");
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(NATIVE_OUT, native);
  writeFileSync(LUA_OUT, lua);
  console.log(`wrote ${NATIVE_OUT} and ${LUA_OUT}`);
}
