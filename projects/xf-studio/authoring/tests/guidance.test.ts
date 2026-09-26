import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { bindingReference, KEY_BINDINGS } from "../src/input-bindings";
import { ACTION_DESCRIPTORS, FILE_DESCRIPTORS, PREVIEW_SETUP_DESCRIPTORS } from "../src/studio-action-descriptors";
import { isProjectLink } from "../src/project-links";
import { parseUIPreferences, UIPreferenceActions } from "../src/ui-preferences";
import { AnchorRegistry, anchorCatalogue, anchorInfo, CONTROL_ANCHORS, isAnchorId, type AnchorId, type AnchorState } from "../src/studio-ui/guidance/anchors";
import { keyTokens, parseHelp, plainText } from "../src/studio-ui/guidance/content";
import { conditionHolds, eventHappened, GUIDANCE_DESCRIPTORS, GuidanceService, type GuidanceEnvironment } from "../src/studio-ui/guidance/engine";
import { exportableFinishClause, finishExportHelp } from "../src/studio-ui/guidance/finish-text";
import { HELP_LINKS, HELP_TOPICS, helpReference, helpTopicsFor, searchTopics, searchTours } from "../src/studio-ui/guidance/help-topics";
import { tourKey } from "../src/studio-ui/guidance/overlay";
import { NARROW_WIDTH, placeCallout } from "../src/studio-ui/guidance/placement";
import { ONBOARDING_TOUR_ID, TOURS, toursFor } from "../src/studio-ui/guidance/tours";
import type { GuidanceFacts, Tour, TourCommand } from "../src/studio-ui/guidance/types";
import type { StudioPanelId } from "../src/studio-ui/layout-defaults";
import { PANEL_IDS, PANEL_META } from "../src/compose/views";
import { studioShortcut } from "../src/studio-ui/shortcuts";
import { finishCatalogue } from "./fixtures/eye-region";

const root = resolve(import.meta.dir, "..", "src");
const guidanceDir = join(root, "studio-ui", "guidance");
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
});

// ---------- Tour data validation ----------

function commandProblems(command: TourCommand, where: string): string[] {
  switch (command.kind) {
    case "studio": return command.action.kind in ACTION_DESCRIPTORS ? [] : [`${where}: unknown action ${command.action.kind}`];
    case "studio.activeLayer": {
      const descriptor = (ACTION_DESCRIPTORS as Record<string, { payload: Record<string, unknown> }>)[command.action.kind];
      return descriptor?.payload.layerId ? [] : [`${where}: ${command.action.kind} is not a layer action`];
    }
    case "file": return command.action.kind in FILE_DESCRIPTORS ? [] : [`${where}: unknown file workflow ${command.action.kind}`];
    case "previewSetup": return command.action.kind in PREVIEW_SETUP_DESCRIPTORS ? [] : [`${where}: unknown setup action ${command.action.kind}`];
    case "panel": return (PANEL_IDS as readonly string[]).includes(command.panel) ? [] : [`${where}: unknown panel ${command.panel}`];
  }
}

test("tour data names only registered anchors, catalogued actions and real key bindings", () => {
  const problems: string[] = [];
  const ids = TOURS.map(tour => tour.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const tour of TOURS) {
    expect(tour.id).toMatch(/^[a-z0-9][a-z0-9.-]{0,63}$/);
    tour.steps.forEach((step, index) => {
      const where = `${tour.id}#${index + 1}`;
      if (step.anchor && !isAnchorId(step.anchor)) problems.push(`${where}: unknown anchor ${step.anchor}`);
      const panel = step.anchor && isAnchorId(step.anchor) ? anchorInfo(step.anchor)?.panel : undefined;
      if (panel && !(PANEL_IDS as readonly string[]).includes(panel)) problems.push(`${where}: unknown panel ${panel}`);
      for (const button of step.buttons ?? []) if (typeof button.action !== "string") problems.push(...commandProblems(button.action, where));
      for (const id of keyTokens(`${step.content.title} ${step.content.body}`))
        if (!KEY_BINDINGS.some(binding => binding.id === id)) problems.push(`${where}: unknown key binding ${id}`);
      const conditions = step.advanceWhen ? [step.advanceWhen] : [];
      while (conditions.length) {
        const condition = conditions.pop()!;
        if ("any" in condition) conditions.push(...condition.any);
        else if ("capability" in condition) problems.push(...commandProblems(condition.capability, where));
        else if ("panelVisible" in condition && !(PANEL_IDS as readonly string[]).includes(condition.panelVisible)) problems.push(`${where}: unknown panel`);
      }
      // Plain, friendly text: a title and some body, no developer jargon.
      expect(step.content.title.length).toBeGreaterThan(3);
      expect(plainText(step.content.body).length).toBeGreaterThan(20);
      expect(`${step.content.title} ${step.content.body}`).not.toMatch(/\b(dispatch|capability|anchor|payload|recipe|UV space|API|port)\b/i);
    });
  }
  expect(problems).toEqual([]);
  const onboarding = TOURS.find(tour => tour.id === ONBOARDING_TOUR_ID)!;
  expect(onboarding.audience).toBe("onboarding");
  expect(onboarding.steps.length).toBeGreaterThanOrEqual(6);
  expect(onboarding.steps.length).toBeLessThanOrEqual(8);
  const whatsNew = TOURS.find(tour => tour.audience === "whats-new")!;
  expect(whatsNew.version).toBe("0.1.0-alpha.1");
  expect(whatsNew.steps.length).toBeGreaterThanOrEqual(3);
  expect(whatsNew.steps.length).toBeLessThanOrEqual(4);
});

test("every control anchor is registered by a panel or the shell, and every panel is an anchor", () => {
  // The shell's panels and every feature's view register anchors.
  const sources = [...files(join(root, "studio-ui")), ...files(join(root, "features"))].map(file => readFileSync(file, "utf8")).join("\n");
  const registered = new Set([...sources.matchAll(/anchors\.register\("([a-z.]+)"/g)].map(match => match[1]));
  for (const match of sources.matchAll(/\["(header\.[a-z]+)", [a-zA-Z]+\]/g)) registered.add(match[1]);
  expect(Object.keys(CONTROL_ANCHORS).filter(id => !registered.has(id))).toEqual([]);
  // Nothing registers an anchor the catalogue doesn't know.
  expect([...registered].filter(id => !isAnchorId(id))).toEqual([]);
  expect(readFileSync(join(root, "studio-ui", "app.ts"), "utf8")).toContain("rt.anchors.register(panelAnchor(panel.spec.id");
  for (const panel of PANEL_IDS) expect(anchorInfo(`panel.${panel}`)?.panel).toBe(panel);
  // Every control anchor inside a panel names a real panel.
  for (const info of anchorCatalogue(PANEL_IDS)) if (info.panel) expect(PANEL_IDS as readonly string[]).toContain(info.panel);
  // A panel anchor is known by its form; which panels exist is the catalogue's to say.
  expect(anchorInfo("panel.hair.strands")?.panel).toBe("hair.strands");
  expect(isAnchorId("panel.")).toBe(false);
  expect(isAnchorId("layers.bogus")).toBe(false);
});

test("the registry reports visible, hidden and missing anchors from layout boxes only", () => {
  const box = (width: number, height: number, isConnected = true) => ({ isConnected, getBoundingClientRect: () => ({ left: 10, top: 20, width, height }) });
  const registry = new AnchorRegistry<ReturnType<typeof box>>();
  expect(registry.state("layers.add")).toBe("missing");
  const unregister = registry.register("layers.add", box(80, 24));
  expect(registry.state("layers.add")).toBe("visible");
  expect(registry.rect("layers.add")).toEqual({ x: 10, y: 20, w: 80, h: 24 });
  registry.register("uv.canvas", box(0, 0));
  expect(registry.state("uv.canvas")).toBe("hidden");
  registry.register("head.view", box(10, 10, false));
  expect(registry.state("head.view")).toBe("missing");
  unregister();
  expect(registry.state("layers.add")).toBe("missing");
  expect(() => registry.register("no.such" as AnchorId, box(1, 1))).toThrow();
});

// ---------- Engine ----------

const baseFacts: GuidanceFacts = { layers: 1, activeLayer: "a", finish: "matte", color: "#905774", edit: "1:0:s1", presets: 1, lighting: "studio", visiblePanels: ["layers", "uv", "head"] };
function environment(overrides: Partial<{ anchors: Partial<Record<AnchorId, AnchorState>>; panels: StudioPanelId[]; unavailable: string[] }> = {}) {
  let facts = { ...baseFacts };
  const recorded: [string, string][] = [];
  const env: GuidanceEnvironment = {
    facts: () => facts,
    anchor: id => overrides.anchors?.[id] ?? "visible",
    panelVisible: panel => (overrides.panels ?? ["layers", "uv", "head", "finish", "presets"]).includes(panel),
    panelTitle: panel => (PANEL_META as Record<string, { title: string }>)[panel]?.title ?? panel,
    capability: command => command.kind === "studio" && overrides.unavailable?.includes(command.action.kind)
      ? { available: false, reason: "Not now." } : { available: true },
    record: (tourId, outcome) => { recorded.push([tourId, outcome]); },
  };
  return { env, recorded, set(next: Partial<GuidanceFacts>) { facts = { ...facts, ...next }; } };
}
const tour = (steps: Tour["steps"]): Tour => ({ id: "t", title: "Test", summary: "A test tour.", audience: "howto", steps });
const content = { title: "Step", body: "Some helpful words for this step." };

test("guidance actions are catalogued and follow the start, next, back, skip and finish state machine", () => {
  expect(Object.keys(GUIDANCE_DESCRIPTORS).sort()).toEqual(["guidance.back", "guidance.finish", "guidance.next", "guidance.skip", "guidance.startTour"]);
  for (const descriptor of Object.values(GUIDANCE_DESCRIPTORS)) expect(descriptor).toMatchObject({ scope: ["guidance"], effect: "view", undo: "none" });
  const { env, recorded } = environment();
  const service = new GuidanceService([tour([{ anchor: "layers.add", content }, { anchor: "uv.canvas", content }, { content }])], env);
  expect(service.capability({ kind: "guidance.next" })).toMatchObject({ available: false });
  expect(service.dispatch({ kind: "guidance.startTour", tourId: "missing" })).toMatchObject({ ok: false });
  expect(service.dispatch({ kind: "guidance.startTour", tourId: "t" })).toEqual({ ok: true });
  let active = service.snapshot().active!;
  expect(active).toMatchObject({ index: 0, count: 3, first: true, last: false, target: { kind: "anchor", anchor: "layers.add" } });
  expect(active.buttons.map(button => button.label)).toEqual(["Next"]);
  expect(service.capability({ kind: "guidance.back" }).available).toBe(false);
  expect(service.capability({ kind: "guidance.finish" }).available).toBe(false);
  service.dispatch({ kind: "guidance.next" });
  expect(service.snapshot().active!.buttons.map(button => button.label)).toEqual(["Back", "Next"]);
  service.dispatch({ kind: "guidance.back" });
  expect(service.snapshot().active!.index).toBe(0);
  service.dispatch({ kind: "guidance.next" }); service.dispatch({ kind: "guidance.next" });
  active = service.snapshot().active!;
  expect(active).toMatchObject({ index: 2, last: true, target: { kind: "none" } });
  expect(active.buttons.map(button => button.label)).toEqual(["Back", "Done"]);
  expect(service.dispatch({ kind: "guidance.finish" })).toEqual({ ok: true });
  expect(service.snapshot()).toMatchObject({ active: null, last: { tourId: "t", outcome: "completed" } });
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  service.dispatch({ kind: "guidance.skip" });
  expect(recorded).toEqual([["t", "completed"], ["t", "skipped"]]);
  // Next on the last step completes the tour, like Done.
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  for (let i = 0; i < 3; i++) service.dispatch({ kind: "guidance.next" });
  expect(recorded.at(-1)).toEqual(["t", "completed"]);
});

test("starting a tour while another runs ends the running one as skipped, recorded once, before the new one starts (UI-43)", () => {
  const { env, recorded } = environment();
  const other: Tour = { ...tour([{ content }, { content }]), id: "other", audience: "whats-new" };
  const service = new GuidanceService([tour([{ content }, { content }, { content }]), other], env);
  const notices: (string | undefined)[] = [];
  service.subscribe(() => notices.push(service.snapshot().active?.tour.id));
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  service.dispatch({ kind: "guidance.next" });
  expect(service.dispatch({ kind: "guidance.startTour", tourId: "other" })).toEqual({ ok: true });
  expect(recorded).toEqual([["t", "skipped"]]);
  expect(service.snapshot()).toMatchObject({ active: { tour: { id: "other" }, index: 0 }, last: { tourId: "t", outcome: "skipped" } });
  // Readers saw the first tour end before the second began.
  expect(notices).toEqual(["t", "t", undefined, "other"]);
  service.dispatch({ kind: "guidance.next" }); service.dispatch({ kind: "guidance.finish" });
  expect(recorded).toEqual([["t", "skipped"], ["other", "completed"]]);
  // Restarting the same tour mid-way records the abandoned run too.
  service.dispatch({ kind: "guidance.startTour", tourId: "t" }); service.dispatch({ kind: "guidance.next" });
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  expect(recorded.at(-1)).toEqual(["t", "skipped"]);
  expect(service.snapshot().active).toMatchObject({ tour: { id: "t" }, index: 0 });
});

test("advanceWhen moves on only when its event happens after the step starts, or its capability condition holds", () => {
  const { env, set } = environment();
  const service = new GuidanceService([tour([
    { content, advanceWhen: { event: "layer.added" } },
    { content, advanceWhen: { any: [{ event: "finish.changed" }, { event: "color.changed" }] } },
    { content, advanceWhen: { capability: { kind: "studio", action: { kind: "history.undo" } }, available: true } },
    { content, advanceWhen: { panelVisible: "history" } },
    { content },
  ])], env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  expect(service.snapshot().active!.waiting).toBe(true);
  expect(service.observe()).toBe(false);
  set({ layers: 2, activeLayer: "b", finish: "matte" });
  expect(service.observe()).toBe(true);
  expect(service.snapshot().active!.index).toBe(1);
  // The step's baseline is the moment it started: the earlier layer change doesn't count.
  expect(service.observe()).toBe(false);
  set({ finish: "metallic" });
  expect(service.observe()).toBe(true);
  expect(service.snapshot().active!.index).toBe(2);
  // Capability conditions ask the environment, like any other control.
  expect(service.observe()).toBe(true);
  expect(service.snapshot().active!.index).toBe(3);
  expect(service.observe()).toBe(false);
  set({ visiblePanels: [...baseFacts.visiblePanels, "history"] });
  expect(service.observe()).toBe(true);
  expect(service.snapshot().active!.index).toBe(4);
  // Pure event rules.
  expect(eventHappened("finish.changed", baseFacts, { ...baseFacts, finish: "glossy", activeLayer: "other" })).toBe(false);
  expect(eventHappened("recipe.edited", baseFacts, { ...baseFacts, edit: "2:1:s2" })).toBe(true);
  expect(eventHappened("preset.added", baseFacts, { ...baseFacts, presets: 2 })).toBe(true);
  expect(eventHappened("lighting.changed", baseFacts, { ...baseFacts, lighting: "creator" })).toBe(true);
  expect(conditionHolds({ any: [] }, baseFacts, baseFacts, () => ({ available: true }))).toBe(false);
});

test("a missing anchor offers its panel, lights the panel when only the control is hidden, or is skipped gracefully", () => {
  // The panel is closed: offer to show it through the ordinary panel command, or move on.
  let setup = environment({ anchors: { "history.list": "hidden" }, panels: ["layers"] });
  let service = new GuidanceService([tour([{ anchor: "history.list", content, buttons: [{ label: "Do it", action: { kind: "studio", action: { kind: "history.undo" } } }] }, { content }])], setup.env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  let active = service.snapshot().active!;
  expect(active.target).toEqual({ kind: "offer", anchor: "history.list", panel: "history", panelTitle: "History" });
  expect(active.buttons.map(button => [button.label, button.action])).toEqual([["Show History", { kind: "panel", panel: "history" }], ["Skip this step", "next"]]);
  // The panel is showing but the control isn't laid out (e.g. no layer selected): light the panel.
  setup = environment({ anchors: { "finish.picker": "hidden" }, panels: ["finish"] });
  service = new GuidanceService([tour([{ anchor: "finish.picker", content }])], setup.env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  expect(service.snapshot().active!.target).toEqual({ kind: "panel", anchor: "finish.picker", panel: "finish" });
  // A header anchor with no panel to open is skipped, in the direction of travel, never a crash.
  const anchors: Partial<Record<AnchorId, AnchorState>> = { "header.package": "missing" };
  setup = environment({ anchors });
  service = new GuidanceService([tour([{ content }, { anchor: "header.package", content }, { content: { ...content, title: "Last" } }])], setup.env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  service.dispatch({ kind: "guidance.next" });
  expect(service.snapshot().active!.index).toBe(2);
  service.dispatch({ kind: "guidance.back" });
  expect(service.snapshot().active!.index).toBe(0);
  // An anchor that disappears mid-step moves the tour on when it next observes.
  anchors["header.package"] = "visible";
  service.dispatch({ kind: "guidance.next" });
  expect(service.snapshot().active!.index).toBe(1);
  anchors["header.package"] = "missing";
  expect(service.observe()).toBe(true);
  expect(service.snapshot().active!.index).toBe(2);
  // A tour with nothing showable completes at once.
  service = new GuidanceService([tour([{ anchor: "header.package", content }])], setup.env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  expect(service.snapshot()).toMatchObject({ active: null, last: { outcome: "completed" } });
  // Unavailable commands stay listed, disabled, with their reason.
  setup = environment({ unavailable: ["history.undo"] });
  service = new GuidanceService([tour([{ content, buttons: [{ label: "Undo it", action: { kind: "studio", action: { kind: "history.undo" } } }] }])], setup.env);
  service.dispatch({ kind: "guidance.startTour", tourId: "t" });
  expect(service.snapshot().active!.buttons[0]).toMatchObject({ label: "Undo it", capability: { available: false, reason: "Not now." } });
});

test("tour progress is a bounded, validated UI preference", () => {
  const preferences = new UIPreferenceActions();
  expect(preferences.capability({ kind: "tours.record", tourId: "Bad id!", outcome: "completed" }).available).toBe(false);
  expect(preferences.capability({ kind: "tours.record", tourId: "onboarding", outcome: "maybe" as never }).available).toBe(false);
  preferences.dispatch({ kind: "tours.record", tourId: "onboarding", outcome: "declined" });
  expect(preferences.snapshot().tours).toEqual({ onboarding: "declined" });
  expect(parseUIPreferences({ ...preferences.snapshot(), tours: { onboarding: "completed", "__proto__": "completed", x: 3 } }).tours).toEqual({ onboarding: "completed" });
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true }).tours).toBeUndefined();
});

// ---------- Boundaries ----------

test("guidance modules stay presentation: no domain internals, and the runner and data are DOM-free", () => {
  const allowedValues = new Map([["input-bindings", ["bindingReference", "chordsLabel", "KEY_BINDINGS", "keyBinding", "shortcutLabel"]],
    ["mod-branding", ["EYE_MAKEUP_MOD"]]]);
  const problems: string[] = [];
  for (const file of files(guidanceDir)) {
    const source = readFileSync(file, "utf8"), name = relative(guidanceDir, file);
    for (const match of source.matchAll(/^import\s+(type\s+)?\{?([^}]*?)\}?\s*from\s+"([^"]+)";/gms)) {
      const [, typeOnly, names, specifier] = match;
      const target = resolve(file, "..", specifier);
      if (target.startsWith(join(root, "studio-ui")) || typeOnly) continue;
      const module = relative(root, target).replaceAll("\\", "/");
      const values = names.split(",").map(item => item.trim()).filter(item => item && !item.startsWith("type "));
      const extra = values.filter(value => !(allowedValues.get(module) ?? []).includes(value));
      if (extra.length) problems.push(`${name} imports ${extra.join(", ")} from ${module}`);
    }
    if (/from "\.\.\/\.\.\/(authoring-|collection-|recipe|editor-actions|scene|trusted-|studio-application|studio-file-operations|browser-)/.test(source.replace(/^import type .*$/gm, "")))
      problems.push(`${name} imports a domain module`);
  }
  for (const pure of ["anchors.ts", "content.ts", "engine.ts", "finish-text.ts", "help-topics.ts", "placement.ts", "tours.ts", "types.ts"]) {
    const source = readFileSync(join(guidanceDir, pure), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    if (/\bdocument\.|\bwindow\.|\blocalStorage\b|\bfetch\(/.test(source)) problems.push(`${pure} touches the DOM or I/O`);
  }
  expect(problems).toEqual([]);
  // Buttons only name commands; the shell runs them through the same validated paths as every control.
  const controller = readFileSync(join(guidanceDir, "controller.ts"), "utf8");
  for (const path of ["rt.dispatch(command.action)", "rt.file(command.action)", "port.previewSetup.dispatch(command.action)", "rt.dock.reveal(command.panel"])
    expect(controller).toContain(path);
  expect(controller).not.toMatch(/controlBegin|beginGesture|applyGesture|library\.dispatch/);
});

// ---------- Help ----------

test("the Help keyboard and mouse reference is the binding catalogue, filtered by the search", () => {
  expect(helpReference("")).toEqual(bindingReference());
  expect(helpReference("   ")).toEqual(bindingReference());
  const undo = helpReference("undo");
  const rows = undo.flatMap(section => section.rows);
  expect(rows.length).toBeGreaterThan(0);
  const all = bindingReference().flatMap(section => section.rows);
  for (const row of rows) expect(all).toContainEqual(row);
  expect(rows.some(row => row.ids.includes("shell.undo"))).toBe(true);
  expect(helpReference("keyboard undo").flatMap(section => section.rows)).toEqual(rows);
  // The panel renders the derived reference; no hand-written shortcut table.
  const panel = readFileSync(join(guidanceDir, "help-panel.ts"), "utf8");
  expect(panel).toContain("helpReference(query)");
  expect(panel).not.toMatch(/Ctrl\+|"F1"/);
  // F1 opens Help; the tour keys are catalogued and listed in the reference.
  expect(studioShortcut({ key: "F1" }, { textInput: true, modalOpen: false })).toBe("guide");
  expect(studioShortcut({ key: "F1" }, { textInput: false, modalOpen: true })).toBeUndefined();
  const listed = bindingReference().flatMap(section => section.rows.flatMap(row => row.ids));
  for (const id of ["shell.help", "tour.skip", "tour.next", "tour.back"]) expect(listed).toContain(id);
});

test("help topics are data: valid key tokens, known tours, searchable; links are named pages only", () => {
  const ids = HELP_TOPICS.map(topic => topic.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const topic of HELP_TOPICS) {
    for (const id of keyTokens(topic.body)) expect(KEY_BINDINGS.some(binding => binding.id === id)).toBe(true);
    for (const tourId of topic.tours ?? []) expect(TOURS.some(item => item.id === tourId)).toBe(true);
    expect(parseHelp(topic.body).length).toBeGreaterThan(0);
  }
  expect(searchTopics("").length).toBe(HELP_TOPICS.length);
  expect(searchTopics("GLITTER").map(topic => topic.id)).toContain("finishes");
  expect(searchTopics("preview only", helpTopicsFor(finishCatalogue())).map(topic => topic.id)).toContain("finishes");
  expect(searchTopics("undo history")[0].id).toBe("undo");
  expect(searchTopics("zzzz nothing")).toEqual([]);
  expect(searchTours("new", TOURS).map(item => item.id)).toContain("whats-new-0.1.0-alpha.1");
  for (const item of HELP_LINKS) expect(isProjectLink(item.link)).toBe(true);
  // Markdown-lite: bold, bullets and key tokens become structure, never markup.
  expect(parseHelp("Hi **there** [[key:shell.undo]]\n\n- one\n- two <b>")).toEqual([
    { kind: "p", inlines: [{ kind: "text", text: "Hi " }, { kind: "strong", text: "there" }, { kind: "text", text: " " }, { kind: "key", id: "shell.undo", label: "Ctrl+Z" }] },
    { kind: "list", items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two <b>" }]] },
  ]);
});

test("help and tour text about which finishes export is built from the finish catalogue, never restated (UI-44)", () => {
  const catalogue = finishCatalogue();
  const named = (adapter: string) => catalogue.filter(finish => finish.exportAdapter === adapter).map(finish => finish.shortLabel);
  // The data names no finish; the words are filled in from the catalogue the port publishes.
  for (const text of [...HELP_TOPICS.map(topic => topic.body), ...TOURS.flatMap(item => item.steps.map(step => step.content.body))])
    for (const finish of catalogue) expect(text).not.toContain(`**${finish.shortLabel}**`);
  const topics = helpTopicsFor(catalogue), tours = toursFor(catalogue);
  for (const text of [...topics.map(topic => topic.body), ...tours.flatMap(item => item.steps.map(step => step.content.body))]) expect(text).not.toContain("{{");
  const finishes = topics.find(topic => topic.id === "finishes")!;
  expect(finishes.body).toContain(finishExportHelp(catalogue));
  // Each finish is named once, in the sentence of its export status.
  const sentences = plainText(finishes.body).split(/(?<=\.) /);
  for (const finish of catalogue) {
    const sentence = sentences.filter(text => text.includes(finish.shortLabel));
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).toContain({ "flat-provisional": "can go into your mod", experimental: "can be built as experiments", none: "preview only" }[finish.exportAdapter]);
  }
  const step = tours.find(item => item.id === ONBOARDING_TOUR_ID)!.steps.find(item => item.anchor === "finish.picker")!;
  expect(step.content.body).toContain(exportableFinishClause(catalogue));
  for (const name of named("flat-provisional")) expect(step.content.body).toContain(name);
  for (const name of [...named("experimental"), ...named("none")]) expect(step.content.body).not.toContain(name);
  // A change in the route policy changes the words.
  const moved = catalogue.map(finish => finish.id === "glitter" ? { ...finish, exportAdapter: "experimental" as const } : finish);
  expect(finishExportHelp(moved)).not.toContain("preview only");
  expect(finishExportHelp(moved).split(". ").find(text => text.includes("**Glitter**"))).toContain("can be built as experiments");
  expect(exportableFinishClause([{ shortLabel: "Matte", exportAdapter: "flat-provisional" }])).toBe("Matte goes into your mod today");
});

// ---------- Accessibility and layout ----------

test("a11y: Esc skips, arrows and Enter navigate, Enter on a button presses it, and the card is a labelled non-modal dialog", () => {
  const card = { onButton: false, first: false, last: false };
  expect(tourKey({ key: "Escape" }, card)).toBe("skip");
  expect(tourKey({ key: "ArrowRight" }, card)).toBe("next");
  expect(tourKey({ key: "Enter" }, card)).toBe("next");
  expect(tourKey({ key: "Enter" }, { ...card, last: true })).toBe("finish");
  expect(tourKey({ key: "Enter" }, { ...card, onButton: true })).toBeUndefined();
  expect(tourKey({ key: "ArrowLeft" }, card)).toBe("back");
  expect(tourKey({ key: "ArrowLeft" }, { ...card, first: true })).toBe("consume");
  expect(tourKey({ key: "ArrowRight", ctrlKey: true }, card)).toBeUndefined();
  expect(tourKey({ key: "x" }, card)).toBeUndefined();
  const overlay = readFileSync(join(guidanceDir, "overlay.ts"), "utf8"), controller = readFileSync(join(guidanceDir, "controller.ts"), "utf8");
  expect(overlay).toContain(`role: "dialog", "aria-modal": "false"`);
  expect(overlay).toContain(`"aria-labelledby": titleId, "aria-describedby": bodyId`);
  expect(overlay).toMatch(/h\("h2", \{ class: "guidance-title", id: titleId, tabindex: "-1" \}\)/);
  // Focus moves into the card only on a person's own navigation, is restored afterwards, and each step is announced.
  expect(controller).toContain("if (focus) requestAnimationFrame(() => overlay.callout.focusTitle())");
  expect(controller).toContain("rt.feedback.announce(`${active.tour.title}, step ${active.index + 1} of ${active.count}");
  expect(controller).toMatch(/back\?\.focus\(\{ preventScroll: true \}\)/);
  // Esc elsewhere never steals a gesture's, menu's, dialog's or text field's Escape.
  expect(controller).toMatch(/event\.defaultPrevented[\s\S]*isTextInput\(event\.target\)[\s\S]*dialog\[open\], \.menu, \.popover[\s\S]*state\.gesture \|\| state\.control/);
});

test("the callout is placed beside, inside or as a sheet, always within the window", () => {
  const viewport = { w: 1600, h: 1000 }, size = { w: 360, h: 200 };
  expect(placeCallout(undefined, size, viewport)).toEqual({ x: 620, y: 400, side: "center" });
  expect(placeCallout({ x: 100, y: 100, w: 200, h: 40 }, size, viewport).side).toBe("right");
  expect(placeCallout({ x: 1300, y: 100, w: 280, h: 40 }, size, viewport).side).toBe("left");
  expect(placeCallout({ x: 100, y: 100, w: 200, h: 40 }, size, viewport, "bottom")).toMatchObject({ side: "bottom", y: 152 });
  const inside = placeCallout({ x: 0, y: 0, w: 1600, h: 1000 }, size, viewport);
  expect(inside.side).toBe("inside");
  const narrow = placeCallout({ x: 10, y: 600, w: 300, h: 100 }, size, { w: NARROW_WIDTH - 40, h: 800 });
  expect(narrow).toMatchObject({ side: "sheet", y: 12 });
  for (const place of [inside, narrow]) {
    expect(place.x).toBeGreaterThanOrEqual(12);
    expect(place.y).toBeGreaterThanOrEqual(12);
  }
  // The overlay and callout are fixed layers; the stylesheet gives them no flow position.
  const css = readFileSync(resolve(root, "..", "public", "studio.css"), "utf8");
  expect(css).toMatch(/\.guidance-layer \{ position: fixed; inset: 0;[^}]*pointer-events: none/);
  expect(css).toMatch(/\.guidance-callout \{ position: fixed;/);
  expect(css).toMatch(/--guidance-scrim: light-dark\(oklch\(\.985[^)]*\), oklch\(\.1 /);
});
