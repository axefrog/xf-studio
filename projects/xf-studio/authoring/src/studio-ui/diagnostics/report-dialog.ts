import type { DiagnosticsAction, ReportItemState, ReportState } from "../../diagnostics/actions";
import { button, Toggle } from "../controls";
import { iconButton } from "../components/icon-button";
import { h, setDisabled, setText, uid } from "../dom";
import { icon } from "../icons";
import type { StudioRuntime } from "../runtime";

let current: { close(): void } | null = null;
/** A group's disclosure mark: the expander's chevron, turned while the group is open (`details[open]`). */
const chevron = () => h("span", { class: "report-chevron", "aria-hidden": "true" }, icon("chevronRight"));

const SHARING_WARNING = "Reports you attach on GitHub are public, and most mods' permissions don't allow re-uploading their files. " +
  "Only include files of mods you made yourself, or whose permissions allow sharing them.";
const MODE_HELP = "Keeps three hours of more detailed activity instead of the last half hour, for a problem that's hard to catch. " +
  "It turns itself off after a day. Nothing is sent anywhere.";

/**
 * "Report a problem": prepares a report, shows exactly what it holds for review (grouped, with sizes and a preview of each part,
 * the whole of any part on request, and the summary and index files as they will be saved), and offers Save report, Copy summary
 * and Open a GitHub issue. Nothing leaves the computer unless the person sends it. Acts only through `port.diagnostics`
 * (docs/diagnostics.md).
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
  const again = button({ label: "Prepare again", icon: "refresh", small: true, onClick: prepare });
  again.hidden = true;
  // The report file's own summary and index, always in it, built from the ticked parts only.
  const readme = h("pre", {}), index = h("pre", {});
  // Every group is a disclosure with the expander's chevron, so a folded one never reads as an empty band (C-31); this one, made from
  // the parts above it, comes after them.
  const summaryFiles = h("details", { class: "report-group report-files" },
    h("summary", {}, chevron(), h("span", { class: "report-group-title", text: "Always in the report" }), h("span", { class: "report-size", text: "README.md · report.json" })),
    h("p", { class: "muted small", text: "A short summary and a list of what the file holds, made from the parts you leave ticked. Your folders are replaced when it's saved." }),
    h("details", { class: "report-preview" }, h("summary", {}, chevron(), "Show the summary (README.md)"), readme),
    h("details", { class: "report-preview" }, h("summary", {}, chevron(), "Show the list (report.json)"), index));
  summaryFiles.hidden = true;
  const mode = new Toggle({ label: "Diagnostic mode", help: MODE_HELP,
    onChange: checked => void dispatch({ kind: "diagnostics.setMode", mode: checked ? "deep" : "normal" }).then(result => setText(status, result.message)) });
  const save = button({ label: "Save report…", icon: "save", variant: "primary", onClick: () => void run({ kind: "diagnostics.saveReport" }) });
  const copy = button({ label: "Copy summary", icon: "duplicate", onClick: () => void run({ kind: "diagnostics.copySummary" }) });
  const issue = button({ label: "Open a GitHub issue", icon: "export", onClick: () => void run({ kind: "diagnostics.openIssue" }) });
  const closeButton = button({ label: "Close", variant: "quiet", onClick: () => close() });
  const dialog = h("dialog", { class: "sheet report-sheet", "aria-labelledby": titleId },
    h("div", { class: "sheet-head" }, h("h2", { id: titleId, text: "Report a problem" }),
      iconButton({ label: "Close", icon: "close", onClick: () => close() })),
    h("div", { class: "report-body" },
      h("p", { class: "report-intro", text: "Nothing leaves your computer unless you send it. Review what the report holds, save it, then attach it to a GitHub issue. " +
        "Personal folder names and e-mail addresses are already replaced with placeholders." }),
      ref ? h("p", { class: "report-ref" }, "Reference ", h("strong", { text: ref })) : null,
      h("label", { class: "report-label", for: descriptionId, text: "What were you doing?" }), description,
      groups, summaryFiles,
      // What the last step did (or that the report is being prepared) says so under everything it is about, beside nothing but the
      // report's size: no empty band above the parts, and a message appearing moves nothing above it (C-31).
      h("div", { class: "report-state" }, status, retry, again), total, mode.element),
    h("div", { class: "report-foot" }, save, copy, issue, h("span", { class: "grow" }), closeButton));

  async function run(action: DiagnosticsAction) {
    const result = await dispatch(action);
    setText(status, result.message);
  }

  let shape = "", lastSaid = "";
  const rows = new Map<string, { box: Toggle; size: HTMLElement; reason: HTMLElement }>();
  const groupSizes = new Map<string, HTMLElement>();
  let confirm: Toggle | null = null;
  function build(report: ReportState) {
    rows.clear(); groupSizes.clear(); confirm = null;
    // A group with nothing in it (no mod setup read yet: no parts, or only empty ones) isn't listed: it would be a heading over nothing,
    // "0 B" (C-31).
    groups.replaceChildren(...report.groups.filter(group => group.items.some(item => item.bytes > 0)).map((group, index) => {
      const size = h("span", { class: "report-size" });
      groupSizes.set(group.id, size);
      const optional = group.id === "optional";
      const hasModFiles = group.items.some(item => item.modFiles);
      if (hasModFiles) {
        const sharing: Toggle = new Toggle({ label: "I made these mods, or their permissions allow sharing their files.",
          onChange: confirmed => void dispatch({ kind: "diagnostics.confirmSharing", confirmed }) });
        confirm = sharing;
      }
      return h("details", { class: "report-group", open: index < 2 || optional ? true : undefined },
        h("summary", {}, chevron(), h("span", { class: "report-group-title", text: group.label }), size),
        h("p", { class: "muted small", text: group.detail }),
        hasModFiles ? h("div", { class: "report-warning", role: "note" }, icon("warning"), h("div", {},
          h("p", { text: SHARING_WARNING }), confirm!.element)) : null,
        h("ul", { class: "report-items" }, group.items.map(item => row(item))));
    }));
  }
  function row(item: ReportItemState) {
    // Each part is a switch, as every include-or-not choice in the Studio is (the library's Switch; C-31), its reason on its note line.
    const box: Toggle = new Toggle({ label: item.label, onChange: async included => {
      const result = await dispatch({ kind: "diagnostics.setIncluded", item: item.id, included });
      if (!result.ok) { box.update(!included); setText(status, result.message); }
    } });
    const size = h("span", { class: "report-size" }), reason = h("small", { class: "report-reason" });
    rows.set(item.id, { box, size, reason });
    const text = h("pre", { text: item.preview });
    // A long part shows its start; the whole of it loads on request (DIAG-13).
    const all = item.partial ? button({ label: "Show all of it", small: true, variant: "quiet", onClick: async () => {
      setDisabled(all!, true);
      const full = await port.diagnostics.fullText(item.id);
      if (full === null) { setDisabled(all!, false); setText(status, "XF Studio couldn't show all of it. Try again in a moment."); return; }
      setText(text, full); all!.remove();
    } }) : null;
    return h("li", { class: "report-item" },
      h("div", { class: "report-item-head" }, box.element, size),
      h("small", { class: "muted report-item-detail", text: item.detail }), reason,
      item.preview ? h("details", { class: "report-preview" }, h("summary", {}, chevron(), "Show what's in it"), text, all) : null);
  }
  function render() {
    if (!dialog.isConnected) return;
    const snapshot = port.diagnostics.snapshot(), report = snapshot.report as ReportState | null;
    mode.update(snapshot.mode?.mode === "deep", { note: snapshot.mode?.mode === "deep" && snapshot.mode.until
      ? `On until ${new Date(snapshot.mode.until).toLocaleString()}.` : undefined });
    if (!report) return;
    const key = JSON.stringify([report.phase, report.groups.map(group => group.items.map(item => item.id))]);
    if (key !== shape) { shape = key; build(report); }
    retry.hidden = report.phase !== "failed" || report.expired;
    again.hidden = !report.expired;
    summaryFiles.hidden = !report.files;
    if (report.files) { setText(readme, report.files.readme); setText(index, report.files.index); }
    // The status follows the report's own steps; a message from the mode switch stays until the report says something new.
    const said = report.phase === "preparing" ? report.message ?? "Preparing the report…" : report.busy === "saving" ? "Making the report file…"
      : report.busy === "copying" ? "Copying…" : report.busy === "opening" ? "Opening the issue page…" : report.message ?? "";
    if (said !== lastSaid) { lastSaid = said; setText(status, said); }
    for (const group of report.groups) {
      const groupSize = groupSizes.get(group.id);
      if (groupSize) setText(groupSize, group.size);
      for (const item of group.items) {
        const found = rows.get(item.id);
        if (!found) continue;
        const wanted = port.diagnostics.capability({ kind: "diagnostics.setIncluded", item: item.id, included: !item.included });
        // The reason is said once, on the part's own reason line (below), not again on the switch's note line.
        found.box.update(item.included, { disabled: !item.included && !wanted.available, reason: wanted.reason, reasonOnLine: false });
        setText(found.size, item.size);
        setText(found.reason, !item.included && !wanted.available ? wanted.reason ?? "" : "");
      }
    }
    confirm?.update(report.sharingConfirmed);
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
