/**
 * Browser page for tests/tree-view-geometry.test.ts (bundled there, run in headless Chrome with the real studio.css inlined). It renders
 * the component library's TreeView and records, as plain data in `window.probe`: where the empty message sits in the tree's frame; how
 * many rows are drawn after the tree grows taller with no update or scroll; where the loading status sits once the rows are scrolled;
 * and what has focus after F takes the focused row out of Favourites. The test asserts; this page only measures. Nothing here reads
 * game files.
 */
import { favouriteToggle, TreeView, TREE_ROW_HEIGHT } from "../src/studio-ui/components/tree-view";

/** public/studio.css, inlined by the test (runProbePage's `define`). */
declare const STUDIO_CSS: string;

export type Rect = { top: number; bottom: number; left: number; right: number };
export type TreeProbe = { ok: boolean; failure?: string;
  empty: { frame: Rect; message: Rect; shown: boolean };
  grown: { viewHeight: number; rowsInView: number; drawnInView: number };
  status: { frame: Rect; status: Rect; scrollTop: number };
  focus: { before: string | null; after: string | null } };

const rect = (element: Element): Rect => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Wait (up to a second) for `done`, giving the page frames to deliver its ResizeObserver. */
async function until(done: () => boolean) { for (let i = 0; i < 20 && !done(); i++) await wait(50); }

async function run(): Promise<Omit<TreeProbe, "ok">> {
  const style = document.createElement("style");
  style.textContent = STUDIO_CSS;
  document.head.append(style);
  const host = document.createElement("div");
  host.style.cssText = "position: absolute; left: 0; top: 0; width: 360px;";
  document.body.append(host);
  let favs = new Set(["p1", "p2"]);
  const open = new Set(["fav", "pack"]);
  const toggle = (id: string) => { if (favs.has(id)) favs.delete(id); else favs.add(id); paint(); };
  const groups = () => [{ id: "fav", label: "Favourites", rows: [...favs].map(id => ({ id: `fav\u001f${id}`, label: `Pose ${id}`, trailingState: true })) },
    { id: "pack", label: "Pack", rows: Array.from({ length: 200 }, (_, i) => ({ id: `pack\u001fp${i}`, label: `Pose p${i}`, trailingState: favs.has(`p${i}`) })) }];
  const tree = new TreeView({ label: "Poses", emptyText: "No poses match. Try other words, or clear the search.", onActivate() {}, onToggle() {},
    onKey: (event, item) => { if (event.key === "f" && item.kind === "row") { toggle(item.id.split("\u001f")[1]!); return true; } },
    trailing: row => favouriteToggle({ on: !!row.trailingState, onToggle: () => toggle(row.id.split("\u001f")[1]!) }) });
  const paint = (loading?: string) => tree.update({ groups: groups(), expanded: open, loading });
  tree.element.style.height = "200px";
  host.append(tree.element);
  const scroller = tree.element.querySelector<HTMLElement>('[role="tree"]')!;

  // 1. Empty: the message in the frame's visible area.
  tree.update({ groups: [], expanded: open });
  const message = tree.element.querySelector(".tree-empty")!;
  const empty = { frame: rect(tree.element), message: rect(message), shown: getComputedStyle(message).display !== "none" };

  // 2. Grown from 200 px to 800 px with no update and no scroll: every row in view is drawn.
  paint();
  tree.element.style.height = "800px";
  const drawn = () => [...scroller.querySelectorAll<HTMLElement>(".tree-item")].map(item => Number(/translateY\((\d+)px\)/.exec(item.style.transform)?.[1] ?? -1) / TREE_ROW_HEIGHT);
  const rowsInView = () => Math.ceil(scroller.clientHeight / TREE_ROW_HEIGHT);
  const drawnInView = () => { const set = new Set(drawn()); let n = 0; for (let i = 0; i < rowsInView(); i++) if (set.has(i)) n++; return n; };
  await until(() => drawnInView() >= rowsInView());
  const grown = { viewHeight: scroller.clientHeight, rowsInView: rowsInView(), drawnInView: drawnInView() };

  // 3. Loading, scrolled well down: the status stays in the frame's corner.
  tree.element.style.height = "300px";
  paint("Loading Pose p40…");
  scroller.scrollTop = 1500;
  await wait(100);
  const status = { frame: rect(tree.element), status: rect(tree.element.querySelector(".tree-status")!), scrollTop: scroller.scrollTop };

  // 4. F on a focused Favourites row takes it out of Favourites: focus stays in the tree.
  paint();
  scroller.scrollTop = 0;
  tree.focusItem("fav\u001fp1");
  const before = document.activeElement?.getAttribute("data-id") ?? null;
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  const after = document.activeElement === document.body ? null : document.activeElement?.getAttribute("data-id") ?? null;
  return { empty, grown, status, focus: { before, after } };
}

run().then(result => { (window as unknown as { probe: TreeProbe }).probe = { ok: true, ...result }; },
  error => { (window as unknown as { probe: Partial<TreeProbe> }).probe = { ok: false, failure: String((error as Error)?.stack ?? error) }; });
