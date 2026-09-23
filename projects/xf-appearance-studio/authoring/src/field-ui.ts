import { MAX_FIELDS, clamp, type Layer, type WarpField } from "./recipe";

/** Presentation adapter: recipe edits use the application's existing transaction hooks. */
export function setupFields(elements: {
  list: HTMLElement; add: HTMLButtonElement; remove: HTMLButtonElement; clear: HTMLButtonElement;
  reach: HTMLInputElement; value: HTMLElement; note: HTMLElement;
}, hooks: {
  layer(): Layer | undefined; selected(): WarpField | undefined;
  select(id: string): void; begin(): void; change(): void;
}) {
  elements.add.onclick = () => {
    const l = hooks.layer(); if (!l || l.fields.length >= MAX_FIELDS) return;
    const n = l.points.length, i = l.fields.length;
    const f: WarpField = { id: crypto.randomUUID(),
      u: clamp(l.points.reduce((sum, p) => sum + p.u, 0) / n + .008 * i),
      v: clamp(l.points.reduce((sum, p) => sum + p.v, 0) / n), du: 0, dv: 0, radius: .03 };
    hooks.begin(); l.fields.push(f); hooks.select(f.id); hooks.change();
  };
  elements.remove.onclick = () => {
    const l = hooks.layer(), f = hooks.selected(); if (!l || !f) return;
    const i = l.fields.indexOf(f); if (i < 0) return;
    hooks.begin(); l.fields.splice(i, 1);
    const next = l.fields[Math.min(i, l.fields.length - 1)];
    if (next) hooks.select(next.id);
    hooks.change();
  };
  elements.clear.onclick = () => {
    const f = hooks.selected(); if (!f || (!f.du && !f.dv)) return;
    hooks.begin(); f.du = f.dv = 0; hooks.change();
  };
  elements.reach.addEventListener("pointerdown", () => { if (hooks.selected()) hooks.begin(); });
  elements.reach.addEventListener("keydown", () => { if (hooks.selected()) hooks.begin(); });
  elements.reach.oninput = () => {
    const f = hooks.selected(); if (!f) return;
    f.radius = clamp(+elements.reach.value, .005, .2); hooks.change();
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
