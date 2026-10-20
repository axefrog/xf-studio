/** Isolated style-guide QA. Run under the repository's memory guard; never starts the authoring server or reads settings/assets.
 * bun tools/tree-view-capture.ts [output directory] [baseline guide HTML] [--widths 300,480]
 * The baseline is optional: save public/style-guide.html before regenerating it to capture the previous specimen too.
 * `--widths` sets the panel widths captured (default 300 and 480 px).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { launch, type Session } from "./cdp";

const argv = process.argv.slice(2), widthsAt = argv.indexOf("--widths");
const widths = widthsAt >= 0 ? argv.splice(widthsAt, 2)[1]!.split(",").map(Number) : [300, 480];
if (!widths.length || widths.some(width => !Number.isInteger(width) || width < 200)) throw Error("--widths takes whole panel widths of at least 200 px");
const out = resolve(argv[0] ?? "evidence/screenshots/tree-view");
const current = readFileSync(resolve(import.meta.dir, "../public/style-guide.html"), "utf8");
const baseline = argv[1] ? readFileSync(resolve(argv[1]), "utf8") : undefined;
mkdirSync(out, { recursive: true });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => new Response(
  new URL(request.url).pathname === "/before" ? baseline ?? current : current, { headers: { "content-type": "text/html" } }) });
let page: Session | undefined;
const checks: unknown[] = [];
// The existing CDP driver has no command deadline if Chrome exits mid-command. Bound this verification process as well as memory.
const deadline = setTimeout(() => { console.error("TreeView capture exceeded its 120 second deadline"); process.exit(1); }, 120_000);
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
try {
  console.log("TreeView: starting isolated headless guide");
  page = await launch(`http://127.0.0.1:${server.port}/after?verify=1`, { width: 1100, height: 650, motion: "reduce", args: ["--disable-gpu", "--no-sandbox"] });
  for (const before of baseline ? [true, false] : [false]) for (const theme of ["light", "dark"] as const) for (const width of widths) {
    console.log(`TreeView: ${before ? "before" : "after"}, ${theme}, ${width}px`);
    await page.viewport(width * (before ? 1 : 2) + (before ? 48 : 64), 480);
    await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/${before ? "before" : "after"}?verify=1&case=${theme}-${width}#lib-tree-view` });
    await page.waitFor('!!document.querySelector("#lib-tree-view .tree-item")');
    // Move the actual live guide specimen into a measurement sheet; no mock rows or copied component styles.
    await page.evaluate(`(() => {
      const specimen = document.querySelector('#lib-tree-view .live-specimen');
      const sheet = document.createElement('main'); sheet.style.cssText = 'padding:24px;width:max-content;max-width:none';
      const heading = document.createElement('h2'); heading.className = 'control-label'; heading.textContent = ${JSON.stringify(`${before ? "Before · grouped TreeView" : "TreeView · grouped reference and nested extension"} · ${theme} · ${width} px panels`)};
      sheet.append(heading, specimen); document.body.replaceChildren(sheet); document.body.className = 'guide';
      document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
      const sections = [...specimen.querySelectorAll('[data-tree-example]')];
      if (sections.length) { const row = sections[0].parentElement; row.style.cssText = 'display:flex;align-items:flex-start;gap:16px;flex-wrap:nowrap';
        for (const section of sections) section.style.cssText = 'flex:none;min-width:0;width:${width}px;max-width:none';
      } else { specimen.style.width = '${width}px'; specimen.firstElementChild.style.maxWidth = 'none'; }
      window.scrollTo(0,0);
    })()`);
    if (!before) {
      await page.evaluate('document.querySelector(\'[data-tree-example="recursive"] [data-id="structure"]\').focus()');
      await page.key("ArrowDown"); await page.key("ArrowDown");
      const rect = await page.evaluate<{ x: number; y: number }>('(() => {const r=document.querySelector(\'[data-tree-example="recursive"] [data-id="back"]\').getBoundingClientRect();return {x:r.x+100,y:r.y+14}})()');
      await page.mouse("mouseMoved", rect.x, rect.y);
      const measured = await page.evaluate(`(() => {
        const host = document.querySelector('[data-tree-example="recursive"]');
        const rows = [...host.querySelectorAll('.tree-item')]; const get = id => host.querySelector('[data-id="'+id+'"]');
        const rect = el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
        const focus = document.activeElement;
        return { theme:${JSON.stringify(theme)},width:${width}, frame:rect(host.querySelector('.tree-view')),
          rows:rows.map(el=>({id:el.dataset.id,rect:rect(el),level:el.getAttribute('aria-level'),selected:el.getAttribute('aria-selected')})),
          focus:focus.dataset.id, focusVisible:focus.matches(':focus-visible'), focusOutline:getComputedStyle(focus).outlineWidth,
          hover:host.querySelector('.tree-item:hover')?.dataset.id,
          selected:host.querySelector('[aria-selected="true"]')?.dataset.id,
          closed:get('back').getAttribute('aria-expanded'), childRendered:!!get('back-detail'),
          metadataVisible:getComputedStyle(get('coverage').querySelector('.tree-count')).display!=='none',
          countFontMatches:getComputedStyle(get('coverage').querySelector('.tree-count')).font === getComputedStyle(document.querySelector('[data-tree-example="legacy"] .tree-count')).font,
          swatch:rect(get('coverage').querySelector('.tree-swatch')), overflow:host.scrollWidth>host.clientWidth,
          emptyFocusStops:rows.filter(el=>el.tabIndex===0).length,
          indents:['structure','front','coverage'].map(id=>parseFloat(getComputedStyle(get(id)).paddingLeft)),
        };
      })()`);
      const m = measured as any;
      assert(m.frame.width === width, "Panel width differs from requested width");
      assert(m.rows.every((r: any) => r.rect.height === 28), "Row height changed");
      assert(m.focus === "coverage" && m.focusVisible && m.focusOutline === "2px", "Keyboard focus ring missing");
      assert(m.hover === "back" && m.selected === "detail", "Focus/hover/selection are not independent");
      assert(m.closed === "false" && !m.childRendered, "Closed children were rendered");
      assert(m.countFontMatches, "Recursive numeric metadata differs from the grouped count style");
      assert(m.metadataVisible && m.swatch.width === 12 && m.swatch.height === 12 && !m.overflow && m.emptyFocusStops === 1, "Narrow row metadata, swatch or tab stops regressed");
      assert(JSON.stringify(m.indents) === "[8,24,40]", "Depth indentation differs from the guide");
      const ax = await page.send<any>("Accessibility.getFullAXTree");
      const tree = ax.nodes.find((n: any) => n.role?.value === "tree" && n.name?.value === "Sample structure");
      const items = ax.nodes.filter((n: any) => !n.ignored && n.role?.value === "treeitem");
      const node = (name: string) => items.find((n: any) => n.name?.value.startsWith(name));
      const find = (id: string) => ax.nodes.find((n: any) => n.nodeId === id);
      const parent = (n: any) => find(n.parentId);
      assert(tree && node("Coverage layer") && parent(node("Coverage layer"))?.role?.value === "group", "Child missing its accessible group");
      assert(parent(parent(node("Coverage layer")))?.nodeId === node("Front section")?.nodeId, "Accessible child attached to wrong parent");
      assert(parent(parent(node("Front section")))?.nodeId === node("Structure")?.nodeId, "Three accessible levels were not preserved");
      checks.push({ ...m, accessibleHierarchy: "Structure > group > Front section > group > Coverage layer" });
    }
    await page.screenshot(join(out, `atlas-tree-${before ? "before" : "after"}-${theme}-${width}.png`));
  }
  assert(!page.console.some(entry => entry.type === "exception" || entry.type === "error"), "Guide runtime error");
  writeFileSync(join(out, "measurements.json"), JSON.stringify(checks, null, 2));
  console.log(`TreeView: ${checks.length} theme/width cases passed; captures in ${out}`);
} finally { clearTimeout(deadline); await page?.close(); server.stop(true); }
