import { shortcutLabel } from "../../input-bindings";
import type { ProjectLink } from "../../project-links";
import { badge, button, emptyState, section } from "../controls";
import { h, setText, uid } from "../dom";
import type { PanelController } from "../panels/collection";
import { PANEL_META } from "../panel-meta";
import type { Frame, StudioRuntime } from "../runtime";
import { HELP_LINKS, helpReference, helpTopicsFor, searchTopics, searchTours } from "./help-topics";
import { renderHelp } from "./render";
import type { Tour } from "./types";
import type { TourRecord } from "../../ui-preferences";
import { openReportDialog } from "../diagnostics/report-dialog";

export type HelpGuidance = { tours(): readonly Tour[]; status(tourId: string): TourRecord | undefined; start(tourId: string): boolean };
const STATUS: Record<TourRecord, [string, "success" | "neutral"]> = {
  completed: ["Done", "success"], skipped: ["Skipped", "neutral"], declined: ["Not started", "neutral"],
};

/**
 * The Help panel: one search over tours, help topics and the keyboard and mouse reference
 * (generated from the input binding catalogue), plus links to the public knowledge pages and
 * the issue tracker. It reads only data and the UI preferences; tours start through the runner.
 */
export function helpPanel(rt: StudioRuntime, guidance: HelpGuidance): PanelController & { focusSearch(): void } {
  const searchId = uid("help-search");
  const search = h("input", { id: searchId, class: "field help-search", type: "search", placeholder: "Search help, tours and shortcuts",
    "aria-label": "Search help", "aria-controls": `${searchId}-results`, autocomplete: "off", spellcheck: "false" });
  const count = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const tours = h("ul", { class: "help-tours", "aria-label": "Guided tours" });
  const topics = h("div", { class: "help-topics" });
  const reference = h("div", { class: "help-reference" });
  const links = h("ul", { class: "help-links" }, h("li", {},
    h("button", { class: "link-button", type: "button", text: "Report a problem…", onclick: () => { openReportDialog(rt, null); } }),
    h("small", { class: "muted", text: "Prepares a report you review, save and attach. Nothing is sent by itself." })), HELP_LINKS.map(item => h("li", {},
    h("button", { class: "link-button", type: "button", text: item.label, onclick: () => void open(item.link) }),
    h("small", { class: "muted", text: item.detail }))));
  const toursSection = section("Guided tours", tours), topicsSection = section("Questions and answers", topics);
  const referenceSection = section("Keyboard & mouse", h("p", { class: "note muted", text: `Generated from the Studio's own bindings. ${shortcutLabel("shell.shortcuts")} opens the same list as a sheet.` }), reference);
  const empty = emptyState("Nothing matches", "Try fewer or different words, or browse the sections below once the search is cleared.",
    button({ label: "Clear search", variant: "quiet", onClick: () => { search.value = ""; render(); search.focus(); } }));
  const element = h("div", { class: "panel-content help-panel" },
    h("div", { class: "help-search-row" }, search), count,
    h("div", { id: `${searchId}-results`, class: "help-results" }, empty, toursSection, topicsSection, referenceSection,
      section("More help", links)));
  let toursKey = "";

  async function open(link: ProjectLink) {
    const outcome = await rt.port.links.open(link);
    if (!outcome.ok) rt.feedback.toast("warning", "Help", outcome.message);
  }
  function renderTours(query: string) {
    const list = searchTours(query, guidance.tours());
    const key = JSON.stringify([query, list.map(tour => [tour.id, guidance.status(tour.id) ?? ""])]);
    if (key === toursKey) return list.length;
    toursKey = key;
    tours.replaceChildren(...list.map(tour => {
      const status = guidance.status(tour.id), [label, tone] = status ? STATUS[status] : ["Not started", "neutral" as const];
      return h("li", { class: "help-tour" },
        h("div", { class: "help-tour-text" }, h("strong", { text: tour.title }), h("small", { class: "muted", text: `${tour.summary} ${tour.steps.length} steps.` })),
        badge(label, tone),
        button({ label: status === "completed" ? "Replay" : "Start", icon: "play", small: true, variant: tour.audience === "onboarding" && !status ? "primary" : undefined,
          onClick: () => { guidance.start(tour.id); } }));
    }));
    return list.length;
  }
  const helpTopics = helpTopicsFor(rt.finishes);
  function render() {
    const query = search.value.trim();
    const tourCount = renderTours(query);
    const found = searchTopics(query, helpTopics);
    topics.replaceChildren(...found.map(topic => h("details", { class: "help-topic", open: query ? true : undefined },
      h("summary", { text: topic.title }), h("div", { class: "help-topic-body" }, renderHelp(topic.body)))));
    const sections = helpReference(query);
    reference.replaceChildren(...sections.map(item => h("section", { class: "reference-section", "aria-label": item.title },
      h("h4", { text: item.title }), item.detail ? h("p", { class: "muted small", text: item.detail }) : null,
      h("dl", { class: "shortcut-list" }, item.rows.flatMap(row => [h("dt", {}, h("kbd", { text: row.input })),
        h("dd", {}, row.label, row.where ? h("span", { class: "reference-where", text: ` · ${row.where}` }) : null)])))));
    toursSection.hidden = !tourCount; topicsSection.hidden = !found.length; referenceSection.hidden = !sections.length;
    const total = tourCount + found.length + sections.reduce((sum, item) => sum + item.rows.length, 0);
    empty.hidden = !query || total > 0;
    setText(count, query ? `${total} result${total === 1 ? "" : "s"} for ${query}` : "");
  }
  search.addEventListener("input", render);
  search.addEventListener("keydown", event => { if (event.key === "Escape" && search.value) { event.preventDefault(); search.value = ""; render(); } });
  // The first paint (the panel is shown) fills it; the tour runner exists by then.
  let rendered = false;
  return {
    spec: { id: "help", ...PANEL_META.help, element },
    update(_frame: Frame) { if (!rendered) { rendered = true; render(); } else renderTours(search.value.trim()); },
    focusSearch() { if (!rendered) { rendered = true; render(); } search.focus(); search.select(); },
  };
}
