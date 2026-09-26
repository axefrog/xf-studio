import type { DiagnosticsAction, ReportItemState, ReportState } from "../../diagnostics/actions";
import { button, Toggle } from "../controls";
import { h, setDisabled, setText, uid } from "../dom";
import { icon } from "../icons";
import type { StudioRuntime } from "../runtime";

let current: { close(): void } | null = null;

const SHARING_WARNING = "Reports you attach on GitHub are public, and most mods' permissions don't allow re-uploading their files. " +
  "Only include files of mods you made yourself, or whose permissions allow sharing them.";
const MODE_HELP = "Keeps three hours of more detailed activity instead of the last half hour, for a problem that's hard to catch. " +
  "It turns itself off after a day. Nothing is sent anywhere.";

/**
 * "Report a problem": prepares a report, shows exactly what it holds for review (grouped, with sizes and a preview of each part),
 * and offers Save report, Copy summary and Open a GitHub issue. Nothing leaves the computer unless the person sends it. Acts only
 * through `port.diagnostics` (docs/diagnostics.md).
 */
export function openReportDialog(rt: StudioRuntime, ref: string | null) {
  current?.close();
  const port = rt.port;
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dispatch = (action: DiagnosticsAction) => port.diagnostics.dispatch(action);
  const activity = rt.feedback.log.slice(-100).map(entry => ({ time: entry.time.toISOString(), tone: entry.tone, source: entry.source,
    message: entry.ref ? `${entry.message} (reference ${entry.ref})` : entry.message }));
  const prepare = () => void dispatch({ kind: "diagnostics.prepareReport", ref, activity });

  const titleId = uid("report-title"), descriptionId = uid("report-description");
  const description = h("textarea", { id: descriptionId, class: "field report-description", rows: "3", maxlength: "4000",
    placeholder: "What were you doing when it happened, and what did you expect?" });
  description.addEventListener("input", () => void dispatch({ kind: "diagnostics.setDescription", text: description.value }));
  const status = h("p", { class: "report-status", role: "status", "aria-live": "polite" });
  const groups = h("div", { class: "report-groups" });
  const total = h("p", { class: "report-total" });
  const retry = button({ label: "Try again", icon: "refresh", small: true, onClick: prepare });
  retry.hidden = true;
  const mode = new Toggle({ label: "Diagnostic mode", help: MODE_HELP,
    onChange: checked => void dispatch({ kind: "diagnostics.setMode", mode: checked ? "deep" : "normal" }).then(result => setText(status, result.message)) });
  const save = button({ label: "Save report…", icon: "save", variant: "primary", onClick: () => void run({ kind: "diagnostics.saveReport" }) });
  const copy = button({ label: "Copy summary", icon: "duplicate", onClick: () => void run({ kind: "diagnostics.copySummary" }) });
  const issue = button({ label: "Open a GitHub issue", icon: "export", onClick: () => void run({ kind: "diagnostics.openIssue" }) });
  const closeButton = button({ label: "Close", variant: "quiet", onClick: () => close() });
  const dialog = h("dialog", { class: "sheet report-sheet", "aria-labelledby": titleId },
    h("div", { class: "sheet-head" }, h("h2", { id: titleId, text: "Report a problem" }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("div", { class: "report-body" },
      h("p", { class: "report-intro", text: "Nothing leaves your computer unless you send it. Review what the report holds, save it, then attach it to a GitHub issue. " +
        "Personal folder names and e-mail addresses are already replaced with placeholders." }),
      ref ? h("p", { class: "report-ref" }, "Reference ", h("strong", { text: ref })) : null,
      h("label", { class: "report-label", for: descriptionId, text: "What were you doing?" }), description,
      h("div", { class: "report-state" }, status, retry),
      groups, total, mode.element),
    h("div", { class: "report-foot" }, save, copy, issue, h("span", { class: "grow" }), closeButton));

  async function run(action: DiagnosticsAction) {
    const result = await dispatch(action);
    setText(status, result.message);
  }

  let shape = "", lastSaid = "";
  const rows = new Map<string, { box: HTMLInputElement; size: HTMLElement; reason: HTMLElement }>();
  const groupSizes = new Map<string, HTMLElement>();
  let confirm: HTMLInputElement | null = null;
  function build(report: ReportState) {
    rows.clear(); groupSizes.clear(); confirm = null;
    groups.replaceChildren(...report.groups.map((group, index) => {
      const size = h("span", { class: "report-size" });
      groupSizes.set(group.id, size);
      const optional = group.id === "optional";
      const hasModFiles = group.items.some(item => item.modFiles);
      if (hasModFiles) {
        confirm = h("input", { type: "checkbox" });
        confirm.addEventListener("change", () => void dispatch({ kind: "diagnostics.confirmSharing", confirmed: confirm!.checked }));
      }
      return h("details", { class: "report-group", open: index < 2 || optional ? true : undefined },
        h("summary", {}, h("span", { class: "report-group-title", text: group.label }), size),
        h("p", { class: "muted small", text: group.detail }),
        hasModFiles ? h("div", { class: "report-warning", role: "note" }, icon("warning"), h("div", {},
          h("p", { text: SHARING_WARNING }),
          h("label", { class: "report-confirm" }, confirm!, h("span", { text: "I made these mods, or their permissions allow sharing their files." })))) : null,
        h("ul", { class: "report-items" }, group.items.map(item => row(item))));
    }));
  }
  function row(item: ReportItemState) {
    const box = h("input", { type: "checkbox", id: uid("report-item") });
    box.addEventListener("change", async () => {
      const result = await dispatch({ kind: "diagnostics.setIncluded", item: item.id, included: box.checked });
      if (!result.ok) { box.checked = !box.checked; setText(status, result.message); }
    });
    const size = h("span", { class: "report-size" }), reason = h("small", { class: "report-reason" });
    rows.set(item.id, { box, size, reason });
    return h("li", { class: "report-item" },
      h("label", { class: "report-item-head", for: box.id }, box, h("span", { class: "report-item-label", text: item.label }), size),
      h("small", { class: "muted", text: item.detail }), reason,
      item.preview ? h("details", { class: "report-preview" }, h("summary", { text: "Show what's in it" }), h("pre", { text: item.preview })) : null);
  }
  function render() {
    if (!dialog.isConnected) return;
    const snapshot = port.diagnostics.snapshot(), report = snapshot.report as ReportState | null;
    mode.update(snapshot.mode?.mode === "deep", { note: snapshot.mode?.mode === "deep" && snapshot.mode.until
      ? `On until ${new Date(snapshot.mode.until).toLocaleString()}.` : undefined });
    if (!report) return;
    const key = JSON.stringify([report.phase, report.groups.map(group => group.items.map(item => item.id))]);
    if (key !== shape) { shape = key; build(report); }
    retry.hidden = report.phase !== "failed";
    // The status follows the report's own steps; a message from the mode switch stays until the report says something new.
    const said = report.phase === "preparing" ? "Preparing the report…" : report.busy === "saving" ? "Making the report file…"
      : report.busy === "copying" ? "Copying…" : report.busy === "opening" ? "Opening the issue page…" : report.message ?? "";
    if (said !== lastSaid) { lastSaid = said; setText(status, said); }
    for (const group of report.groups) {
      setText(groupSizes.get(group.id)!, group.size);
      for (const item of group.items) {
        const found = rows.get(item.id);
        if (!found) continue;
        found.box.checked = item.included;
        const wanted = port.diagnostics.capability({ kind: "diagnostics.setIncluded", item: item.id, included: !item.included });
        setDisabled(found.box, !item.included && !wanted.available, wanted.reason);
        setText(found.size, item.size);
        setText(found.reason, !item.included && !wanted.available ? wanted.reason ?? "" : "");
      }
    }
    if (confirm) confirm.checked = report.sharingConfirmed;
    setText(total, report.phase === "ready" ? `Report size: ${report.totalSize}${report.window ? ` · recent activity covers the last ${report.window.minutes} minutes` : ""}` : "");
    for (const [control, kind] of [[save, "diagnostics.saveReport"], [copy, "diagnostics.copySummary"], [issue, "diagnostics.openIssue"]] as const) {
      const capability = port.diagnostics.capability({ kind });
      setDisabled(control, !capability.available, capability.reason);
    }
  }
  const unsubscribe = port.subscribe(render);
  function close() {
    unsubscribe();
    void dispatch({ kind: "diagnostics.closeReport" });
    dialog.close(); dialog.remove();
    if (current === handle) current = null;
    if (invoker?.isConnected) invoker.focus();
  }
  const handle = { close };
  current = handle;
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  description.focus();
  prepare();
  render();
  return handle;
}
