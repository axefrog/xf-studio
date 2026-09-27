/**
 * The Save Explorer panel (research/save/save-editor-design.md phase 1): the player's saves, then one save's node tree with sizes and
 * decode status, a node's contents, an object inspector with names resolved where a source knows them, and a generic mod-data view.
 * Read-only and keyboard-accessible: the tree follows the tree pattern (arrows move, Right and Left open and close, Enter shows a node),
 * everything else is buttons and native disclosure. It acts only through its context's facade; it holds no save bytes.
 */
import { chordsLabel, keyBinding, keyBindingById } from "../../../input-bindings";
import { applyCapability, badge, button, emptyState, note, Segmented } from "../../../studio-ui/controls";
import { h, setAttr, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { InspectField, NodeInspection, ObjectInspection, ObjectRef, TreeRow } from "../explorer";
import type { SaveExplorerFacade } from "../facade";
import type { SaveListing } from "../listing";
import { SAVE_EXPLORER_PANEL_META } from "./contribution";

type Ctx = ModuleViewContext<SaveExplorerFacade>;

const KIND_LABELS: Readonly<Record<SaveListing["kind"], string>> = { manual: "Manual save", quick: "Quick save", auto: "Autosave",
  "point-of-no-return": "Point of no return", "end-game": "End-game save", other: "Save" };
const STATUS_TEXT: Readonly<Record<TreeRow["status"], [string, "success" | "info" | "neutral" | "warning" | "error"]>> = {
  decoded: ["Read", "success"], partial: ["Partly read", "info"], raw: ["Bytes", "neutral"], failed: ["Unreadable", "warning"], checking: ["Checking…", "neutral"] };
const ENCODING_TEXT: Readonly<Record<TreeRow["encoding"], string>> = { package: "Object package (self-describing)", persistency: "World objects (hash-keyed)",
  "type-database": "The save's own type database", container: "Holds child nodes", bespoke: "A layout of its own" };
const NAMED_TEXT: Readonly<Record<NonNullable<InspectField["named"]>, string>> = { save: "named by the save", engine: "named by the game's type list",
  scripts: "named by your installed scripts", package: "named in the save", unnamed: "no name known: shown as its hash" };
const PAGE = 50, OBJECTS_PAGE = 100;
const number = (value: number) => value.toLocaleString();
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(2)} MB`;
const when = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(); };

export function explorerPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  // ---- The saves list ----
  const refresh = button({ label: "Refresh", icon: "refresh", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "saves.refresh" }); } });
  const openFile = button({ label: "Open a save file…", icon: "folder", small: true, variant: "quiet",
    onClick: () => { void ctx.dispatch({ kind: "saves.openFile" }, { success: "Save opened." }); } });
  const listCount = h("span", { class: "count" });
  const listNote = note("", "info");
  const saveList = h("ul", { class: "save-list", "aria-label": "Your saves, newest first" });
  // No saves where XF Studio looked, or no saves folder there: what to do, with Settings › Saves one press away (UI-109).
  const listEmpty = h("div", { class: "save-explorer-empty" });
  const openSettings = () => ctx.openSettings("saves");
  const listView = h("div", { class: "save-explorer-list" },
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, listCount), h("div", { class: "row gap-xs" }, refresh, openFile)),
    listNote, listEmpty, saveList,
    note("Read-only: XF Studio never changes a save here. Script mods' data is shown as the save names it."));

  // ---- One open save ----
  const back = button({ label: "All saves", icon: "chevronLeft", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "saves.close" }); } });
  const title = h("h3", { class: "save-title" }), facts = h("p", { class: "note muted save-facts" }), namesNote = note("", "info");
  const tabs = new Segmented<"nodes" | "mods">({ label: "Show", options: [{ value: "nodes", label: "Nodes" }, { value: "mods", label: "Mod data" }],
    onSelect: view => { void ctx.dispatch({ kind: "saves.setView", view }, { quiet: true }); }, compact: true, showLabel: false });
  const tree = h("ul", { class: "save-tree", role: "tree", "aria-label": "Nodes of this save" });
  const nodePane = h("div", { class: "save-node", "aria-live": "off" });
  const objectPane = h("div", { class: "save-object" });
  const modsPane = h("div", { class: "save-mods" });
  const treeHelp = note(`${chordsLabel(keyBindingById("rows.focus"))} move, ${chordsLabel(keyBindingById("rows.expand"))} open and close, Enter shows the node.`);
  const nodesView = h("div", { class: "save-explorer-body" }, h("div", { class: "save-tree-pane" }, tree, treeHelp), h("div", { class: "save-inspect-pane" }, nodePane, objectPane));
  const loading = h("p", { class: "note info", role: "status" });
  const failed = h("div", {});
  const openView = h("div", { class: "save-explorer-open" }, h("div", { class: "list-head" }, back, tabs.element), title, facts, namesNote, loading, failed, nodesView, modsPane);
  const element = h("div", { class: "panel-content save-explorer" }, listView, openView);

  // Presentation-only state: which containers are open, the focused tree row, pages and filters.
  const expanded = new Set<number>();
  let focusId: number | null = null, entryOffset = 0, entryFilter = "", objectsShown = OBJECTS_PAGE, typeFilter = "";
  let listKey = "", treeKey = "", nodeKey = "", objectKey = "", modsKey = "", lastNode: number | null = null, lastSource = "";
  // The tree read once per revision (a large save has thousands of nodes).
  let rowsCache: { revision: number; rows: readonly TreeRow[] } = { revision: -1, rows: [] };
  const treeRows = (revision: number) => { if (rowsCache.revision !== revision) rowsCache = { revision, rows: facade.tree() }; return rowsCache.rows; };

  const select = (node: number) => { void ctx.dispatch({ kind: "saves.selectNode", node }, { quiet: true }); };
  const inspect = (ref: ObjectRef | null) => { void ctx.dispatch({ kind: "saves.inspect", ref }, { quiet: true }); };

  // ---- The tree ----
  const visibleRows = (rows: readonly TreeRow[]) => {
    const out: TreeRow[] = [], byId = new Map(rows.map(row => [row.id, row]));
    const visit = (row: TreeRow) => { out.push(row); if (expanded.has(row.id)) for (const child of row.children) { const next = byId.get(child); if (next) visit(next); } };
    for (const row of rows) if (row.parent === null) visit(row);
    return out;
  };
  const renderTree = (rows: readonly TreeRow[], selected: number | null) => {
    const shown = visibleRows(rows);
    if (focusId === null || !shown.some(row => row.id === focusId)) focusId = selected !== null && shown.some(row => row.id === selected) ? selected : shown[0]?.id ?? null;
    const hadFocus = tree.contains(document.activeElement);
    tree.replaceChildren(...shown.map(row => {
      const [statusText, tone] = STATUS_TEXT[row.status];
      const item = h("li", { class: "save-tree-row", role: "treeitem", "aria-level": row.depth + 1, "aria-selected": row.id === selected ? "true" : "false",
        "data-node": row.id, tabindex: row.id === focusId ? 0 : -1, title: row.detail },
        h("span", { class: "save-tree-indent", style: `--depth:${row.depth}` }),
        h("span", { class: "save-tree-twisty", "aria-hidden": "true", text: row.children.length ? (expanded.has(row.id) ? "▾" : "▸") : "" }),
        h("span", { class: "save-tree-name", text: row.name }),
        h("span", { class: "save-tree-size", text: bytes(row.size) }),
        badge(row.encoding === "container" ? `${number(row.children.length)}` : statusText, row.encoding === "container" ? "neutral" : tone));
      if (row.children.length) setAttr(item, "aria-expanded", expanded.has(row.id) ? "true" : "false");
      item.setAttribute("aria-label", `${row.name}, ${bytes(row.size)}, ${row.encoding === "container" ? `${row.children.length} child nodes` : statusText}`);
      item.addEventListener("click", () => { focusId = row.id; if (row.children.length && row.id === selected) toggle(row.id); select(row.id); });
      return item;
    }));
    if (hadFocus) (tree.querySelector(`[data-node="${focusId}"]`) as HTMLElement | null)?.focus();
  };
  const toggle = (id: number) => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); treeKey = ""; ctx.changed(); };
  tree.addEventListener("keydown", event => {
    const rows = treeRows(facade.snapshot().revision), shown = visibleRows(rows), index = shown.findIndex(row => row.id === focusId), row = shown[index];
    if (!row) return;
    const focus = (id: number) => { focusId = id; treeKey = ""; ctx.changed(); requestAnimationFrame(() => (tree.querySelector(`[data-node="${id}"]`) as HTMLElement | null)?.focus()); };
    const binding = keyBinding("rows", event)?.id;
    if (binding === "rows.focus") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      focus(shown[next]!.id);
    } else if (binding === "rows.expand") {
      event.preventDefault();
      if (event.key === "ArrowRight") { if (row.children.length && !expanded.has(row.id)) toggle(row.id); else if (row.children[0] !== undefined && expanded.has(row.id)) focus(row.children[0]!); }
      else if (row.children.length && expanded.has(row.id)) toggle(row.id);
      else if (row.parent !== null) focus(row.parent);
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(row.id); }
  });

  // ---- A node ----
  const factTable = (rows: [string, string][]) => h("dl", { class: "save-facts-table" }, rows.flatMap(([term, value]) => [h("dt", { text: term }), h("dd", { text: value })]));
  const hex = (text: string) => h("pre", { class: "save-hex", tabindex: 0, "aria-label": "Bytes, in hexadecimal" }, text);
  const renderNode = (rows: readonly TreeRow[], inspection: NodeInspection | undefined, row: TreeRow | undefined, selectedObject: ObjectRef | null) => {
    if (!inspection || !row) { nodePane.replaceChildren(emptyState("No node selected", "Choose a node in the tree to see what it holds.")); return; }
    const n = inspection.node;
    const head = [h("h4", { class: "save-node-title", text: n.name }), factTable([["Kind", ENCODING_TEXT[row.encoding]], ["Size", `${bytes(n.size)}${n.children ? ` (${bytes(n.ownBytes)} of its own)` : ""}`],
      ["Where", `offset ${number(n.offset)}, chunk${n.chunks[0] === n.chunks[1] ? ` ${n.chunks[0] + 1}` : `s ${n.chunks[0] + 1}–${n.chunks[1] + 1}`}`], ["Status", row.detail]])];
    const body: (HTMLElement | null)[] = [];
    if (!n.idMatches) body.push(note("This node doesn't start with its own ID, as nodes of a well-formed save do.", "warning"));
    if (inspection.kind === "container") {
      body.push(h("ul", { class: "save-links" }, row.children.slice(0, 500).map(child => {
        const childRow = rows[child];
        return h("li", {}, h("button", { class: "link-button", type: "button", onclick: () => { expanded.add(row.id); focusId = child; select(child); } }, childRow ? `${childRow.name} · ${bytes(childRow.size)}` : `Node ${child}`));
      })), row.children.length > 500 ? note(`${number(row.children.length - 500)} more child nodes are in the tree.`) : null);
    }
    if (inspection.kind === "package") {
      body.push(note(`${number(inspection.objects.length)} objects in a ${inspection.variant} package: ${number(inspection.decoded)} fully read` +
        (inspection.partial ? `, ${number(inspection.partial)} with values kept as bytes` : "") + (inspection.failed ? `, ${number(inspection.failed)} unreadable` : "") +
        (inspection.trailing ? `. ${number(inspection.trailing)} bytes follow the package.` : ".")));
      const list = h("ul", { class: "save-objects", "aria-label": "Objects" }, inspection.objects.slice(0, objectsShown).map(object => h("li", {},
        h("button", { class: `link-button${selectedObject?.kind === "chunk" && selectedObject.node === n.id && selectedObject.index === object.index ? " current" : ""}`, type: "button",
          "aria-current": selectedObject?.kind === "chunk" && selectedObject.node === n.id && selectedObject.index === object.index ? "true" : undefined,
          onclick: () => inspect({ node: n.id, kind: "chunk", index: object.index }) },
          h("span", { text: `#${object.index} ${object.type}` }), object.status === "decoded" ? null : badge(object.status === "partial" ? "Partly read" : "Unreadable", object.status === "partial" ? "info" : "warning")))));
      body.push(list);
      if (inspection.objects.length > objectsShown) body.push(button({ label: `Show ${number(Math.min(OBJECTS_PAGE, inspection.objects.length - objectsShown))} more`, small: true, variant: "quiet",
        onClick: () => { objectsShown += OBJECTS_PAGE; nodeKey = ""; ctx.changed(); } }));
    }
    if (inspection.kind === "persistency") {
      body.push(note(`${number(inspection.filled)} world objects (of ${number(inspection.entries)} slots); ${number(inspection.walked)} read completely. ` +
        "An object that isn't read completely is kept exactly as the game wrote it."));
      if (inspection.notWalked.length) body.push(h("ul", { class: "save-reasons" }, inspection.notWalked.slice(0, 6).map(reason => h("li", { text: `${number(reason.count)}: ${reason.reason}` }))));
      const filter = h("input", { type: "search", class: "field", placeholder: "Filter by class, e.g. Door", value: entryFilter, "aria-label": "Filter world objects by class" });
      filter.addEventListener("change", () => { entryFilter = filter.value; entryOffset = 0; nodeKey = ""; ctx.changed(); });
      const page = facade.entries(entryOffset, PAGE, entryFilter);
      const prev = button({ label: "Previous", icon: "chevronLeft", small: true, variant: "quiet", onClick: () => { entryOffset = Math.max(0, entryOffset - PAGE); nodeKey = ""; ctx.changed(); } });
      const next = button({ label: "Next", icon: "chevronRight", small: true, variant: "quiet", onClick: () => { entryOffset += PAGE; nodeKey = ""; ctx.changed(); } });
      applyCapability(prev, page.offset > 0 ? { available: true } : { available: false, reason: "This is the first page." });
      applyCapability(next, page.offset + page.rows.length < page.total ? { available: true } : { available: false, reason: "This is the last page." });
      body.push(h("div", { class: "row gap-xs save-pager" }, filter, prev, next,
        h("span", { class: "muted small", text: page.total ? `${number(page.offset + 1)}–${number(page.offset + page.rows.length)} of ${number(page.total)}` : "None match" })));
      body.push(h("ul", { class: "save-objects", "aria-label": "World objects" }, page.rows.map(entry => h("li", {},
        h("button", { class: "link-button", type: "button", onclick: () => inspect({ node: n.id, kind: "entry", index: entry.index }),
          "aria-current": selectedObject?.kind === "entry" && selectedObject.index === entry.index ? "true" : undefined },
          h("span", { text: `${entry.type}` }), h("span", { class: "muted small", text: ` ${entry.id} · ${bytes(entry.size)}` }),
          entry.status === "raw" ? badge("Partly read", "info") : null)))));
      if (inspection.classes.length) body.push(h("details", { class: "save-classes" }, h("summary", { text: `Classes (${number(inspection.classes.length)})` }),
        h("ul", {}, inspection.classes.slice(0, 200).map(item => h("li", {}, h("button", { class: "link-button", type: "button",
          onclick: () => { entryFilter = item.type; entryOffset = 0; nodeKey = ""; ctx.changed(); } }, `${item.type}: ${number(item.count)}`))))));
    }
    if (inspection.kind === "type-database") {
      body.push(note(`Version ${inspection.version}: ${number(inspection.types)} types (${number(inspection.typesNamed)} named) and ${number(inspection.properties)} properties ` +
        `(${number(inspection.propertiesNamed)} named). The save records the schema of the script and world data it holds, mods' types included.`));
      const filter = h("input", { type: "search", class: "field", placeholder: "Filter types", value: typeFilter, "aria-label": "Filter types" });
      filter.addEventListener("change", () => { typeFilter = filter.value; nodeKey = ""; ctx.changed(); });
      const needle = typeFilter.trim().toLowerCase(), rows = inspection.rows.filter(item => !needle || item.name.toLowerCase().includes(needle));
      body.push(filter, h("table", { class: "save-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Type" }), h("th", { text: "Kind" }), h("th", { text: "Size" }))),
        h("tbody", {}, rows.slice(0, 300).map(item => h("tr", {}, h("td", { text: item.name }), h("td", { text: item.kind.replace("-", " ") }), h("td", { text: item.size ? `${item.size} B` : "" }))))),
        rows.length > 300 ? note(`${number(rows.length - 300)} more; filter to find one.`) : null);
    }
    if (inspection.kind === "bespoke" || inspection.kind === "failed") body.push(note(inspection.note, inspection.kind === "failed" ? "warning" : "muted"), hex(inspection.hex));
    nodePane.replaceChildren(...head, ...body.filter((item): item is HTMLElement => !!item));
  };

  // ---- An object ----
  const fieldView = (field: InspectField): HTMLElement => {
    const label = [h("span", { class: "save-field-name", text: field.name }),
      field.type ? h("span", { class: "save-field-type", text: field.type }) : null,
      field.named === "unnamed" ? badge("hash", "neutral") : null];
    const value = field.link ? h("button", { class: "link-button", type: "button", onclick: () => inspect(field.link!) }, field.value ?? "")
      : field.value !== undefined ? h("span", { class: `save-field-value${field.opaque ? " muted" : ""}`, text: field.value }) : null;
    const describe = field.named ? NAMED_TEXT[field.named] : undefined;
    if (field.children?.length || field.more) {
      const details = h("details", { class: "save-field" }, h("summary", { title: describe }, ...label, value),
        h("ul", {}, (field.children ?? []).map(child => h("li", {}, fieldView(child)))), field.more ? note(`${number(field.more)} more not shown.`) : null);
      return details;
    }
    return h("div", { class: "save-field leaf", title: describe }, ...label, value);
  };
  const renderObject = (inspection: ObjectInspection | undefined) => {
    if (!inspection) { objectPane.replaceChildren(); return; }
    objectPane.replaceChildren(h("div", { class: "list-head" }, h("h4", { class: "save-node-title", text: inspection.title }),
      button({ label: "Close", icon: "close", iconOnly: true, small: true, variant: "quiet", onClick: () => inspect(null) })),
      h("p", { class: "note muted", text: inspection.subtitle }),
      ...inspection.notes.map(text => note(text, "info")),
      inspection.fields.length ? h("div", { class: "save-fields", role: "group", "aria-label": `Fields of ${inspection.title}` }, inspection.fields.map(fieldView))
        : note("No fields are written: every value is at its default."),
      ...(inspection.hex ? [hex(inspection.hex)] : []));
  };

  // ---- Mod data ----
  const renderMods = () => {
    const view = facade.modData();
    if (!view) { modsPane.replaceChildren(); return; }
    const intro = note("Script mods keep their data in the save as ordinary objects. They're listed here by namespace, as the save names them; " +
      "XF Studio doesn't interpret any mod's data.");
    const scripts = view.scriptNames ? null : note("Your installed scripts couldn't be read, so XF Studio can't tell which of these mods are still installed.", "info");
    if (!view.namespaces.length) { modsPane.replaceChildren(intro, emptyState("No mod data", "This save holds no namespaced script data.")); return; }
    modsPane.replaceChildren(intro, ...(scripts ? [scripts] : []), h("div", { class: "save-mod-list" }, view.namespaces.map(group => h("details", { class: "save-mod" },
      h("summary", {}, h("strong", { text: group.namespace }), h("span", { class: "muted small", text: ` ${number(group.classes.length)} class${group.classes.length === 1 ? "" : "es"}` }),
        group.classes.some(item => item.defined === false) ? badge("Not in your installed scripts", "warning") : null),
      h("ul", {}, group.classes.map(item => h("li", {}, h("span", { text: item.type }),
        h("span", { class: "muted small", text: ` ${number(item.objects.length)} object${item.objects.length === 1 ? "" : "s"}` }),
        item.defined === false ? h("span", { class: "muted small", text: " · not defined by your installed scripts" }) : null,
        h("ul", { class: "save-links" }, item.objects.slice(0, 12).map((ref, i) => h("li", {}, h("button", { class: "link-button", type: "button",
          onclick: () => { void ctx.dispatch({ kind: "saves.setView", view: "nodes" }, { quiet: true }).then(() => { select(ref.node); inspect(ref); }); } },
          `Open ${i + 1}`)))))))))));
  };

  // ---- The saves list rows ----
  const renderList = (saves: readonly SaveListing[]) => {
    saveList.replaceChildren(...saves.map(save => {
      const thumb = facade.thumbnail(save.folder);
      const meta = [KIND_LABELS[save.kind], when(save.savedAt), save.gameVersion ? `patch ${save.gameVersion}` : "", save.level !== null ? `level ${save.level}` : "",
        save.lifePath ?? ""].filter(Boolean).join(" · ");
      const main = h("button", { class: "save-row", type: "button", "aria-label": `${save.location ?? save.folder}, ${meta}`,
        onclick: () => { void ctx.dispatch({ kind: "saves.open", folder: save.folder }); } },
        thumb ? h("img", { class: "save-thumb", src: thumb, alt: "", loading: "lazy", width: 96, height: 54 }) : h("span", { class: "save-thumb empty", "aria-hidden": "true" }),
        h("span", { class: "save-row-text" }, h("span", { class: "save-row-title", text: save.location ?? save.folder }),
          h("span", { class: "save-row-meta", text: meta }), h("span", { class: "save-row-folder", text: save.folder })));
      return h("li", {}, main);
    }));
  };

  let refreshed = false;
  return {
    spec: { id: "save-explorer.explorer", ...SAVE_EXPLORER_PANEL_META["save-explorer.explorer"], element,
      // The list is read when the panel is first shown, never at startup.
      visibility: visible => { if (visible && !refreshed) { refreshed = true; void ctx.dispatch({ kind: "saves.refresh" }, { quiet: true }); } } },
    update() {
      const state = facade.snapshot(), open = state.open;
      const isOpen = open.phase !== "none";
      listView.hidden = isOpen; openView.hidden = !isOpen;
      applyCapability(refresh, facade.capability({ kind: "saves.refresh" }));
      applyCapability(openFile, facade.capability({ kind: "saves.openFile" }));
      if (!isOpen) {
        const key = JSON.stringify(state.listing);
        if (key !== listKey) {
          listKey = key;
          const listing = state.listing;
          // A failed try is repeated shortly (the host may be restarting): "Reconnecting…", never a question about XF Studio running.
          setText(listCount, listing.phase === "loading" ? listing.reconnecting ? "Reconnecting…" : "Listing your saves…"
            : listing.phase === "ready" ? `${number(listing.saves.length)} save${listing.saves.length === 1 ? "" : "s"}` : "Your saves");
          const missing = listing.phase === "ready" && !listing.available, none = listing.phase === "ready" && listing.available && !listing.saves.length;
          // A missing folder says why in its empty state; a failed listing says so in the note.
          const noteText = missing ? "" : listing.message ?? "";
          setText(listNote, noteText); listNote.hidden = !noteText;
          const settingsButton = () => button({ label: "Open Settings › Saves", icon: "settings", small: true, onClick: openSettings });
          listEmpty.replaceChildren(...(none ? [emptyState(`No saves found in ${listing.folder?.display ?? "your saves folder"}`,
            "Your Cyberpunk 2077 saves appear here, newest first. Save in the game, then choose Refresh. If your saves are in another folder, choose it in Settings.",
            settingsButton())] : missing ? [emptyState("Saves folder not found", listing.message ?? "Choose the folder your saves are in.", settingsButton())] : []));
          listEmpty.hidden = !(none || missing);
          renderList(listing.saves);
        }
        return;
      }
      const source = open.source?.kind === "listed" ? open.source.folder : open.source?.name ?? "";
      if (source !== lastSource) { lastSource = source; expanded.clear(); focusId = null; entryOffset = 0; entryFilter = ""; typeFilter = ""; objectsShown = OBJECTS_PAGE; }
      const listed = open.source?.kind === "listed" ? state.listing.saves.find(save => save.folder === source) : undefined;
      setText(title, listed?.location ?? source);
      const summary = open.summary;
      setText(facts, summary ? [listed ? KIND_LABELS[listed.kind] : "Save file", `game ${Math.floor(summary.gameVersion / 1000)}.${summary.gameVersion % 1000 / 10}`,
        `save version ${summary.saveVersion}`, `${number(summary.nodes)} nodes`, `${bytes(summary.fileBytes)} (${bytes(summary.expandedBytes)} expanded)`].join(" · ") : "");
      const namesText = summary && (!summary.types.scriptNames ? state.names.message ?? "Names from your installed scripts aren't available, so some names show as hashes." :
        !summary.types.engineNames ? "The game's type list isn't available, so a few native values aren't read." : "");
      setText(namesNote, namesText || ""); namesNote.hidden = !namesText;
      setText(loading, open.phase === "loading" ? "Opening the save…" : open.checking ? "Checking each node…" : ""); loading.hidden = !(open.phase === "loading" || open.checking);
      failed.replaceChildren(...(open.phase === "failed" ? [emptyState("This save couldn't be opened", open.message ?? "", button({ label: "All saves", onClick: () => { void ctx.dispatch({ kind: "saves.close" }); } }))] : []));
      const ready = open.phase === "ready";
      tabs.element.hidden = !ready;
      tabs.update(state.selection.view);
      nodesView.hidden = !ready || state.selection.view !== "nodes";
      modsPane.hidden = !ready || state.selection.view !== "mods";
      if (!ready) return;
      const rows = treeRows(state.revision), selected = state.selection.node;
      const reveal = selected !== lastNode;
      if (selected !== lastNode) { lastNode = selected; entryOffset = 0; objectsShown = OBJECTS_PAGE; typeFilter = ""; if (entryFilter && selected !== null && rows[selected]?.encoding !== "persistency") entryFilter = ""; }
      // Reveal the selected node in the tree (its ancestors open).
      for (let at = selected !== null ? rows[selected]?.parent ?? null : null; at !== null; at = rows[at]?.parent ?? null) expanded.add(at);
      const tKey = JSON.stringify([state.revision, selected, focusId, [...expanded]]);
      if (tKey !== treeKey) { treeKey = tKey; renderTree(rows, selected); }
      // A node chosen elsewhere (Mod data, a child link) scrolls into view in the tree.
      if (reveal && selected !== null) (tree.querySelector(`[data-node="${selected}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
      const nKey = JSON.stringify([state.revision, selected, state.selection.object, entryOffset, entryFilter, objectsShown, typeFilter]);
      if (nKey !== nodeKey) { nodeKey = nKey; renderNode(rows, selected !== null ? facade.node(selected) : undefined, selected !== null ? rows[selected] : undefined, state.selection.object); }
      const oKey = JSON.stringify(state.selection.object);
      if (oKey !== objectKey) { objectKey = oKey; renderObject(state.selection.object ? facade.object(state.selection.object) : undefined); }
      if (state.selection.view === "mods") { const mKey = String(state.revision); if (mKey !== modsKey) { modsKey = mKey; renderMods(); } }
    },
  };
}
