/**
 * Layout defaults as graph fragments (research/authoring/profiles-views-layouts-design.md §4.2): plain data a module contributes or the
 * person saves. Every key is local to the fragment; subjects and looks are slots, never actual subjects or looks, so a new tab fills them
 * from its profile (substitution). Types only: validation, instantiation and substitution are `app/profiles/layout-fragment.ts`.
 *
 * - **The dock** holds both size classes, its panels named by the fragment's panel keys, and a view's panel as `view:<view key>`.
 * - **Nodes** carry their state as the graph stores it (scene state, camera pose, lights with the shown setup, display, tools); a scene
 *   node names the subject and look slots it shows.
 * - **Panels** carry their type, their binding (pins name the fragment's keys) and, for types that keep it, their state.
 */
import type { ViewSlot } from "./view-graph";

export const LAYOUT_FRAGMENT_SCHEMA = "xfs/layout-fragment-1";
/** A dock arrangement in a fragment (`xfs/dock`): both size classes under `state`. */
export type FragmentDock = { readonly format: string; readonly version: number; readonly state: unknown };
/** A panel's binding in a fragment: follow focus, or pinned to one of the fragment's views, scenes, subject slots or look slots. */
export type FragmentBinding =
  | { readonly policy: "follow-focus" }
  | { readonly policy: "pinned"; readonly view?: string; readonly scene?: string; readonly subject?: string; readonly look?: string };
export type FragmentNode = { readonly key: string; readonly slot: ViewSlot; readonly kind?: string; readonly state: Readonly<Record<string, unknown>>;
  readonly subject?: string; readonly look?: string };
export type FragmentView = { readonly key: string; readonly title?: string } & { readonly [S in ViewSlot]: string };
export type FragmentPanel = { readonly key: string; readonly type: string; readonly binding?: FragmentBinding; readonly state?: unknown };
export type LayoutFragment = {
  readonly schema: typeof LAYOUT_FRAGMENT_SCHEMA;
  readonly tab: { readonly name: string; readonly dock: FragmentDock };
  readonly subjects: readonly { readonly key: string; readonly kinds: readonly string[] }[];
  readonly looks: readonly { readonly key: string }[];
  readonly nodes: readonly FragmentNode[];
  readonly views: readonly FragmentView[];
  readonly panels: readonly FragmentPanel[];
};
/**
 * A module's default layout (design §1.1, §4.2): read-only, offered in New tab ▸ under the module, and changed only by a later build.
 * Its ID within the module; a tab made from it names it as `<module>/<id>`.
 */
export type DefaultLayoutContribution = { readonly id: string; readonly name: string; readonly description: string; readonly fragment: LayoutFragment };
