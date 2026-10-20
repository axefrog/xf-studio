# Recursive TreeView

The library's TreeView accepts arbitrary-depth `nodes` alongside its existing `groups` input. The [live style-guide entry](../../projects/xf-studio/authoring/public/style-guide.html#lib-tree-view) is the design authority. It places the existing Poses specimen beside a recursive specimen with open and closed branches, metadata, swatches, disabled rows and independent selection. The coordinator's UI/UX review is PASS with the numeric count consistency fix applied; feature integration remains with the main track.

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

[The capture tool](../../projects/xf-studio/authoring/tools/tree-view-capture.ts) opens only the self-contained guide at an ephemeral loopback `?verify=1` address. It starts no Studio server and reads no settings, drafts or game assets. Run it under the 2 GB memory guard after checking the machine's 16 GB free-memory floor. It measures row heights, indents, metadata visibility, swatch dimensions, overflow, roving focus and actual browser accessibility ownership, and saves light/dark screenshots at 300/480 px per panel. Pass an optional baseline guide HTML saved before regeneration to capture before views as well. Outputs stay ignored under `build/hair-lab-wip/tree-view/`.

| Check | Result |
| --- | --- |
| Targeted regression suite | 143 passed, 0 failed; 1,625 assertions across 10 files; 3.30 s. Includes component, persistence, Poses, Expressions, guide freshness and architecture boundary checks. |
| Focused TypeScript check | Passed for component exports, both guide sources, new tests/capture tool and both production callers. |
| Repository-wide TypeScript check | Blocked by the existing `src/features/hair-lab/contact.ts:177` typed-array mismatch (`Float32Array<ArrayBufferLike>` versus `Float32Array<ArrayBuffer>`); no errors reported in this change. The coordinator confirms it is fixed on the main Hair Lab branch. That feature file was not edited. |
| Headless Chrome, 300/480 px × light/dark | Four cases passed. Real accessibility hierarchy verified through three levels; 28 px rows; 8/24/40 px left padding; 12 px swatches; narrow metadata visible; one tab stop; no horizontal overflow. Focus is on Coverage layer, selection on Detail layer, hover on closed Back section; its children are absent. |
| Author visual inspection, 17 October 2026 | All four after views inspected beside the Poses reference; all four before views captured from the saved incumbent guide. Final confirmation inspected after replacing internal IDs with readable labels in the specimen's notification line. No clipped labels/counts, row-height changes or ambiguous focus/selection observed in these examples. |
| Mechanical UI detector | One run: nine warnings in unchanged CSS rules outside TreeView (existing side accent borders). No warnings in the changed TreeView or specimen code; established guide tokens retained. |
| Repository hygiene | Private-path check: 0 findings. Link/source-path check: 0 broken links across 348 tracked Markdown files. The three new files also passed explicit privacy and document-link scans; `git diff --check` is clean. |
| Memory | 2 GB guard with 16 GB system floor for every verification step. Free physical memory checked at 21.4–22.1 GiB; measured peaks: focused typecheck 0.5 GB, full typecheck 1.3 GB, targeted tests 0.5 GB, captures 0.7 GB. |

The capture helper uses a throwaway headless profile with GPU disabled. Its local, asset-free guide run also disables Chrome's sandbox because the sandboxed process crashed inside the Windows memory-guard job; no product/browser defaults changed. An initial capture-helper navigation bug reused a same-document URL after moving the specimen; unique case queries now force a fresh guide page. Both issues were in verification setup, and the completed runs above passed. The helper has a 120 s deadline and closes only its own browser and ephemeral server.

The locally installed [Impeccable](https://github.com/pbakaus/impeccable) skill's context pass, craft guidance and one `detect --json` run supported this review. Its generic warnings about existing accent borders do not override the Studio guide's established selection and focus rules. No third-party code or assets were incorporated.

The ignored evidence directory contains `atlas-tree-before-{light,dark}-{300,480}.png`, `atlas-tree-after-{light,dark}-{300,480}.png` and `measurements.json`. The after views show the unchanged grouped reference beside the extension, with collapsed/expanded/hover/focus/selected states together. No game-derived imagery is involved. Screenshot checks do not cover a screen reader session, extremely deep indentation in a very narrow panel, or feature integration. The coordinator's independent UI/UX review is PASS, subject to consistent numeric metadata. The specimen now uses `count` for card totals, sharing the existing grouped count face; all four cases are recaptured and assert matching computed count fonts.

Canonical review peeks are also saved directly under the authoring `build/hair-lab-wip/`: `atlas-12-tree-after-light-300.png`, `atlas-13-tree-after-light-480.png`, `atlas-14-tree-after-dark-300.png` and `atlas-15-tree-after-dark-480.png`. The corresponding before views are numbered 16–19 in the same theme/width order.

The numeric consistency fix was verified with 56 component/TreeView/guide tests (405 assertions, 0 failures; 0.181 s) and all four recaptured browser cases (8.79 s, 0.6 GB peak under the 2 GB guard). All four updated views were visually inspected; nested counts now match the grouped count face at both widths and themes.
