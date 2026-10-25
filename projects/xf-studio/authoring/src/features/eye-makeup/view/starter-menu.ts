import { recordTime, shapeThumbnail, openValuePopover, type MenuItem } from "../../../studio-ui/components";
import type { MenuAnchor } from "../../../studio-ui/menu";
import type { StarterListing } from "../../../app/starters/starter-actions";
import type { StarterView } from "../../../app/starters/shape-starters";
import { curve } from "../../../engines/layered-makeup/recipe";
import { EYE_LANDMARKS, EYE_THUMBNAIL_WINDOW } from "../starters";
import { addLayerFrom, type EyeMakeupViewContext } from "./actions";

/** The faint guides every thumbnail shares: the eye's lash line and crease (so shapes compare). */
const GUIDES = [EYE_LANDMARKS.lashLine, EYE_LANDMARKS.crease].map(line => line.map(([u, v]) => ({ u, v })));
/** A starter's thumbnail: its outline, tessellated from its own points, over the shared guides. */
export function starterThumbnail(view: Pick<StarterView, "shape">): Element {
  const outline = view.shape ? curve(view.shape.points.map(point => structuredClone(point) as typeof point), 10).map(({ u, v }) => ({ u, v })) : [];
  return shapeThumbnail({ outline, guides: GUIDES, window: EYE_THUMBNAIL_WINDOW });
}

const ALREADY = "Already the starter new layers use.";

/**
 * The starters menu's rows (the New tab menu's layout, U3): a section for the feature's own starters, then Yours. Pressing a row adds
 * a layer with that shape; its star makes it the starter new layers and new looks use. Yours also offers Rename and Delete (a
 * tombstone, with Undo). A section with nothing in it is left out: menus are actionable, never informational.
 */
export function starterItems(ctx: EyeMakeupViewContext, listing: StarterListing, invoker: Element): MenuItem[] {
  const own = listing.starters.filter(item => item.owner.kind === "user"), feature = listing.starters.filter(item => item.owner.kind !== "user");
  const savedAt = (item: StarterView) => item.owner.kind === "user" ? item.owner.savedAt : 0;
  const duplicate = (item: StarterView) => own.some(other => other.id !== item.id && other.name === item.name);
  const sameMinute = (item: StarterView) => own.some(other => other.id !== item.id && other.name === item.name && Math.floor(savedAt(other) / 60_000) === Math.floor(savedAt(item) / 60_000));
  const row = (item: StarterView): MenuItem => {
    const apply = addLayerFrom(item.id);
    return { kind: "action", label: item.name, thumbnail: () => starterThumbnail(item),
      capability: item.shape ? ctx.facade.capability(apply) : { available: false, reason: item.unavailable ?? "This starter can't be used here." },
      ...(item.isDefault ? { tag: "Default" } : {}), ...(item.description ? { tip: item.description } : {}),
      ...(item.owner.kind === "user" && duplicate(item) ? { hint: `Saved ${recordTime(savedAt(item), sameMinute(item))}` } : {}),
      run: () => { if (ctx.dispatch(apply)) ctx.feedback.announce(`Layer added from ${item.name}`); },
      secondary: { icon: "star", name: `Use ${item.name} for new layers`, tone: "neutral",
        capability: item.isDefault ? { available: false, reason: ALREADY } : ctx.starters.capability({ kind: "starters.setDefault", starter: item.id }),
        run: () => { if (ctx.platform({ kind: "starters.setDefault", starter: item.id })) ctx.feedback.announce(`${item.name} will start new layers and new looks`); } } };
  };
  const items: MenuItem[] = [];
  if (feature.length) items.push({ kind: "heading", label: listing.label }, ...feature.map(row));
  if (own.length) {
    items.push({ kind: "heading", label: "Yours" }, ...own.map(row));
    const named = (title: string, icon: "rename" | "trash", act: (item: StarterView) => void, capability: (item: StarterView) => { available: boolean; reason?: string }): MenuItem =>
      ({ kind: "submenu", label: title, icon, items: () => own.map(item => ({ kind: "action" as const, label: item.name, thumbnail: () => starterThumbnail(item),
        capability: capability(item), run: () => act(item) })) });
    items.push({ kind: "separator" },
      named("Rename yours", "rename", item => rename(ctx, item, invoker), item => ctx.starters.capability({ kind: "starters.rename", starter: item.id, name: item.name })),
      named("Delete yours", "trash", item => remove(ctx, item), item => ctx.starters.capability({ kind: "starters.delete", starter: item.id })));
  }
  return items;
}

/** Rename an own starter in the value popover (1 to 60 characters). */
function rename(ctx: EyeMakeupViewContext, item: StarterView, anchor: MenuAnchor) {
  const action = (name: string) => ({ kind: "starters.rename" as const, starter: item.id, name });
  openValuePopover({ kind: "text", label: "Name", value: item.name, maxLength: 61 }, anchor, { title: "Rename starter", apply: "Rename",
    validate: value => ctx.starters.capability(action(String(value))), commit: value => { ctx.platform(action(String(value))); } });
}
/** Delete an own starter: a tombstone, with Undo in the notice. */
function remove(ctx: EyeMakeupViewContext, item: StarterView) {
  if (!ctx.platform({ kind: "starters.delete", starter: item.id })) return;
  ctx.feedback.toast("info", "Starters", `“${item.name}” deleted. Use Undo in this notice to bring it back.`,
    [{ label: "Undo", run: () => { ctx.platform({ kind: "starters.restore", starter: item.id }); } }]);
}

/** Save a layer's shape as the person's own starter: its name in the value popover (1 to 60 characters, the layer's name to start). */
export function saveStarter(ctx: EyeMakeupViewContext, layerId: string, anchor: MenuAnchor) {
  const layer = ctx.facade.view().recipe().layers.find(item => item.id === layerId);
  if (!layer) return;
  const action = (name: string) => ({ kind: "starters.save" as const, layerId, name });
  openValuePopover({ kind: "text", label: "Name", value: layer.name.slice(0, 60), maxLength: 61 }, anchor, { title: "Save shape as starter", apply: "Save",
    hint: "Saves this layer's shape, softness and opacity as a starter of yours. Eye makeup's starters stay available.",
    validate: value => ctx.starters.capability(action(String(value))),
    commit: value => { if (ctx.platform(action(String(value)))) ctx.feedback.toast("info", "Starters", `Saved “${String(value).trim()}”. Find it under Add layer, next to the plus.`); } });
}
