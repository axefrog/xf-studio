// The XF ImGui theme (bridge 0.7): XF Studio's design tokens mapped to a Dear ImGui style, for the bridge's own overlay
// host (native, core/overlay/ThemeTable.inc) and its Cyber Engine Tweaks window (cet/xf_runtime_bridge/theme.lua).
//
// One data-driven table, generated from the Studio's tokens so the two never drift: the :root block of
// projects/xf-studio/authoring/public/studio.css (the style guide's authority) is parsed, every light-dark(light, dark)
// token is split into its two themes, oklch() is converted to sRGB (Björn Ottosson's OKLab matrices, gamut-clipped per
// channel), and MAPPING below says which token each ImGui colour and metric takes. Dark is the default theme and light is
// a manual choice ([overlay] theme in config.ini); nothing switches automatically.
//
//   bun tools/overlay/theme.ts            writes both generated files
//   bun tools/overlay/theme.ts --check    exits 1 when either differs from what the tokens give (tools/test checks it too)
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

/** The :root block's custom properties, each split into its light and dark values (a plain value serves both). */
export function parseRootTokens(css: string): Map<string, Token> {
  const start = css.indexOf(":root {");
  if (start < 0) throw new Error("studio.css has no :root block");
  const end = css.indexOf("\n}", start);
  const body = css.slice(start + ":root {".length, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, Token>();
  for (const declaration of splitTop(body, ";")) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
    if (!m) continue;
    const [, name, value] = m;
    const ld = /^light-dark\(([\s\S]+)\)$/.exec(value!);
    if (ld) {
      const parts = splitTop(ld[1]!, ",");
      if (parts.length === 2) {
        out.set(name!, { light: parts[0]!.trim(), dark: parts[1]!.trim() });
        continue;
      }
    }
    out.set(name!, { light: value!, dark: value! });
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
  source_sha256: string;
  colors: { name: string; token: string; dark: Rgba; light: Rgba }[];
  metrics: { name: string; value: number; from: string }[];
};

export function buildTheme(css: string): Theme {
  const tokens = parseRootTokens(css);
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
  return { source_sha256: createHash("sha256").update(css).digest("hex"), colors, metrics };
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0f` : `${v}f`);

export function nativeTable(theme: Theme): string {
  const lines = [
    "// GENERATED by tools/overlay/theme.ts from projects/xf-studio/authoring/public/studio.css; do not edit.",
    `// Source SHA-256 ${theme.source_sha256}. Regenerate with bun tools/overlay/theme.ts (the tests check it).`,
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
    `-- Source SHA-256 ${theme.source_sha256}. Regenerate with bun tools/overlay/theme.ts (the tests check it).`,
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
  const { native, lua } = generated();
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
