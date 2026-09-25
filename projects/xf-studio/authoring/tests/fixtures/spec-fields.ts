/**
 * Observations of input limits and consequences through the presentation port, for the spec-field
 * parity golden (feature-module platform step 5: `units`, `limits` and `consequence` moved from
 * `action-limits.ts` and `action-consequences.ts` into the action specs). Captured before the move by
 * `capture-spec-fields-golden.ts`; `tests/spec-fields.test.ts` compares the code with it.
 */
import type { StudioAction, StudioTarget } from "../../src/studio-application";
import { trustedFixture } from "../studio-presentation-fixture";

type Shell = ReturnType<typeof trustedFixture>["shell"];
/** Every action kind with each of its variants (and without one). */
function kindsAndVariants(shell: Shell): [string, string | undefined][] {
  const descriptors = shell.authoring.actionDescriptors() as Record<string, { variants?: Record<string, unknown> }>;
  return Object.entries(descriptors).flatMap(([kind, descriptor]) =>
    [[kind, undefined] as [string, string | undefined], ...Object.keys(descriptor.variants ?? {}).map(variant => [kind, variant] as [string, string])]);
}
function limits(shell: Shell) {
  const document = shell.snapshot().authoring.document, layer = document.recipe.layers[document.active];
  const targets: StudioTarget[] = [{ kind: "layer", id: layer.id }, { kind: "point", layerId: layer.id, index: 0 },
    { kind: "viewport" }, { kind: "collection" }, { kind: "preset", id: shell.library.view().draft!.selected! }];
  const out: Record<string, unknown> = {};
  for (const target of targets) for (const [kind, variant] of kindsAndVariants(shell)) {
    const value = shell.authoring.limitsFor(target, kind as StudioAction["kind"], variant);
    if (Object.keys(value).length) out[`${target.kind}/${kind}${variant ? `/${variant}` : ""}`] = value;
  }
  return out;
}
function consequences(shell: Shell) {
  const document = shell.snapshot().authoring.document, layer = document.recipe.layers[document.active];
  const preset = shell.library.view().draft!.selected!;
  const actions: StudioAction[] = [
    { kind: "layer.setOpacity", layerId: layer.id, opacity: .5 }, { kind: "point.remove", layerId: layer.id, index: 0 },
    { kind: "field.remove", layerId: layer.id, fieldId: layer.fields[0]?.id ?? "none" }, { kind: "field.add", layerId: layer.id },
    { kind: "layer.edit", command: { kind: "remove", id: layer.id } }, { kind: "layer.edit", command: { kind: "reset", id: layer.id } },
    { kind: "layer.edit", command: { kind: "duplicate", id: layer.id } }, { kind: "layer.edit", command: { kind: "add" } },
    { kind: "layer.select", layerId: layer.id }, { kind: "history.undo" }, { kind: "history.redo" },
    { kind: "history.jumpTo", entryId: "start" }, { kind: "preset.edit", command: { kind: "remove", id: preset } },
    { kind: "preset.edit", command: { kind: "add" } }, { kind: "collection.undoOpen" }, { kind: "camera.front" },
  ];
  const out: Record<string, unknown> = {};
  // Keys name the look by role, not by its random ID.
  for (const action of actions) out[JSON.stringify(action).replace(preset, "<preset>")] = shell.authoring.consequences({ action });
  for (const kind of shell.authoring.fileKinds()) out[`file:${kind}`] = shell.authoring.consequences({ file: { kind } as never });
  for (const kind of ["save", "open", "package"] as const)
    out[`request:${kind}`] = shell.authoring.consequences({ request: kind === "package" ? { kind, action: "build" } : kind === "open" ? { kind, id: "x" } : { kind } });
  return out;
}

/** Limits and consequences in six editor states: the starter look, irregular Glitter densities and flake sizes, point modes, and an Undo history with Redo. */
export function observeSpecFields() {
  const { shell } = trustedFixture();
  const ok = (action: StudioAction) => { const result = shell.authoring.dispatch(action); if (!result.ok) throw Error(`${action.kind}: ${result.message}`); };
  const layerId = () => { const d = shell.snapshot().authoring.document; return d.recipe.layers[d.active].id; };
  const states: Record<string, unknown> = {};
  // The active layer's modes the limits depend on, so the golden shows which branch each state takes.
  const modes = () => { const d = shell.snapshot().authoring.document, layer = d.recipe.layers[d.active];
    return { finish: layer.finish, flakes: layer.flakes ?? null, strength: layer.strength.mode, softness: layer.softness.mode }; };
  const observe = (name: string) => { states[name] = { modes: modes(), limits: limits(shell), consequences: consequences(shell) }; };
  observe("starter");
  ok({ kind: "layer.setFinish", layerId: layerId(), finish: "glitter" });
  ok({ kind: "glitter.selectModel", layerId: layerId(), model: "irregular" });
  observe("irregular-dense");
  ok({ kind: "glitter.setIrregular", layerId: layerId(), key: "radius", value: .0003 });
  observe("irregular-dense-tiny-flakes");
  ok({ kind: "glitter.setIrregular", layerId: layerId(), key: "radius", value: .0005 });
  ok({ kind: "glitter.setIrregular", layerId: layerId(), key: "count", value: 16000 });
  ok({ kind: "glitter.setIrregular", layerId: layerId(), key: "radius", value: .002 });
  observe("irregular-sparse-large-flakes");
  ok({ kind: "pigment.edit", layerId: layerId(), command: { kind: "smooth-strength", enabled: false } });
  ok({ kind: "softness.edit", layerId: layerId(), command: { kind: "variable-softness", enabled: true } });
  observe("point-modes");
  ok({ kind: "history.undo" });
  observe("with-redo");
  return states;
}
