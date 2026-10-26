/**
 * The Recordings panel: the game sessions the recorder kept on this computer, newest first, with the one open now marked. Opening one
 * shows it in the Holotable view. States: looking, none yet, couldn't be read (with Try again), not available in this copy.
 */
import { applyCapability, button, emptyState, note, RecordList, type RecordRow } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import { HOLOTABLE_PANEL_META } from "./contribution";

type Ctx = ModuleViewContext<HolotableFacade>;

export function holotableRecordingsPanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  const runs = new RecordList({ label: "Recordings" });
  const refresh = button({ label: "Refresh", icon: "refresh", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "holo.refresh" }, { quiet: true }); } });
  const status = note("", "muted");
  status.setAttribute("role", "status");
  const body = h("div", {}, runs.element);
  const element = h("div", { class: "panel-content holotable-recordings" }, h("div", { class: "control-line" }, refresh), status, body);
  let key = "";
  return {
    spec: { id: "holotable.recordings", ...HOLOTABLE_PANEL_META["holotable.recordings"], element },
    update() {
      const state = facade.snapshot();
      setText(status, state.phase === "ready" || state.phase === "unavailable" || state.phase === "failed" ? "" : state.message);
      status.hidden = !status.textContent;
      const k = JSON.stringify([state.phase, state.message, state.runs.map(r => r.dir), state.open?.dir, state.live.available, state.live.recording, state.live.watching, state.live.phase]);
      if (k === key) return;
      key = k;
      if (state.phase === "unavailable" || state.phase === "failed") {
        body.replaceChildren(emptyState(state.phase === "unavailable" ? "Holotable isn't available here" : "The recordings couldn't be read", state.message,
          button({ label: "Try again", icon: "refresh", onClick: () => { void ctx.dispatch({ kind: "holo.refresh" }); } })));
        return;
      }
      if (!body.contains(runs.element)) body.replaceChildren(runs.element);
      const rows: RecordRow[] = state.runs.map((r): RecordRow => ({
        id: r.dir, name: r.title ?? `Session ${r.session.slice(0, 8)} · run ${r.run}`, current: state.open?.dir === r.dir,
        meta: r.standalone ? [`layers only · ${Math.round(r.end - r.start)} s`] : [`${Math.round(r.end - r.start)} s`, `${(r.bytes / 1e6).toFixed(1)} MB`],
        badge: state.open?.dir === r.dir ? { text: "Open now", tone: "info" } : undefined,
        action: state.open?.dir === r.dir ? undefined : button({ label: "Open", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.open", dir: r.dir }); } }),
      }));
      if (state.live.available || state.live.watching) {
        const watch = button({ label: "Watch", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.watch" }); } });
        applyCapability(watch, facade.capability({ kind: "holo.watch" }));
        const reconnecting = state.live.watching && (state.live.phase === "disconnected" || !state.live.available);
        rows.unshift({ id: "live", name: "Live game", meta: [reconnecting ? "Reconnecting…" : state.live.recording ? "Recording now" : "Not recording"], current: state.live.watching,
          badge: state.live.watching ? { text: "Watching", tone: "info" } : undefined, action: state.live.watching ? undefined : watch });
      }
      runs.update(rows);
    },
  };
}
