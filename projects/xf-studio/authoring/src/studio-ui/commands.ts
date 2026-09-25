import { bindingReference } from "../input-bindings";
import { Toggle } from "./controls";
import { h, uid } from "./dom";
import { icon, type IconName } from "./icons";
import type { Capability } from "./menu";

/** A presentation command wraps exactly one application action, file request or layout change. */
export type Command = { id: string; title: string; group: string; icon?: IconName; shortcut?: string; keywords?: string;
  capability(): Capability; run(): void };

/** Palette search: every whitespace-separated term must occur in the title, group or keywords. */
export function matchCommands<T extends Pick<Command, "title" | "group" | "keywords">>(commands: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command => terms.every(term => `${command.title} ${command.group} ${command.keywords ?? ""}`.toLowerCase().includes(term)));
}

/** Keyboard-first command palette. Disabled commands stay listed with their reason. */
export function openPalette(commands: () => Command[], options: { onClose?(): void } = {}) {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const listId = uid("palette-list");
  const input = h("input", { class: "palette-input", type: "text", role: "combobox", "aria-expanded": "true", "aria-controls": listId,
    "aria-autocomplete": "list", placeholder: "Type a command…", spellcheck: "false", "aria-label": "Command" });
  const list = h("ul", { class: "palette-list", role: "listbox", id: listId, "aria-label": "Commands" });
  const dialog = h("dialog", { class: "palette", "aria-label": "Command palette" },
    h("div", { class: "palette-field" }, icon("search"), input, h("kbd", { text: "Esc" })), list,
    h("div", { class: "palette-foot" }, h("span", { text: "↑↓ choose · Enter run · disabled commands explain why" })));
  let items: Command[] = [], active = 0;
  const all = commands();
  const render = () => {
    items = matchCommands(all, input.value);
    active = Math.min(active, Math.max(0, items.length - 1));
    let group = "";
    list.replaceChildren(...items.flatMap((command, index) => {
      const capability = command.capability();
      const nodes: HTMLElement[] = [];
      if (command.group !== group) { group = command.group; nodes.push(h("li", { class: "palette-group", role: "presentation", text: group })); }
      const option = h("li", { class: `palette-item${index === active ? " active" : ""}`, role: "option", id: `${listId}-${index}`,
        "aria-selected": String(index === active), "aria-disabled": capability.available ? undefined : "true" },
        h("span", { class: "menu-icon" }, command.icon ? icon(command.icon) : null),
        h("span", { class: "menu-text" }, h("span", { class: "menu-label", text: command.title }),
          capability.available ? null : h("small", { class: "menu-reason", text: capability.reason ?? "Unavailable" })),
        command.shortcut ? h("kbd", { text: command.shortcut }) : null);
      option.addEventListener("pointermove", () => { if (active !== index) { active = index; render(); } });
      option.addEventListener("click", () => run(index));
      nodes.push(option);
      return nodes;
    }));
    if (!items.length) list.append(h("li", { class: "palette-empty", text: "No matching command." }));
    input.setAttribute("aria-activedescendant", items.length ? `${listId}-${active}` : "");
    list.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  };
  const run = (index: number) => {
    const command = items[index];
    if (!command || !command.capability().available) return;
    close(true);
    command.run();
  };
  const close = (restore = true) => {
    dialog.close(); dialog.remove(); options.onClose?.();
    if (restore && invoker?.isConnected) invoker.focus();
  };
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (event.key === "Enter") { event.preventDefault(); run(active); }
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(true); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(true); });
  document.body.append(dialog);
  dialog.showModal();
  render();
  input.focus();
}

/**
 * Keyboard & mouse reference, generated from the input binding catalogue grouped by context,
 * so it lists exactly what the handlers do. Optionally hosts the viewport-hints preference.
 */
export function openInputReference(options: { hints?: { enabled: boolean; set(enabled: boolean): void } } = {}) {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const sections = bindingReference().map(section => h("section", { class: "reference-section", "aria-labelledby": `reference-${section.id}` },
    h("h3", { id: `reference-${section.id}`, text: section.title }),
    section.detail ? h("p", { class: "muted small", text: section.detail }) : null,
    h("dl", { class: "shortcut-list wide" }, section.rows.flatMap(row => [h("dt", {}, h("kbd", { text: row.input })),
      h("dd", {}, row.label, row.where ? h("span", { class: "reference-where", text: ` · ${row.where}` }) : null)]))));
  const hints = options.hints ? new Toggle({ label: "Show input hints in the viewports", help: "A corner strip and target tooltips that follow the pointer and held keys.",
    onChange: checked => options.hints!.set(checked) }) : undefined;
  hints?.update(options.hints!.enabled);
  const dialog = h("dialog", { class: "sheet reference-sheet", "aria-labelledby": "shortcuts-title" },
    h("div", { class: "sheet-head" }, h("h2", { id: "shortcuts-title", text: "Keyboard & mouse" }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    hints ? h("div", { class: "reference-pref" }, hints.element) : null,
    h("div", { class: "reference-body" }, sections));
  const close = () => { dialog.close(); dialog.remove(); invoker?.focus(); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}
