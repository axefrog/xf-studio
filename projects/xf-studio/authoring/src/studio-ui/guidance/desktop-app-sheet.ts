import type { DesktopAppState } from "../../desktop-app";
import type { ReadonlyDeep } from "../../read-only";
import { applyCapability, button, note } from "../controls";
import { iconButton } from "../components/icon-button";
import { h, setText, uid } from "../dom";
import { icon } from "../icons";
import type { StudioRuntime } from "../runtime";

let current: { close(): void } | null = null;

/** One plain line for the setup program built here, e.g. "canary-win-x64-XFStudio-Setup-canary.exe, 42 MB, built 27 Sep at 11:01". */
export function installerSummary(installer: NonNullable<ReadonlyDeep<DesktopAppState>["status"]>["installer"] & {}, now = new Date()): string {
  const built = new Date(installer.builtAt), sameDay = built.toDateString() === now.toDateString();
  const time = built.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = sameDay ? "today" : built.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${installer.name}, ${Math.max(1, Math.round(installer.bytes / 1_048_576))} MB, built ${day} at ${time}`;
}

/** The Help entry's label and one-line detail for the desktop app, from the port's snapshot (localhost only). */
export function desktopAppEntry(state: ReadonlyDeep<DesktopAppState>): { label: string; detail: string; opens: boolean } {
  const installed = state.status?.installed;
  if (installed?.canOpen) return { label: "Open the desktop app", opens: true,
    detail: `XF Studio${installed.version ? ` ${installed.version}` : ""} is installed on this computer as a Windows app.` };
  if (state.status?.platform === "other") return { label: "Get the desktop app…", opens: false, detail: "The desktop app is for Windows: how to build it." };
  return { label: "Get the desktop app…", opens: false, detail: state.status?.installer
    ? "Install XF Studio as a Windows app from the setup you built." : "XF Studio as a Windows app: how to get it." };
}

/** Opens the installed app, or says plainly why it couldn't (a toast; nothing else changes). */
export async function openDesktopApp(rt: StudioRuntime) {
  const outcome = await rt.port.desktopApp.dispatch({ kind: "desktopApp.open" });
  rt.feedback.toast(outcome.ok ? "success" : "warning", "Desktop app", outcome.message);
}

/**
 * "Get the desktop app" (localhost only): what the host found and the one next step. Installed: **Open the desktop app**. A setup
 * built in this checkout: **Install from your build**, whose consent line names the file; the click is the consent, and the host
 * runs only that file. Otherwise the one build command (with Copy) and, once a release is published, the releases page. Acts only
 * through `port.desktopApp` and `port.links`; it opens at once and fills in as the host answers.
 */
export function openDesktopAppSheet(rt: StudioRuntime) {
  current?.close();
  const port = rt.port, app = port.desktopApp;
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = uid("desktop-app-title");
  const title = h("h2", { id: titleId, text: "XF Studio desktop app", tabindex: "-1" });
  const lead = h("p", { class: "desktop-app-lead" });
  const detail = h("div", { class: "desktop-app-detail" });
  const status = h("p", { class: "install-status", role: "status", "aria-live": "polite" });
  const primary = button({ label: "Open the desktop app", icon: "monitor", variant: "primary", onClick: () => void run() });
  // Installed already: running the latest build's setup again updates it (the same consent as the first install).
  const reinstall = button({ label: "Run the setup again", icon: "package", small: true, onClick: () => void install() });
  const again = button({ label: "Check again", icon: "refresh", small: true, variant: "quiet", onClick: () => void refresh() });
  const close = button({ label: "Close", variant: "quiet", onClick: () => done() });
  const dialog = h("dialog", { class: "sheet desktop-app-sheet", "aria-labelledby": titleId },
    h("div", { class: "sheet-head" }, title,
      iconButton({ label: "Close", icon: "close", onClick: () => done() })),
    lead, detail, status, h("div", { class: "report-foot" }, primary, again, h("span", { class: "grow" }), close));
  let renderedKey = "";
  /** What this sheet's own last step said (a launch started, or why not); an earlier session's outcome isn't shown. */
  let said: { ok: boolean; message: string } | null = null;

  async function refresh() { await app.dispatch({ kind: "desktopApp.refresh" }); }
  async function install() {
    const installer = app.snapshot().status?.installer;
    if (!installer) return;
    said = null;
    const outcome = await app.dispatch({ kind: "desktopApp.install", installer: installer.id });
    said = { ok: outcome.ok, message: outcome.message };
    render();
  }
  async function run() {
    const found = app.snapshot().status;
    if (!found?.installed?.canOpen) { await install(); return; }
    said = null;
    const outcome = await app.dispatch({ kind: "desktopApp.open" });
    if (outcome.ok) { done(); rt.feedback.toast("success", "Desktop app", outcome.message); return; }
    said = { ok: false, message: outcome.message };
    render();
  }
  const command = (text: string) => {
    const copy = button({ label: "Copy", icon: "duplicate", small: true, variant: "quiet", onClick: () => {
      void navigator.clipboard?.writeText(text).then(() => setText(copy.querySelector("span")!, "Copied"), () => {}); } });
    return h("div", { class: "desktop-app-command" }, h("code", { text }), copy);
  };
  function render() {
    const state = app.snapshot(), found = state.status;
    const key = JSON.stringify([found, state.busy === "desktopApp.refresh" && !found, state.error]);
    if (key !== renderedKey) {
      renderedKey = key;
      const installed = found?.installed, installer = found?.installer;
      primary.hidden = !(installed?.canOpen || (installer && found?.platform === "windows"));
      const release = found?.release;
      const releaseLink = release ? button({ label: `Download ${release.title} from GitHub`, icon: "export", small: true,
        onClick: () => void port.links.open("project-releases").then(outcome => { if (!outcome.ok) rt.feedback.toast("warning", "Desktop app", outcome.message); }) }) : null;
      const build = found ? h("div", { class: "desktop-app-build" },
        h("p", { text: `Build the setup from this checkout: in ${found.build.folder}, run` }), command(found.build.command),
        h("p", { class: "muted small", text: `It takes a minute or two. The setup lands in ${found.build.output}, and this window offers to install it.` })) : null;
      if (!found) {
        setText(lead, state.error ? "" : "Checking whether the desktop app is on this computer…");
        detail.replaceChildren();
      } else if (installed) {
        setText(lead, installed.canOpen ? `XF Studio${installed.version ? ` ${installed.version}` : ""} is installed on this computer. It keeps its own library and settings, separate from this browser Studio.`
          : "The desktop app is installed, but its program is missing. Install it again to repair it.");
        detail.replaceChildren(...(installer ? [note(`To update it from your latest build (${installerSummary(installer)}), close the desktop app and run the setup again. Nothing changes until you choose Install in its window.`, "muted"),
          reinstall] : installed.canOpen || !build ? [] : [build]));
      } else if (found.platform !== "windows") {
        setText(lead, "The XF Studio desktop app is a Windows app. On a Windows PC with this checkout, build and install it from here.");
        detail.replaceChildren(...[build, releaseLink].filter((node): node is NonNullable<typeof node> => !!node));
      } else if (installer) {
        setText(lead, "Install XF Studio as a Windows app, from the setup you built:");
        detail.replaceChildren(h("p", { class: "desktop-app-file" }, icon("package"), h("span", { text: `${installerSummary(installer)}, in ${found.build.output}` })),
          // The consent line: what the click does, before it is pressed.
          note("Install from your build runs this setup. It installs XF Studio for your Windows user only (no administrator rights), and nothing changes until you choose Install in its own window.", "info"),
          note("This alpha isn't signed yet, so Windows may ask whether to run it or say the publisher is unknown. That's expected for a setup you built yourself.", "muted"));
      } else {
        setText(lead, "The desktop app isn't installed on this computer yet.");
        detail.replaceChildren(...[build, releaseLink ?? h("p", { class: "muted small", text: "Downloads from GitHub start with the first release." })].filter((node): node is NonNullable<typeof node> => !!node));
      }
      setText(primary.querySelector("span")!, installed?.canOpen ? "Open the desktop app" : "Install from your build");
    }
    const busy = state.busy;
    const action = found?.installed?.canOpen ? { kind: "desktopApp.open" as const } : { kind: "desktopApp.install" as const, installer: found?.installer?.id ?? "" };
    const capability = app.capability(action);
    // A step that can't be taken here says why in the sheet itself, not only in the button's tooltip.
    const blocked = !primary.hidden && !busy && !capability.available ? capability.reason ?? "" : "";
    setText(status, busy === "desktopApp.install" ? "Starting the setup…" : busy === "desktopApp.open" ? "Opening XF Studio…"
      : state.error ?? said?.message ?? blocked);
    status.className = `install-status${state.error || (said && !said.ok) ? " warning" : ""}`;
    applyCapability(primary, capability);
    applyCapability(reinstall, app.capability({ kind: "desktopApp.install", installer: found?.installer?.id ?? "" }));
    applyCapability(again, busy ? { available: false, reason: "Wait a moment." } : { available: true });
  }
  const unsubscribe = port.subscribe(render);
  // Coming back after running the setup: look again, so the sheet offers Open once it has installed.
  const onFocus = () => { if (!app.snapshot().busy) void refresh(); };
  window.addEventListener("focus", onFocus);
  function done() {
    unsubscribe();
    window.removeEventListener("focus", onFocus);
    if (dialog.open) dialog.close();
    dialog.remove();
    current = null;
    if (invoker?.isConnected) invoker.focus();
  }
  dialog.addEventListener("cancel", event => { event.preventDefault(); done(); });
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
  current = { close: done };
  render();
  void refresh();
  return { close: done };
}
