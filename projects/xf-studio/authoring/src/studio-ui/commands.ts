import { h, uid } from "./dom";
import { icon, type IconName } from "./icons";
import type { Capability } from "./menu";

/** A presentation command wraps exactly one application action, file request or layout change. */
export type Command = { id: string; title: string; group: string; icon?: IconName; shortcut?: string; keywords?: string;
  capability(): Capability; run(): void };

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
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    items = all.filter(command => terms.every(term => `${command.title} ${command.group} ${command.keywords ?? ""}`.toLowerCase().includes(term)));
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

/** Static reference dialog for keyboard shortcuts. */
export function openShortcuts() {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const rows: [string, string][] = [
    ["Ctrl+K", "Command palette — every command, with reasons when unavailable"], ["Ctrl+Z", "Undo the last recipe change (outside text fields)"],
    ["Ctrl+S", "Save the collection to the local library"], ["F6 / Shift+F6", "Move focus between the header, panel groups and status bar"],
    ["← → Home End", "Switch tabs in a focused tab strip"], ["Alt+Shift+← →", "Reorder the focused tab"], ["Shift+F10", "Layout or context commands for the focused item"],
    ["Delete", "Close the focused tab · remove the focused row"], ["↑ ↓", "Move between rows in Presets and Layers"], ["Alt+↑ ↓", "Reorder the focused row"],
    ["F2", "Rename the focused row"], ["Ctrl+D", "Duplicate the focused row"], ["Esc", "Cancel a drag, gesture, menu or dialog"],
    ["Ctrl while dragging a panel", "Float freely without snapping"], ["F (viewport focused)", "Front view · Fit shape"],
    ["1 / 2 / O (UV focused)", "Both eyes · single eye · other eye"], ["?", "Show this list"],
  ];
  const dialog = h("dialog", { class: "sheet", "aria-labelledby": "shortcuts-title" },
    h("div", { class: "sheet-head" }, h("h2", { id: "shortcuts-title", text: "Keyboard shortcuts" }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("dl", { class: "shortcut-list wide" }, rows.flatMap(([key, value]) => [h("dt", {}, h("kbd", { text: key })), h("dd", { text: value })])));
  const close = () => { dialog.close(); dialog.remove(); invoker?.focus(); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}
