import { MAX_FIELDS, type Layer, type WarpField } from "./recipe";
import type { RecipeAction } from "./recipe-actions";
import { bindControlEdit } from "./control-edit-ui";
import type { ReadonlyDeep } from "./read-only";

/** Presentation adapter: recipe edits use the application's existing transaction hooks. */
export function setupFields(elements: {
  list: HTMLElement; add: HTMLButtonElement; remove: HTMLButtonElement; clear: HTMLButtonElement;
  reach: HTMLInputElement; value: HTMLElement; note: HTMLElement;
}, hooks: {
  layer(): ReadonlyDeep<Layer> | undefined; selected(): ReadonlyDeep<WarpField> | undefined;
  select(id: string): void; begin(id: string): void; commit(id: string): void; cancel(id: string): void;
  edit(action: RecipeAction, record?: boolean): void;
}) {
  elements.add.onclick = () => {
    const l = hooks.layer(); if (!l || l.fields.length >= MAX_FIELDS) return;
    hooks.edit({ kind: "field.add", layerId: l.id }, true);
  };
  elements.remove.onclick = () => {
    const l = hooks.layer(), f = hooks.selected(); if (!l || !f) return;
    hooks.edit({ kind: "field.remove", layerId: l.id, fieldId: f.id }, true);
  };
  elements.clear.onclick = () => {
    const l = hooks.layer(), f = hooks.selected(); if (!l || !f || (!f.du && !f.dv)) return;
    hooks.edit({ kind: "field.clear", layerId: l.id, fieldId: f.id }, true);
  };
  bindControlEdit(elements.reach, { begin: () => { if (hooks.selected()) hooks.begin("radius"); },
    commit: () => hooks.commit("radius"), cancel: () => hooks.cancel("radius") });
  elements.reach.oninput = () => {
    const l = hooks.layer(), f = hooks.selected(); if (!l || !f) return;
    hooks.edit({ kind: "field.setReach", layerId: l.id, fieldId: f.id, radius: +elements.reach.value });
  };
  let signature = "";
  return function refresh() {
    const l = hooks.layer(), f = hooks.selected();
    const key = JSON.stringify([l?.id, l?.fields.map(f => f.id)]);
    if (key !== signature) {
      signature = key;
      elements.list.replaceChildren(...(l?.fields ?? []).map((field, i) => {
        const b = document.createElement("button"); b.type = "button";
        b.textContent = `Warp ${i + 1}`;
        b.onclick = () => hooks.select(field.id); return b;
      }));
    }
    Array.from(elements.list.querySelectorAll("button")).forEach((button, i) =>
      button.setAttribute("aria-pressed", String(l?.fields[i]?.id === f?.id)));
    elements.add.disabled = !l || l.fields.length >= MAX_FIELDS;
    elements.remove.disabled = elements.clear.disabled = elements.reach.disabled = !f;
    elements.clear.disabled ||= !f?.du && !f?.dv;
    elements.reach.value = String(f?.radius ?? .03);
    elements.value.textContent = f ? `${(f.radius * 100).toFixed(2)}% UV` : "—";
    elements.note.textContent = f
      ? `Circle: position · square: pull · ring: reach (fades beyond it). ${l!.fields.length} / ${MAX_FIELDS} controls. Pulls blend and add where they overlap.`
      : "No warping. Add a control, then drag its square to pull the makeup.";
  };
}
