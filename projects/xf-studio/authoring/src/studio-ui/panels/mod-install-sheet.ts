import { applyCapability, button, note } from "../controls";
import { h, setText, uid } from "../dom";
import { icon } from "../icons";
import type { StudioRuntime } from "../runtime";

let current: { close(): void } | null = null;

/**
 * "Add to my mod manager" (UI-82): the review before consent. It asks the host for the plan, shows in plain words exactly what
 * would be added and where (the mod's folder, the one mod-list row and its section, or the game folder), anything to know first
 * and, when it can't be done now, why with the one next step (a button where there is one). The primary button is the consent
 * to that plan; nothing is added until it is pressed. Acts only through `port.modInstall`.
 */
export function openModInstallSheet(rt: StudioRuntime, product: string, options: { openSetup(): void; rename?(): void }) {
  current?.close();
  const port = rt.port, install = port.modInstall;
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = uid("install-title");
  const title = h("h2", { id: titleId, text: "Add your mod" });
  const where = h("p", { class: "install-where" });
  const changes = h("ul", { class: "result-list install-changes", "aria-label": "What will change" });
  const notes = h("div", { class: "install-notes" });
  const status = h("p", { class: "install-status", role: "status", "aria-live": "polite" });
  const setup = button({ label: "Open Game & tools", icon: "settings", small: true, onClick: () => { close(); options.openSetup(); } });
  const again = button({ label: "Check again", icon: "refresh", small: true, onClick: () => void review() });
  const rename = button({ label: "Rename the mod", icon: "rename", small: true, onClick: () => { close(); options.rename?.(); } });
  const add = button({ label: "Add", icon: "package", variant: "primary", onClick: () => void apply() });
  const cancel = button({ label: "Cancel", variant: "quiet", onClick: () => close() });
  const dialog = h("dialog", { class: "sheet install-sheet", "aria-labelledby": titleId },
    h("div", { class: "sheet-head" }, title,
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    where, changes, notes, h("div", { class: "install-state" }, status, again, rename, setup),
    h("div", { class: "report-foot" }, add, h("span", { class: "grow" }), cancel));
  let said = "";

  async function review() {
    said = "";
    const outcome = await install.dispatch({ kind: "modInstall.review", product });
    if (!outcome.ok) said = outcome.message;
    render();
  }
  async function apply() {
    const outcome = await install.dispatch({ kind: "modInstall.apply", product });
    if (outcome.ok) {
      close();
      rt.feedback.toast("success", "Mod package", outcome.message);
      return;
    }
    // The plan no longer matches what is there now: review again, and say why this one wasn't used.
    if (outcome.code === "stale_plan") { await review(); said = outcome.message; render(); return; }
    said = outcome.message;
    render();
  }
  function render() {
    const state = install.snapshot(), plan = state.plans[product], busy = state.busy?.product === product ? state.busy.kind : null;
    const target = plan?.route === "mo2" ? "Mod Organizer 2" : "your game folder";
    setText(title, plan ? `Add “${plan.modName}” to ${target}?` : "Add your mod");
    setText(where, plan ? `${plan.replacing ? "Updates" : "Adds"} ${plan.modName} in ${plan.place}. Nothing is added until you choose ${plan.route === "mo2" ? "Add to Mod Organizer 2" : "Add to the game folder"}.`
      : busy === "modInstall.review" ? "Checking where your mod would go…" : "");
    const key = JSON.stringify([plan?.changes, plan?.notes]);
    if (changes.dataset.key !== key) {
      changes.dataset.key = key;
      changes.replaceChildren(...(plan?.changes ?? []).map(text => h("li", {}, icon("check"), h("span", { text }))));
      notes.replaceChildren(...(plan?.notes ?? []).map(text => note(text, "info")));
    }
    changes.hidden = !plan?.changes.length;
    const blocked = plan?.blocked ?? null;
    setText(status, busy === "modInstall.apply" ? "Adding your mod…" : said || blocked || "");
    status.className = `install-status${said || blocked ? " warning" : ""}`;
    // The one next step as a button, as the plan names it (UI-99): Game & tools, renaming the mod, or Check again once the
    // person has done what it says. A refused Add offers Check again.
    const next = blocked ? plan!.next : said ? "retry" : null;
    setup.hidden = next !== "setup";
    rename.hidden = next !== "rename" || !options.rename;
    again.hidden = next !== "retry" && !(next === "rename" && !options.rename);
    applyCapability(again, busy ? { available: false, reason: "Wait a moment." } : { available: true });
    setText(add.querySelector("span")!, plan ? plan.route === "mo2" ? "Add to Mod Organizer 2" : "Add to the game folder" : "Add");
    applyCapability(add, install.capability({ kind: "modInstall.apply", product }));
  }
  const unsubscribe = port.subscribe(render);
  function close() {
    unsubscribe();
    if (dialog.open) dialog.close();
    dialog.remove();
    current = null;
    if (invoker?.isConnected) invoker.focus();
  }
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  current = { close };
  render();
  void review();
  return { close };
}
