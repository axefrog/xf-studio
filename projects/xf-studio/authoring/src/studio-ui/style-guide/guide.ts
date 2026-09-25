import { PANEL_META } from "../panel-meta";
import { PANEL_IDS } from "../layout-defaults";
import { compositions, futures, states } from "./compositions";
import { components } from "./components";
import { foundations, shell } from "./foundations";
import { i } from "./kit";
import { panelSystem } from "./panels";
import { reference } from "./reference";

/** Page-layout styles for the guide itself; component styles come verbatim from studio.css. */
const guideCss = `
body.guide { overflow: auto; height: auto; }
.guide-top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: var(--sp-5); padding: var(--sp-4) var(--sp-6); background: var(--bg-panel); border-bottom: 1px solid var(--line); }
.guide-top h1 { margin: 0; font: 600 var(--fs-lg)/1 var(--font-display); letter-spacing: .14em; text-transform: uppercase; }
.guide-top .meta { color: var(--text-muted); font-size: var(--fs-sm); }
.guide-controls { margin-left: auto; display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.guide-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--sp-7); padding: var(--sp-6) var(--sp-7) 80px; max-width: 1560px; margin: 0 auto; }
.guide-toc { position: sticky; top: 72px; align-self: start; max-height: calc(100vh - 90px); overflow: auto; font-size: var(--fs-sm); }
.guide-toc ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.guide-toc a { display: block; padding: 4px 8px; color: var(--text-muted); text-decoration: none; border-left: 2px solid transparent; }
.guide-toc a:hover { color: var(--text); background: var(--bg-hover); }
.guide-toc .toc-section > a { color: var(--text); font: 600 var(--fs-xs)/1.6 var(--font-display); letter-spacing: .1em; text-transform: uppercase; margin-top: var(--sp-4); }
.guide-toc .toc-sub a { padding-left: 16px; }
.guide-intro { display: grid; gap: var(--sp-5); margin-bottom: var(--sp-8); }
.guide-intro .lede { font-size: var(--fs-lg); max-width: 78ch; margin: 0; }
.legend { display: flex; flex-wrap: wrap; gap: var(--sp-5); font-size: var(--fs-sm); color: var(--text-muted); }
.guide-section { margin-bottom: 64px; scroll-margin-top: 70px; }
.guide-section-head { display: flex; align-items: baseline; gap: var(--sp-5); border-bottom: 1px solid var(--line); padding-bottom: var(--sp-4); margin-bottom: var(--sp-5); }
.guide-section-head h2 { margin: 0; font: 600 var(--fs-xl)/1.1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; }
.section-number { font: 600 var(--fs-sm)/1 var(--font-mono); color: var(--accent-text); }
.section-intro { max-width: 80ch; color: var(--text-muted); margin: 0 0 var(--sp-6); }
.patterns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-6); }
.pattern { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; padding: var(--sp-5); background: var(--bg-panel); border: 1px solid var(--line); scroll-margin-top: 70px; }
.pattern.wide { grid-column: 1 / -1; }
.pattern-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); }
.pattern-head h3 { margin: 0; font-size: var(--fs-lg); }
.status-tag { font: 600 var(--fs-2xs)/1 var(--font-display); letter-spacing: .1em; text-transform: uppercase; padding: 5px 7px; border: 1px solid var(--line-strong); white-space: nowrap; }
.status-tag.implemented { color: var(--success); border-color: color-mix(in oklab, var(--success) 50%, transparent); background: var(--success-bg); }
.status-tag.future { color: var(--warning); border-color: color-mix(in oklab, var(--warning) 50%, transparent); background: var(--warning-bg); border-style: dashed; }
.status-tag.rule { color: var(--accent-text); border-color: var(--accent-edge); }
.pattern[data-status="future"] { border-style: dashed; }
.specimen { position: relative; padding: var(--sp-5); background: var(--bg-app); border: 1px solid var(--line-soft); overflow: auto; color: var(--text); }
.specimen.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 0; }
.specimen.compare:has(.mock-shell, .token-grid, .icon-grid, .layout-maps, .ref-table) { grid-template-columns: 1fr; }
.specimen .pane { padding: var(--sp-5); background: var(--bg-app); color: var(--text); overflow: auto; min-width: 0; }
.specimen .pane::before { content: attr(data-label); display: block; margin-bottom: var(--sp-4); font: 600 var(--fs-2xs)/1 var(--font-display); letter-spacing: .12em; text-transform: uppercase; color: var(--text-faint); }
.guidance { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: var(--sp-3) var(--sp-5); margin: 0; font-size: var(--fs-sm); }
.guidance dt { color: var(--text-muted); font: 600 var(--fs-2xs)/1.8 var(--font-display); letter-spacing: .1em; text-transform: uppercase; }
.guidance dd { margin: 0; max-width: 90ch; }
.stack-s { display: flex; flex-direction: column; gap: var(--sp-4); }
.align-start { align-items: flex-start; }
.principles { margin: 0; padding-left: 1.3em; display: grid; gap: var(--sp-3); max-width: 90ch; }
.token-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: var(--sp-3); }
.token { display: grid; grid-template-columns: 34px 1fr; grid-template-rows: auto auto; column-gap: var(--sp-4); align-items: center; padding: var(--sp-3); background: var(--bg-panel); border: 1px solid var(--line-soft); }
.token-swatch { grid-row: 1 / 3; width: 34px; height: 34px; background: var(--sample); border: 1px solid var(--line); }
.token small { color: var(--text-muted); font-size: var(--fs-xs); }
.type-specimen p { margin: 0 0 var(--sp-3); }
.t-display { font: 600 var(--fs-xl)/1 var(--font-display); letter-spacing: .14em; }
.t-title { font-size: var(--fs-lg); font-weight: 650; }
.space-scale { display: flex; align-items: flex-end; gap: var(--sp-5); font: var(--fs-xs) var(--font-mono); color: var(--text-muted); }
.space-scale span { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); }
.space-scale i { display: block; width: var(--size); height: var(--size); background: var(--signal); }
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: var(--sp-2); }
.icon-cell { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); background: var(--bg-panel); border: 1px solid var(--line-soft); }
.icon-cell code { font-size: var(--fs-2xs); color: var(--text-muted); }
.demo-focus-ring { outline: 2px solid var(--focus); outline-offset: 2px; }
.dock-tab.demo-focus-ring { outline-offset: -2px; height: 32px; }
.menu-item.demo-focus { background: var(--bg-hover); box-shadow: inset 0 0 0 2px var(--focus); }
.stage-sample { height: 120px; background: var(--stage); position: relative; padding: var(--sp-4); }
.static-menu, .static-popover, .static-toast, .static-palette, .static-sheet { position: static !important; box-shadow: var(--shadow-sm); }
.static-menu { max-width: 340px; }
.static-palette { display: flex; max-width: 520px; margin: 0; }
.static-palette .palette-input { display: flex; align-items: center; }
.static-sheet { display: block; max-width: 460px; }
.demo-header, .demo-status { border: 1px solid var(--line); }
.demo-header { height: var(--header-h); } .demo-status { height: var(--status-h); }
.demo-dock-row { display: flex; gap: var(--sp-4); flex-wrap: wrap; }
.demo-split { max-width: 520px; }
.demo-float-area { position: relative; height: 190px; background: var(--bg-app); }
.demo-float-area .dock-window { pointer-events: auto; }
.snap-demo-static { position: relative; height: 240px; max-width: 520px; }
.snap-demo-static .demo-target { position: absolute; inset: 0; }
.layout-maps { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--sp-6); }
.layout-maps figure { margin: 0; }
.layout-maps figcaption { font-size: var(--fs-sm); color: var(--text-muted); margin-top: var(--sp-3); }
.layout-map { display: grid; gap: 3px; height: 200px; font-size: var(--fs-2xs); }
.layout-map span { display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px; background: var(--bg-panel); border: 1px solid var(--line); color: var(--text-muted); font-family: var(--font-display); letter-spacing: .06em; text-transform: uppercase; }
.layout-map span.stage { background: var(--stage); color: var(--stage-text); border-color: transparent; }
/* Drawn at real window proportions (1600×1000 and 900×900) so the head cells read as portrait. */
.layout-map.wide { width: min(100%, 346px); grid-template-columns: 21fr 37fr 42fr; grid-template-rows: 2fr 3fr; grid-template-areas: "a c d" "b c e"; }
.layout-map.compact { width: min(100%, 216px); grid-template-columns: 38fr 4fr 58fr; grid-template-rows: 56fr 44fr; grid-template-areas: "a b b" "c c d"; }
.handle-legend { width: 100%; max-width: 480px; display: block; }
.toast-demo { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 420px; }
.demo-viewport { height: 170px; }
.demo-uv { height: 170px; margin-top: var(--sp-4); }
.demo-hints { height: auto; min-height: 58px; }
.demo-hints .viewport-bottom { position: static; padding: var(--sp-4); }
.demo-hints-uv { height: auto; min-height: 0; }
.demo-tip-stage { height: auto; min-width: 240px; }
.static-tip { position: static; }
.uv-well { flex: 1; min-height: 60px; margin: var(--sp-3); background: linear-gradient(90deg, transparent 49.8%, #c4ddca44 50%, transparent 50.2%), radial-gradient(60% 50% at 30% 45%, oklch(.5 .08 350 / .7), transparent 70%), radial-gradient(60% 50% at 70% 45%, oklch(.5 .08 350 / .7), transparent 70%), #253132; border: 1px solid var(--line-strong); }
.mock-shell { display: grid; grid-template-rows: var(--header-h) minmax(0, 1fr) auto; height: 420px; border: 1px solid var(--line-strong); background: var(--bg-app); overflow: hidden; }
.mock-shell.compact-mock { max-width: 560px; height: 520px; }
.mock-dock { display: grid; gap: 4px; padding: 4px; min-height: 0; }
.mock-dock.wide-3 { grid-template-columns: 1.25fr 1.6fr 1.25fr; }
.mock-dock.wide-3.portrait-stage { grid-template-columns: 21fr 37fr 42fr; }
.mock-dock.wide-2 { grid-template-columns: 1.2fr 1fr; }
.mock-dock.compact-2 { grid-template-rows: 56fr 44fr; }
.mock-col, .mock-row { display: grid; gap: 4px; min-height: 0; min-width: 0; }
.mock-col { grid-auto-rows: minmax(0, 1fr); }
.mock-row { grid-template-columns: 1fr 1.4fr; }
.mock-row.stage-row { grid-template-columns: 38fr 62fr; }
.mock-stack { display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-4); }
.mock-dock .dock-group { min-height: 0; }
.mock-dock .panel-content { padding: var(--sp-4); gap: var(--sp-4); min-height: 0; }
.mock-stage { min-height: 100%; }
.mock-head { position: absolute; left: 50%; top: 54%; height: 76%; aspect-ratio: .8; translate: -50% -50%; color: oklch(.78 .01 255); }
.mock-head svg { width: 100%; height: 100%; }
.future-mock { border-style: dashed; }
.future-banner { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-5); background: var(--warning-bg); color: var(--warning); font-size: var(--fs-sm); border-bottom: 1px dashed var(--warning); }
.mock-shell.future-mock { grid-template-rows: var(--header-h) auto minmax(0, 1fr); }
.timeline { list-style: none; margin: 0 0 var(--sp-4); padding: 0 0 0 var(--sp-5); border-left: 2px solid var(--line-strong); display: grid; gap: var(--sp-3); font-size: var(--fs-sm); }
.timeline li.current { color: var(--signal); }
.gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-3); }
.gallery figure { margin: 0; padding: var(--sp-2); border: 1px solid var(--line); background: var(--bg-panel); font-size: var(--fs-xs); }
.gallery figure.selected { border-color: var(--signal); }
.gallery .thumb { display: block; aspect-ratio: 1.4; background: radial-gradient(40% 30% at 35% 50%, oklch(.6 .12 var(--hue)), transparent), radial-gradient(40% 30% at 65% 50%, oklch(.6 .12 var(--hue)), transparent), var(--stage); }
.palette-swatches { display: grid; grid-template-columns: repeat(12, 22px); gap: 3px; }
.palette-swatches span { width: 22px; height: 22px; border: 1px solid oklch(0 0 0 / .3); }
.compare-demo { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.compare-demo .viewport-panel { height: 110px; min-height: 0; padding: var(--sp-3); }
.ref-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.ref-table th, .ref-table td { text-align: left; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.contrast-table td.ok { color: var(--success); font-family: var(--font-mono); }
.contrast-table td.fail { color: var(--danger); font-family: var(--font-mono); font-weight: 700; }
.ref-table th { font: 600 var(--fs-2xs)/1.4 var(--font-display); letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
.snap-sandbox, .live-dock { position: relative; height: 360px; background: var(--bg-app); border: 1px solid var(--line); overflow: hidden; touch-action: none; }
.live-dock .dock { position: absolute; inset: 4px; width: auto; height: auto; }
.sandbox-empty { padding: var(--sp-6); color: var(--text-muted); }
.snap-sandbox .sandbox-group { position: absolute; }
.snap-sandbox .sandbox-panel { position: absolute; z-index: 5; box-shadow: var(--shadow); }
.snap-sandbox .sandbox-panel .dock-tabbar-fill { cursor: grab; }
.snap-sandbox .dock-overlay { z-index: 10; }
@media (max-width: 1000px) { .guide-layout { grid-template-columns: minmax(0, 1fr); padding: var(--sp-5); } .guide-layout main { min-width: 0; overflow-x: clip; } .guide-toc { display: none; } .patterns { grid-template-columns: minmax(0, 1fr); } .specimen.compare { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .guide-top { position: static; flex-wrap: wrap; } .guide-top .meta { flex: 1 1 100%; } .guide-controls { width: 100%; margin-left: 0; } .guidance { grid-template-columns: minmax(0, 1fr); } }
`;

export type GuideInput = { css: string; script: string; generated: string };

export function guideDocument(input: GuideInput) {
  const panels = PANEL_IDS.map(id => ({ id, ...PANEL_META[id] }));
  const sections = [foundations(input.css), shell(), panelSystem(), components(), states(), compositions(), futures(), reference(panels)];
  const toc = sections.map(html => {
    const id = /<section class="guide-section" id="([^"]+)"/.exec(html)![1], title = /<h2 id="[^"]+">([^<]+)<\/h2>/.exec(html)![1];
    const items = [...html.matchAll(/<article class="pattern[^"]*" id="([^"]+)"[^>]*>\s*<header class="pattern-head"><h3>([^<]+)<\/h3>/g)];
    return `<li class="toc-section"><a href="#${id}">${title}</a><ol class="toc-sub">${items.map(([, pid, ptitle]) => `<li><a href="#${pid}">${ptitle}</a></li>`).join("")}</ol></li>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>XF Studio · Interface style guide</title>
<!-- Generated by tools/build-style-guide.ts from public/studio.css and src/studio-ui/style-guide/*. Do not edit by hand. -->
<style id="studio-css">
${input.css}
</style>
<style id="guide-css">${guideCss}</style>
</head>
<body class="guide">
<header class="guide-top"><span class="brand-mark" aria-hidden="true">XF</span><h1>Studio interface guide</h1><span class="meta">Authoritative reference · generated ${input.generated}</span>
  <div class="guide-controls" role="group" aria-label="Guide display">
    <div class="segmented" role="group" aria-label="Theme"><button type="button" class="segment" data-theme-choice="system" aria-pressed="true">${i("monitor")}<span>System</span></button><button type="button" class="segment" data-theme-choice="light" aria-pressed="false">${i("sun")}<span>Light</span></button><button type="button" class="segment" data-theme-choice="dark" aria-pressed="false">${i("moon")}<span>Dark</span></button></div>
    <label class="toggle"><input type="checkbox" role="switch" class="switch" id="compare-themes"><span class="switch-track" aria-hidden="true"></span><span class="toggle-label">Light and dark side by side</span></label>
  </div></header>
<div class="guide-layout">
<nav class="guide-toc" aria-label="Contents"><ol>${toc}</ol></nav>
<main>
<div class="guide-intro">
  <p class="lede">XF Studio authors complete eye-makeup presets, keeps them in a local library, previews them on V and builds a private candidate for one in-game selector.
  This guide defines how its interface looks and behaves, and how new work composes from the same parts. Every pattern states what it contains, when it appears,
  how it combines and adapts, and which application action or read-only state drives it.</p>
  <div class="legend"><span class="status-tag implemented">Implemented</span><span>in the Studio today (public/index.html)</span><span class="status-tag future">Future direction · not built</span><span>room left in the design; needs actions and discussion first</span><span class="status-tag rule">Rule</span><span>applies to all work</span></div>
</div>
${sections.join("\n")}
</main></div>
<div class="sr-only" aria-live="polite" id="guide-live"></div>
<script type="module">
${input.script}
</script>
</body>
</html>
`;
}
