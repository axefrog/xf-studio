/**
 * The guided tour "Your first eye makeup mod" (guidance/tours.ts): its step order in each state, how each step waits for the person's
 * action, "Do it for me" through the real registered actions (and Undo), the not-set-up branch and the read-only window.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEASE_MESSAGES, WorkspaceLease } from "../src/app/workspace/workspace-lease";
import { ACTION_DESCRIPTORS } from "../src/app/studio-action-descriptors";
import { EYE_STARTERS } from "../src/features/eye-makeup/starters";
import { isAnchorId, anchorInfo, type AnchorId, type AnchorState } from "../src/studio-ui/guidance/anchors";
import { TourCommandRun, TOUR_TARGET_MISSING } from "../src/studio-ui/guidance/command-run";
import { commandCapability, packageFacts, runCommand } from "../src/studio-ui/guidance/controller";
import { eventHappened, gateHolds, GuidanceService, type GuidanceEnvironment } from "../src/studio-ui/guidance/engine";
import { plainText } from "../src/studio-ui/guidance/content";
import { EYE_TOUR_ID, EYE_TOUR_LOOKS, TOURS, toursFor } from "../src/studio-ui/guidance/tours";
import type { GuidanceFacts, Tour, TourCommand } from "../src/studio-ui/guidance/types";
import { PANEL_IDS } from "../src/compose/views";
import { finishCatalogue } from "./fixtures/eye-region";
import { trustedFixture } from "./studio-presentation-fixture";

const tour = TOURS.find(item => item.id === EYE_TOUR_ID)!;
const ids = tour.steps.map(step => step.id!);
const root = resolve(import.meta.dir, "..", "src");

const facts: GuidanceFacts = { layers: 1, activeLayer: "a", finish: "matte", color: "#905774", edit: "1:0:s1", presets: 1, lighting: "studio",
  visiblePanels: [...PANEL_IDS], writable: true, setup: "ready", package: "none", lastPackage: "", installed: 0 };

function environment(start: Partial<GuidanceFacts> = {}, hiddenAnchors: AnchorId[] = []) {
  let current = { ...facts, ...start };
  const env: GuidanceEnvironment = {
    facts: () => current,
    anchor: (id): AnchorState => hiddenAnchors.includes(id) ? "hidden" : "visible",
    panelVisible: () => true, panelTitle: panel => panel,
    capability: () => ({ available: true }),
  };
  return { env, set(next: Partial<GuidanceFacts>) { current = { ...current, ...next }; }, get facts() { return current; } };
}
const service = (start: Partial<GuidanceFacts> = {}) => {
  const world = environment(start), run = new GuidanceService([tour], world.env);
  return { ...world, run, step: () => run.snapshot().active && tour.steps[run.snapshot().active!.step]!.id };
};
/** The steps a person meets, pressing Next, in a state. */
function walk(start: Partial<GuidanceFacts>): string[] {
  const { run, step } = service(start), seen: string[] = [];
  run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  for (let guard = 0; guard < 30 && run.snapshot().active; guard++) { seen.push(step()!); run.dispatch({ kind: "guidance.next" }); }
  return seen;
}

test("the tour is registered for Help's Guided tours, never auto-started, and has 8 to 12 steps", () => {
  expect(TOURS.filter(item => item.id === EYE_TOUR_ID)).toHaveLength(1);
  expect(tour).toMatchObject({ audience: "howto", title: "Your first eye makeup mod" });
  expect(tour.steps.length).toBeGreaterThanOrEqual(8);
  expect(tour.steps.length).toBeLessThanOrEqual(12);
  expect(new Set(ids).size).toBe(ids.length);
  // Only the onboarding tour is offered by itself, and it may mention this one; this one is started from Help (or the palette).
  const controller = readFileSync(join(root, "studio-ui", "guidance", "controller.ts"), "utf8");
  expect([...controller.matchAll(/start\((\w+)\)/g)].map(match => match[1]).filter(name => name !== "tourId")).toEqual(["ONBOARDING_TOUR_ID"]);
  // Each step is anchored to a real control or panel, in plain words.
  for (const step of tour.steps) {
    if (step.anchor) { expect(isAnchorId(step.anchor)).toBe(true); const panel = anchorInfo(step.anchor)?.panel; if (panel) expect(PANEL_IDS as readonly string[]).toContain(panel); }
    expect(`${step.content.title} ${step.content.body}`).not.toMatch(/\b(dispatch|capability|anchor|payload|recipe|UV space|API|port)\b/i);
    expect(plainText(step.content.body).length).toBeGreaterThan(40);
  }
});

test("the steps run in order: two looks, Check, Build, add it, and what to check in the game", () => {
  expect(walk({})).toEqual(["intro", "first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style",
    "check", "build", "in-game"]);
  // Once a Build is showing, adding it comes before the closing step.
  expect(walk({ package: "build" })).toEqual(["intro", "first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style",
    "check", "build", "install", "in-game"]);
  const titles = (steps: readonly string[]) => steps.map(id => tour.steps.find(step => step.id === id)!.content.title);
  expect(titles(["intro", "first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style", "check", "build", "install", "in-game"]))
    .toEqual(["Your first eye makeup mod", "First look: add a preset", "First look: colour and finish", "Second look: add another preset",
      "Second look: a different starter shape", "Second look: colour and finish", "Check your looks", "Build your mod", "Add it to your game", "What to check in the game"]);
  // The progress counts what the person meets, not the gated-out steps.
  const { run } = service({ package: "build" });
  run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  expect(run.snapshot().active).toMatchObject({ index: 0, count: 10, first: true });
  const setup = service({ setup: "needs" });
  setup.run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  expect(setup.run.snapshot().active!.count).toBe(9);
});

test("the starter shapes, finishes and colours the tour uses exist, and the finishes go into the mod", () => {
  const starters = new Map(EYE_STARTERS.map(starter => [starter.id, starter.name]));
  expect(starters.get(EYE_TOUR_LOOKS.first.starter)).toBe("Lid wash");
  expect(starters.get(EYE_TOUR_LOOKS.second.starter)).toBe("Classic wing");
  expect(EYE_TOUR_LOOKS.first.starter).not.toBe(EYE_TOUR_LOOKS.second.starter);
  const text = tour.steps.map(step => step.content.body).join("\n");
  expect(text).toContain("**Lid wash**");
  expect(text).toContain("**Classic wing**");
  // The tour's finishes are ones the finish catalogue says go into a mod (so the tour never builds a mod that leaves its looks out).
  const catalogue = finishCatalogue();
  for (const id of [EYE_TOUR_LOOKS.first.finish, EYE_TOUR_LOOKS.second.finish]) {
    const finish = catalogue.find(item => item.id === id)!;
    expect({ id, adapter: finish.exportAdapter, research: !!finish.research }).toEqual({ id, adapter: "flat-provisional", research: false });
  }
  expect(EYE_TOUR_LOOKS.first.color).not.toBe(EYE_TOUR_LOOKS.second.color);
  // The words about finishes come from the catalogue, like the other tours' (UI-44).
  const filled = toursFor(catalogue).find(item => item.id === EYE_TOUR_ID)!;
  for (const step of filled.steps) expect(step.content.body).not.toContain("{{");
  expect(filled.steps.find(step => step.id === "first-look-style")!.content.body).toContain("go into your mod today");
});

test("each step waits for the person's own action and moves on only when it happens after the step began", () => {
  const { run, set, step } = service();
  run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  // The introduction waits for nothing.
  expect(run.snapshot().active!.waiting).toBe(false);
  expect(run.observe()).toBe(false);
  run.dispatch({ kind: "guidance.next" });
  const advance = (id: string, change: Partial<GuidanceFacts>) => {
    expect(step()).toBe(id);
    expect(run.snapshot().active!.waiting).toBe(true);
    expect(run.observe()).toBe(false);
    set(change);
    expect(run.observe()).toBe(true);
  };
  advance("first-look-add", { presets: 2, activeLayer: "b" });
  advance("first-look-style", { finish: "regular", color: "#a8576b" });
  advance("second-look-add", { presets: 3, activeLayer: "c", finish: "matte", color: "#905774" });
  advance("second-look-shape", { layers: 2, activeLayer: "d" });
  advance("second-look-style", { finish: "metallic" });
  advance("check", { lastPackage: "check@100", package: "check" });
  // Without a Check or a Build the Build step holds; a Build that ends moves on to adding it.
  expect(step()).toBe("build");
  set({ lastPackage: "check@200" });
  expect(run.observe()).toBe(false);
  set({ lastPackage: "build@300", package: "build" });
  expect(run.observe()).toBe(true);
  advance("install", { installed: 1 });
  expect(step()).toBe("in-game");
  expect(run.snapshot().active!.waiting).toBe(false);
  // A step started after a run finished doesn't count it: only what happens afterwards does.
  expect(eventHappened("package.checked", { ...facts, lastPackage: "check@1" }, { ...facts, lastPackage: "check@1" })).toBe(false);
  expect(eventHappened("package.checked", { ...facts, lastPackage: "check@1" }, { ...facts, lastPackage: "check@2" })).toBe(true);
  // A Build counts as a Check too (the person went straight to Build); a Check is not a Build.
  expect(eventHappened("package.checked", facts, { ...facts, lastPackage: "build@5" })).toBe(true);
  expect(eventHappened("package.built", facts, { ...facts, lastPackage: "check@5" })).toBe(false);
  // Another kind of request (a save) leaves no package run to count.
  expect(eventHappened("package.checked", { ...facts, lastPackage: "check@1" }, { ...facts, lastPackage: "" })).toBe(false);
});

test("Next works on any waiting step, so the person is never stuck", () => {
  const { run, step } = service();
  run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  for (let i = 0; i < 6; i++) run.dispatch({ kind: "guidance.next" });
  expect(step()).toBe("check");
  expect(run.snapshot().active!.buttons.map(button => button.label)).toEqual(["Check for me", "Back", "Next"]);
  run.dispatch({ kind: "guidance.back" });
  expect(step()).toBe("second-look-style");
});

test("not set up: the Package steps point at the setup card's next step, and the tour carries on once it is done", () => {
  expect(walk({ setup: "needs" })).toEqual(["intro", "first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style",
    "check", "setup", "in-game"]);
  const world = service({ setup: "needs" });
  world.run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  for (let i = 0; i < 7; i++) world.run.dispatch({ kind: "guidance.next" });
  expect(world.step()).toBe("setup");
  const active = world.run.snapshot().active!;
  expect(active.target).toEqual({ kind: "anchor", anchor: "package.setup" });
  expect(active.buttons[0]).toMatchObject({ label: "Open Settings › Game", action: { kind: "settings", section: "game" }, capability: { available: true } });
  expect(active.waiting).toBe(false);
  // The person finishes setting up: the step has nothing left to say, so the tour moves to Build by itself.
  world.set({ setup: "ready" });
  expect(world.run.observe()).toBe(true);
  expect(world.step()).toBe("build");
  // Settings still loading counts as set up (no flash of the setup step), a damaged or missing setup counts as needing it.
  expect(gateHolds({ setup: "ready" }, { ...facts, setup: "loading" })).toBe(true);
  expect(gateHolds({ setup: "needs" }, { ...facts, setup: "loading" })).toBe(false);
  expect(gateHolds({ setup: "needs" }, { ...facts, setup: "needs" })).toBe(true);
  // The install step needs a Build result to point at.
  expect(gateHolds({ built: true }, facts)).toBe(false);
  expect(gateHolds({ built: true }, { ...facts, package: "build" })).toBe(true);
  expect(gateHolds({ built: false }, { ...facts, package: "check" })).toBe(true);
  // The closing step is for everyone who can make changes, set up or not.
  expect(tour.steps.find(step => step.id === "in-game")!.when).toEqual({ writable: true });
});

test("a read-only window gets one step that says it needs the window that can make changes", () => {
  expect(walk({ writable: false })).toEqual(["read-only"]);
  const world = service({ writable: false });
  world.run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  const active = world.run.snapshot().active!;
  expect(active).toMatchObject({ count: 1, first: true, last: true, target: { kind: "none" } });
  expect(active.content.body).toContain("read-only");
  expect(active.content.body).toContain("**Use it here**");
  expect(active.buttons.map(button => button.label)).toEqual(["Done"]);
  // Another window gives up the workspace while the step shows: the window can change things again, so the tour goes on from its introduction.
  world.set({ writable: true });
  expect(world.run.observe()).toBe(true);
  expect(world.step()).toBe("intro");
  // And the other way: a window that loses the workspace mid-tour moves to the explanation's end rather than offering buttons that refuse.
  const lost = service();
  lost.run.dispatch({ kind: "guidance.startTour", tourId: EYE_TOUR_ID });
  lost.set({ writable: false });
  expect(lost.run.observe()).toBe(true);
});

/** What the shell's tour runner needs of the runtime for commands, over a real presentation port. */
function runtime(options: Parameters<typeof trustedFixture>[0] = {}) {
  const fixture = trustedFixture(options), shell = fixture.shell, eye = shell.feature("eye-makeup");
  const refused: string[] = [], announced: string[] = [], files: unknown[] = [], settings: string[] = [];
  const rt = { port: shell, get editor() { return eye.view(); },
    feedback: { toast: (_kind: string, _source: string, message: string) => { refused.push(message); }, announce: (text: string) => { announced.push(text); } },
    dispatch: (action: Parameters<typeof shell.authoring.dispatch>[0]) => { const result = shell.authoring.dispatch(action); if (!result.ok) refused.push(result.message); return result.ok; },
    file: async (action: unknown) => { files.push(action); return { ok: true }; },
    settings: { open: (section: string) => { settings.push(section); } }, dock: { reveal: () => {} } };
  return { ...fixture, run: new TourCommandRun(), rt: rt as unknown as Parameters<typeof runCommand>[0], eye, refused, announced, files, settings,
    presets: () => shell.library.summary().draft!.presets, layer: () => eye.view().layer()! };
}
const button = (id: string) => tour.steps.find(step => step.id === id)!.buttons![0].action as TourCommand;

test("Do it for me uses Add preset convention; colour, finish and layer edits stay undoable", async () => {
  const world = runtime(), { shell, rt } = world;
  const before = world.presets().length;
  expect(commandCapability(rt, button("first-look-add"))).toEqual({ available: true });
  expect(await runCommand(rt, button("first-look-add"), world.run)).toBe(true);
  // Just like Add preset: no Undo entry for creating the preset, and no extra reset.
  const ordinary = runtime();
  expect(ordinary.shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.authoring.historyTimeline().steps.length).toBe(ordinary.shell.authoring.historyTimeline().steps.length);
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(false);
  expect(world.presets()).toHaveLength(before + 1);
  // A new preset, selected, with a layer from the default Lid wash.
  expect(world.presets()).toHaveLength(before + 1);
  const lidWash = EYE_STARTERS.find(starter => starter.id === EYE_TOUR_LOOKS.first.starter)!.shape;
  expect(world.layer().points.length).toBe(lidWash.points.length);
  expect(await runCommand(rt, button("first-look-style"), world.run)).toBe(true);
  expect(world.layer()).toMatchObject({ finish: EYE_TOUR_LOOKS.first.finish, color: EYE_TOUR_LOOKS.first.color });
  const first = world.presets().at(-1)!.id;
  // The second look: another preset, then a second layer from Classic wing, then its own colour and finish.
  expect(await runCommand(rt, button("second-look-add"), world.run)).toBe(true);
  expect(world.presets()).toHaveLength(before + 2);
  expect(world.presets().at(-1)!.id).not.toBe(first);
  expect(await runCommand(rt, button("second-look-shape"), world.run)).toBe(true);
  expect(world.eye.view().recipe().layers).toHaveLength(2);
  const classic = EYE_STARTERS.find(starter => starter.id === EYE_TOUR_LOOKS.second.starter)!.shape;
  expect(world.layer().points.length).toBe(classic.points.length);
  expect(world.layer().name).toBe("Classic wing");
  expect(await runCommand(rt, button("second-look-style"), world.run)).toBe(true);
  expect(world.layer()).toMatchObject({ finish: EYE_TOUR_LOOKS.second.finish, color: EYE_TOUR_LOOKS.second.color });
  expect(world.refused).toEqual([]);
  expect(world.announced.filter(text => text.startsWith("Done"))).toHaveLength(2);
  // Undo steps back through the colour and finish the tour set, one change at a time, like the person's own edits.
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(world.layer().finish).not.toBe(EYE_TOUR_LOOKS.second.finish);
  expect(world.layer().color).toBe(EYE_TOUR_LOOKS.second.color);
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(world.layer().color).not.toBe(EYE_TOUR_LOOKS.second.color);
  // …then the layer the tour added. A preset the tour added is removed, and brought back, as any preset is.
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(world.eye.view().recipe().layers).toHaveLength(1);
  const added = world.presets().at(-1)!.id;
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "remove", id: added } }).ok).toBe(true);
  expect(world.presets()).toHaveLength(before + 1);
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
  expect(world.presets()).toHaveLength(before + 2);
});

test("Do it for me runs only registered actions, never DOM clicks, and stops at the first refusal", async () => {
  // Every action a button names is in the action registry; the runner reaches the DOM through nothing.
  const kinds: string[] = [];
  const collect = (command: unknown): void => {
    const any = command as { kind?: string; action?: { kind: string }; steps?: unknown[] };
    if (any.kind === "sequence") for (const step of any.steps ?? []) collect(step as never);
    else if (any.kind === "studio" || any.kind === "studio.activeLayer") kinds.push(any.action!.kind);
    else if (any.kind === "studio.resetActiveLayer") kinds.push("layer.edit");
  };
  for (const step of tour.steps) for (const item of step.buttons ?? []) if (typeof item.action !== "string") collect(item.action as never);
  expect(kinds.length).toBeGreaterThan(5);
  for (const kind of kinds) expect(Object.keys(ACTION_DESCRIPTORS)).toContain(kind);
  const controller = readFileSync(join(root, "studio-ui", "guidance", "controller.ts"), "utf8");
  expect(controller).not.toMatch(/\.click\(|dispatchEvent\(/);
  // A refused first command ends the run: nothing after it is attempted, and the refusal was said once.
  const world = runtime();
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(true);
  let attempts = 0;
  const refusing = { ...world.rt, dispatch: () => { attempts++; return false; } } as unknown as typeof world.rt;
  expect(await runCommand(refusing, button("first-look-style"), world.run)).toBe(false);
  expect(attempts).toBe(1);
  expect(world.announced).toEqual([]);
});

test("a window that can't make changes refuses the buttons with its own reason; Check and Settings go through their own paths", async () => {
  // Another window holds the workspace: a real read-only lease, so every edit refuses with the window's own words.
  const lease = new WorkspaceLease({ acquire: async () => null, takeOver: () => new Promise(() => {}), onReleaseRequested: () => {}, release: async () => {} },
    { clock: { after: () => {} } });
  await lease.start();
  const readOnly = runtime({ lease }), before = readOnly.presets().length;
  expect(commandCapability(readOnly.rt, button("first-look-add"))).toMatchObject({ available: false });
  expect(await runCommand(readOnly.rt, button("first-look-add"), readOnly.run)).toBe(false);
  expect(readOnly.presets()).toHaveLength(before);
  expect(readOnly.refused).toEqual([LEASE_MESSAGES.refused]);
  const world = runtime();
  expect(await runCommand(world.rt, tour.steps.find(step => step.id === "check")!.buttons![0].action as TourCommand)).toBe(true);
  expect(world.files).toEqual([{ kind: "package.check" }]);
  expect(await runCommand(world.rt, tour.steps.find(step => step.id === "setup")!.buttons![0].action as TourCommand)).toBe(true);
  expect(world.settings).toEqual(["game"]);
  expect(commandCapability(world.rt, { kind: "sequence", steps: [] }).available).toBe(false);
});

test("the facts say whether the window can make changes, whether the game is set up, and where the Mod package panel stands", () => {
  const port = (parts: { lease?: { writable: boolean }; view?: unknown; files?: unknown; installs?: Record<string, { ok: boolean }> }) => ({ port: {
    status: { snapshot: () => ({ lease: parts.lease }) },
    localSetup: { snapshot: () => ({ view: parts.view }) },
    files: { snapshot: () => parts.files ?? { activity: [] } },
    modInstall: { snapshot: () => ({ outcomes: parts.installs ?? {} }) } } }) as unknown as Parameters<typeof packageFacts>[0];
  const ready = { source: "file", readiness: { build: { issues: [] }, sourceDiscovery: { issues: [] } } };
  const needs = { source: "file", readiness: { build: { issues: [{ code: "game_root_unset", reason: "Choose your Cyberpunk 2077 folder." }] }, sourceDiscovery: { issues: [] } } };
  expect(packageFacts(port({ view: ready }))).toEqual({ writable: true, setup: "ready", package: "none", lastPackage: "", installed: 0 });
  expect(packageFacts(port({ view: needs })).setup).toBe("needs");
  expect(packageFacts(port({ view: { ...ready, source: "backup" } })).setup).toBe("needs");
  expect(packageFacts(port({})).setup).toBe("loading");
  expect(packageFacts(port({ lease: { writable: false }, view: ready })).writable).toBe(false);
  expect(packageFacts(port({ view: ready, files: { package: { kind: "packageCheck" }, last: { kind: "package.check", ok: true, at: 7 } } })))
    .toMatchObject({ package: "check", lastPackage: "check@7" });
  expect(packageFacts(port({ view: ready, files: { package: { kind: "packageBuild" }, last: { kind: "package.build", ok: true, at: 9 } },
    installs: { a: { ok: true }, b: { ok: false } } }))).toMatchObject({ package: "build", lastPackage: "build@9", installed: 1 });
  // A failed run, or a request that isn't a package run, is not a finished Check or Build.
  expect(packageFacts(port({ view: ready, files: { last: { kind: "package.build", ok: false, at: 9 } } })).lastPackage).toBe("");
  expect(packageFacts(port({ view: ready, files: { package: { kind: "packageBuild" }, last: { kind: "save", ok: true, at: 9 } } })).lastPackage).toBe("");
});

test("the controls the tour points at register their anchors, and Help lists the tour with the others", () => {
  const sources = (name: string) => readFileSync(join(root, name), "utf8");
  expect(sources("features/eye-makeup/view/collection.ts")).toContain(`ctx.anchors.register("presets.add", addButton)`);
  expect(sources("features/eye-makeup/view/layers.ts")).toContain(`ctx.anchors.register("layers.starters", starters)`);
  const panel = sources("studio-ui/panels/collection.ts");
  for (const anchor of ["package.check", "package.setup", "package.build", "package.install"]) expect(panel).toContain(`rt.anchors.register("${anchor}"`);
  for (const step of tour.steps) if (step.anchor) expect(isAnchorId(step.anchor)).toBe(true);
  // Help's Guided tours and the palette list every tour the runner holds, with this one's words in the palette's search.
  const controller = sources("studio-ui/guidance/controller.ts");
  expect(controller).toContain("service.tourList().map(tour =>");
  expect(controller).toContain("tour.keywords ??");
  expect(tour.keywords).toContain("first mod");
  // The capture hooks exist only in a ?verify=1 workspace.
  const app = sources("studio-ui/app.ts");
  expect(app).toContain("if (verificationMode(port)) Object.assign(window, { xfStudioShell:");
  expect(app).toContain("guidance: { start: guidance.start, reach: guidance.reach, verifyFacts: guidance.verifyFacts");
  const tours: readonly Tour[] = TOURS;
  expect(tours.map(item => item.id)).toContain(EYE_TOUR_ID);
});


test("the closing callout keeps three checks and sends troubleshooting to Help", () => {
  const body = tour.steps.find(step => step.id === "in-game")!.content.body;
  expect(body.split("\n").filter(line => line.startsWith("- "))).toHaveLength(3);
  expect(body).toContain("If the row isn't there: [[help:install|Installing your mod]] in Help.");
  expect(body).not.toContain("RED4ext");
  expect(body.split(/\s+/).length).toBeLessThan(110);
});

test("reproduction: selecting existing work after the first tour Add refuses styling", async () => {
  const world = runtime(), original = world.shell.focus.targets().look!;
  const recipe = JSON.stringify(world.eye.view().recipe());
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(true);
  const created = world.shell.focus.targets().look!;
  expect(created.look).not.toBe(original.look);
  expect(world.shell.authoring.dispatch({ kind: "scene.setLook", look: original }).ok).toBe(true);
  expect(commandCapability(world.rt, button("first-look-style"), world.run)).toMatchObject({ available: false, reason: TOUR_TARGET_MISSING });
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
  expect(JSON.stringify(world.eye.view().recipe())).toBe(recipe);
  expect(world.refused).toEqual([TOUR_TARGET_MISSING]);
  // Returning to the same look/layer cannot reuse an earlier scene generation.
  expect(world.shell.authoring.dispatch({ kind: "scene.setLook", look: created }).ok).toBe(true);
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
});

test("manual Add captures a new preset identity; selecting existing work does not", async () => {
  const world = runtime();
  world.run.watch(world.rt, button("first-look-add"));
  expect(world.run.observe(world.rt)).toBe(false);
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
  expect(world.shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(world.run.observe(world.rt)).toBe(true);
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(true);
});

test("switching layers or removing the captured layer refuses the tour edit", async () => {
  const world = runtime();
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(true);
  const captured = world.layer().id;
  expect(world.shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  const other = JSON.stringify(world.layer());
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
  expect(JSON.stringify(world.layer())).toBe(other);
  expect(world.shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "remove", id: captured } }).ok).toBe(true);
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
});

test("the second tour layer can only be added to its captured look", async () => {
  const world = runtime(), original = world.shell.focus.targets().look!;
  expect(await runCommand(world.rt, button("second-look-add"), world.run)).toBe(true);
  expect(world.shell.authoring.dispatch({ kind: "scene.setLook", look: original }).ok).toBe(true);
  const recipe = JSON.stringify(world.eye.view().recipe());
  expect(await runCommand(world.rt, button("second-look-shape"), world.run)).toBe(false);
  expect(JSON.stringify(world.eye.view().recipe())).toBe(recipe);
});

test("Add stays pinned to the context chosen when its step opens", async () => {
  const world = runtime(), original = world.shell.focus.targets().look!;
  world.run.watch(world.rt, button("first-look-add"));
  expect(world.shell.authoring.dispatch({ kind: "scene.setLook", look: original }).ok).toBe(true);
  const count = world.presets().length;
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(false);
  expect(world.presets()).toHaveLength(count);
});

test("closing a tour cancels a sequence before its next edit", async () => {
  const world = runtime();
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(true);
  const finish = world.layer().finish, dispatch = world.rt.dispatch;
  const closing = { ...world.rt, dispatch: (action: Parameters<typeof dispatch>[0]) => {
    const result = dispatch(action);
    if (action.kind === "layer.setColor") world.run.cancel();
    return result;
  } } as typeof world.rt;
  expect(await runCommand(closing, button("first-look-style"), world.run)).toBe(false);
  expect(world.layer().color).toBe(EYE_TOUR_LOOKS.first.color);
  expect(world.layer().finish).toBe(finish);
  expect(world.announced).toEqual([]);
});

test("an unrelated scope cannot satisfy pending creation, and cancellation releases the wait", async () => {
  const world = runtime(), original = structuredClone(world.shell.focus.targets());
  world.shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "add" } });
  let displayed = structuredClone(world.shell.focus.targets());
  const delayed = { ...world.rt, port: { ...world.rt.port, focus: { ...world.rt.port.focus, targets: () => displayed } } } as typeof world.rt;
  const pending = runCommand(delayed, button("first-look-add"), world.run);
  displayed = original; // A different existing look, never the new identity the helper added.
  expect(world.run.observe(delayed)).toBe(false);
  expect(world.run.target("first")).toBeUndefined();
  world.run.cancel();
  expect(await pending).toBe(false);
  expect(world.run.target("first")).toBeUndefined();
  expect(await runCommand(world.rt, button("first-look-style"), world.run)).toBe(false);
});


test("a target switch between colour and finish stops the remaining sequence", async () => {
  const world = runtime(), original = world.shell.focus.targets().look!;
  const existing = JSON.stringify(world.eye.view().recipe());
  expect(await runCommand(world.rt, button("first-look-add"), world.run)).toBe(true);
  const dispatch = world.rt.dispatch;
  const switching = { ...world.rt, dispatch: (action: Parameters<typeof dispatch>[0]) => {
    const result = dispatch(action);
    if (action.kind === "layer.setColor") world.shell.authoring.dispatch({ kind: "scene.setLook", look: original });
    return result;
  } } as typeof world.rt;
  expect(await runCommand(switching, button("first-look-style"), world.run)).toBe(false);
  expect(JSON.stringify(world.eye.view().recipe())).toBe(existing);
});
