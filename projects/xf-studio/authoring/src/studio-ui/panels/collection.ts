import type { PackageBuildResult, PackageCheckResult } from "../../platform/api";
import { EYE_MAKEUP_MOD, MOD_NAME_HINT } from "../../legacy/eye-makeup/mod-branding";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import { applyCapability, badge, button, setButtonLabel, emptyState, note, section } from "../controls";
import { h, setAttr, setText } from "../dom";
import type { Command } from "../commands";
import type { PanelSpec } from "../dock/dock-view";
import { icon } from "../icons";
import { progressBar } from "../components/progress";
import { modLine } from "../components/mod-line";
import { openMenu, openValuePopover, type MenuAnchor, type MenuItem } from "../menu";
import type { PackageProductSummary as ProductSummary } from "../../library/collection-actions";
type PackageProductSummary = ReadonlyDeep<ProductSummary>;
import type { FeedbackAction } from "../feedback";
import type { Frame, StudioRuntime } from "../runtime";
import { openReportDialog } from "../diagnostics/report-dialog";
import { setupStatus, wantsWolvenKitStep } from "./game-setup";
import { wolvenKitStepButton } from "../wolvenkit-step";
import { modInstallLabel, openModInstallSheet } from "./mod-install-sheet";

import { PANEL_META } from "../panel-meta";

export type PanelController = { spec: PanelSpec; update(frame: Frame): void;
  /** Management and recovery controls remain usable beside a missing-target chooser. */
  emptyChoices?: "alongside";
  /** Reuse this controller for the shown tab's instance; undefined while the session is empty. */
  bind?(instance: string | undefined): void;
  /** The panel is gone for good (its module was hidden): what it holds in a service lets go (a Save Explorer's open save). */
  dispose?(): void;
  /** The panel's own palette commands (its presentation state, e.g. folding), read when the palette opens. */
  commands?(): Command[];
  /** Bring one part of the panel into view and focus it (Settings: a group, `settings-sections.ts`). */
  show?(section?: string): void };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Library facts derived only from the draft summary and saved list; nothing is guessed. */
export function libraryState(frame: Frame) {
  const library = frame.library, draft = library.draft;
  // A read-only window (another one holds the workspace) saves nothing, so it makes no claim about saving (t-read-only-window).
  const lease = frame.status?.lease;
  if (lease && !lease.writable) return { tone: "neutral" as const, label: "Read-only", detail: lease.message };
  if (!draft) return { tone: "neutral" as const, label: "Loading library…", detail: "" };
  const stored = library.summaries.find(item => item.id === draft.id);
  if (library.busy && library.progress?.phase === "working") return { tone: "info" as const, label: "Working…", detail: library.progress.message };
  // Plain chip labels; version numbers live in the tooltip/detail line. Work is always in the library (it saves itself as you go); the
  // chip says how it stands against the last version saved (profiles design §2.2: Save version).
  if (draft.revision === undefined) return { tone: "info" as const, label: "No version yet",
    detail: "Your work saves itself to your library as you go. Save version keeps a version you can return to." };
  if (stored && stored.revision > draft.revision) return { tone: "warning" as const, label: "Newer version saved",
    detail: `Version ${stored.revision} was saved elsewhere; this collection was last saved here as version ${draft.revision}. Save version keeps yours as the newest, or Save as new collection keeps both.` };
  const persistence = frame.persistence;
  if (persistence?.baseline === "known" && !persistence.dirty) return { tone: "neutral" as const, label: "Saved",
    detail: `Matches version ${draft.revision} in your library.` };
  if (persistence?.baseline === "known") {
    const presets = persistence.dirtyPresets.length;
    const what = [persistence.structureDirty ? "the collection's name or order" : "",
      presets ? `${presets} ${presets === 1 ? "preset" : "presets"}` : ""].filter(Boolean).join(" and ");
    return { tone: "info" as const, label: "Changed since last version",
      detail: `Changed since version ${draft.revision}: ${what}. Save version makes version ${draft.revision + 1}.` };
  }
  // The last version couldn't be read back, so nothing can be compared: the chip names the version and makes no claim about changes. It is
  // read again on the next library refresh (c-chips).
  if (persistence?.baseline === "unavailable") return { tone: "neutral" as const, label: `Version ${draft.revision}`,
    detail: `Your work saves itself as you go. Version ${draft.revision} couldn't be read back from your library to compare with, so XF Studio can't say what changed since; Save version keeps a new version.` };
  // The last version's content is being read back to compare with: the library is at work (c-chips' words). Only while that read runs.
  return { tone: "info" as const, label: "Working…",
    detail: `Comparing your work with version ${draft.revision} in your library. Your work saves itself as you go.` };
}

/**
 * “Reopen previous”, on the toast after an open or import, shows the collection that was shown before the request again, but only while
 * that is still the one to go back to; otherwise it would show the wrong one. Nothing is replaced by opening or importing: the collection
 * shown before stays in the library. Reopen is the one name for this, wherever it is offered (style guide glossary).
 */
export function reopenPreviousAction(rt: StudioRuntime): FeedbackAction {
  const before = rt.port.library.summary().draft?.id;
  return { label: "Reopen previous", run: () => {
    if (!before || rt.port.library.summary().draft?.previous?.id !== before) {
      rt.feedback.toast("warning", "Library", "The collection from before that change is no longer the one to go back to. Open it from the Library panel.");
      return;
    }
    void rt.file({ kind: "collection.recover" });
  } };
}
/** Shared by the Library panel and the command palette. */
export function importCollection(rt: StudioRuntime, _anchor?: MenuAnchor) {
  void rt.file({ kind: "collection.import" }, { actions: [reopenPreviousAction(rt)] });
}

export function packagePanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  // The game and mod manager are chosen in Settings (UI-109); here, one line says whether Build and Add are ready, with the way there.
  const showSetup = () => rt.settings.open("game");
  const setupLine = h("p", { class: "setup-status", role: "status" });
  // When the line says WolvenKit is needed, its one next step is the button beside it (release-readiness-audit.md item 14).
  const wolvenKitStep = wolvenKitStepButton(rt);
  // Named after the Settings group it mirrors (release-readiness-audit.md C-6).
  const setup = section({ title: "Game", help: "Your game folder and mod manager are chosen in Settings › Game; your own WolvenKit, if you use one, in Settings › Tools." },
    setupLine, h("div", { class: "row wrap gap-s" }, wolvenKitStep.element, button({ label: "Open Settings", icon: "settings", small: true, onClick: showSetup })));
  const check = button({ label: "Check", icon: "check", title: "Check which presets and layers can become mod files (creates no files)", onClick: () => void runPackage("check") });
  const build = button({ label: "Build mod files…", icon: "package", variant: "primary", onClick: event => confirmBuild(event.currentTarget as Element) });
  // While the latest Build is current, its result's Add is the one primary action: Build again is a secondary one.
  const rebuild = button({ label: "Build mod files…", icon: "package", onClick: event => confirmBuild(event.currentTarget as Element) });
  // The progress line keeps its place while nothing runs, so starting or finishing work never moves the panel (UI-90).
  const progressText = h("p", { class: "progress-text" });
  const progressLine = progressBar({ label: "Package request in progress" });
  const progress = h("div", { class: "package-progress idle" }, progressLine.element, progressText);
  const result = h("div", { class: "package-result", "aria-live": "polite" });
  let resultSignature = "";
  // Which XF mods the draft builds: one by default, named after its feature; the person may rename a mod and, once the
  // collection has more than one exportable feature, move a feature into a mod of its own (feature-module platform §6).
  const mods = h("ul", { class: "result-list package-mods", "aria-label": "Mods this collection builds" });
  let modsSignature = "";
  const renameMod = (product: PackageProductSummary, anchor: Element) => {
    const make = (modName: string) => ({ kind: "package.rename" as const, productId: product.id, modName });
    openValuePopover({ kind: "text", label: "Mod name", value: product.modName, maxLength: 80 }, anchor,
      { title: "Rename mod", apply: "Rename", hint: MOD_NAME_HINT, validate: value => port.authoring.capability(make(String(value))),
        commit: value => { if (rt.dispatch(make(String(value)))) rt.feedback.announce(`Mod renamed to ${String(value).trim() || "its default name"}`); } });
  };
  /** The mod's menu; while it would hold only Rename… (a default name, one feature, one mod), its button renames directly (UI-143). */
  const modItems = (product: PackageProductSummary, products: readonly PackageProductSummary[], anchor: Element) => {
    const items: MenuItem[] = [{ kind: "action", label: "Rename…", icon: "rename", run: () => renameMod(product, anchor) }];
    if (product.nameSource === "plan") items.push({ kind: "action", label: "Use the default name", icon: "reset",
      capability: port.authoring.capability({ kind: "package.rename", productId: product.id, modName: "" }),
      run: () => { rt.dispatch({ kind: "package.rename", productId: product.id, modName: "" }); } });
    // Moving features between mods is offered only where there is something to move.
    if (product.features.length > 1) for (const feature of product.features) items.push({ kind: "action", label: `Make ${feature.label.toLowerCase()} a mod of its own`,
      icon: "export", capability: port.authoring.capability({ kind: "package.split", feature: feature.id }),
      run: () => { rt.dispatch({ kind: "package.split", feature: feature.id }); } });
    for (const other of products) if (other.id !== product.id) items.push({ kind: "action", label: `Merge into “${other.modName}”`, icon: "import",
      capability: port.authoring.capability({ kind: "package.merge", productId: product.id, intoId: other.id }),
      run: () => { rt.dispatch({ kind: "package.merge", productId: product.id, intoId: other.id }); } });
    return items;
  };
  const onlyRename = (product: PackageProductSummary, products: readonly PackageProductSummary[]) =>
    product.nameSource !== "plan" && product.features.length < 2 && products.length < 2;
  const renderMods = (products: readonly PackageProductSummary[], planIssue?: string) => {
    const signature = JSON.stringify([products, planIssue ?? null]);
    if (signature === modsSignature) return;
    modsSignature = signature;
    // A plan made with a newer version (or damaged) is kept as it came; the service says why in plain words (CORE-91).
    if (planIssue) mods.replaceChildren(h("li", {}, icon("warning"), h("span", { text: planIssue })));
    // While its menu would hold only Rename…, the mod line's action renames directly (UI-143).
    else mods.replaceChildren(...products.map(product => modLine({ name: product.modName, kind: product.features.map(feature => feature.label).join(", "),
      action: onlyRename(product, products)
        ? button({ label: `Rename ${product.modName}…`, icon: "rename", iconOnly: true, variant: "ghost", small: true,
          onClick: event => renameMod(product, event.currentTarget as Element) })
        : button({ label: `${product.modName} options`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true,
          onClick: event => { const anchor = event.currentTarget as Element; openMenu(modItems(product, products, anchor), anchor, { label: `${product.modName} options`, invoker: anchor }); } }) })));
    mods.hidden = !products.length && !planIssue;
  };
  // After Build, each mod offers "Add to my mod manager…" (a reviewed plan, then consent) and "Show in folder" (UI-82). The rows
  // live outside the result card, so a repaint updates them in place.
  const installRows = new Map<string, { element: HTMLElement; add: HTMLButtonElement; show: HTMLButtonElement; line: HTMLElement }>();
  const installRow = (product: string) => {
    let row = installRows.get(product);
    if (!row) {
      const add: HTMLButtonElement = button({ label: "Add to my mod manager…", icon: "package", small: true, variant: "primary",
        onClick: () => { openModInstallSheet(rt, product, { openSetup: showSetup, rename: () => {
          // A name MO2 or the game folder can't take: rename the mod where its name is set (UI-99).
          const summary = port.library.summary().products?.find(item => item.id === product);
          if (summary) renameMod(summary, add);
        } }); } });
      const show = button({ label: "Show in folder", icon: "folder", small: true, onClick: () => void port.modInstall.dispatch({ kind: "modInstall.reveal", product })
        .then(outcome => { if (!outcome.ok) rt.feedback.toast("warning", "Mod package", outcome.message, [], { code: outcome.code }); }) });
      const line = h("p", { class: "install-line small", role: "status" });
      row = { element: h("div", { class: "install-row" }, h("div", { class: "row wrap gap-s" }, add, show), line), add, show, line };
      installRows.set(product, row);
    }
    return row;
  };
  async function runPackage(action: "check" | "build") {
    await rt.request({ kind: "package", action }, { quietSuccess: false });
  }
  function confirmBuild(anchor: Element) {
    openMenu([{ kind: "heading", label: "Build your mod files?", detail: "Uses this collection as it is now, your latest edits included. Can take a minute or two, and can't be cancelled once started. Nothing is added to your game or mod manager until you choose to." },
      { kind: "action", label: "Build now", icon: "package", capability: buildCapability(), run: () => void runPackage("build") },
      { kind: "action", label: "Check first", icon: "check", capability: port.files.capability({ kind: "package.check" }), run: () => void runPackage("check") }],
    anchor, { label: "Confirm build", invoker: anchor });
  }
  // Build readiness (including the host's Build setup) is part of the file capability.
  const buildCapability = () => port.files.capability({ kind: "package.build" });
  // No list of finishes here (release-readiness-audit.md item 7): the finish picker groups them by what can be built, and Check
  // names every layer it leaves out.
  const element = h("div", { class: "panel-content" },
    section({ title: "Mod package", help: [`Builds your own copy of your XF mods from this collection as it is now, your latest edits included.`,
      `Eye makeup becomes ${EYE_MAKEUP_MOD.modName}: each preset is one choice in the character creator's “${EYE_MAKEUP_MOD.selectorLabel}” selector.`,
      "Check names any layer it would leave out, and why. The finish picker groups finishes by what can be built."] },
      // Check, then the primary Build last; the progress takes the rest of the same row (one line, reserved), so it adds no band.
      mods, h("div", { class: "row gap-s package-actions" }, check, build, rebuild, progress)),
    result,
    setup);
  rt.anchors.register("package.check", check);
  return {
    spec: { id: "package", ...PANEL_META["package"], element },
    update(frame) {
      const files = frame.files, library = frame.library;
      applyCapability(check, port.files.capability({ kind: "package.check" }));
      applyCapability(build, buildCapability());
      applyCapability(rebuild, buildCapability());
      const builtCurrent = files.package?.kind === "packageBuild" && files.package.freshness === "current";
      build.hidden = builtCurrent; rebuild.hidden = !builtCurrent;
      renderMods(frame.library.products ?? [], frame.library.packagePlanIssue);
      const line = setupStatus(frame);
      setText(setupLine, line.text); setupLine.className = `setup-status ${line.tone}`;
      wolvenKitStep.update(frame, wantsWolvenKitStep(frame));
      const working = library.busy && library.progress?.code === "package";
      progress.classList.toggle("idle", !working);
      setText(progressText, working ? library.progress!.message : "");
      // A Build that says which stage it has reached fills the bar that far (PIPE-131); otherwise it sweeps.
      progressLine.set(working && typeof library.progress?.fraction === "number" ? library.progress.fraction : null);
      progressText.title = progressText.textContent ?? "";
      const lastError = files.last && !files.last.ok && (files.last.kind === "package.check" || files.last.kind === "package.build") ? files.last : undefined;
      const signature = JSON.stringify([files.package, lastError, library.draft?.presets.map(p => [p.id, p.name])]);
      if (signature !== resultSignature) {
        resultSignature = signature;
        const pkg = files.package;
        result.replaceChildren(pkg ? renderResult(pkg, library.draft?.presets ?? [], installRow, showSetup) : lastError ? failureCard(rt, lastError)
          : emptyState("No check yet", "Run Check to see which presets and layers can become mod files. Check creates no files."));
      }
      // The install rows follow every paint: availability, and what happened last.
      const installs = frame.modInstall, route = frame.localSetup.view?.fields.launchRoute;
      for (const [product, row] of installRows) {
        setButtonLabel(row.add, modInstallLabel(route));
        applyCapability(row.add, port.modInstall.capability({ kind: "modInstall.review", product }));
        applyCapability(row.show, port.modInstall.capability({ kind: "modInstall.reveal", product }));
        const outcome = installs.outcomes[product];
        setText(row.line, outcome?.message ?? "");
        row.line.className = `install-line small${outcome ? outcome.ok ? " done" : " warning" : ""}`;
      }
      const buildNext = result.querySelector<HTMLElement>("[data-build-next]");
      const built = files.package?.kind === "packageBuild" ? files.package.result.products.map(product => product.productId) : [];
      if (buildNext) buildNext.hidden = built.length > 0 && built.every(product => installs.outcomes[product]?.ok);
    },
  };
}

/**
 * A failed Check or Build (UI-94): what failed in plain words, that the collection is unchanged, and "Report this problem" with
 * the failure's reference when it wasn't an ordinary refusal. The code and time stay in Details for the report.
 */
function failureCard(rt: StudioRuntime, failed: ReadonlyDeep<{ kind: string; code: string; message: string; at: number }>) {
  const build = failed.kind === "package.build";
  const expected = rt.port.diagnostics.expected(failed.code);
  const report = button({ label: "Report this problem", icon: "warning", small: true, onClick: () => { openReportDialog(rt, null); } });
  applyCapability(report, rt.port.diagnostics.capability({ kind: "diagnostics.prepareReport" }));
  return h("div", { class: "result-card error" }, icon(expected ? "warning" : "error"),
    h("div", {}, h("strong", { text: build ? "Build didn't finish" : "Check didn't finish" }), h("p", { text: failed.message }),
      h("p", { class: "muted small", text: "Your collection is unchanged." }),
      expected ? null : h("div", { class: "row wrap gap-s" }, report),
      technicalDetails([["Code", failed.code], ["Time", new Date(failed.at).toLocaleString()]])));
}

/** A collapsed "Details" block with a Copy button: codes, hashes and paths for bug reports. */
function technicalDetails(rows: [string, string][], footnote?: string) {
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const copy = button({ label: "Copy details", icon: "duplicate", small: true, variant: "quiet", onClick: () => {
    void navigator.clipboard?.writeText(text).then(() => setButtonLabel(copy, "Copied"), () => {});
  } });
  return h("details", { class: "result-details" }, h("summary", { text: "Details" }),
    h("dl", { class: "facts" }, ...rows.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", {}, h("code", { class: "hash", text: value }))])),
    footnote ? h("p", { class: "muted small", text: footnote }) : null, copy);
}

type PackageResultView = ReadonlyDeep<{ kind: "packageCheck"; result: PackageCheckResult; freshness: "current" | "stale" } |
  { kind: "packageBuild"; result: PackageBuildResult; freshness: "current" | "stale" }>;
function renderResult(pkg: PackageResultView, presets: readonly { id: string; name: string }[],
  installRow: (product: string) => { element: HTMLElement }, openSetup: () => void) {
  const name = (id: string) => presets.find(preset => preset.id === id)?.name ?? "Preset no longer in draft";
  const isBuild = pkg.kind === "packageBuild";
  const r = pkg.result;
  const retained = new Set(r.products.flatMap(product => product.features.flatMap(feature => feature.presets.map(look => look.id)))).size;
  const card = h("div", { class: `result-card ${pkg.freshness === "stale" ? "stale" : "ok"}` },
    h("div", { class: "result-head" }, h("strong", { text: isBuild ? "Build result" : "Check result" }),
      pkg.freshness === "current" ? badge("Current", "success") : badge("Stale — changed since", "warning")),
    h("p", { class: "result-summary", text: `${retained} of ${r.originalPresetCount} preset${r.originalPresetCount === 1 ? "" : "s"} can become mod files.${isBuild ? "" : " This check created no files."}` }));
  // One block per mod the collection builds (one by default); each feature in it has its own selector.
  for (const product of r.products) {
    // The product line says whom each feature's part is for when the feature says (eye makeup: a feminine and a masculine V).
    const block = h("div", { class: "result-product" }, h("p", { class: "muted small" }, "Mod ", h("strong", { text: product.modName }),
      product.features.map(feature => ` · ${feature.label} in the “${feature.selectorLabel}” selector${feature.audience ? `, ${feature.audience}` : ""}`).join("")));
    // The game's own names for the looks (appearance IDs) are in Details, not the list (UI-85).
    if (!isBuild) block.append(h("ul", { class: "result-list" }, product.features.flatMap(feature => feature.presets.map(preset =>
      h("li", {}, icon("check"), h("span", { text: name(preset.id) }))))));
    // A built mod is added to the mod manager, or its folder shown, from here; its path is in Details (UI-82).
    if (isBuild) block.append(installRow(product.productId).element);
    card.append(block);
    // What the mod falls short of (eye makeup: not for a masculine V this time): one warning each, the reason and the step,
    // directly under its product and above the build note, with the button that takes the step.
    // Once per wording: the same warning from two features shows once (UI-149).
    for (const warning of new Map(product.features.flatMap(feature => feature.warnings ?? []).map(item => [item.text, item] as const)).values()) {
      card.append(note(warning.text, "warning"));
      if (warning.next === "settings.game") card.append(h("div", { class: "row wrap gap-s" },
        button({ label: "Open Settings", icon: "settings", small: true, onClick: openSetup })));
    }
  }
  // e.g. before any plate was prepared for this route, Check cannot tell which looks reach the eye area; Build does. A Build's
  // notes say what the mod is not made for (a masculine V, when his eye plate couldn't be prepared).
  for (const text of new Set(r.products.flatMap(product => product.features.flatMap(feature => feature.notes)))) card.append(note(text, "info"));
  // Each omission once: whole looks, parts and features (the host decided them), then each feature's own, labelled with
  // its feature when several features export (PIPE-88; the same order as `resultOmissions` in the export contract).
  const features = r.products.flatMap(product => product.features), several = new Set(features.map(feature => feature.feature)).size > 1;
  const omissions = [...r.omissions.map(omission => ({ omission, label: undefined as string | undefined })),
    ...features.flatMap(feature => feature.omissions.map(omission => ({ omission, label: several ? feature.label : undefined })))];
  if (omissions.length) card.append(h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Omitted from the package" }),
    h("ul", { class: "result-list" }, omissions.map(({ omission: item, label }) => h("li", {}, icon("warning"),
      h("span", { text: item.kind === "layer" ? `${label ? `${label} layer` : "Layer"} “${item.layerName}” in “${item.presetName}” — ${item.reason}` :
        item.kind === "part" ? `The ${item.feature} part of “${item.presetName}” — ${item.reason}` :
        item.kind === "feature" ? `${item.label} — ${item.reason}` :
        label ? `${label} of “${item.presetName}” — ${item.reason}` :
        `Whole preset “${item.presetName}” — ${item.reason}` }))))));
  // The next step until every mod is added (hidden then: each install line says where its mod is).
  if (isBuild) {
    const next = note(r.products.length === 1 ? "Add it to your mod manager, or show its folder to copy it by hand."
      : "Add them to your mod manager, or show their folders to copy them by hand.", "info");
    next.dataset.buildNext = "";
    card.append(next);
  }
  // Technical facts stay available for bug reports without crowding the result.
  card.append(technicalDetails([
    ...(isBuild ? (r as ReadonlyDeep<PackageBuildResult>).products.flatMap(product => [[`${product.modName} files`, product.package],
      [`${product.modName} manifest`, product.manifest],
      [`${product.modName} archive SHA-256`, product.archiveSha256]] as [string, string][]) : []),
    ...(!isBuild ? r.products.flatMap(product => product.features.flatMap(feature => feature.presets.map(preset =>
      [`“${name(preset.id)}” in game`, String(preset.appearance ?? "")] as [string, string]))) : []),
    ["Collection fingerprint (SHA-256)", r.collectionSha256],
    ...r.products.flatMap(product => product.features.map(feature => [`${feature.label} fingerprint (SHA-256)`, feature.packagedSha256] as [string, string]))]));
  if (pkg.freshness === "stale") card.append(note("Your collection changed after this result. Run Check again.", "warning"));
  setAttr(card, "data-freshness", pkg.freshness);
  return card;
}
