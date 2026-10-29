/** Composes existing controls over the generic feature facade. */
import { featureView } from "../../../src/studio-ui/views/feature-view";
import { button } from "../../../src/studio-ui/controls";
import { h, setText } from "../../../src/studio-ui/dom";
import { ID, type Layers } from "./index";

export const VIEW = { owner: ID, primary: "closure-layers.editor", activity: [{ pattern: /^closure\./, label: "Closure layers" }],
  panels: [{ id: "closure-layers.editor", title: "Closure layers", icon: "layers", description: "Test-only layered editor.",
    order: 1, slot: "stack", context: { kind: "look" } }] } as const;
export const BINDING = featureView(VIEW, { panels: { "closure-layers.editor": ctx => {
  const read = () => (ctx.facade.view()?.part as Layers | undefined)?.layers[0]?.value;
  const value = h("output", { "data-closure-value": "" });
  const edit = button({ label: "Increment first layer", onClick: () => {
    const action = { kind: "closure.setValue", id: "first", value: (read() ?? 0) + 1 }; ctx.dispatch(action);
  } });
  const undo = button({ label: "Undo closure edit", onClick: () => ctx.platform({ kind: "history.undo" }) });
  const file = button({ label: "Export closure layers", onClick: () => { void ctx.collection.file({ kind: "recipe.export" }); } });
  const element = h("div", { "data-closure-editor": "" }, value, edit, undo, file);
  return { spec: { id: "closure-layers.editor", title: "Closure layers", icon: "layers", description: "Test-only layered editor.", element },
    update() { setText(value, String(read())); }, dispose() {} };
} } });
