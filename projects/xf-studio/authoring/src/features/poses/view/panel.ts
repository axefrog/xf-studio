/**
 * The Poses panel (pose-library-design.md §6, decisions Q2–Q8): one search field, Stand still and Creator idle, the pose V holds, the
 * game's outfit filter note, and the tree (Favourites, Recent, then the game's categories). One click on a pose poses V; the camera stays
 * where it is, and Frame V frames the posed body. It acts only through its context's facade.
 *
 * The search field and the tree are stand-ins (a native search input and tree-adapter.ts) until the component library's SearchField and
 * TreeView land; the panel composes them through the adapter's small interface.
 */
import { applyCapability, button, emptyState, note } from "../../../studio-ui/controls";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { PoseBadge } from "../types";
import type { PoseLibraryFacade } from "../facade";
import type { PoseGroup, PoseTree } from "../library";
import { POSES_PANEL_META } from "./contribution";
import { PoseTreeAdapter, type TreeGroupData } from "./tree-adapter";

type Ctx = ModuleViewContext<PoseLibraryFacade>;

const BADGES: Readonly<Record<PoseBadge, { text: string; title: string }>> = {
  moves: { text: "Moves", title: "An animated pose: it plays in a loop" },
  holds: { text: "Holds", title: "V holds a weapon or prop here, which XF Studio doesn't draw yet: she poses empty-handed" },
  vehicle: { text: "Vehicle", title: "A pose for a car or bike seat, which XF Studio doesn't draw" },
};
const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
/** Plain words for the garment tags that hid poses. */
const TAG_WORDS: Readonly<Record<string, string>> = { Coat: "a coat", HeadCover: "a head cover", Collar: "a high collar", HelmetFull: "a full helmet" };
const tagWords = (tags: readonly string[]) => tags.map(tag => TAG_WORDS[tag] ?? tag).join(" or ");

export function posesPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  const search = h("input", { class: "field poses-search", type: "search", placeholder: "Search poses, categories and packs", "aria-label": "Search poses" });
  const still = button({ label: "Stand still", icon: "pause", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.clear", to: "still" }); } });
  const idle = button({ label: "Idle", icon: "play", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.clear", to: "idle" }); } });
  const frame = button({ label: "Frame V", icon: "body", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.frame" }, { quiet: true }); } });
  const current = h("p", { class: "note muted poses-current", role: "status" });
  const outfitText = h("span", {});
  const outfitToggle = button({ label: "Show them", small: true, variant: "ghost", onClick: () => {
    void ctx.dispatch({ kind: "pose.showFiltered", shown: !facade.snapshot().showFiltered }, { quiet: true });
  } });
  const outfit = h("p", { class: "note info poses-outfit" }, outfitText, " ", outfitToggle);
  const state = h("div", { class: "poses-state" });
  const count = h("p", { class: "note muted poses-count" });
  const tree = new PoseTreeAdapter({
    label: "Poses by category",
    onToggle: (group, open) => { void ctx.dispatch({ kind: "pose.openGroup", group, open }, { quiet: true }); },
    onActivate: id => { void ctx.dispatch({ kind: "pose.select", id }); },
    onFavourite: (id, on) => { void ctx.dispatch({ kind: "pose.favourite", id, on }, { quiet: true }); },
  });
  const limits = note("Props, weapons and vehicles aren't drawn, so V poses empty-handed. Hair keeps its rest shape, and clothes don't yet make room for the body in strong poses.");
  const element = h("div", { class: "panel-content poses-panel" }, search, h("div", { class: "poses-actions" }, still, idle, frame), current, outfit, state, count, tree.element, limits);
  idle.title = "Play the idle chosen in Motion (the creator's close-up unless you chose another)";

  let query = "", treeKey = "", stateKey = "", lastTree: PoseTree | null = null;
  search.addEventListener("input", () => { query = search.value; ctx.changed(); });
  search.addEventListener("keydown", event => { if (event.key === "ArrowDown") { event.preventDefault(); tree.focusFirst(); } });

  /** The tree's groups as the adapter draws them; while searching every group with a match is open. */
  const groupsOf = (poseTree: PoseTree, currentId: string | null, loading: boolean): TreeGroupData[] => poseTree.groups.map((group: PoseGroup) => ({
    id: group.id, label: group.label, secondary: group.pack,
    rows: group.rows.map(row => ({ id: row.id, label: row.label, secondary: group.kind === "category" ? undefined : row.category || undefined,
      badges: row.badges.map(item => BADGES[item]), disabled: row.unavailable, current: row.id === currentId, loading: row.id === currentId && loading,
      favourite: row.favourite })),
  }));

  return {
    spec: { id: "poses.library", ...POSES_PANEL_META["poses.library"], element },
    update() {
      const snapshot = facade.snapshot(), catalogue = snapshot.catalogue;
      // Stand still, the idle and Frame V say why when they can't act.
      applyCapability(still, facade.capability({ kind: "pose.clear", to: "still" }));
      applyCapability(idle, facade.capability({ kind: "pose.clear", to: "idle" }));
      applyCapability(frame, facade.capability({ kind: "pose.frame" }));
      const held = snapshot.current;
      setText(current, held ? (held.loading ? `Loading ${held.label}…` : `V holds ${held.label}.`)
        : !snapshot.playable.available ? snapshot.playable.reason ?? "" : snapshot.body === "idle" ? "V plays the idle. Choose a pose to hold it." : "V stands still. Choose a pose to hold it.");
      // Catalogue states: one plain line and, where it helps, the one next step.
      const sKey = JSON.stringify([catalogue.phase, catalogue.message]);
      if (sKey !== stateKey) {
        stateKey = sKey;
        state.replaceChildren(...(catalogue.phase === "needs-setup" ? [emptyState("Poses come from your game", catalogue.message,
          button({ label: "Open Game & tools", icon: "settings", onClick: () => ctx.reveal("package", true) }))]
          : catalogue.phase === "failed" ? [emptyState("The poses couldn't be read", catalogue.message,
            button({ label: "Try again", icon: "refresh", onClick: () => { void ctx.dispatch({ kind: "pose.retry" }); } }))]
            : catalogue.phase === "ready" ? [] : [note(catalogue.message, "info")]));
      }
      const poseTree = facade.tree(query);
      const hidden = poseTree.hiddenByOutfit;
      outfit.hidden = !hidden;
      setText(outfitText, snapshot.showFiltered ? `${plural(hidden, "pose")} the game hides while V wears ${tagWords(poseTree.hidingTags)} ${hidden === 1 ? "is" : "are"} shown.`
        : `${plural(hidden, "pose")} ${hidden === 1 ? "is" : "are"} hidden while V wears ${tagWords(poseTree.hidingTags)}, as in the game.`);
      setText(outfitToggle.querySelector("span") ?? outfitToggle, snapshot.showFiltered ? "Hide them" : "Show them");
      count.hidden = catalogue.phase !== "ready";
      setText(count, query.trim() ? `${plural(poseTree.shown, "pose")} match` : `${plural(catalogue.listed, "pose")} in ${plural(catalogue.categories, "category").replace("categorys", "categories")}`);
      const open = new Set(query.trim() ? poseTree.groups.map(group => group.id) : snapshot.preferences.open);
      const tKey = JSON.stringify([catalogue.revision, snapshot.preferences, query, [...open], held, snapshot.showFiltered, hidden]);
      if (tKey !== treeKey || poseTree !== lastTree) { treeKey = tKey; lastTree = poseTree; tree.update(groupsOf(poseTree, held?.id ?? null, !!held?.loading), open); }
    },
  };
}
