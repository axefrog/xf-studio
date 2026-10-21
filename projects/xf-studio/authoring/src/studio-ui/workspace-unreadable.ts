/**
 * What the page shows instead of the Studio when its saved workspace can't be opened (damaged, or written by a newer XF
 * Studio), on localhost and the desktop alike: nothing was changed, and Start fresh sets the old file aside (kept, never
 * deleted) and reloads. Composed from the library's empty state, button and note; the hosts' bootstraps show it.
 */
import { button, emptyState, note } from "./controls";
import { h } from "./dom";

export function showWorkspaceUnreadable(root: HTMLElement, options: { file: string; startFresh(): Promise<string | null>; reload(): void }) {
  const status = note(options.file ? `Saved workspace file: ${options.file}` : "");
  const fresh = button({ label: "Start fresh", variant: "primary", onClick: async () => {
    fresh.disabled = true;
    try {
      const kept = await options.startFresh();
      status.textContent = kept ? `Your old workspace was kept as ${kept}. Starting fresh…` : "Starting fresh…";
      options.reload();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "XF Studio couldn't set the old workspace aside. Restart XF Studio and try again.";
      fresh.disabled = false;
    }
  } });
  const box = emptyState("Your last session couldn't be opened.",
    "XF Studio's saved workspace is damaged or was written by a newer version, so nothing was changed. " +
    "Start fresh to continue: the old workspace file is kept beside it, and your saved library is not affected.", fresh);
  // As before: what happened, the kept file, then the one action.
  box.insertBefore(status, fresh.parentElement);
  root.removeAttribute("aria-busy");
  root.replaceChildren(h("div", { class: "boot-failed", role: "alert", style: "max-width:560px;margin:15vh auto;padding:0 var(--sp-5)" }, box));
}
