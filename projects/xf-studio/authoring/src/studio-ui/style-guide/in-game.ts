import { code, esc, pattern, section } from "./kit";
import { IN_GAME_THEME, IN_GAME_LABELLED_BAR_ALPHA, CET_SCALE_RANGE, type ColourSlot } from "./in-game-theme";
import { contrastRows, contrastLayerLabel, hex, resolveColours, resolveMetrics, resolveRuleValues, rootTokens, ruleValue, type Rgba } from "./in-game-resolve";

/**
 * "In-game surfaces" (section 09): how the XF Runtime Bridge looks in the game. The ImGui specimens are HTML and CSS approximations,
 * drawn from the same table the bridge's theme generator reads (in-game-theme.ts), so a review can set them beside the Studio's own.
 * Dear ImGui draws no bevel, shadow, blur or tracking of its own; where a specimen shows one (the chip's chamfer, tracked capitals) the
 * entry says the host draws it by hand.
 */

const M = IN_GAME_THEME.motion;
const mix = (slot: string, alpha: number) => `color-mix(in oklab, var(--ig-${slot}) ${Math.round(alpha * 100)}%, transparent)`;

/** One custom property per slot, named for it, from the table: the specimens read these and nothing else. */
function slotVars(css: string) {
  const hover = ruleValue(css, ".btn.primary:hover", "background") ?? "var(--accent)";
  const lines = IN_GAME_THEME.colours.map((c: ColourSlot) =>
    c.alpha === undefined ? `--ig-${c.slot}: var(${c.token});` : `--ig-${c.slot}: color-mix(in oklab, var(${c.token}) ${Math.round(c.alpha * 100)}%, transparent);`);
  return `${lines.join(" ")} --ig-XfAccentHover: ${hover};`;
}

export function inGameCss(css: string) {
  const sweep = resolveRuleValues(css).find(v => v.name === "SweepSeconds")!.value;
  return `
.ig { ${slotVars(css)} font: 13px/1.3 var(--font-ui); color: var(--ig-Text); }
.ig-scene { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--sp-6); padding: var(--sp-6); border: 1px solid var(--line-soft); }
.ig-scene.bright { background: linear-gradient(115deg, #cdbb9d 0%, #ece0c8 38%, #94a9bb 70%, #d9c9a8 100%); }
.ig-scene.dark { background: linear-gradient(115deg, #07090d 0%, #141b27 55%, #0b0e14 100%); }
.ig-scene .ig-caption { color: #fff; mix-blend-mode: difference; }
.ig-stack { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }
.ig-caption { margin: 0; font: 600 var(--fs-2xs)/1.2 var(--font-display); letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
.ig-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--sp-5); align-items: start; }
.ig-cell { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.ig-win { background: var(--ig-WindowBg); border: 1px solid var(--ig-Border); border-radius: 2px; padding: 12px; display: flex; flex-direction: column; gap: 6px; width: 364px; max-width: 100%; box-sizing: border-box; }
.ig-win.narrow { width: 300px; }
.ig-line { background: var(--ig-WindowBg); border: 1px solid var(--ig-Border); border-radius: 2px; padding: 12px; display: flex; flex-direction: column; gap: 4px; width: 460px; max-width: 100%; box-sizing: border-box; }
.ig-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.ig-mark { flex: none; width: 30px; height: 24px; display: grid; place-items: center; background: var(--ig-XfAccent); color: var(--ig-XfAccentInk); font: 700 13px/1 var(--font-display); letter-spacing: .04em; border-radius: 0 7px 0 7px; }
.ig-title { font: 600 15px/1 var(--font-display); color: var(--ig-XfAccentText); white-space: nowrap; }
.ig-head .ig-foot { margin-left: auto; }
.ig-eyebrow { display: flex; align-items: center; gap: 6px; font: 600 11px/1 var(--font-display); letter-spacing: .12em; text-transform: uppercase; color: var(--ig-XfTextMuted); margin-top: 4px; }
.ig-eyebrow::before { content: ""; width: 6px; height: 6px; background: var(--ig-XfAccentEdge); flex: none; }
.ig-body { color: var(--ig-Text); }
.ig-muted { color: var(--ig-XfTextMuted); }
.ig-label { font-size: 12px; color: var(--ig-XfTextMuted); }
.ig-foot { font-size: 12px; color: var(--ig-TextDisabled); }
.ig-value { font: 12px/1.3 var(--font-mono); color: var(--ig-Text); }
.ig-rule { height: 1px; background: var(--ig-Separator); margin: 4px 0; }
.ig-status { display: flex; align-items: baseline; gap: 8px; }
.ig-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--ig-TextDisabled)); translate: 0 -1px; align-self: center; }
.ig-dot[data-tone="ok"] { --c: var(--ig-XfSuccess); } .ig-dot[data-tone="write"] { --c: var(--ig-XfWarning); }
.ig-dot[data-tone="paused"] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ig-XfWarning); }
.ig-dot[data-tone="killed"] { --c: var(--ig-XfDanger); }
.ig-live { animation: ig-pulse ${M.pulsePeriodMs}ms ease-in-out infinite; }
@keyframes ig-pulse { 0%, 100% { opacity: 1; } 50% { opacity: ${1 - M.pulseDepth}; } }
@keyframes ig-settle { 0% { background-color: ${mix("XfSignalBg", 1)}; } ${(M.settleMs / (M.settleMs + M.settleGapMs) * 100).toFixed(1)}%, 100% { background-color: transparent; } }
.ig-settle { animation: ig-settle ${M.settleMs + M.settleGapMs}ms cubic-bezier(.2, .7, .2, 1) infinite; }
@keyframes ig-sweep { from { left: -35%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .ig-live, .ig-settle, .ig-card[data-waiting], .ig-bar.indeterminate::after { animation: none; } .ig-bar.indeterminate::after { left: 0; } }
.ig-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; font: 600 11px/1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap;
  color: var(--ig-XfTextMuted); background: transparent; border: 1px solid var(--ig-XfLine); border-radius: 0 4px 0 4px; }
.ig-chip[data-tone="ok"] { color: var(--ig-XfSuccess); background: var(--ig-XfSuccessBg); border-color: ${mix("XfSuccess", M.chipBorderAlpha)}; }
.ig-chip[data-tone="warning"] { color: var(--ig-XfWarning); background: var(--ig-XfWarningBg); border-color: ${mix("XfWarning", M.chipBorderAlpha)}; }
.ig-chip[data-tone="danger"] { color: var(--ig-XfDanger); background: var(--ig-XfDangerBg); border-color: ${mix("XfDanger", M.chipBorderAlpha)}; }
.ig-chip[data-tone="info"] { color: var(--ig-XfSignal); background: var(--ig-XfSignalBg); border-color: var(--ig-XfSignalLine); }
.ig-chip[data-hollow] { background: transparent; }
.ig-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ig-kv { display: grid; grid-template-columns: 9.5em minmax(0, 1fr); gap: 6px 8px; align-items: baseline; font-size: 12px; margin: 0; }
.ig-kv dt { color: var(--ig-XfTextMuted); } .ig-kv dd { margin: 0; color: var(--ig-Text); min-width: 0; overflow-wrap: anywhere; } .ig-kv dd.mono { font-family: var(--font-mono); }
.ig-bar { position: relative; height: 6px; background: var(--ig-XfLine); overflow: hidden; }
.ig-bar > i { display: block; height: 100%; width: var(--v, 0%); background: var(--ig-PlotHistogram); }
.ig-bar.labelled { height: 16px; } .ig-bar.labelled > i { background: ${mix("PlotHistogram", IN_GAME_LABELLED_BAR_ALPHA)}; }
.ig-bar.labelled > span { position: absolute; inset: 0; display: grid; place-items: center; font: 12px/1 var(--font-mono); color: var(--ig-Text); mix-blend-mode: normal;  }
.ig-bar[data-tone="warning"] > i { --ig-PlotHistogram: var(--ig-XfWarning); background: var(--ig-XfWarning); } .ig-bar[data-tone="danger"] > i { --ig-PlotHistogram: var(--ig-XfDanger); background: var(--ig-XfDanger); }
.ig-bar.labelled[data-tone="warning"] > i { background: ${mix("XfWarning", IN_GAME_LABELLED_BAR_ALPHA)}; } .ig-bar.labelled[data-tone="danger"] > i { background: ${mix("XfDanger", IN_GAME_LABELLED_BAR_ALPHA)}; }
.ig-bar.indeterminate::after { content: ""; position: absolute; top: 0; bottom: 0; width: 35%; background: var(--ig-PlotHistogram); animation: ig-sweep ${sweep}s var(--ease) infinite; }
.ig-card { background: var(--ig-ChildBg); border: 1px solid var(--ig-XfLine); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ig-card[data-edge="accent"] { border-left: 2px solid var(--ig-XfAccentEdge); } .ig-card[data-edge="warning"] { border-left: 2px solid var(--ig-XfWarning); background: var(--ig-XfWarningBg); }
.ig-card[data-edge="danger"] { border-left: 2px solid var(--ig-XfDanger); } .ig-card[data-edge="signal"] { border-left: 2px solid var(--ig-XfSignal); }
@keyframes ig-edge { 0%, 100% { border-left-color: var(--ig-XfAccentEdge); } 50% { border-left-color: color-mix(in oklab, var(--ig-XfAccentEdge) ${Math.round((1 - M.pulseDepth) * 100)}%, transparent); } }
.ig-card[data-edge="accent"][data-waiting] { animation: ig-edge ${M.pulsePeriodMs}ms ease-in-out infinite; }
.ig-btn { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 8px; background: var(--ig-Button); color: var(--ig-Text); border: 1px solid var(--ig-Border); border-radius: 2px; font: 13px/1 var(--font-ui); white-space: nowrap; }
.ig-btn[data-state="hover"] { background: var(--ig-ButtonHovered); } .ig-btn[data-state="active"] { background: var(--ig-ButtonActive); }
.ig-btn[data-state="focus"] { outline: 2px solid var(--ig-NavCursor); outline-offset: 1px; }
.ig-btn[data-state="disabled"] { opacity: ${resolveRuleValues(css).find(v => v.name === "DisabledAlpha")!.value}; }
.ig-btn.primary { background: var(--ig-XfAccent); color: var(--ig-XfAccentInk); border-color: var(--ig-XfAccentEdge); }
.ig-btn.primary[data-state="hover"] { background: var(--ig-XfAccentHover); } .ig-btn.primary[data-state="active"] { background: var(--ig-XfAccent); }
.ig-btn.quiet { background: transparent; border-color: var(--ig-XfLine); } .ig-btn.quiet[data-state="hover"] { background: var(--ig-ButtonHovered); }
.ig-btn.danger { background: transparent; color: var(--ig-XfDanger); border-color: var(--ig-XfDanger); } .ig-btn.danger[data-state="hover"] { background: var(--ig-XfDangerBg); }
.ig-btn.on { background: var(--ig-XfSignalBg); color: var(--ig-XfSignal); border-color: var(--ig-XfSignal); }
.ig-key { display: inline-flex; align-items: center; height: 28px; padding: 0 8px; background: var(--ig-FrameBg); color: var(--ig-Text); border: 1px solid var(--ig-XfLineStrong); border-radius: 2px; font: 12px/1 var(--font-mono); }
.ig-input { display: block; width: 100%; box-sizing: border-box; padding: 6px 8px; background: var(--ig-FrameBg); color: var(--ig-Text); border: 1px solid var(--ig-Border); border-radius: 2px; font-size: 13px; min-height: 28px; }
.ig-input.multi { min-height: 62px; } .ig-input .ig-placeholder { color: var(--ig-TextDisabled); }
.ig-tip { display: inline-block; max-width: 280px; padding: 6px 8px; background: var(--ig-PopupBg); color: var(--ig-Text); border: 1px solid var(--ig-Border); border-left: 3px solid var(--ig-XfSignal); border-radius: 2px; font-size: 12px; }
.ig-tip[data-tone="warning"] { border-left-color: var(--ig-XfWarning); }
.ig-note { font-size: 12px; margin: 0; }
.ig-ink { --red: #ff5b52; --mild: #c7524b; --yellow: #fcee0a; --green: #55e08a; --blue: #5ef0ff; --grey: #9aa2a8; position: relative; display: inline-block; font-family: var(--font-display); }
.ig-ink > .under { position: absolute; inset: 0; background: #000; opacity: .88; } .ig-ink > .plate { position: absolute; inset: 0; background: #14161a; } .ig-ink > .edge { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--red); }
.ig-ink > .body { position: relative; padding: 8px 0 8px 14px; margin-right: 14px; display: flex; flex-direction: column; min-width: 300px; }
.ig-ink .head { display: flex; align-items: center; } .ig-ink .diamond { width: 7px; height: 7px; rotate: 45deg; margin: 1px 9px 0 1px; background: var(--c, var(--grey)); }
.ig-ink .t { font-size: 16px; font-weight: 600; text-transform: uppercase; color: var(--red); } .ig-ink .tag { margin-left: 8px; font-size: 11px; font-weight: 500; text-transform: uppercase; color: var(--mild); }
.ig-ink .s { margin: 3px 0 2px; font-size: 13px; font-weight: 500; color: var(--c, var(--grey)); } .ig-ink .m { margin-top: 2px; font-size: 13px; color: var(--blue); } .ig-ink .m.done { color: var(--green); } .ig-ink .m.warn { color: #ff7a73; }
.ig-ink .answers { display: flex; gap: 18px; margin-top: 4px; font-size: 14px; font-weight: 600; color: var(--yellow); } .ig-ink .answers .hover { color: var(--blue); }
.ig-ink .hint { margin-top: 3px; font-size: 12px; color: var(--grey); }
.ig-ink[data-tone="ok"] { --c: var(--green); } .ig-ink[data-tone="write"], .ig-ink[data-tone="paused"] { --c: var(--yellow); } .ig-ink[data-tone="killed"] { --c: var(--red); }
.ig-scale { display: grid; grid-template-columns: max-content max-content 1fr; gap: 6px var(--sp-6); align-items: baseline; }
.ig-swatch { display: inline-block; width: 22px; height: 14px; border: 1px solid var(--line); vertical-align: middle; background-image: linear-gradient(var(--sw), var(--sw)), conic-gradient(#8885 25%, #0000 0 50%, #8885 0 75%, #0000 0); background-size: 100% 100%, 8px 8px; }
.ig-table td code { white-space: nowrap; } .ig-table td.num { text-align: right; font-family: var(--font-mono); }
.ig-table td.ok { color: var(--success); font-family: var(--font-mono); } .ig-table td.fail { color: var(--danger); font-family: var(--font-mono); font-weight: 700; }
.ig-tag { font: 600 var(--fs-2xs)/1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; padding: 2px 5px; border: 1px solid var(--line-strong); }
.ig-tag.new { color: var(--signal); border-color: var(--signal-line); } .ig-tag.changed { color: var(--warning); border-color: var(--warning); }
`;
}

// ---- Specimen pieces (HTML approximations of ImGui) -------------------------------------------------------------------------------

const dot = (t: string, live = false) => `<i class="ig-dot${live ? " ig-live" : ""}" data-tone="${t}" aria-hidden="true"></i>`;
const chip = (label: string, t = "", options: { hollow?: boolean } = {}) => `<span class="ig-chip"${t ? ` data-tone="${t}"` : ""}${options.hollow ? " data-hollow" : ""}>${label}</span>`;
const head = (right = "") => `<div class="ig-head"><span class="ig-mark" aria-hidden="true">XF</span><span class="ig-title">XF Runtime Bridge</span>${chip("test", "info")}${right ? `<span class="ig-foot">${right}</span>` : ""}</div>`;
const status = (t: string, text: string, live = false) => `<div class="ig-status">${dot(t, live)}<span class="ig-muted">${esc(text)}</span></div>`;
const eyebrow = (label: string, flush = false) => `<div class="ig-eyebrow"${flush ? " style=\"margin-top:0\"" : ""}>${label}</div>`;
const kv = (rows: [string, string, boolean?][]) => `<dl class="ig-kv">${rows.map(([k, v, mono]) => `<dt>${k}</dt><dd${mono ? ' class="mono"' : ""}>${v}</dd>`).join("")}</dl>`;
const btn = (label: string, variant = "", state = "") => `<span class="ig-btn ${variant}"${state ? ` data-state="${state}"` : ""}>${label}</span>`;
const bar = (pct: number, options: { label?: string; tone?: string; indeterminate?: boolean } = {}) =>
  `<div class="ig-bar${options.label ? " labelled" : ""}${options.indeterminate ? " indeterminate" : ""}"${options.tone ? ` data-tone="${options.tone}"` : ""} style="--v:${pct}%" role="img" aria-label="${esc(options.label ?? `${pct} percent`)}">${options.indeterminate ? "" : "<i></i>"}${options.label ? `<span>${esc(options.label)}</span>` : ""}</div>`;
const card = (inner: string, edge = "", extra = "") => `<div class="ig-card"${edge ? ` data-edge="${edge}"` : ""}${extra}>${inner}</div>`;
const cell = (caption: string, inner: string) => `<div class="ig-cell"><p class="ig-caption">${caption}</p>${inner}</div>`;
const scene = (kind: "bright" | "dark", inner: string) => `<div class="ig-scene ${kind}">${inner}</div>`;
const tipSpan = (text: string, t = "") => `<span class="ig-tip"${t ? ` data-tone="${t}"` : ""}>${esc(text)}</span>`;

/** The question card: the one yellow thing in a window, an accent edge that breathes while it waits. */
const question = (state: "waiting" | "answered") => card(state === "waiting"
  ? `${eyebrow("Question from XF Studio", true)}<div class="ig-body">Is the pin fully visible, or partly cut off?</div><div class="ig-row">${btn("Fully visible", "primary")}${btn("Partly cut off", "primary")}</div>`
  : `${eyebrow("Question from XF Studio", true)}<div class="ig-body">Is the pin fully visible, or partly cut off?</div><div class="ig-muted" style="font-size:13px">Sent: Fully visible. Waiting for the next question.</div>`,
  "accent", state === "waiting" ? " data-waiting" : "");

const tonesTable = `<table class="ref-table ig-table"><thead><tr><th>Bridge state</th><th>Dot</th><th>Chip</th><th>Ink diamond</th><th>Live pulse</th></tr></thead><tbody>
  <tr><td>Connected, read-only</td><td>${dot("ok", true)} success</td><td>${chip("Read-only", "ok")}</td><td>Green</td><td>Yes</td></tr>
  <tr><td>Changes allowed (test profile)</td><td>${dot("write", true)} warning</td><td>${chip("Changes allowed", "warning")}</td><td>Yellow</td><td>Yes</td></tr>
  <tr><td>Changes paused</td><td>${dot("paused")} warning ring</td><td>${chip("Paused", "warning", { hollow: true })}</td><td>Yellow</td><td>No</td></tr>
  <tr><td>Stopped (kill switch)</td><td>${dot("killed")} danger</td><td>${chip("Stopped", "danger")}</td><td>Red</td><td>No</td></tr>
  <tr><td>Off, starting, no plugin</td><td>${dot("off")} faint</td><td>${chip("Off")}</td><td>Grey</td><td>No</td></tr></tbody></table>`;

// ---- The section --------------------------------------------------------------------------------------------------------------------

export function inGameSurfaces(css: string) {
  const colours = resolveColours(css), metrics = resolveMetrics(css), tokens = rootTokens(css);
  const px = (token: string) => parseFloat(tokens.get(token)![1]);
  const md = px("--fs-md");
  const paint = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)} / ${c[3]})`;
  const swatch = (c: Rgba) => `<span class="ig-swatch" style="--sw:${paint(c)}"></span>`;
  const meta = new Map<string, ColourSlot>(IN_GAME_THEME.colours.map(c => [c.slot, c]));

  const colourRows = colours.map(c => {
    const e = meta.get(c.slot);
    const mark = e?.from ? `<span class="ig-tag changed" title="${esc(`Today ${e.from}. ${e.why ?? ""}`)}">was ${e.from}</span>` : e?.added ? `<span class="ig-tag new" title="${esc(e.why ?? "")}">new</span>` : "";
    return `<tr><td><code>${c.slot}</code></td><td><code>${c.token}</code>${c.alpha !== undefined ? ` × ${c.alpha}` : ""}</td><td>${swatch(c.dark)} <code>${hex(c.dark)}</code></td><td>${swatch(c.light)} <code>${hex(c.light)}</code></td><td>${esc(e?.use ?? IN_GAME_THEME.ruleColours.find(r => r.slot === c.slot)?.use ?? "")}</td><td>${mark}</td></tr>`;
  }).join("");
  const reasons = IN_GAME_THEME.colours.filter(c => c.why && (c.from || c.added) && !/^(As above|Named so no slot)/.test(c.why))
    .map(c => `<li>${code(c.slot)}${c.from ? ` (was ${code(c.from)})` : ""}: ${esc(c.why!)}</li>`).join("");
  const metricRows = metrics.map(m => {
    const e = IN_GAME_THEME.metrics.find(x => x.name === m.name)!;
    return `<tr><td><code>${m.name}</code></td><td><code>${m.token}</code></td><td class="num">${m.px} px</td><td>${esc(e.use)}</td><td>${e.added ? `<span class="ig-tag new" title="${esc(e.why ?? "")}">new</span>` : ""}</td></tr>`;
  }).join("");
  const ruleRows = resolveRuleValues(css).map(v => `<tr><td><code>${v.name}</code></td><td><code>${esc(v.rule)}</code> <code>${v.property}</code></td><td class="num">${v.value}${v.property === "animation" ? " s" : ""}</td><td>${esc(IN_GAME_THEME.ruleValues.find(x => x.name === v.name)!.use)}</td></tr>`).join("");
  const contrast = contrastRows(css).map(r => {
    const cellOf = (v: number) => `<td class="${v >= r.min ? "ok" : "fail"}">${v.toFixed(2)}:1</td>`;
    return `<tr><td>${esc(r.use)}</td><td><code>${r.fg}</code> on <code>${r.bgs.map(contrastLayerLabel).join(" + ")}</code></td><td>${r.min}:1</td>${cellOf(r.light)}${cellOf(r.dark)}</tr>`;
  }).join("");

  const typeRows = IN_GAME_THEME.type.map(t => {
    const size = px(t.token), factor = size / md;
    const face = t.face === "display" ? "var(--font-display)" : t.face === "mono" ? "var(--font-mono)" : "var(--font-ui)";
    const sample = `<span style="font:${t.weight} ${size}px/1.2 ${face};${t.caps ? "letter-spacing:.1em;text-transform:uppercase;" : ""}color:var(--ig-${t.role === "title" ? "XfAccentText" : t.role === "body" ? "Text" : "XfTextMuted"})">${t.caps ? "Connected" : t.role === "title" ? "XF Runtime Bridge" : t.role === "value" ? "0.31 ms  F11" : t.role === "label" ? "Stop key" : "XF Studio connected"}</span>`;
    return `<tr><td><code>${t.role}</code></td><td>${sample}</td><td>${t.face}${t.weight >= 600 ? " 600" : ""}${t.caps ? ", capitals" : ""}</td><td><code>${t.token}</code> · ${size} px</td><td class="num">× ${factor.toFixed(2)}</td><td>${esc(t.use)}</td></tr>`;
  }).join("");

  const space = metrics.filter(m => ["WindowPaddingX", "ItemSpacingY", "ItemSpacingX", "SectionGap", "ChildPaddingX", "ChildPaddingY"].includes(m.name)).map(m => `${code(m.name)} ${m.px}`).join(" · ");

  return section("in-game", "09", "In-game surfaces",
    `How XF Runtime Bridge looks in the game. The bridge has three surfaces with fixed names (the <strong>ink panel</strong>, the <strong>XF ImGui overlay panel</strong> and <strong>CET</strong>, whose window and one-line status are its two parts), and only one of them shows status at a time.
     They are themed like the Studio, from one table of its tokens that the bridge's theme generator reads, so the two cannot drift. Dark is the default and light is a manual setting. This section is the design; the bridge's own work queue builds it. The ImGui specimens below are HTML approximations drawn from that table: Dear ImGui itself draws no shadow, blur, bevel or letter-spacing, and where a specimen shows one the entry says the host draws it by hand.`, [
    pattern({ id: "ig-surfaces", title: "Three surfaces, one status at a time", status: "rule", wide: true,
      specimen: `<table class="ref-table ig-table"><thead><tr><th>Surface</th><th>Drawn with</th><th>Where and when</th><th>Takes input</th><th>Looks like</th></tr></thead><tbody>
        <tr><td><strong>Ink panel</strong></td><td>The game's own ink widgets and named styles (redscript, needs Codeware)</td><td>Primary status surface while the game shows its HUD, and inside photo mode's menu</td><td>Answer keys; clicks inside photo mode's menu</td><td>The game: its plate, its red edge, its type. No light variant</td></tr>
        <tr><td><strong>XF ImGui overlay panel</strong> (in code and in session notes: the XF box)</td><td>Dear ImGui through the bridge's own overlay host (native)</td><td>When the HUD is hidden (menus, photo mode's fallback) and for XF tools. Never on a loading or press-any-key screen</td><td>None today</td><td>XF: the Studio's tokens, the XF brand, a plate over the game</td></tr>
        <tr><td><strong>CET</strong>: the XF Runtime Bridge window, and the CET line</td><td>Cyber Engine Tweaks' ImGui and its font (Lua)</td><td>The window only while CET's overlay is open: interaction and diagnostics. The line is the fallback status, drawn only when neither of the other two can be</td><td>The window: yes. The line: none</td><td>XF, in CET's font, scaled by role</td></tr></tbody></table>
        <p class="ig-caption" style="margin-top:var(--sp-5)">Which one shows</p>
        <p class="muted small" style="margin:0">The plugin chooses (<code>ChooseStatusSurface</code>): the ink panel while it is on screen, else the overlay panel, else the CET line, else none. The CET window is not a status surface. Nothing in this section adds a second one.</p>`,
      what: "The three surfaces and the one rule that governs them: one status surface at a time, chosen by the plugin, never by the look of a surface. The names are fixed in the UI, in documents and in code comments.",
      when: "Whenever a surface is added or changed: say which of the three it is. Status is always the same sentence on every surface (the plugin's own wording); only its dress differs.",
      avoid: "A fourth surface; two surfaces showing status together; a surface that decides for itself whether it shows; wording that differs between surfaces." }),

    pattern({ id: "ig-tokens", title: "In-game token table", status: "rule", wide: true,
      specimen: `<div class="stack-s"><p class="ig-caption">Colours: ${colours.length} slots, dark then light, resolved from studio.css</p>
        <div style="overflow:auto;max-height:520px"><table class="ref-table ig-table"><thead><tr><th>Slot</th><th>Studio token</th><th>Dark</th><th>Light</th><th>Where it shows</th><th></th></tr></thead><tbody>${colourRows}</tbody></table></div>
        <p class="ig-caption">Metrics: ${metrics.length}, the Studio's pixels at 1x (the host scales them by the back buffer's height over 1080; CET by its font size over 13)</p>
        <div style="overflow:auto;max-height:420px"><table class="ref-table ig-table"><thead><tr><th>Metric</th><th>Studio token</th><th>Value</th><th>Where it applies</th><th></th></tr></thead><tbody>${metricRows}</tbody></table></div>
        <p class="ig-caption">Numbers read from a Studio rule</p>
        <table class="ref-table ig-table"><thead><tr><th>Name</th><th>Rule</th><th>Value</th><th>Where it applies</th></tr></thead><tbody>${ruleRows}</tbody></table>
        <p class="ig-caption">Contrast of what the surfaces draw, from those resolved colours (the plate laid over the app background)</p>
        <div style="overflow:auto;max-height:420px"><table class="ref-table ig-table"><thead><tr><th>Use</th><th>Pair</th><th>Minimum</th><th>Light</th><th>Dark</th></tr></thead><tbody>${contrast}</tbody></table></div></div>`,
      what: `One table, ${code("in-game-theme.ts")}, in which every ImGui colour slot and every metric names a Studio token and nothing else: no colour is written twice, and light and dark come from the token's own light-dark(). It maps every slot the pinned Dear ImGui has, so no widget ever shows ImGui's blue; names an older ImGui (CET's) lacks are skipped by both consumers. The bridge's generator (${code("tools/overlay/theme.ts")}) is to read this file for its mapping, and a test in the Studio checks the table against studio.css and against what the generator writes today.`,
      when: "Any in-game colour, size or space. A surface pushes a slot by name; it never carries a hex value or a pixel literal of its own.",
      combine: `Spacing and sizes in this section follow ${space}. A component's colours are recipes of slots, given in the component entry (a primary button is ${code("XfAccent")}, ${code("XfAccentHover")}, ${code("XfAccentInk")} and ${code("XfAccentEdge")}).`,
      adapt: "The host scales every metric by the back buffer's height over 1080 and the player's overlay scale; the CET window and line scale by CET's font size over 13, as the existing theme already does. Light is chosen in config.ini and never switched automatically; the ink panel has no light variant.",
      drives: `${code("studio.css")} :root, resolved by ${code("in-game-resolve.ts")}; the generator writes ${code("ThemeTable.inc")} (host) and ${code("theme.lua")} (CET). ${code("tests/in-game-theme.test.ts")} fails when a token is missing, a slot the generator writes is not here, or a shared slot disagrees.`,
      a11y: "Text and frames meet the contrast minimums above in both themes (a failing pair fails the test). Colour never carries a state alone: every tone also has words, and the dot's ring and fill differ.",
      avoid: "A literal colour or pixel size in a surface; a new Studio token for the game's sake; a colour that exists only in game.",
      rows: [["What changes", `Two slots change token: ${code("Border")} and ${code("CheckMark")}. ${colours.filter(c => meta.get(c.slot)?.added).length} slots and ${IN_GAME_THEME.metrics.filter(m => m.added).length} metrics are new, all aliases of existing tokens; none is a new Studio token. Why, where it is not "so no slot keeps an ImGui default":<ul class="principles">${reasons}</ul>`]] }),

    pattern({ id: "ig-type", title: "In-game type hierarchy", status: "rule", wide: true,
      specimen: `<div class="ig"><div class="ig-win" style="width:auto"><table class="ref-table ig-table" style="background:transparent"><thead><tr><th>Role</th><th>Specimen</th><th>Face</th><th>Size</th><th>CET scale</th><th>Use</th></tr></thead><tbody>${typeRows}</tbody></table></div></div>`,
      what: "Five roles, sizes taken from the Studio's scale. The host bakes one font per role (the Studio's UI face, Segoe UI Variable, the display face Bahnschrift and Cascadia Mono), CET, which has one font, multiplies it by the role's size over the body size. Body text stays exactly as it is: the XF box's 13 px matches other CET windows, and CET's own size is whatever the player set.",
      when: "Every piece of text on the overlay panel, the CET window and the CET line.",
      adapt: `Overlay: baked once with every glyph for the back buffer's height and rebuilt on resize (the host already does this for two fonts; it becomes five). CET: ${code("SetWindowFontScale")} before the role's text and back to 1 after it, factors kept between ${CET_SCALE_RANGE[0]} and ${CET_SCALE_RANGE[1]} so a bitmap font stays crisp. CET has no display or mono face: the title there is the body font larger and eyebrows and chips are capitals in the body font, smaller.`,
      drives: `${code("IN_GAME_TYPE")} in the table; ${code("FontSizeXs")}, ${code("FontSizeSmall")}, ${code("FontSize")} and ${code("FontSizeLarge")} for the sizes.`,
      a11y: "Nothing is set below 11 px at 1080p (the Studio's own minimum). Capitals only for labels of a few words.",
      avoid: "A size outside the roles; a weight the face lacks (ImGui does not synthesise bold); capitals for a sentence; changing the body size to make room.",
      rows: [["Tracking", `The Studio tracks capitals (${code(".12em")}); ImGui cannot. The host draws eyebrows and chips glyph by glyph with a ${code("0.1")} em gap through the draw list (short, fixed labels only; ${code("ImDrawListAddText")} per character), and CET does the same where its draw-list calls exist. Where it cannot, capitals are drawn plain.`]] }),

    pattern({ id: "ig-motion", title: "In-game motion: the pulse and the settle", status: "rule", wide: true,
      specimen: `<div class="ig"><div class="ig-win" style="width:auto"><div class="ig-row" style="gap:var(--sp-7)">
        <div class="ig-stack">${status("ok", "Connected: live pulse", true)}${status("write", "Changes allowed: live pulse", true)}</div>
        <div class="ig-stack">${status("paused", "Changes paused: still")}${status("killed", "Stopped: still")}${status("off", "Off: still")}</div>
        <div class="ig-stack"><div class="ig-row">${chip("Read-only", "ok")}<span class="ig-foot">one settle, when it changes</span></div><div class="ig-card ig-settle" style="padding:2px 8px"><span class="ig-label">A value that just changed state</span></div></div>
        <div class="ig-stack" style="width:160px">${bar(0, { indeterminate: true })}<span class="ig-foot">working: one sweep ${resolveRuleValues(css).find(v => v.name === "SweepSeconds")!.value} s</span></div></div></div></div>`,
      what: `Two small motions and nothing else. <strong>The live pulse:</strong> a connected bridge's dot breathes, its alpha following ${code("1 − depth × (0.5 − 0.5 cos(2πt / period))")}, depth ${M.pulseDepth} (alpha 1 down to ${1 - M.pulseDepth}), period ${M.pulsePeriodMs / 1000} s, so it eases in and out and never steps. It changes alpha only: not size, colour or position. It runs while the bridge is connected (the success and the changes-allowed tones) and, on one shared clock so they never beat, on a waiting question's accent edge. <strong>The settle:</strong> when a status chip or tone changes, its fill takes ${code("XfSignalBg")} and fades out over ${M.settleMs} ms, once, at most once per ${M.settleGapMs / 1000} s per element. An indeterminate bar sweeps as the Studio's does (${resolveRuleValues(css).find(v => v.name === "SweepSeconds")!.value} s).`,
      when: "Live state only: something is happening now and the player should feel it is alive. Paused, stopped and off are still, so stillness itself says the bridge has stopped.",
      adapt: `The plugin reads Windows' own setting (animation effects off, ${code("SPI_GETCLIENTAREAANIMATION")}) at start and with each info refresh, honours an ${code("[overlay] motion = auto | reduced | full")} override, and publishes the answer in the info the CET layer already reads. Reduced: the dot is drawn at full alpha, no settle, an indeterminate bar becomes a still 35 % segment with its words. The diagnostics' moving bar is an instrument (one sweep a second so a skipped frame shows) and stays as it is.`,
      drives: `${code("status.tone")} and the waiting question from ${code("XFBridge_Info")}; one clock (${code("ImGui::GetTime")} in the host, ${code("ImGui.GetTime")} in CET) shared by every pulsing element on a surface.`,
      a11y: "Under half a hertz and a 40 % swing: far from the three-flashes-a-second limit. Meaning is never in the pulse: the words say connected, and a still dot loses no information.",
      avoid: "Anything above 0.5 Hz; a pulse on a stopped, paused or error state (a stopped bridge does not breathe); glow, blur or shadows; motion that moves layout or the pointer's target; a pulse on more than the dot and a waiting question's edge; animating over a loading or press-any-key screen (no surface draws there).",
      rows: [["Exception", `The ink panel's answers flash (red and yellow every 0.15 s for 0.9 s, when a key did nothing) is functional but runs at three changes a second. It becomes one hold in the danger colour for 0.45 s and an ease back over 0.25 s.`]] }),

    pattern({ id: "ig-components", title: "In-game components", status: "rule", wide: true,
      specimen: `<div class="ig"><div class="ig-grid">
        ${cell("Heading", `<div class="ig-win">${head("0.8.21")}</div>`)}
        ${cell("Eyebrow and key-value rows", `<div class="ig-win">${eyebrow("Keys")}${kv([["Stop key", `<span class="ig-key">Ctrl+Shift+End</span>`], ["Plugin", "0.8.21", true], ["Requests", "1,204", true]])}</div>`)}
        ${cell("Status line: the five tones", `<div class="ig-win">${status("ok", "XF Studio connected · read-only", true)}${status("write", "XF Studio connected · changes allowed", true)}${status("paused", "XF Studio connected · changes paused")}${status("killed", "The bridge is stopped.")}${status("off", "Waiting for XF Studio…")}</div>`)}
        ${cell("Status chips", `<div class="ig-win"><div class="ig-row">${chip("Read-only", "ok")}${chip("Changes allowed", "warning")}${chip("Paused", "warning", { hollow: true })}${chip("Stopped", "danger")}${chip("test", "info")}${chip("Off")}</div></div>`)}
        ${cell("Value bars", `<div class="ig-win">${bar(38)}${bar(62, { label: "0.31 ms of 1 ms" })}${bar(84, { label: "0.84 ms of 1 ms", tone: "warning" })}${bar(97, { label: "0.97 ms of 1 ms", tone: "danger" })}${bar(0, { indeterminate: true })}</div>`)}
        ${cell("Child panels (cards)", `<div class="ig-win">${card(`${eyebrow("Diagnostics", true)}<div class="ig-label">A plain card: ChildBg, a soft edge.</div>`)}${card(`<div class="ig-label">A note: a tone edge on a tone wash.</div>`, "warning")}${card(`<div class="ig-label">An info note.</div>`, "signal")}</div>`)}
        ${cell("Buttons", `<div class="ig-win"><div class="ig-row">${btn("Mark this moment")}${btn("Mark", "", "hover")}${btn("Mark", "", "active")}${btn("Mark", "", "focus")}${btn("Mark", "", "disabled")}</div><div class="ig-row">${btn("Answer", "primary")}${btn("Answer", "primary", "hover")}${btn("Answer", "primary", "disabled")}${btn("Change…", "quiet")}${btn("Pause changes", "on")}</div><div class="ig-row">${btn("Stop the bridge", "danger")}${btn("Stop the bridge", "danger", "hover")}${btn("Stop the bridge", "danger", "disabled")}</div></div>`)}
        ${cell("Keycap and fields", `<div class="ig-win"><div class="ig-row"><span class="ig-key">F11</span><span class="ig-key">Ctrl+Shift+End</span></div><div class="ig-input multi"><span class="ig-placeholder">Comment for XF Studio</span></div><div class="ig-input">A text box with a value</div></div>`)}
        ${cell("Question card, waiting then answered", `<div class="ig-win">${question("waiting")}${question("answered")}</div>`)}
        ${cell("Tooltips", `<div class="ig-win">${tipSpan("Ctrl+Enter sends")}${tipSpan("Saves are held: a test change would go into them.", "warning")}</div>`)}
      </div></div>
      <div style="margin-top:var(--sp-6);overflow:auto"><table class="ref-table ig-table"><thead><tr><th>Component</th><th>Anatomy</th><th>States</th><th>Spacing</th><th>Use it</th></tr></thead><tbody>
        <tr><td>Heading</td><td>Brand mark (30 × 24, the Studio's chamfer, <code>XfAccent</code> with <code>XfAccentInk</code>), title (title role, <code>XfAccentText</code>), an info chip for where it is drawn or "test", the version at the right in <code>TextDisabled</code></td><td>Text only; the mark never animates</td><td>Gap <code>ItemSpacingX</code>; 24 px row; <code>ItemSpacingY</code> below</td><td>Top of the overlay panel and the CET window. Not on the CET line</td></tr>
        <tr><td>Eyebrow</td><td>A 6 px <code>XfAccentEdge</code> square, then a capitals label in <code>XfTextMuted</code></td><td>One</td><td>Gap 6; <code>SectionGap</code> above a new group, <code>ItemSpacingY</code> below</td><td>Names a group of rows or a card. Replaces the plain "Keys" and "Comment for XF Studio" lines</td></tr>
        <tr><td>Status line</td><td>An 8 px dot (fixed, not scaled with the font) then the plugin's sentence in <code>XfTextMuted</code>; the dot in the tone's slot</td><td>Idle (<code>TextDisabled</code>), live (success, changes allowed: pulses), paused (warning ring), stopped (danger), off (<code>TextDisabled</code>); warning and error text take the tone's colour for the sentence too</td><td>Dot centred on the text line, gap <code>ItemSpacingX</code>; wraps with the words hanging under the words</td><td>The first line of every surface. It is the CET line's only content</td></tr>
        <tr><td>Status chip</td><td>20 px high: <code>ChipPaddingX</code>, eyebrow-role capitals in the tone, fill the tone's wash, 1 px border the tone at ${M.chipBorderAlpha} alpha, top-right and bottom-left corners chamfered <code>BevelSmall</code> (the host draws the polygon; CET keeps square corners)</td><td>Neutral, success, warning, danger, info; hollow (no fill) for paused</td><td>Gap <code>ItemInnerSpacingX</code>; never wraps</td><td>A short fact beside a sentence: the mode, where a panel is drawn. The plugin supplies the short label (Read-only, Changes allowed, Paused, Stopped); a chip never abbreviates a sentence</td></tr>
        <tr><td>Key-value row</td><td>Label (label role, <code>XfTextMuted</code>) in a column as wide as the longest label (about 9 em), value (body, or value role for figures and keys) after it</td><td>A value can be empty ("—"), muted, or in a tone</td><td>Row gap <code>ItemSpacingY</code>; column gap <code>ItemSpacingX</code></td><td>Anything with a name and a value: the stop key, version, frames, CPU, modules. Replaces strings like "frames 120   cpu 0.3 ms"</td></tr>
        <tr><td>Value bar</td><td>A track in <code>XfLine</code> (pushed as <code>FrameBg</code>), the fill <code>PlotHistogram</code>, square ends, no border. Thin: <code>BarThin</code>. Labelled: <code>BarLabelled</code> with the figure inside in the value role, the fill drawn at ${IN_GAME_LABELLED_BAR_ALPHA} alpha without an opaque cap, so the figure stays readable across the filled and unfilled track. Meter: the fill is warning past 75 % of its budget and danger past 90 %, with the figure always shown</td><td>Idle (empty track), live (fill), warning, danger, indeterminate (a 35 % segment sweeping), disabled (unknown: empty track and "—")</td><td><code>ItemSpacingY</code> above and below; full width of its card</td><td>A quantity against a limit or a task's progress. A colour change never stands alone: the figure is there</td></tr>
        <tr><td>Child panel (card)</td><td><code>BeginChild</code> with <code>ChildBg</code>, 1 px <code>XfLine</code> border, <code>ChildPaddingX/Y</code>, 2 px radius; optional 2 px left edge in a tone (accent for a question, warning, danger, signal)</td><td>Plain, edged, waiting (the accent edge pulses)</td><td>Cards <code>SectionGap</code> apart; contents <code>ItemSpacingY</code></td><td>A group that belongs together: the question, the keys, the diagnostics. Not for a single line</td></tr>
        <tr><td>Button</td><td>28 px (<code>ControlHeight</code>), <code>FramePaddingX</code>, 1 px <code>Border</code>. Default; primary (<code>XfAccent</code>); quiet (clear, <code>XfLine</code>); danger (clear, danger text and border); on (<code>XfSignalBg</code>, <code>XfSignal</code>)</td><td>Idle, hover, active, focus (<code>NavCursor</code> ring), disabled (<code>DisabledAlpha</code>, and it says why in its tooltip)</td><td>Rows gap <code>ItemSpacingX</code>; the stop button on its own row, <code>SectionGap</code> from the rest</td><td>One primary per window: a waiting question's answers, the one thing asked of the player. Send, Mark and Pause stay default. Compact rows use <code>ControlHeightSmall</code></td></tr>
        <tr><td>Keycap and field</td><td>Keycap: <code>FrameBg</code>, <code>XfLineStrong</code> border, value role. Field: <code>FrameBg</code>, <code>Border</code>, <code>FramePaddingX</code></td><td>Idle, hover (<code>FrameBgHovered</code>), editing (<code>FrameBgActive</code>), focus ring, disabled</td><td>As a button's</td><td>A key being shown or taken; free text</td></tr>
        <tr><td>Question card</td><td>A card edged <code>XfAccentEdge</code>: eyebrow in <code>XfAccentText</code>, the question in body, answers as primary buttons. Answered: the same card, still, the answer in <code>XfTextMuted</code> ("Sent: X. Waiting for the next question.")</td><td>Waiting (edge pulses), answered (still)</td><td>Fixed height across both states, so nothing below it moves and a click never lands on the wrong button</td><td>The pending question, in the CET window; on the overlay panel as a line with its key hint</td></tr>
        <tr><td>Tooltip</td><td><code>PopupBg</code>, <code>Border</code>, a 3 px left edge drawn on the tooltip's window: <code>XfSignal</code> for help, <code>XfWarning</code> for the reason a control is unavailable</td><td>Shown on hover</td><td><code>ChildPaddingX/Y</code></td><td>What a control does, or why it is unavailable. Never the only place a fact lives</td></tr>
        <tr><td>Footer line</td><td>Label role in <code>TextDisabled</code></td><td>One</td><td><code>SectionGap</code> above</td><td>The version, last in a window</td></tr></tbody></table></div>`,
      what: "The parts every in-game surface is built from, with their anatomy, states, spacing and use. Each is a recipe of table slots and metrics; a surface composes them and does not draw its own.",
      when: "Anything drawn on the overlay panel or in the CET window, and the status line on the CET line. The ink panel uses the game's own widgets and none of these.",
      combine: "A window is: heading, status line (and chips), the question card if one is waiting, actions, groups as eyebrow + card, footer. One primary button per window. Cards never nest.",
      adapt: "At the overlay's 360 px or the CET window's 28 em width a row that does not fit wraps whole (the existing rule: an item starts a new row rather than widening the window). Controls keep their height at any scale.",
      drives: `${code("XFBridge_Info")}: ${code("status")} (tone, text, label, connection, changes), the question and its answer, ${code("kill_key")}, ${code("save_lock")}, and for the overlay ${code("PanelData")}. The short chip labels are new fields of ${code("status")}.`,
      a11y: "A control is always a real ImGui item, so the keyboard and the pointer reach it as in any CET window (the overlay panel takes no input today). Disabled controls name their reason in a tooltip.",
      avoid: "A one-off control; a second primary; colour as the only difference between two states; a solid fill under a bar's figure; a card inside a card." }),

    pattern({ id: "ig-overlay", title: "XF ImGui overlay panel", status: "future",
      specimen: `<div class="ig">${scene("bright", `<div class="ig-win">${head()}${status("ok", "XF Studio connected · read-only", true)}<div class="ig-body">Walk to the spot ahead.</div><div class="ig-muted">[F6] Fully visible · [F7] Partly cut off</div></div>
        <div class="ig-win">${head()}${status("write", "XF Studio connected · changes allowed", true)}${card(`${eyebrow("Diagnostics", true)}${kv([["Frames", "48,201", true], ["CPU", "0.31 ms (max 0.9)", true], ["Back buffer", "R10G10B10A2 × 3, 3840 × 2160", true], ["Frame generation", "none"]])}${bar(0.31 * 100, { label: "0.31 ms of 1 ms" })}`)}</div>`)}
        ${scene("dark", `<div class="ig-win">${head()}${status("killed", "The bridge is stopped.")}</div><div class="ig-win">${head()}${status("paused", "XF Studio connected · changes paused")}</div>`)}</div>`,
      what: "The small plate the bridge draws itself when the HUD is hidden, and later the home of XF's own tools. Heading with the brand mark, the status line, the coordinator's message lines, a waiting question as its text and key hint, and, with diagnostics on, a card of key-value rows and a labelled bar.",
      when: "While the plugin names it the status surface (HUD hidden; the ink panel can't draw) or an XF tool needs ImGui. Never over a loading or press-any-key screen.",
      combine: "It never shows at the same time as the ink panel or the CET line. It sits where the ink panel's anchor puts it, clear of the screen's centre, where every framing and capture region sits, and is cleared for a capture. Width 360 px at 1080p.",
      adapt: "Scales by the back buffer's height over 1080. Messages wrap at the panel's width; at most four lines, then the oldest goes. The diagnostics card appears only with [overlay] diagnostics.",
      drives: `${code("PanelData")} through the host's triple buffer (status, tone, lines, ask hint, diagnostics), ${code("ThemeTable.inc")}.`,
      avoid: "Taking input (it stays click-through until an XF tool needs it, and then only inside a tool window); a drop shadow, glow or blur; any colour but the slots; covering the HUD's own elements; pulsing anything but the dot; text under 11 px.",
      rows: [
        ["Tokens", `${code("WindowBg")} plate, ${code("Border")} edge, ${code("ChildBg")} and ${code("XfLine")} cards, the five tone slots for dot and chips, ${code("PlotHistogram")} on ${code("XfLine")} for bars, ${code("XfAccent*")} for the mark and a question's label. Metrics as the table.`],
        ["Type", `Title role for the heading (15 px display, unchanged), body for status and messages (13 px, unchanged: it matches other CET windows), label and value for diagnostics, eyebrow for the card's name and chips. Five baked fonts.`],
        ["Components", "Heading, status line, chip, message lines (body, in the level's colour: info text, ask accent text, warn warning, done success), key-value rows, value bar, one card."],
        ["Motion", "The dot's live pulse and the settle on a change of state. The diagnostics bar keeps its one-second sweep."]] }),

    pattern({ id: "ig-cet-window", title: "CET: the XF Runtime Bridge window", status: "future",
      specimen: `<div class="ig"><div class="ig-scene dark" style="background:var(--bg-app)">
        <div class="ig-win">${head("0.8.21")}${status("write", "XF Studio connected", true)}<div class="ig-row">${chip("Changes allowed", "warning")}<span class="ig-foot">XF test profile</span></div>
          ${question("waiting")}
          <div class="ig-row">${btn("Pause changes")}${btn("Mark this moment")}</div>
          <div class="ig-row">${btn("Stop the bridge", "danger")}<span class="ig-foot">or press Ctrl+Shift+End in the game</span></div>
          ${eyebrow("Comment for XF Studio")}<div class="ig-input multi"><span class="ig-placeholder">Type a note for the session</span></div><div class="ig-row">${btn("Send", "", "disabled")}</div>
          ${eyebrow("Keys")}${card(`<div class="ig-row"><span class="ig-label">Stop key</span><span class="ig-key">Ctrl+Shift+End</span>${btn("Change…")}</div><span class="ig-note ig-muted" style="min-height:2.6em">Press the new key, with Ctrl, Shift or Alt if you like. Esc cancels.</span>`)}
          <div class="ig-foot" style="margin-top:6px">Version 0.8.21</div></div>
        <div class="ig-win">${head("0.8.21")}${status("killed", "The bridge is stopped.")}<div class="ig-row">${chip("Stopped", "danger")}</div>
          <div class="ig-row">${btn("Reconnect", "primary")}</div><div class="ig-note ig-muted">Saving stays locked until you load a save.</div>
          ${eyebrow("Diagnostics")}${card(kv([["Overlay", "drawing", true], ["Frames", "48,201", true], ["CPU", "0.31 ms", true]]) + bar(31, { label: "0.31 ms of 1 ms" }))}
          <div class="ig-foot" style="margin-top:6px">Version 0.8.21</div></div></div></div>`,
      what: "The window the player opens with CET's overlay: the interactive place and the home of diagnostics. Same heading, status line and chips as the overlay panel; then the waiting question, the actions, the comment box, the keys, and a diagnostics card. Everything the window does today stays where it is; this gives it the Studio's dress.",
      when: "Only while CET's overlay is open. It is not a status surface: while it is open the CET line hides and it shows the status itself.",
      combine: "Order: heading, status line and chip, question card, actions (Pause, Mark; the stop button on its own row), then comment, keys and diagnostics each as eyebrow and card, footer. Only a question's answers (and Reconnect once the bridge is stopped) are primary. The window keeps its top-left corner when its height changes, and every button ignores a click for 0.4 s after the content above it changed height (both exist today).",
      adapt: "Auto-sizes to 28 em of CET's font; rows wrap whole. Scales by CET's font size over 13. The question card holds its tallest height until the window reopens.",
      drives: `${code("panel.lua")} and ${code("theme.lua")}: ${code("XFBridge_Info")} state (${code("status")}, ${code("bridge")}, ${code("kill_key")}, ${code("save_lock")}), the question, ${code("overlay.theme")}.`,
      avoid: "Another primary beside a waiting question; hiding a function behind a collapsed card (diagnostics collapse; actions, the question and the stop button never do); a control that moves under the pointer; CET's own font replaced (the bridge never changes the player's CET setup); text that depends on colour alone.",
      rows: [
        ["Tokens", `All the slots: ${code("Button")} family, ${code("FrameBg")} family, ${code("Header")} family for collapsing headers, ${code("NavCursor")}, ${code("XfAccent*")}, tones and washes, ${code("XfLine")}, ${code("XfLineStrong")}. The window's background is fully opaque (it already is).`],
        ["Type", `By scale: title × ${(px("--fs-lg") / md).toFixed(2)}, body × 1, label and value × ${(px("--fs-sm") / md).toFixed(2)}, eyebrow and chips × ${(px("--fs-xs") / md).toFixed(2)} in capitals. ${code("SetWindowFontScale")} around each role's text.`],
        ["Components", "Everything in the component entry: heading, status line, chips, eyebrow, key-value rows, bars (diagnostics), cards, all button variants, keycap, comment field, question card, tooltips, footer."],
        ["Motion", "The dot's live pulse and a waiting question's pulsing edge, on one clock; the settle on a state change; nothing else."]] }),

    pattern({ id: "ig-cet-line", title: "CET: the status line", status: "future",
      specimen: `<div class="ig"><div class="ig-scene bright" style="gap:var(--sp-5)">
        <div class="ig-line"><div class="ig-status">${dot("ok", true)}<span class="ig-muted">XF Runtime Bridge · XF Studio connected · read-only</span></div></div>
        <div class="ig-line"><div class="ig-status">${dot("write", true)}<span class="ig-muted">XF Runtime Bridge · XF Studio connected · changes allowed</span></div><div class="ig-body">Walk to the spot ahead.</div><div class="ig-label">[F6] Fully visible · [F7] Partly cut off, or click an answer in the XF Runtime Bridge window.</div></div>
        <div class="ig-line"><div class="ig-status">${dot("killed")}<span class="ig-muted">XF Runtime Bridge · The bridge is stopped.</span></div><div class="ig-label">XF overlay is off while frame generation is on.</div></div></div></div>`,
      what: "One line at the far top left, the fallback status surface: a dot in the tone and the plugin's sentence in the muted colour; under it the coordinator's message lines and, for a waiting question, how to answer it. It is the status line component and nothing more.",
      when: "Only when neither the ink panel nor the overlay panel can draw (for example while frame generation turns the overlay off), and never while CET's overlay is open.",
      combine: "No heading, chips, cards, bars or buttons: it takes no input and stays small. It wraps at 640 px from the left (unscaled), clear of the screen's centre. Message lines are body text in the level's colour; the answer hint is a label line in the muted colour.",
      adapt: "CET's font and CET's font scale (body × 1, hint × 0.92). The dot is drawn on the foreground draw list in the window's left padding (the existing 0.8.11 route), with the bullet as the fallback.",
      drives: `${code("status.label")} and ${code("status.tone")}, the messages and the answer hint, ${code("overlay.off_for_frame_generation")}.`,
      avoid: "More than the status and its messages; a plate wider than the text needs; a pulse on anything but the dot; sitting over the middle of the screen.",
      rows: [
        ["Tokens", `${code("WindowBg")}, ${code("Border")}, ${code("XfTextMuted")} for the words, the tone slots for the dot, ${code("Text")}, ${code("XfAccentText")}, ${code("XfWarning")} and ${code("XfSuccess")} for message levels. Metrics: ${code("WindowPaddingX/Y")}, ${code("ItemSpacingY")}.`],
        ["Type", "Body for the status and messages, label (× 0.92) for the answer hint. No scale above 1."],
        ["Components", "Status line, message lines, answer hint."],
        ["Motion", "The dot's live pulse while connected; still otherwise."]] }),

    pattern({ id: "ig-ink", title: "Ink panel", status: "implemented",
      specimen: `<div class="ig">${scene("dark", `<div class="ig-ink" data-tone="ok"><span class="under"></span><span class="plate"></span><span class="edge"></span><div class="body"><div class="head"><i class="diamond"></i><span class="t">XF Runtime Bridge</span><span class="tag">test</span></div><div class="s">XF Studio connected · read-only</div><div class="m">Walk to the spot ahead.</div><div class="m done">Saved a mark.</div><div class="answers"><span>[F6] Fully visible</span><span class="hover">[F7] Partly cut off</span></div></div></div>
        <div class="ig-ink" data-tone="write"><span class="under"></span><span class="plate"></span><span class="edge"></span><div class="body"><div class="head"><i class="diamond"></i><span class="t">XF Runtime Bridge</span><span class="tag">test · photo mode</span></div><div class="s">XF Studio connected · changes allowed</div><div class="answers"><span>Answered: Fully visible</span></div></div></div>`)}
        <p class="muted small" style="margin:var(--sp-3) 0 0">Approximation at 1080p: the game's own named styles are the authority; these hexes and the stand-in face are not.</p></div>`,
      what: "The most beautiful surface, because it is the game's own: ink widgets in the game's fonts and named colours, on the game's dark plate with its red edge. It is primary while the HUD shows and inside photo mode's menu. This entry says what it inherits and what the XF design adds to it: nothing visual.",
      when: "While the game shows its HUD, and inside photo mode's menu. When it is on screen, no other surface shows status.",
      combine: "It carries the same sentences as the others. Its tone is the same meaning in the game's colours: ok green, changes allowed or paused yellow, stopped red, off or idle grey; message levels: info blue, ask yellow, warn the game's active red, done green. Position and floors keep clear of the game's own HUD blocks.",
      adapt: "Laid out on the HUD's 3840 × 2160 design canvas and scaled with it (one design unit is half a pixel at 1080p): panel padding 28 / 16, plate = body + 56 × 36, wrap at 980, 4 lines of messages at most. The user's scale (0.5 to 2.5) multiplies all of it. No light variant: the game has none.",
      drives: `${code("XFBridge_Hud()")}'s text frame (${code("XFRuntimeBridgeInk.reds")}); styles bound by name (${code("MainColors.*")} through the game's ${code("main_colors.inkstyle")}).`,
      a11y: "Answer keys work whenever the ink panel holds the question, even with the HUD hidden; in photo mode's menu the answers are clickable and the panel holds photo mode's exit while it does.",
      avoid: "A hex colour or a Studio token (always a named game style); a light variant; a pulse, glow or any motion of its own beyond the answer feedback; drawing over the HUD's own blocks, a dialogue, or a loading or press-any-key screen; an answer flash faster than the one in the motion entry.",
      rows: [
        ["Tokens", `None of the Studio's. The plate is ${code("MainColors.Fullscreen_PrimaryBackgroundDarkest")} at full opacity over a black underlay at 0.88 (so it reads over a bright scene and the minimap); the edge ${code("MainColors.Red")}; title ${code("Red")}; tag ${code("MildRed")}; status and diamond the tone's style; messages ${code("Blue")} (info), ${code("Yellow")} (ask), ${code("ActiveRed")} (warn), ${code("Green")} (done); answers ${code("Yellow")}, ${code("Blue")} under the pointer; hint ${code("Grey")}.`],
        ["Type", `The game's Rajdhani family at design units: title 32 Semi-Bold, capitals; tag 22 Medium, capitals; status 26 Medium; messages 26 Regular; answers 28 Semi-Bold; hint 24 Regular. The hierarchy (32 / 28 / 26 / 24 / 22) is already the game's; it stays.`],
        ["Components", "The plate with its edge, a header (state diamond, title, tag), a status line, message lines, an answer row (one text per answer), a hint line. Nothing the ImGui components add (no chips, bars or cards): a game HUD panel does not have them."],
        ["Motion", "None of its own. The answers' feedback flash becomes one hold and a fade (see the motion entry)."]] }),
  ]);
}
