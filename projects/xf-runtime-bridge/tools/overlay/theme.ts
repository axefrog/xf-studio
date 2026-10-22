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
// The mapping is a design decision for the UI component track's review (AGENTS.md: component-first UI, UI/UX review);
// this file only carries it out. ImGui has no bevelled corners, so the Studio's bevel becomes its 2 px radius everywhere.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
 * Which token each ImGui colour takes. `alpha` multiplies the token's own alpha (for hover and selection washes the
 * tokens give as colours). The XF entries (prefix Xf) are the panel's own semantic colours, not ImGui's.
 */
export const MAPPING: readonly { name: string; token: string; alpha?: number }[] = [
  { name: "Text", token: "--text" },
  { name: "TextDisabled", token: "--text-faint" },
  { name: "WindowBg", token: "--bg-overlay" },
  { name: "ChildBg", token: "--bg-panel" },
  { name: "PopupBg", token: "--bg-overlay" },
  { name: "Border", token: "--line" },
  { name: "BorderShadow", token: "--bg-app", alpha: 0 },
  { name: "FrameBg", token: "--bg-sunken" },
  { name: "FrameBgHovered", token: "--bg-hover" },
  { name: "FrameBgActive", token: "--bg-active" },
  { name: "TitleBg", token: "--bg-raised" },
  { name: "TitleBgActive", token: "--bg-raised" },
  { name: "TitleBgCollapsed", token: "--bg-raised" },
  { name: "MenuBarBg", token: "--bg-panel" },
  { name: "ScrollbarBg", token: "--bg-sunken" },
  { name: "ScrollbarGrab", token: "--line-strong" },
  { name: "ScrollbarGrabHovered", token: "--text-faint" },
  { name: "ScrollbarGrabActive", token: "--text-muted" },
  { name: "CheckMark", token: "--accent" },
  { name: "SliderGrab", token: "--signal" },
  { name: "SliderGrabActive", token: "--accent" },
  { name: "Button", token: "--bg-raised" },
  { name: "ButtonHovered", token: "--bg-hover" },
  { name: "ButtonActive", token: "--bg-active" },
  { name: "Header", token: "--signal-bg" },
  { name: "HeaderHovered", token: "--bg-hover" },
  { name: "HeaderActive", token: "--bg-active" },
  { name: "Separator", token: "--line-soft" },
  { name: "SeparatorHovered", token: "--line-strong" },
  { name: "SeparatorActive", token: "--accent" },
  { name: "ResizeGrip", token: "--line" },
  { name: "ResizeGripHovered", token: "--line-strong" },
  { name: "ResizeGripActive", token: "--accent" },
  { name: "Tab", token: "--bg-panel" },
  { name: "TabHovered", token: "--bg-hover" },
  { name: "PlotLines", token: "--signal" },
  { name: "PlotLinesHovered", token: "--accent" },
  { name: "PlotHistogram", token: "--signal" },
  { name: "PlotHistogramHovered", token: "--accent" },
  { name: "TableHeaderBg", token: "--bg-raised" },
  { name: "TableBorderStrong", token: "--line-strong" },
  { name: "TableBorderLight", token: "--line-soft" },
  { name: "TextSelectedBg", token: "--signal-bg" },
  { name: "DragDropTarget", token: "--accent" },
  { name: "NavCursor", token: "--focus" },
  { name: "ModalWindowDimBg", token: "--bg-app", alpha: 0.6 },
  // XF semantic colours for the panel's own text and marks.
  { name: "XfAccent", token: "--accent" },
  { name: "XfAccentInk", token: "--accent-ink" },
  { name: "XfAccentEdge", token: "--accent-edge" },
  { name: "XfAccentText", token: "--accent-text" },
  { name: "XfSignal", token: "--signal" },
  { name: "XfSuccess", token: "--success" },
  { name: "XfWarning", token: "--warning" },
  { name: "XfDanger", token: "--danger" },
  { name: "XfTextMuted", token: "--text-muted" },
  { name: "XfLineStrong", token: "--line-strong" },
];

/** ImGui style metrics from the spacing, size and radius tokens (at the Studio's own 1x; the host scales them). */
export const METRICS: readonly { name: string; from: string; note: string }[] = [
  { name: "WindowPaddingX", from: "--sp-5", note: "panel padding" },
  { name: "WindowPaddingY", from: "--sp-5", note: "panel padding" },
  { name: "FramePaddingX", from: "--sp-4", note: "field padding (.field)" },
  { name: "FramePaddingY", from: "--sp-3", note: "(control height - text) / 2, about sp-3 at 13 px text in 28 px controls" },
  { name: "ItemSpacingX", from: "--sp-4", note: "gap between controls" },
  { name: "ItemSpacingY", from: "--sp-3", note: "gap between rows" },
  { name: "ItemInnerSpacingX", from: "--sp-3", note: ".btn gap" },
  { name: "ItemInnerSpacingY", from: "--sp-2", note: "" },
  { name: "Rounding", from: "--radius", note: "every corner (ImGui has no bevel)" },
  { name: "BevelSmall", from: "--bevel-sm", note: "for the panel's own drawn bevels" },
  { name: "FontSize", from: "--fs-md", note: "body text" },
  { name: "FontSizeSmall", from: "--fs-sm", note: "labels, the footer" },
  { name: "FontSizeLarge", from: "--fs-lg", note: "the panel's title" },
  { name: "ControlHeight", from: "--control-h", note: "buttons and fields" },
];

/** The typography the Studio names, as Windows font files (the host loads the first it finds, else ImGui's default). */
export const FONTS = {
  ui: ["SegUIVar.ttf", "segoeui.ttf"],
  display: ["bahnschrift.ttf"],
  mono: ["CascadiaMono.ttf", "consola.ttf"],
} as const;

export type Theme = {
  /** RB-104: the SHA-256 of the mapped tokens' resolved values (colours and metrics), not of the whole stylesheet, so an
   * unrelated rule in studio.css never makes the tables "drift". */
  tokens_sha256: string;
  colors: { name: string; token: string; dark: Rgba; light: Rgba }[];
  metrics: { name: string; value: number; from: string }[];
};

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
  const metrics = METRICS.map((m) => {
    const t = tokens.get(m.from);
    if (!t) throw new Error(`studio.css has no token ${m.from}`);
    return { name: m.name, value: px(t.dark), from: m.from };
  });
  const tokens_sha256 = createHash("sha256").update(JSON.stringify({ colors, metrics })).digest("hex");
  return { tokens_sha256, colors, metrics };
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0f` : `${v}f`);

export function nativeTable(theme: Theme): string {
  const lines = [
    "// GENERATED by tools/overlay/theme.ts from projects/xf-studio/authoring/public/studio.css; do not edit.",
    `// Mapped tokens' SHA-256 ${theme.tokens_sha256}. Regenerate with bun tools/overlay/theme.ts (CI and the tests check it).`,
    "// Colours are sRGB (gamma-encoded) RGBA, dark then light; metrics are the Studio's pixels at 1x.",
    "// XF_THEME_COLOR(name, token, dark r, g, b, a, light r, g, b, a)",
    ...theme.colors.map((c) => `XF_THEME_COLOR(${c.name}, "${c.token}", ${c.dark.map(f).join(", ")}, ${c.light.map(f).join(", ")})`),
    "// XF_THEME_METRIC(name, token, value)",
    ...theme.metrics.map((m) => `XF_THEME_METRIC(${m.name}, "${m.from}", ${f(m.value)})`),
    "",
  ];
  return lines.join("\n");
}

export function luaTable(theme: Theme): string {
  const rgba = (c: Rgba) => `{ ${c.join(", ")} }`;
  const lines = [
    "-- GENERATED by tools/overlay/theme.ts from projects/xf-studio/authoring/public/studio.css; do not edit.",
    `-- Mapped tokens' SHA-256 ${theme.tokens_sha256}. Regenerate with bun tools/overlay/theme.ts (CI and the tests check it).`,
    "-- The XF Studio theme for the bridge's CET window: ImGui colours (sRGB RGBA) per theme and the Studio's metrics in pixels.",
    "return {",
    "  colors = {",
    ...theme.colors.map((c) => `    ${c.name} = { token = "${c.token}", dark = ${rgba(c.dark)}, light = ${rgba(c.light)} },`),
    "  },",
    "  metrics = {",
    ...theme.metrics.map((m) => `    ${m.name} = ${m.value},`),
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
