# Recursive TreeView

The library's TreeView accepts arbitrary-depth `nodes` alongside its existing `groups` input. The [live style-guide entry](../../projects/xf-studio/authoring/public/style-guide.html#lib-tree-view) is the design authority. It places the existing Poses specimen beside a recursive specimen with open and closed branches, metadata, swatches, disabled rows and independent selection. The component was built, and passed an independent UI/UX review, on the Hair Lab branch; it was ported onto `main` without any Hair Lab code and awaits its own review there. No feature uses recursive nodes yet.

## Integration

Import `TreeView`, `TreeNodeData` and `TreeItemRef` from `studio-ui/components`. Supply a controlled snapshot; no feature-specific code was added to the component or existing callers.

```ts
const controller = new AbortController();
const tree = new TreeView({
  label: "Structure", remember: false, signal: controller.signal,
  onActivate: id => actions.select(id),
  onToggle: (id, open) => actions.expand(id, open),
  onHover: item => actions.inspectHovered(item?.id ?? null),
  onFocus: item => actions.inspectFocused(item.id),
});
// On each owner snapshot:
tree.update({ nodes: snapshot.nodes, expanded: snapshot.expanded, selected: snapshot.selected });
// On withdrawal:
controller.abort();
```

`TreeNodeData` extends the existing row shape: `id`, `label`, optional `secondary`, `swatch` (a CSS colour), `badges`, `disabled`, `reason` and search `highlight` ranges. Its additional fields are:

| Field | Contract |
| --- | --- |
| `children` | Array, or synchronous provider returning children. A closed provider is never called; an open provider runs once per `update`. Providers project existing snapshot data and perform no I/O. Empty arrays are leaves; a provider declares a branch even before it returns children. |
| `selectable` | Defaults to true, including branches. False makes a branch disclosure-only, without selected semantics. |
| `count` | Optional explicit numeric count independent of provider evaluation. Uses the same muted monospace face as grouped counts; reserve `secondary` for descriptive text. |

Node IDs must be stable and globally unique within one recursive tree. Callbacks receive identities, not mutable domain nodes: `{ kind: "node", id, group, parent? }`; `parent` is the immediate parent's ID, and `group` is that ID (or the root's own ID). Legacy callbacks retain `kind: "group" | "row"` and their existing `group` meaning. Keep a domain index outside the component when a highlight needs geometry rather than an ID. Selection of a hidden descendant stays in the owner; the component does not silently select its ancestor.

## Interaction and compatibility

| Input | Recursive nodes | Existing grouped callers |
| --- | --- | --- |
| Label click, Enter | Select, through `onActivate`; disabled nodes never activate | Whole group toggles; leaf activates immediately |
| Space | Select; a disclosure-only branch toggles | Whole group toggles; leaf unchanged |
| Chevron click | Toggle branch without selecting | Whole group toggles |
| Right | Open branch; otherwise enter its first visible child | Same existing behaviour |
| Left | Close branch; otherwise focus parent | Same existing behaviour |
| Up/Down, Home/End | Move focus through visible nodes without selecting | Unchanged |
| Letter | Next matching visible label, wrapping | Existing single-letter type-ahead retained |
| Hover/focus | Notify independently of selection; hover clears on leave, collapse, virtual eviction and cancellation | Same additive callbacks available |

Both production call sites were checked: [Poses](../../projects/xf-studio/authoring/src/features/poses/view/panel.ts) retains immediate pose activation, group toggling, favourite actions and its key override; the [expression drawer](../../projects/xf-studio/authoring/src/features/expressions/view/drawer.ts) retains immediate start-from activation, remembered groups, F2/Delete and menus. Neither file was edited.

Recursive rows use the existing 28 px height, 16 px depth increment, neutral hover, cyan selection and inset 2 px keyboard focus ring. A 12 px decorative swatch supplements the text. Short recursive metadata remains visible at narrow widths; legacy secondary text retains its existing narrow-width hiding rule. Tooltips and accessible names retain the full recursive text. Explicit counts stay separate from secondary text.

The component keeps only viewport rows, overscan, focus and the ancestors needed to describe that hierarchy. `aria-level`, `aria-setsize` and `aria-posinset` describe the complete visible snapshot even when siblings are virtualised. Recursive branches own `role=group` elements that own their rendered direct children; `aria-expanded` appears only on branches and `aria-selected` only on selectable items. This follows the [W3C WAI-ARIA tree view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) (consulted 17 October 2026). The visual rows remain positioned in the same spacer as legacy trees. Collapsing a focused descendant returns focus to the nearest surviving ancestor. Browser accessibility-tree checks supplement DOM attribute tests; they do not replace testing with screen readers.

## Verification and review

The new [behaviour tests](../../projects/xf-studio/authoring/tests/tree-view-nodes.test.ts) cover four levels, lazy provider evaluation, owned hierarchy, independent selection/focus, keyboard traversal, disclosure, disabled rows, hover clearing, cancellation, metadata, uniqueness, bounded rendering over 2,000 children and legacy key/menu/trailing routes. Existing component, persistence, Poses and Expressions tests provide regression coverage.

[The capture tool](../../projects/xf-studio/authoring/tools/tree-view-capture.ts) opens only the self-contained guide at an ephemeral loopback `?verify=1` address. It starts no Studio server and reads no settings, drafts or game assets. Run it under the 2 GB memory guard. It measures row heights, indents, metadata visibility, swatch dimensions, overflow, roving focus and actual browser accessibility ownership, and saves light and dark screenshots per panel width (`--widths`, default 300 and 480 px). Pass an optional baseline guide HTML (for example `main`'s `public/style-guide.html`) to capture before views as well. Outputs stay in the ignored `evidence/screenshots/` tree. The helper uses a throwaway headless profile with the GPU disabled, and disables Chrome's sandbox for this local, asset-free page because the sandboxed process crashed inside the Windows memory-guard job; no product or browser defaults change. It has a 120 s deadline and closes only its own browser and server.

| Check (port onto `main`, 21 October 2026) | Result |
| --- | --- |
| Targeted regression suite | 173 passed, 0 failed across 19 files: TreeView, components, style guide, Poses, Expressions, dock, experiments, browser build and architecture boundary. |
| Headless Chrome, 390/1280 px × light/dark | Four cases passed with the measurements above (28 px rows; 8/24/40 px indents; 12 px swatches; narrow metadata visible; one tab stop; no overflow; three accessible levels). |
| Grouped callers, before and after | The style guide's grouped Poses specimen and the expression drawer's Start from tree (isolated `?verify=1` workspace, 390 and 1280 px floating panels, both themes) render the same before and after; the drawer captures are byte-identical. |

The earlier review on the Hair Lab branch also ran a mechanical UI detector ([Impeccable](https://github.com/pbakaus/impeccable)), whose generic warnings about existing accent borders don't override the Studio guide's selection and focus rules, and found the nested counts needed the grouped count face, which the specimen's `count` now uses. Screenshot checks do not cover a screen reader session, extremely deep indentation in a very narrow panel, or feature integration.
