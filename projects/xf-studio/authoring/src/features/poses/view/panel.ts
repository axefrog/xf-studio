/**
 * The Poses panel (pose-library-design.md §6, decisions Q2–Q8): the search field, Stand still, Idle and Frame V, the pose V holds, the
 * game's outfit filter note, and the tree (Favourites, Recent, then the game's categories with the packs that added them). One click on a
 * pose poses V; the camera stays where it is, and Frame V frames the posed body. Composed from the component library (SearchField,
 * TreeView, favouriteToggle); it acts only through its context's facade.
 */
import { keyBinding } from "../../../input-bindings";
import { applyCapability, button, emptyState, favouriteToggle, note, SearchField, TreeView, type TreeGroupData, type TreeRowData } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { PoseBadge } from "../types";
import type { PoseLibraryFacade } from "../facade";
import type { PoseTree } from "../library";
import { POSES_PANEL_META } from "./contribution";

type Ctx = ModuleViewContext<PoseLibraryFacade>;

const BADGES: Readonly<Record<PoseBadge, string>> = { moves: "Moves", holds: "Holds a prop", vehicle: "Vehicle" };
const plural = (count: number, singular: string, many = `${singular}s`) => `${count.toLocaleString()} ${count === 1 ? singular : many}`;
/** Plain words for the garment tags that hid poses. */
const TAG_WORDS: Readonly<Record<string, string>> = { Coat: "a coat", HeadCover: "a head cover", Collar: "a high collar", HelmetFull: "a full helmet", Mask: "a mask" };
const tagWords = (tags: readonly string[]) => tags.map(tag => TAG_WORDS[tag] ?? tag).join(" or ");
/** Letters and digits only, lower case: for telling whether a category's pack name only repeats its label. */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The pack beside a category, unless it only repeats the label ("HEXED" in "HEXED - Pose Pack"): space goes to what tells them apart. */
function packBeside(label: string, pack: string | null): string | undefined {
  if (!pack) return undefined;
  const a = squash(label), b = squash(pack);
  if (a && b && (b.includes(a) || a.includes(b))) return undefined;
  // Every word of the label is in the pack's name ("Climbing Jumping Falling" in "Climbing Jumping and Falling Poses").
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const packWords = new Set(words(pack)), labelWords = words(label);
  return labelWords.length && labelWords.every(word => packWords.has(word)) ? undefined : pack;
}
/** A pose can be in Favourites, Recent and its category at once, and the tree keys items by ID: each row's ID carries its group. */
const SEP = "\u001f";
const rowKey = (group: string, pose: string) => `${group}${SEP}${pose}`;
const poseOf = (key: string) => key.slice(key.indexOf(SEP) + 1);
export function posesPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  let query = "", treeKey = "", stateKey = "", lastTree: PoseTree | null = null;
  const tree = new TreeView({
    label: "Poses by category",
    emptyText: "No poses match. Try other words, or clear the search.",
    onToggle: (group, open) => { void ctx.dispatch({ kind: "pose.openGroup", group, open }, { quiet: true }); },
    onActivate: key => { void ctx.dispatch({ kind: "pose.select", id: poseOf(key) }); },
    // F stars the focused pose (input-bindings.ts `rows.favourite`).
    onKey: (event, item) => {
      if (item.kind !== "row" || keyBinding("rows", event)?.id !== "rows.favourite") return false;
      const id = poseOf(item.id), on = !facade.snapshot().preferences.favourites.some(entry => entry.id === id);
      void ctx.dispatch({ kind: "pose.favourite", id, on }, { quiet: true });
      return true;
    },
    trailing: row => favouriteToggle({ on: !!row.trailingState, what: row.label,
      onToggle: on => { void ctx.dispatch({ kind: "pose.favourite", id: poseOf(row.id), on }, { quiet: true }); } }),
  });
  const search = new SearchField({ label: "Search poses", placeholder: "Search poses, categories and packs", className: "poses-search",
    onFilter: value => { query = value; ctx.changed(); }, onArrowDown: () => tree.focus() });
  const still = button({ label: "Stand still", icon: "pause", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.clear", to: "still" }); } });
  const idle = button({ label: "Idle", icon: "play", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.clear", to: "idle" }); } });
  idle.title = "Play the idle chosen in Motion (the creator's close-up unless you chose another)";
  const frame = button({ label: "Frame V", icon: "body", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "pose.frame" }, { quiet: true }); } });
  const current = h("p", { class: "note muted poses-current", role: "status" });
  const outfitText = h("span", {});
  const outfitToggle = button({ label: "Show them", small: true, variant: "ghost", onClick: () => {
    void ctx.dispatch({ kind: "pose.showFiltered", shown: !facade.snapshot().showFiltered }, { quiet: true });
  } });
  const outfit = h("p", { class: "note info poses-outfit" }, outfitText, " ", outfitToggle);
  const state = h("div", { class: "poses-state" });
  const count = h("p", { class: "note muted poses-count" });
  tree.element.classList.add("poses-tree");
  const limits = note("Props, weapons and vehicles aren't drawn, so V poses empty-handed. Clothes don't yet make room for the body in strong poses.");
  const element = h("div", { class: "panel-content poses-panel" }, search.element, h("div", { class: "poses-actions" }, still, idle, frame), current, outfit, state, count,
    tree.element, limits);

  /** The tree's groups as the library draws them. */
  const groupsOf = (poseTree: PoseTree): TreeGroupData[] => {
    return poseTree.groups.map(group => ({
      id: group.id, label: group.label, secondary: packBeside(group.label, group.pack), count: group.rows.length, highlight: group.matches,
      rows: group.rows.map((row): TreeRowData => ({ id: rowKey(group.id, row.id), label: row.label,
        secondary: group.kind === "category" ? undefined : row.category || undefined, badges: row.badges.map(badge => ({ text: BADGES[badge] })),
        disabled: !!row.unavailable, reason: row.unavailable ?? undefined, highlight: row.matches, trailingState: row.favourite })),
    }));
  };

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
          button({ label: "Open Settings › Game", icon: "settings", onClick: () => ctx.openSettings("game") }))]
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
      setText(count, query ? `${plural(poseTree.shown, "pose")} match` : `${plural(catalogue.listed, "pose")} in ${plural(catalogue.categories, "category", "categories")}`);
      tree.element.hidden = catalogue.phase !== "ready" && !poseTree.groups.length;
      // While searching, every group with a match is open.
      const open = new Set(query ? poseTree.groups.map(group => group.id) : snapshot.preferences.open);
      const tKey = JSON.stringify([catalogue.revision, query, [...open], held, snapshot.showFiltered]);
      if (tKey !== treeKey || poseTree !== lastTree) {
        treeKey = tKey; lastTree = poseTree;
        const shownGroups = groupsOf(poseTree);
        // The current pose is marked where it shows: the first open group that lists it (a collapsed Favourites mustn't hide the mark).
        const holders = held ? shownGroups.filter(group => group.rows.some(row => poseOf(row.id) === held.id)) : [];
        const holder = holders.find(group => open.has(group.id)) ?? holders[0];
        const currentKey = holder && held ? rowKey(holder.id, held.id) : undefined;
        tree.update({ groups: shownGroups, expanded: open, current: currentKey, loading: held?.loading ? `Loading ${held.label}…` : false });
      }
    },
  };
}
