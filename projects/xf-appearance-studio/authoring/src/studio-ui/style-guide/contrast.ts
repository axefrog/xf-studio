/** WCAG contrast computed from the real studio.css tokens at guide build time. */
type Oklch = [number, number, number];
const parse = (text: string): Oklch | undefined => {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};
function tokens(css: string) {
  const light = new Map<string, Oklch>(), dark = new Map<string, Oklch>();
  for (const match of css.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    const pair = /light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)/.exec(value);
    if (pair) { const l = parse(pair[1]), d = parse(pair[2]); if (l) light.set(name, l); if (d) dark.set(name, d); continue; }
    const single = /^oklch\([^)]*\)$/.test(value.trim()) ? parse(value) : undefined;
    if (single) { light.set(name, single); dark.set(name, single); }
  }
  return { light, dark };
}
function srgb([L, C, H]: Oklch) {
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(v => Math.min(1, Math.max(0, v)));
}
const luminance = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
export function ratio(fg: Oklch, bg: Oklch) {
  const a = luminance(srgb(fg)), b = luminance(srgb(bg));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export const CONTRAST_PAIRS: [string, string, number, string][] = [
  ["--text", "--bg-panel", 4.5, "Body text"], ["--text-muted", "--bg-panel", 4.5, "Secondary text"],
  ["--text-faint", "--bg-panel", 4.5, "Tertiary text on panels"], ["--text-muted", "--bg-app", 4.5, "Secondary text on the app background"],
  ["--line-strong", "--bg-panel", 3, "Control boundaries"], ["--accent-text", "--bg-panel", 4.5, "Accent as text"],
  ["--signal", "--bg-panel", 3, "Selection and drop targets"], ["--danger", "--bg-panel", 4.5, "Errors"],
  ["--warning", "--bg-panel", 4.5, "Warnings, preview study"], ["--success", "--bg-panel", 4.5, "Success, exportable"],
  ["--focus", "--bg-panel", 3, "Focus ring"], ["--accent-ink", "--accent", 4.5, "Text on the primary button"],
];
export function contrastTable(css: string) {
  const { light, dark } = tokens(css);
  const cell = (map: Map<string, Oklch>, fg: string, bg: string, min: number) => {
    const a = map.get(fg), b = map.get(bg);
    if (!a || !b) return `<td>—</td>`;
    const value = ratio(a, b);
    return `<td class="${value >= min ? "ok" : "fail"}">${value.toFixed(2)}:1</td>`;
  };
  const rows = CONTRAST_PAIRS.map(([fg, bg, min, use]) =>
    `<tr><td>${use}</td><td><code>${fg}</code> on <code>${bg}</code></td><td>${min}:1</td>${cell(light, fg, bg, min)}${cell(dark, fg, bg, min)}</tr>`).join("");
  const failures = CONTRAST_PAIRS.filter(([fg, bg, min]) => [light, dark].some(map => { const a = map.get(fg), b = map.get(bg); return !a || !b || ratio(a, b) < min; }));
  return { html: `<table class="ref-table contrast-table"><thead><tr><th>Use</th><th>Pair</th><th>Minimum</th><th>Light</th><th>Dark</th></tr></thead><tbody>${rows}</tbody></table>`, failures };
}
