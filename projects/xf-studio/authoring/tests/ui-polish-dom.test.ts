// The UI/UX review fixes (UI-80..97) over the light DOM harness (light-dom.ts): ordinary refusals fade, unavailable actions stay
// focusable and say why, a Build offers "Add to my mod manager" with a reviewed plan and "Show in folder", Settings offers what
// XF Studio found and saves each choice at once (the saves folder too), and the failure card offers a report instead of a log path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { InstallDetectionActions } from "../src/installation/install-detection-actions";
import { LocalSetupActions, type LocalSetupTransport } from "../src/setup/local-setup-actions";
import { ModInstallActions, type ModInstallPlan } from "../src/installation/mod-install-actions";
import { UpdateCheckActions, type UpdateCheckTransport } from "../src/setup/update-check-actions";
import { emptyUpdateCheckMemory, UpdateCheckService } from "../src/setup/update-check";
import { simulatedReleases } from "../src/setup/host/update-check-github";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
/** Wait (up to a second, for a busy full run) until `ready` holds, repainting between tries. */
async function until(ready: () => boolean, paint: () => void = () => {}) {
  for (let i = 0; i < 100 && !ready(); i++) { await settle(10); paint(); }
  return ready();
}
const openSheet = () => lightDocument.body.querySelectorAll("dialog").filter(dialog => dialog.open).at(-1);
const text = (element: LightElement) => element.textContent;
const buttons = (root: LightElement) => root.querySelectorAll("button");
const buttonNamed = (root: LightElement, name: string) => buttons(root).find(button => text(button) === name || button.getAttribute("aria-label") === name);

describe("refusals and unavailable actions (UI-80, UI-84, UI-15)", () => {
  test("an ordinary refusal is a warning that fades; a real failure stays with its reference; a repeat isn't shown twice", async () => {
    const { Feedback } = await import("../src/studio-ui/feedback");
    const logged: string[] = [];
    const feedback = new Feedback({ notice: failure => { logged.push(failure.message); return "XF-TEST"; }, report: () => {},
      expected: code => code === "invalid_value" });
    feedback.toast("error", "Undo", "There is nothing to undo.", [], { code: "invalid_value" });
    const [refusal] = feedback.toasts.children as unknown as LightElement[];
    expect(refusal!.className).toBe("toast warning");
    expect(refusal!.getAttribute("role")).toBe("status");
    expect(logged).toEqual([]);
    feedback.toast("error", "Library", "The library couldn't be read.", [], { code: "internal" });
    const failure = (feedback.toasts.children as unknown as LightElement[])[1]!;
    expect(failure.className).toBe("toast error");
    expect(text(failure)).toContain("Reference XF-TEST");
    expect(buttonNamed(failure, "Report this problem")).toBeTruthy();
    feedback.toast("error", "Undo", "There is nothing to undo.", [], { code: "invalid_value" });
    expect(feedback.toasts.children.length).toBe(2);
    expect(feedback.log.length).toBe(2);
  });

  test("an unavailable main action stays focusable, says why and runs nothing", async () => {
    const { applyCapability, button } = await import("../src/studio-ui/controls");
    let runs = 0;
    const control = button({ label: "Build mod files…", onClick: () => { runs++; } }) as unknown as LightElement;
    applyCapability(control as never, { available: false, reason: "Choose your Cyberpunk 2077 folder." });
    expect(control.disabled).toBe(false);
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.getAttribute("aria-description")).toBe("Choose your Cyberpunk 2077 folder.");
    expect(control.getAttribute("data-reason")).toBe("Choose your Cyberpunk 2077 folder.");
    control.click();
    expect(runs).toBe(0);
    applyCapability(control as never, { available: true });
    expect(control.getAttribute("aria-disabled")).toBeNull();
    control.click();
    expect(runs).toBe(1);
  });
});

// ---- The Mod package panel over real application services and fake host transports ----

const PLAN = (over: Partial<ModInstallPlan> = {}): ModInstallPlan => ({ schema: "xfs/mod-install-plan-1", candidateId: "c1", modName: "XF Eye Artistry",
  route: "mo2", place: "Mod Organizer 2 (profile “Main”)", blocked: null, next: null, replacing: false, token: "t1", notes: [],
  changes: ["Add the mod “XF Eye Artistry” to Mod Organizer 2, with its 2 files in D:\\MO2\\mods\\XF Eye Artistry\\archive\\pc\\mod.",
    "Add “XF Eye Artistry” to the profile “Main”, switched on. At the bottom of the \"Looks\" section, where Mod Organizer puts newly installed mods.",
    "Nothing else in your mod list changes."], ...over });
const VIEW = (fields: Record<string, unknown> = {}) => ({ revision: 1, source: "primary", overridden: [],
  fields: { gameRoot: null, launchRoute: "mo2", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null, eyePlateHead: "installed",
    savesDirectory: null, checkForUpdates: true, ...fields },
  saves: { source: "detected", detected: { display: "Saved Games\\CD Projekt Red\\Cyberpunk 2077", found: true }, chosenFound: null },
  readiness: { build: { ready: false, issues: [{ code: "game_root_unset", reason: "Choose your Cyberpunk 2077 folder." }], limits: [] },
    sourceDiscovery: { ready: false, issues: [], limits: [] } },
  eyePlateHead: { label: "Eye plate head", options: [{ value: "installed", label: "The head your game loads" }, { value: "base-game", label: "The unmodified head" }] } });
const BUILD = { kind: "packageBuild", freshness: "current", result: { schema: "xfs/package-build-2", collectionId: "k", originalPresetCount: 1,
  omissions: [], collectionSha256: "f".repeat(64), installed: false, gameRenderingVerified: false,
  products: [{ productId: "p1", modName: "XF Eye Artistry", nameSource: "derived", archive: "xfs_a", isDefault: true, omissions: [], requirements: {},
    features: [{ feature: "eye-makeup", label: "Eye makeup", selectorLabel: "XF", presets: [{ id: "look1", appearance: "xfs_eye_layer1__xfs_e01" }],
      notes: [], omissions: [], packagedSha256: "a".repeat(64) }],
    package: "C:\\Data\\package-candidates\\c1", manifest: "C:\\Data\\package-candidates\\c1\\manifest.json",
    archiveSha256: "b".repeat(64), xlSha256: "c".repeat(64), verifiedUnpackedFiles: 3, installed: false, gameRenderingVerified: false }] } };

type HarnessOptions = { plan?: ModInstallPlan; files?: Record<string, unknown>; picker?: boolean; view?: ReturnType<typeof VIEW>;
  /** The prepared game files the character context reports (Settings › Tools shows them). */
  prepared?: { bytes: number | null; clearing?: boolean; freed?: number };
  /** The host's answer to a save, in place of accepting it (a refused saves folder). */
  refuse?: (fields: Record<string, unknown>) => { code: string; error: string } | null;
  /** The host's update check (Settings › Updates); without it checking isn't available. */
  updates?: UpdateCheckTransport;
  /** The update service itself, when a test drives it before the panel opens (a check already running). */
  updateActions?: UpdateCheckActions;
  /** A read-only window: the port refuses what the workspace lease refuses (everything but view preferences and diagnostics). */
  readOnly?: string };
async function packageHarness(options: HarnessOptions = {}) {
  const { packagePanel } = await import("../src/studio-ui/panels/collection");
  return panelHarness(options, rt => packagePanel(rt as never));
}
async function panelHarness<P extends { spec: { element: HTMLElement }; update(frame: never): void }>(options: HarnessOptions, make: (rt: unknown) => P) {
  const { Feedback } = await import("../src/studio-ui/feedback");
  const { Frame } = await import("../src/studio-ui/runtime");
  const saved: unknown[] = [], sentInstall: unknown[] = [], opened: (string | undefined)[] = [];
  let view = options.view ?? VIEW();
  const transport: LocalSetupTransport = async (method, body) => {
    if (method === "PATCH") {
      const fields = (body as { fields: Record<string, unknown> }).fields, refusal = options.refuse?.(fields);
      if (refusal) return { ok: false, status: 400, data: refusal };
      saved.push(fields); view = { ...view, fields: { ...view.fields, ...fields } };
    }
    return { ok: true, status: 200, data: view as never };
  };
  const setup = new LocalSetupActions(transport, options.picker ? async field => field === "savesDirectory" ? "E:\\Saves" : "E:\\Games\\Cyberpunk 2077" : null);
  await setup.dispatch({ kind: "setup.refresh" });
  const detection = new InstallDetectionActions(async target => ({ ok: true, status: 200, data: (target === "games"
    ? { schema: "xfs/game-install-detection-1", supported: true, rejected: [], unsupported: [], issues: [], limitations: [],
      candidates: [{ root: "D:\\Steam\\Cyberpunk 2077", evidence: [{ source: "steam", detail: "" }], executableFound: true }] }
    : { schema: "xfs/mo2-instance-detection-1", supported: true, issues: [], limitations: [],
      instances: [{ kind: "portable", name: "Cyberpunk MO2", root: "D:\\MO2", iniFound: true, gameName: "Cyberpunk 2077", gamePath: null,
        managesCyberpunk: true, selectedProfile: "Main", paths: {}, skipFileSuffixes: [], skipDirectories: [], profiles: ["Main", "Testing"] }] }) as never }));
  const install = new ModInstallActions(async body => {
    sentInstall.push(body);
    if (body.action === "plan") return { ok: true, status: 200, data: options.plan ?? PLAN() };
    if (body.action === "install") return { ok: true, status: 200, data: { schema: "xfs/mod-install-result-1", candidateId: "c1", modName: "XF Eye Artistry",
      route: "mo2", message: "“XF Eye Artistry” is in Mod Organizer 2 and switched on in the profile “Main”." } };
    return { ok: true, status: 200, data: { ok: true } };
  }, () => [{ product: "p1", candidateId: "c1", modName: "XF Eye Artistry" }]);
  const listeners = new Set<() => void>();
  const updates = options.updateActions ?? new UpdateCheckActions(options.updates ?? null);
  const files: Record<string, unknown> & { activity: { kind: string; cancellable: boolean }[] } = { activity: [], ...options.files ?? { package: BUILD } };
  const port = {
    files: { capability: (action?: { kind: string }) => ({ available: action?.kind !== "package.stop" || files.activity.some(entry => entry.kind === "package.build" && entry.cancellable), reason: "Waiting for the host to finish stopping or completing the Build." }), snapshot: () => files },
    library: { capability: () => ({ available: true }), summary: () => ({ busy: files.collectionBusy ?? false, progress: files.progress, products: [], draft: { presets: [{ id: "look1", name: "Night market" }] } }) },
    authoring: { capability: () => ({ available: true }), requestCapability: () => ({ available: true }),
      previewState: () => (options.prepared ? { character: { prepared: options.prepared } } : {}) },
    // WolvenKit's next step beside a setup line that needs it (release-readiness-audit.md item 14).
    previewSetup: { snapshot: () => ({ wolvenKitStep: { label: "Set up WolvenKit…", action: { kind: "previewSetup.consent" } } }),
      capability: () => ({ available: true }), dispatch: async () => ({ ok: true }) },
    localSetup: { snapshot: () => setup.snapshot(), capability: (a: never) => setup.capability(a), dispatch: (a: never) => setup.dispatch(a) },
    installDetection: { snapshot: () => detection.snapshot(), capability: (a: never) => detection.capability(a), dispatch: (a: never) => detection.dispatch(a) },
    modInstall: { snapshot: () => install.snapshot(), capability: (a: never) => install.capability(a), dispatch: (a: never) => install.dispatch(a) },
    diagnostics: { expected: (code?: string) => code === "package_build_unavailable", capability: () => ({ available: true }), snapshot: () => ({ mode: null }),
      dispatch: async () => ({ ok: true, message: "" }) },
    preferences: { snapshot: () => ({ researchTools: false }), capability: () => ({ available: true }) },
    updates: { snapshot: () => updates.snapshot(), capability: (a: never) => updates.capability(a), dispatch: (a: never) => updates.dispatch(a) },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  if (options.readOnly) {
    const refused = () => ({ available: false, code: "unavailable", reason: options.readOnly });
    for (const family of [port.files, port.library, port.previewSetup, port.localSetup, port.installDetection, port.modInstall, port.updates] as { capability: unknown }[])
      family.capability = refused;
    Object.assign(port.authoring, { capability: refused, requestCapability: refused });
  }
  for (const service of [setup, detection, install, updates]) service.subscribe(() => { for (const listener of listeners) listener(); });
  const feedback = new Feedback();
  const dispatched: unknown[] = [];
  const rt = { port, feedback, finishes: [], anchors: { register() {} }, dock: { reveal() {} }, request: async () => {}, dispatch: (action: unknown) => { dispatched.push(action); return true; },
    changed: () => paint(), report: () => true, settings: { open: (section?: string) => { opened.push(section); } } };
  const panel = make(rt);
  lightDocument.body.append(panel.spec.element as never);
  const paint = () => panel.update(new Frame(port as never) as never);
  paint();
  return { panel, root: panel.spec.element as unknown as LightElement, paint, saved, sentInstall, setup, detection, feedback, opened, dispatched };
}
/** The Settings panel over the same services, with appearance preferences kept in memory. */
async function settingsHarness(options: HarnessOptions = {}) {
  const { settingsPanel } = await import("../src/studio-ui/panels/settings");
  let theme: "system" | "light" | "dark" = "system", hints = true, research = false;
  const appearance = { theme: () => theme, setTheme: (next: typeof theme) => { theme = next; }, hints: () => hints, setHints: (on: boolean) => { hints = on; },
    research: () => research, setResearch: (on: boolean) => { research = on; }, openReference: () => {} };
  const h = await panelHarness(options, rt => settingsPanel(rt as never, { appearance } as never));
  return { ...h, appearance: () => ({ theme, hints, research }) };
}

test("Build Stop keeps its label and becomes unavailable while stopping, then the host's result decides what the panel says", async () => {
  const files: Record<string, unknown> = { activity: [{ kind: "package.build", cancellable: false }], collectionBusy: true,
    progress: { phase: "working", code: "package", message: "Stopping…" } };
  const h = await packageHarness({ files });
  const stop = buttonNamed(h.root, "Stop")!;
  expect(stop).toBeTruthy();
  expect(stop.getAttribute("aria-disabled")).toBe("true");
  expect(stop.getAttribute("data-reason")).toBe("Waiting for the host to finish stopping or completing the Build.");
  expect(text(h.root).split("Stopping…")).toHaveLength(2);
  expect(text(h.root)).not.toContain("Build stopped.");
  Object.assign(files, { activity: [], collectionBusy: false, package: BUILD });
  // The harness reads the supplied snapshot; repaint with a completed host result in a fresh panel.
  h.panel.spec.element.remove();
  const completed = await packageHarness({ files });
  expect(buttonNamed(completed.root, "Add to Mod Organizer 2…")).toBeTruthy();
  expect(text(completed.root)).not.toContain("Build stopped.");
  completed.panel.spec.element.remove();
});

test("a confirmed stopped Build uses the reviewed information copy", async () => {
  const h = await packageHarness({ files: { last: { kind: "package.build", ok: false,
    code: "package_build_cancelled", message: "host answer", at: 0 } } });
  expect(text(h.root)).toContain("Build stopped. Your mod files weren't changed.");
  expect(buttonNamed(h.root, "Report this problem")).toBeUndefined();
  h.panel.spec.element.remove();
});

describe("after Build: Add to my mod manager and Show in folder (UI-82)", () => {
  test("each built mod offers both; its folder path is only in Details", async () => {
    const h = await packageHarness();
    const add = buttonNamed(h.root, "Add to Mod Organizer 2…")!;
    expect(add).toBeTruthy();
    expect(buttonNamed(h.root, "Show in folder")).toBeTruthy();
    const details = h.root.querySelector(".result-details")!;
    expect(text(details)).toContain("C:\\Data\\package-candidates\\c1");
    expect(text(h.root).replace(text(details), "")).not.toContain("package-candidates");
    buttonNamed(h.root, "Show in folder")!.click();
    await settle();
    expect(h.sentInstall.at(-1)).toEqual({ action: "reveal", candidateId: "c1" });
    h.panel.spec.element.remove();
  });

  test("a Check lists the looks by name; their game IDs are only in Details (UI-85)", async () => {
    const check = { kind: "packageCheck", freshness: "current", result: { ...BUILD.result, schema: "xfs/package-check-2", ready: true,
      products: BUILD.result.products.map(({ productId, modName, nameSource, archive, isDefault, omissions, requirements, features }) =>
        ({ productId, modName, nameSource, archive, isDefault, omissions, requirements, features })) } };
    const h = await packageHarness({ files: { package: check } });
    const details = h.root.querySelector(".result-details")!, list = h.root.querySelector(".result-product")!;
    expect(text(list)).toContain("Night market");
    expect(text(list)).not.toContain("xfs_eye_layer1__xfs_e01");
    expect(text(details)).toContain("“Night market” in game");
    expect(text(details)).toContain("xfs_eye_layer1__xfs_e01");
    expect(buttonNamed(h.root, "Show in folder")).toBeUndefined();
    h.panel.spec.element.remove();
  });

  test("the product line says whom the mod is for, and a limit shows once as a warning with its step, above the build note", async () => {
    const warning = { text: "A head mod changes the masculine V's head; choose “The unmodified game head” for both heads to include him.", next: "settings.game" };
    const feminineOnly = { ...BUILD, result: { ...BUILD.result, products: BUILD.result.products.map(product => ({ ...product,
      features: product.features.map(feature => ({ ...feature, audience: "for a feminine V only", warnings: [warning] })) })) } };
    const h = await packageHarness({ files: { package: feminineOnly } });
    const card = h.root.querySelector(".result-card")!;
    expect(text(card.querySelector(".result-product")!)).toContain("Eye makeup in the “XF” selector, for a feminine V only");
    const notes = [...card.querySelectorAll(".note")];
    const shown = notes.find(item => text(item) === warning.text)!;
    expect(shown.className).toContain("warning");
    expect(notes.filter(item => text(item) === warning.text)).toHaveLength(1);
    // Directly under the product block, before the build note.
    expect(notes.indexOf(shown)).toBeLessThan(notes.findIndex(item => text(item).startsWith("Add it to your mod manager")));
    buttonNamed(card, "Open Settings")!.click();
    expect(h.opened).toEqual(["game"]);
    h.panel.spec.element.remove();
    // Both bodies: the product line says so and no warning shows.
    const both = { ...BUILD, result: { ...BUILD.result, products: BUILD.result.products.map(product => ({ ...product,
      features: product.features.map(feature => ({ ...feature, audience: "for a feminine and a masculine V" })) })) } };
    const b = await packageHarness({ files: { package: both } });
    expect(text(b.root.querySelector(".result-product")!)).toContain("selector, for a feminine and a masculine V");
    expect([...b.root.querySelectorAll(".result-card .note.warning")]).toHaveLength(0);
    b.panel.spec.element.remove();
  });

  test("the same warning from two features shows once, by its words (UI-149)", async () => {
    const warning = () => ({ text: "A head mod changes the masculine V's head; choose “The unmodified game head” for both heads to include him.", next: "settings.game" });
    const two = { ...BUILD, result: { ...BUILD.result, products: BUILD.result.products.map(product => ({ ...product,
      features: [...product.features, { ...product.features[0], feature: "other", label: "Other" }].map(feature => ({ ...feature, warnings: [warning()] })) })) } };
    const h = await packageHarness({ files: { package: two } });
    const notes = [...h.root.querySelector(".result-card")!.querySelectorAll(".note")].filter(item => text(item) === warning().text);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.className).toContain("warning");
    h.panel.spec.element.remove();
  });

  test("Add reviews the plan first, names what changes and where, and adds only on consent", async () => {
    const h = await packageHarness();
    buttonNamed(h.root, "Add to Mod Organizer 2…")!.click();
    expect(await until(() => !!openSheet() && text(openSheet()!).includes("Nothing else in your mod list changes."), h.paint)).toBe(true);
    const sheet = openSheet()!;
    expect(h.sentInstall).toEqual([{ action: "plan", candidateId: "c1" }]);
    expect(text(sheet)).toContain("Add “XF Eye Artistry” to Mod Organizer 2?");
    expect(text(sheet)).toContain("At the bottom of the \"Looks\" section");
    expect(text(sheet)).toContain("Nothing else in your mod list changes.");
    const consent = buttonNamed(sheet, "Add to Mod Organizer 2")!;
    expect(consent.getAttribute("aria-disabled")).toBeNull();
    consent.click();
    expect(await until(() => !sheet.open, h.paint)).toBe(true);
    expect(h.sentInstall.at(-1)).toEqual({ action: "install", candidateId: "c1", token: "t1" });
    expect(sheet.open).toBe(false);
    expect(text(h.root.querySelector(".install-line")!)).toContain("switched on in the profile “Main”");
    // Once added, the next-step note goes (the line above says where the mod is), and the unavailable Add says why.
    expect(h.root.querySelector("[data-build-next]")!.hidden).toBe(true);
    const again = buttonNamed(h.root, "Add to Mod Organizer 2…")!;
    expect(again.getAttribute("aria-disabled")).toBe("true");
    expect(again.getAttribute("title")).toBe("“XF Eye Artistry” is already added from this build. Build again to add a newer copy.");
    h.panel.spec.element.remove();
  });

  test("after a current Build, Add is the one primary action: Build again is a secondary one, with the same step", async () => {
    const h = await packageHarness();
    const builds = buttons(h.root).filter(item => text(item) === "Build mod files…");
    expect(builds.map(item => [item.className.includes("primary"), item.hidden])).toEqual([[true, true], [false, false]]);
    expect(buttons(h.root).filter(item => item.className.includes("primary") && !item.hidden).map(text)).toEqual(["Add to Mod Organizer 2…"]);
    expect(text(h.root.querySelector("[data-build-next]")!)).toBe("Add it to your mod manager, or show its folder to copy it by hand.");
    h.panel.spec.element.remove();
    // A stale Build: Build is the primary again.
    const stale = await packageHarness({ files: { package: { ...BUILD, freshness: "stale" } } });
    expect(buttons(stale.root).filter(item => text(item) === "Build mod files…").map(item => [item.className.includes("primary"), item.hidden])).toEqual([[true, false], [false, true]]);
    stale.panel.spec.element.remove();
  });

  test("a plan whose next step is Show in folder makes it the sheet's primary button, focused, in place of Add", async () => {
    const h = await packageHarness({ plan: PLAN({ changes: [], next: "reveal",
      blocked: "This build has a file XF Studio can't place (x.reds), so it can't add it for you. Show it in its folder and copy its folders into your game folder or mod manager." }) });
    buttonNamed(h.root, "Add to Mod Organizer 2…")!.click();
    expect(await until(() => !!openSheet()?.querySelector(".install-status")?.textContent, h.paint)).toBe(true);
    const sheet = openSheet()!;
    const show = buttons(sheet).find(item => text(item) === "Show in folder")!;
    expect(show.hidden).toBe(false);
    expect(show.className).toContain("primary");
    expect(lightDocument.activeElement).toBe(show);
    expect(buttonNamed(sheet, "Add to Mod Organizer 2")!.hidden).toBe(true);
    for (const name of ["Open Settings", "Check again", "Rename the mod"]) expect(buttonNamed(sheet, name)!.hidden).toBe(true);
    show.click();
    expect(await until(() => !sheet.open, h.paint)).toBe(true);
    expect(h.sentInstall.at(-1)).toEqual({ action: "reveal", candidateId: "c1" });
    h.panel.spec.element.remove();
  });

  test("a blocked plan says why, offers the one next step, and can't be accepted", async () => {
    const h = await packageHarness({ plan: PLAN({ blocked: "Choose your Mod Organizer 2 instance and profile in Settings › Game first.", next: "setup" }) });
    buttonNamed(h.root, "Add to Mod Organizer 2…")!.click();
    expect(await until(() => !!openSheet()?.querySelector(".install-status")?.textContent, h.paint)).toBe(true);
    const sheet = openSheet()!;
    expect(text(sheet.querySelector(".install-status")!)).toBe("Choose your Mod Organizer 2 instance and profile in Settings › Game first.");
    // The plan names its next step (UI-99): the sheet never guesses it from the words.
    expect(buttonNamed(sheet, "Open Settings")!.hidden).toBe(false);
    expect(buttonNamed(sheet, "Check again")!.hidden).toBe(true);
    expect(buttonNamed(sheet, "Rename the mod")!.hidden).toBe(true);
    const consent = buttonNamed(sheet, "Add to Mod Organizer 2")!;
    expect(consent.getAttribute("aria-disabled")).toBe("true");
    consent.click();
    await settle();
    expect(h.sentInstall.filter(body => (body as { action: string }).action === "install")).toEqual([]);
    buttonNamed(sheet, "Close")!.click();
    h.panel.spec.element.remove();
  });

  test("a blocked plan's next step is the button it names: rename the mod, or check again (UI-99, UI-100)", async () => {
    for (const [next, shown] of [["rename", "Rename the mod"], ["retry", "Check again"]] as const) {
      const h = await packageHarness({ plan: PLAN({ blocked: "Mod Organizer 2 still has an early test copy of this mod: the mod “XF Studio”. " +
        "Remove that mod in Mod Organizer 2 (right-click it, then Remove mod), then choose Check again.", next }) });
      buttonNamed(h.root, "Add to Mod Organizer 2…")!.click();
      expect(await until(() => !!openSheet()?.querySelector(".install-status")?.textContent, h.paint)).toBe(true);
      const sheet = openSheet()!;
      for (const name of ["Open Settings", "Check again", "Rename the mod"]) expect(buttonNamed(sheet, name)!.hidden).toBe(name !== shown);
      buttonNamed(sheet, "Close")!.click();
      h.panel.spec.element.remove();
    }
  });

  test("a failed Build offers a problem report, never a log path; an ordinary refusal needs no report (UI-94)", async () => {
    const failed = await packageHarness({ files: { last: { ok: false, kind: "package.build", code: "package_build_failed", message: "Package Build failed.", at: 0 } } });
    const card = failed.root.querySelector(".result-card")!;
    expect(text(card)).toContain("Build didn't finish");
    expect(text(card)).not.toMatch(/log/i);
    expect(buttonNamed(card, "Report this problem")).toBeTruthy();
    failed.panel.spec.element.remove();
    const refused = await packageHarness({ files: { last: { ok: false, kind: "package.build", code: "package_build_unavailable", message: "Choose your Cyberpunk 2077 folder.", at: 0 } } });
    expect(buttonNamed(refused.root.querySelector(".result-card")!, "Report this problem")).toBeUndefined();
    refused.panel.spec.element.remove();
  });
});

describe("Settings in a read-only window (style guide t-read-only-window)", () => {
  test("what the port still allows stays available; everything that would write settings shows as unavailable with the lease's reason", async () => {
    const reason = "This workspace is open in another window. Choose Use it here to edit in this window.";
    const h = await settingsHarness({ readOnly: reason });
    const { markReadOnly } = await import("../src/studio-ui/read-only-sweep");
    h.panel.spec.visibility?.(true);
    await settle(); h.paint();
    markReadOnly(h.root as never, reason);
    const unavailable = (element: LightElement | null | undefined) => !!element && (element.getAttribute("aria-disabled") === "true" || element.disabled);
    // Kept: the theme (a UI preference), Keyboard & mouse (it only opens a reference), diagnostics and Report a problem.
    const appearance = h.root.querySelector("[data-capability=allowed]")!;
    expect(appearance).toBeTruthy();
    for (const name of ["Match system", "Light", "Dark", "Keyboard & mouse…", "Report a problem…"])
      expect(unavailable(buttonNamed(h.root, name)), name).toBe(false);
    const deep = h.root.querySelectorAll("input").find(input => input.closest("[data-capability=allowed]") && text(input.closest("[data-capability=allowed]")!).includes("Diagnostic mode"));
    expect(unavailable(deep)).toBe(false);
    // Refused: the game folder setup and Check for updates (local settings writes).
    const game = h.root.querySelector("[data-settings-section=game]")!;
    const gameControls = [...game.querySelectorAll("button"), ...game.querySelectorAll("input")];
    expect(gameControls.length).toBeGreaterThan(5);
    expect(gameControls.filter(control => !unavailable(control) && !control.matches(".help-tip")).map(control => text(control) || control.getAttribute("aria-label"))).toEqual([]);
    expect(gameControls.filter(control => control.tagName === "button" && !control.matches(".help-tip")).every(control => control.getAttribute("data-reason") === reason)).toBe(true);
    h.panel.spec.element.remove();
  });
});

describe("Settings: one form, what XF Studio found, saved as chosen (UI-83, UI-03, UI-109)", () => {
  test("detected folders are all shown as choices, the first one found is used without a click, and choosing one saves it", async () => {
    const h = await settingsHarness();
    const game = h.root.querySelector("[data-settings-section=game]")!;
    h.panel.spec.visibility?.(true);
    await settle(); h.paint();
    // Show the options: each folder XF Studio found is a choice, with where it was found (the library's FolderSetting).
    const folders = game.querySelectorAll(".folder-setting");
    const choices = (index: number) => folders[index]!.querySelectorAll(".folder-choice");
    expect(choices(0).map(choice => text(choice.querySelector(".folder-choice-path")!))).toEqual(["D:\\Steam\\Cyberpunk 2077"]);
    expect(text(choices(0)[0]!.querySelector(".folder-choice-source")!)).toBe("Steam");
    // Defaults first: nothing was chosen, so the folders found are saved without a click, and show as the ones in use.
    await settle(); h.paint();
    await settle(); h.paint();
    const fields = h.saved as { gameRoot?: string; mo2Root?: string }[];
    expect(fields.some(saved => saved.gameRoot === "D:\\Steam\\Cyberpunk 2077")).toBe(true);
    expect(fields.some(saved => saved.mo2Root === "D:\\MO2")).toBe(true);
    expect(choices(0)[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(text(choices(1)[0]!.querySelector(".folder-choice-source")!)).toBe("Cyberpunk MO2");
    const profile = game.querySelectorAll("select").find(select => select.options.some(option => text(option) === "Main · last used"))!;
    expect(profile.options.map(option => text(option))).toEqual(["Choose a profile", "Main · last used", "Testing"]);
    // No native picker on this host: Choose another folder… opens the text box, which saves what is typed.
    buttonNamed(folders[0]!, "Choose another folder…")!.click();
    await settle(); h.paint();
    const typed = folders[0]!.querySelector(".folder-typed")!;
    expect(typed.hidden).toBe(false);
    const input = typed.querySelector("input")!;
    input.value = "D:\\Games\\Cyberpunk 2077";
    input.dispatchEvent(Object.assign(lightEvent("keydown"), { key: "Enter" }));
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ gameRoot: "D:\\Games\\Cyberpunk 2077" });
    // The chosen folder is listed first, pressed; the one found can be chosen again with one press.
    expect(choices(0).map(choice => [text(choice.querySelector(".folder-choice-path")!), choice.getAttribute("aria-pressed")]))
      .toEqual([["D:\\Games\\Cyberpunk 2077", "true"], ["D:\\Steam\\Cyberpunk 2077", "false"]]);
    (choices(0)[1] as unknown as HTMLElement).click();
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ gameRoot: "D:\\Steam\\Cyberpunk 2077" });
    // The groups are plain, in order.
    expect(h.root.querySelectorAll("[data-settings-section]").map(section => section.getAttribute("data-settings-section")))
      .toEqual(["game", "saves", "tools", "appearance", "updates", "privacy"]);
    h.panel.spec.element.remove();
  });

  test("with the desktop's folder picker, Choose a folder… picks and saves a folder", async () => {
    const h = await settingsHarness({ picker: true });
    const game = h.root.querySelector("[data-settings-section=game]")!;
    // Nothing chosen or found yet, so it is "a" folder, not "another" (C-29).
    const choose = buttonNamed(game.querySelector(".folder-setting")!, "Choose a folder…")!;
    expect(choose).toBeTruthy();
    choose.click();
    await settle();
    expect(h.saved.at(-1)).toMatchObject({ gameRoot: "E:\\Games\\Cyberpunk 2077" });
    h.panel.spec.element.remove();
  });

  test("the saves folder is detected by default and described without a profile path; another folder is typed, checked and saved", async () => {
    const refusal = { code: "saves_folder_missing", error: "XF Studio can't find that folder. Check how it's typed, or copy the folder's address from File Explorer's address bar." };
    const h = await settingsHarness({ refuse: fields => fields.savesDirectory === "D:\\Nowhere" ? refusal : null });
    const saves = h.root.querySelector("[data-settings-section=saves]")!;
    expect(text(saves.querySelector(".saves-current")!)).toBe("Detected: Saved Games\\CD Projekt Red\\Cyberpunk 2077");
    expect(buttonNamed(saves, "Use the detected folder")!.hidden).toBe(true);
    // Localhost has no folder picker: "Choose another folder…" opens the text box with plain guidance.
    const typed = saves.querySelector(".setup-typed-block")!;
    expect(typed.hidden).toBe(true);
    buttonNamed(saves, "Choose another folder…")!.click();
    await settle(); h.paint();
    expect(typed.hidden).toBe(false);
    expect(text(typed)).toContain("copy its address bar");
    const input = typed.querySelector("input")!;
    input.value = "D:\\Nowhere";
    buttonNamed(saves, "Use this folder")!.click();
    await settle(); h.paint();
    // The host's refusal is said beside the field, and nothing was saved.
    const problem = saves.querySelector(".note.warning")!;
    expect(problem.hidden).toBe(false);
    expect(text(problem)).toBe(refusal.error);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(h.saved).toEqual([]);
    input.value = "D:\\Games\\Saves";
    input.dispatchEvent(lightEvent("input"));
    buttonNamed(saves, "Use this folder")!.click();
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ savesDirectory: "D:\\Games\\Saves" });
    expect(typed.hidden).toBe(true);
    expect(text(saves.querySelector(".saves-current")!)).toBe("Your folder: D:\\Games\\Saves");
    // "Use the detected folder" goes back to the default.
    buttonNamed(saves, "Use the detected folder")!.click();
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ savesDirectory: null });
    expect(text(saves.querySelector(".saves-current")!)).toBe("Detected: Saved Games\\CD Projekt Red\\Cyberpunk 2077");
    h.panel.spec.element.remove();
  });

  test("the desktop's folder picker chooses the saves folder at once", async () => {
    const h = await settingsHarness({ picker: true });
    const saves = h.root.querySelector("[data-settings-section=saves]")!;
    buttonNamed(saves, "Choose another folder…")!.click();
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ savesDirectory: "E:\\Saves" });
    expect(saves.querySelector(".setup-typed-block")!.hidden).toBe(true);
    h.panel.spec.element.remove();
  });

  test("Settings › Tools shows the prepared game files and clears them (moved from Character, readiness item 6)", async () => {
    const h = await settingsHarness({ prepared: { bytes: 1.5 * 1024 ** 3 } });
    const tools = h.root.querySelector("[data-settings-section=tools]")!;
    expect(text(tools)).toContain("Prepared game files: 1.5 GB");
    buttonNamed(tools, "Clear prepared game files")!.click();
    expect(h.dispatched.at(-1)).toEqual({ kind: "character.clearPreparedFiles" });
    h.panel.spec.element.remove();
  });

  test("Updates: the check at start is a saved switch, on by default, and Check now says what it found in place (readiness item 22)", async () => {
    const service = (kind: "newer" | "current" | "offline") => new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1, automatic: () => true,
      store: { load: emptyUpdateCheckMemory, save: () => {} }, releases: simulatedReleases(kind, "0.1.0-alpha.2") });
    let answer = service("current");
    const h = await settingsHarness({ updates: async body => ({ ok: true, status: 200, data: body.action === "check" ? await answer.check(new AbortController().signal) : null }) });
    const updates = h.root.querySelector("[data-settings-section=updates]")!;
    const toggle = updates.querySelector("input[role=switch]") as unknown as LightElement & { checked: boolean };
    expect(text(updates)).toContain("Check for updates when XF Studio starts");
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(lightEvent("change"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.saved.at(-1)).toEqual({ ...h.setup.snapshot().view!.fields, checkForUpdates: false });
    const read = async () => { buttonNamed(updates, "Check now")!.click(); await new Promise(resolve => setTimeout(resolve, 0)); h.paint(); return text(updates); };
    expect(await read()).toContain("You have the newest version, 0.1.0-alpha.2.");
    expect(buttonNamed(updates, "Open the releases page")!.hidden).toBe(true);
    answer = service("newer");
    expect(await read()).toContain("XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2.");
    expect(buttonNamed(updates, "Open the releases page")!.hidden).toBe(false);
    answer = service("offline");
    expect(await read()).toContain("XF Studio couldn't check for updates just now. New versions are always on the releases page.");
    h.panel.spec.element.remove();
  });

  const releasesService = (kind: "newer" | "current" | "offline") => new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1,
    automatic: () => true, store: { load: emptyUpdateCheckMemory, save: () => {} }, releases: simulatedReleases(kind, "0.1.0-alpha.2") });
  /** A host whose next answer can be held, so a check in progress can be looked at. */
  const heldHost = () => {
    const host = { answer: releasesService("offline"), hold: null as Promise<void> | null, release: () => {},
      holdNext() { host.hold = new Promise<void>(resolve => { host.release = () => { host.hold = null; resolve(); }; }); },
      transport: (async body => { if (host.hold) await host.hold;
        return { ok: true, status: 200, data: body.action === "check" ? await host.answer.check(new AbortController().signal) : null }; }) as UpdateCheckTransport };
    return host;
  };

  test("Updates: a re-check shows on Check now (Checking…, unavailable); the line and releases button keep the last result", async () => {
    const host = heldHost();
    const h = await settingsHarness({ updates: host.transport });
    const updates = h.root.querySelector("[data-settings-section=updates]")!;
    const checkNow = updates.querySelector("button.btn.small")!, releases = buttonNamed(updates, "Open the releases page")!;
    checkNow.click();
    await settle(); h.paint();
    const offline = text(updates);
    expect(offline).toContain("XF Studio couldn't check for updates just now.");
    expect(releases.hidden).toBe(false);
    expect(releases.className).toContain("quiet");
    host.holdNext(); host.answer = releasesService("newer");
    checkNow.click();
    h.paint();
    expect(text(checkNow)).toBe("Checking…");
    expect(checkNow.getAttribute("aria-disabled")).toBe("true");
    expect(text(updates).replace("Checking…", "Check now")).toBe(offline);
    expect(releases.hidden).toBe(false);
    host.release();
    await settle(); h.paint();
    expect(text(checkNow)).toBe("Check now");
    expect(checkNow.getAttribute("aria-disabled")).toBeNull();
    expect(text(updates)).toContain("XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2.");
    // A newer version: the releases page becomes the main action and Check now the quiet one.
    expect(releases.className).toContain("primary");
    expect(releases.className).not.toContain("quiet");
    expect(checkNow.className).toContain("quiet");
    host.answer = releasesService("current");
    checkNow.click();
    await settle(); h.paint();
    expect(releases.hidden).toBe(true);
    expect(checkNow.className).not.toContain("quiet");
    h.panel.spec.element.remove();
  });

  test("Updates opened mid-check: no releases button without its line; a last result shows at once, versions unbroken", async () => {
    // The first check still running when Settings opens: nothing found yet, so no releases button and no line.
    const first = heldHost(), fresh = new UpdateCheckActions(first.transport);
    first.holdNext(); const running = fresh.dispatch({ kind: "updates.check" });
    const h = await settingsHarness({ updateActions: fresh });
    let updates = h.root.querySelector("[data-settings-section=updates]")!;
    expect(text(buttonNamed(updates, "Checking…")!)).toBe("Checking…");
    expect(buttonNamed(updates, "Open the releases page")!.hidden).toBe(true);
    first.release(); await running; await settle(); h.paint();
    expect(buttonNamed(updates, "Open the releases page")!.hidden).toBe(false);
    expect(text(updates)).toContain("XF Studio couldn't check for updates just now.");
    h.panel.spec.element.remove();
    // A re-check running when Settings opens: the last result's line shows at once beside its button, each version in one piece.
    const again = heldHost(), known = new UpdateCheckActions(again.transport);
    again.answer = releasesService("newer"); await known.dispatch({ kind: "updates.check" });
    again.holdNext(); const recheck = known.dispatch({ kind: "updates.check" });
    const h2 = await settingsHarness({ updateActions: known });
    updates = h2.root.querySelector("[data-settings-section=updates]")!;
    expect(buttonNamed(updates, "Checking…")!.getAttribute("aria-disabled")).toBe("true");
    expect(text(updates)).toContain("XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2.");
    expect(buttonNamed(updates, "Open the releases page")!.hidden).toBe(false);
    expect([...updates.querySelectorAll(".update-version")].map(span => text(span))).toEqual(["0.2.0-beta.1", "0.1.0-alpha.2"]);
    again.release(); await recheck; await settle();
    h2.panel.spec.element.remove();
  });

  test("a tour Help link opens its topic despite an earlier search, with the answer expanded and focused", async () => {
    const { helpPanel } = await import("../src/studio-ui/guidance/help-panel");
    const host = heldHost(), updates = new UpdateCheckActions(host.transport);
    const rt = { port: { updates, about: { capability: () => ({ available: false }) }, desktopApp: { offered: () => false },
      links: { open: async () => ({ ok: true }) } }, feedback: { toast() {} }, changed() {}, finishes: [], settings: { open() {} } };
    const panel = helpPanel(rt as never, { tours: () => [], status: () => undefined, start: () => false });
    panel.update(null as never);
    const root = panel.spec.element as unknown as LightElement;
    root.querySelector("input")!.value = "no matches";
    panel.openTopic("install");
    expect(root.querySelector("input")!.value).toBe("Installing your mod");
    const topic = root.querySelector('[data-help-topic="install"]')!;
    expect(topic.hasAttribute("open")).toBe(true);
    expect(lightDocument.activeElement).toBe(topic.querySelector("summary"));
    for (const name of ["ArchiveXL", "RED4ext", "redscript", "Nexus Mods"]) expect(text(topic)).toContain(name);
    panel.spec.element.remove();
  });

  test("Help's Check for updates: while it checks, the button says so and is unavailable, and the last detail stays", async () => {
    const { helpPanel } = await import("../src/studio-ui/guidance/help-panel");
    const host = heldHost(), updates = new UpdateCheckActions(host.transport);
    let panel: ReturnType<typeof helpPanel> | null = null;
    const rt = { port: { updates, about: { capability: () => ({ available: false }) }, desktopApp: { offered: () => false },
      links: { open: async () => ({ ok: true }) } }, feedback: { toast: () => () => {}, record: () => {} }, changed: () => panel?.update(null as never),
    finishes: [], settings: { open: () => {} } };
    panel = helpPanel(rt as never, { tours: () => [], status: () => undefined, start: () => false });
    panel.update(null as never);
    const root = panel.spec.element as unknown as LightElement;
    const row = root.querySelector(".help-check-updates")!, detail = root.querySelector(".help-updates-detail")!;
    expect(text(row)).toBe("Check for updates");
    expect(text(detail)).toBe("Looks for a newer XF Studio on GitHub, where each new version is published.");
    row.click();
    await settle();
    expect(text(detail)).toContain("XF Studio couldn't check for updates just now.");
    host.holdNext(); host.answer = releasesService("newer");
    row.click();
    expect(text(row)).toBe("Checking for updates…");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(text(detail)).toContain("XF Studio couldn't check for updates just now.");
    host.release();
    await settle();
    expect(text(row)).toBe("Check for updates");
    expect(row.getAttribute("aria-disabled")).toBeNull();
    expect(text(detail)).toBe("XF Studio 0.2.0-beta.1 is available. Download it from XF Studio releases below.");
  });

  test("appearance is set here too, and Mod package points to Settings instead of holding the form", async () => {
    const h = await settingsHarness();
    const appearance = h.root.querySelector("[data-settings-section=appearance]")!;
    buttonNamed(appearance, "Dark")!.click();
    expect(h.appearance().theme).toBe("dark");
    h.panel.spec.element.remove();
    const pkg = await packageHarness();
    expect(pkg.root.querySelector("[data-settings-section]")).toBeNull();
    expect(text(pkg.root)).toContain("To build your mod files: Choose your Cyberpunk 2077 folder.");
    buttonNamed(pkg.root, "Open Settings")!.click();
    expect(pkg.opened).toEqual(["game"]);
    pkg.panel.spec.element.remove();
  });
});

describe("the layer list says what the flag shows (UI-95)", () => {
  test("a layer left out of the mod files is described to screen readers, not only drawn", async () => {
    const { EDGE_CUT_NOTE, layersPanel } = await import("../src/features/eye-makeup/view/layers");
    const recipe = { layers: [{ id: "a", name: "Glitter lid", color: "#ffffff", opacity: 1, symmetry: true, enabled: true, finish: "glitter" },
      { id: "b", name: "Liner", color: "#000000", opacity: 1, symmetry: true, enabled: true, finish: "matte" },
      { id: "c", name: "Wash", color: "#000000", opacity: .6, symmetry: true, enabled: true, finish: "matte" }] };
    const facade = { view: () => ({ recipe: () => recipe, layer: () => recipe.layers[0], selected: () => 0 }),
      finishCatalogue: () => [{ id: "glitter", label: "Glitter", stored: [], exportAdapter: "none" }, { id: "matte", label: "Matte", stored: [], exportAdapter: "flat-provisional" }],
      glitterModelCatalogue: () => [{ id: "classic", label: "Classic", summary: "", stored: [] }],
      layerExport: (id: string) => id === "a" ? { exportable: false, reason: "Glitter can't be built into a mod yet.", blockedBy: "layer" } : { exportable: true, experimental: false, note: "" },
      // The wash still has coverage where the plate ends (PREV-146).
      layerSurfaceEdge: (id: string) => new Float64Array(id === "c" ? [0.4, 0.18, 0.41, 0.18] : []),
      capability: () => ({ available: true }), contextCapability: () => ({ available: true }) };
    const ctx = { facade, dispatch: () => true, platform: () => true, feedback: { toast() {}, announce() {} }, anchors: { register() {} }, links: { open: async () => ({ ok: true }) },
      starters: { ready: () => false, list: () => undefined, capability: () => ({ available: false, reason: "The starters are still loading." }) } };
    const panel = layersPanel(ctx as never);
    panel.update({ recipe, library: { draft: undefined }, locked: undefined, layer: recipe.layers[0] } as never);
    const rows = (panel.spec.element as unknown as LightElement).querySelectorAll(".item-main");
    const glitter = rows.find(row => row.textContent.includes("Glitter lid"))!, liner = rows.find(row => row.textContent.includes("Liner"))!;
    expect(glitter.getAttribute("aria-description")).toBe("Left out of your mod files: Glitter can't be built into a mod yet.");
    expect(liner.getAttribute("aria-description")).toBeNull();
    // A layer cut off at the plate's edge gets the same warning flag, consequence first, in 90 characters or fewer (PREV-146).
    const wash = rows.find(row => row.textContent.includes("Wash"))!;
    expect(wash.getAttribute("aria-description")).toBe(EDGE_CUT_NOTE);
    expect(EDGE_CUT_NOTE.startsWith("Cut off at the plate's edge in game")).toBe(true);
    expect(EDGE_CUT_NOTE.length).toBeLessThanOrEqual(90);
  });
});

describe("wording helpers", () => {
  test("the preview's readiness says the same thing everywhere (UI-92)", async () => {
    const { readinessText } = await import("../src/studio-ui/readiness-text");
    const at = (phase: string, head: string, extra = {}) => readinessText({ readiness: { phase, size: 2048, pending: 2, ...extra } as never,
      viewport: { head: { phase: head } } as never });
    expect(at("ready", "ready").label).toBe("3D view 2K · ready");
    expect(at("updating", "loading").label).toBe("UV map 2K · updating");
    expect(at("updating", "ready").detail).toBe("2 textures still to make. Until then, layers show their last finished texture.");
    expect(at("blocked", "ready", { error: "Out of memory." })).toMatchObject({ label: "3D view couldn't update", detail: "Out of memory." });
  });

  test("the palette shows each group once, where it first appears (UI-91)", async () => {
    const { matchCommands } = await import("../src/studio-ui/commands");
    const list = [{ title: "Front view", group: "View" }, { title: "Calibrate", group: "Research" }, { title: "Quality 1K", group: "View" }];
    expect(matchCommands(list, "").map(command => command.title)).toEqual(["Front view", "Quality 1K", "Calibrate"]);
  });
});

describe("The workspace notice (style guide t-recovering, t-unprotected): it never moves the dock for a transient state", () => {
  // The confirm popover places itself in the window (the light DOM has none: give it one for these tests).
  const globals = globalThis as { window?: unknown };
  const had = globals.window;
  beforeAll(() => { globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {} }; });
  afterAll(() => { if (had === undefined) delete globals.window; else globals.window = had; });
  const harness = async () => {
    const { workspaceNotice, restoringLine } = await import("../src/studio-ui/app");
    const sent: string[] = [];
    const rt = { port: { workspace: { dispatch: async () => ({ ok: true }) }, documents: { dispatch: async (action: { kind: string }) => { sent.push(action.kind); return { ok: true }; } } },
      file: (action: { kind: string }) => { sent.push(action.kind); }, feedback: { toast() {} } };
    const notice = workspaceNotice(rt as never);
    const root = notice.element as unknown as LightElement;
    const frame = (recovering: { shown: boolean; long: boolean; safe: boolean; missing: number }, extra: { unprotected?: number; reason?: "pending" | "failed" | "storage-full"; gesture?: boolean } = {}) =>
      ({ status: { outbox: { unprotected: extra.unprotected ?? 0, unprotectedReason: extra.reason, pending: 1, conflicts: 0, failing: false, recovering } }, files: {},
        preview: { gesture: extra.gesture ? { source: "uv" } : null, control: null } }) as never;
    const visible = () => buttons(root).filter(button => !button.hidden).map(button => text(button));
    const shown = (name: string) => buttons(root).find(button => !button.hidden && text(button) === name)!;
    return { notice, root, frame, visible, shown, sent, restoringLine };
  };

  test("restoring's first seconds are the status bar's line, never the band; once it takes a while the band offers its labelled ways on", async () => {
    const { notice, root, frame, visible, shown, sent, restoringLine } = await harness();
    notice.update(frame({ shown: false, long: false, safe: false, missing: 0 }));
    expect(root.hidden).toBe(true);
    expect(restoringLine(frame({ shown: false, long: false, safe: false, missing: 0 }))).toBe("");
    // Shown after a second: the status bar's fixed line says so, and the band stays closed (nothing under the header moves).
    notice.update(frame({ shown: true, long: false, safe: false, missing: 0 }));
    expect(root.hidden).toBe(true);
    expect(restoringLine(frame({ shown: true, long: false, safe: false, missing: 0 }))).toBe("Restoring changes from your last session…");
    notice.update(frame({ shown: true, long: true, safe: true, missing: 0 }));
    expect(root.hidden).toBe(false);
    expect(restoringLine(frame({ shown: true, long: true, safe: true, missing: 0 }))).toBe("");
    expect(text(root.querySelector(".workspace-notice-text")!)).toBe("Restoring changes from your last session is taking a while.");
    expect(visible()).toEqual(["Try again", "Use restored"]);
    expect(shown("Use restored").getAttribute("title")).toBe("Keep working on the restored version");
    // One rule at every width: every button is labelled, none an icon alone (B6, I2).
    for (const button of buttons(root)) { expect(button.querySelector("svg")).toBeNull(); expect(button.classList.contains("icon-only")).toBe(false); }
    shown("Use restored").click();
    shown("Try again").click();
    notice.update(frame({ shown: true, long: true, safe: false, missing: 0 }));
    expect(visible()).toEqual(["Try again", "Export this window's copy"]);
    await settle();
    expect(sent).toEqual(["documents.keepRestored", "documents.retryRecovery"]);
  });

  test("a missing save offers Import save… and Discard those changes, which asks first in place with focus on Cancel", async () => {
    const { notice, root, frame, visible, shown, sent } = await harness();
    notice.update(frame({ shown: true, long: true, safe: false, missing: 1 }));
    expect(text(root.querySelector(".workspace-notice-text")!)).toBe("Some restored changes need a game save that's no longer on this computer. Import it again, or discard them.");
    expect(visible()).toEqual(["Import save…", "Discard those changes"]);
    shown("Import save…").click();
    shown("Discard those changes").click();
    await settle();
    // Nothing is discarded yet: the confirmation names what goes.
    expect(sent).toEqual(["savedV.import"]);
    const popover = lightDocument.body.querySelector(".confirm-popover")!;
    expect(popover.getAttribute("role")).toBe("alertdialog");
    expect(text(popover.querySelector(".popover-message")!)).toBe("Discard the restored changes that need that game save? What they changed goes back to the library's version, and they can't be got back.");
    expect(text(lightDocument.activeElement!)).toBe("Cancel");
    popover.dispatchEvent(lightEvent("submit"));
    await settle();
    expect(sent).toEqual(["savedV.import", "documents.discardWaiting"]);
    expect(lightDocument.body.querySelector(".confirm-popover")).toBeNull();
  });

  test("the unprotected line waits until a gesture in progress ends, then stays until a record is written", async () => {
    const { notice, root, frame, visible } = await harness();
    const idle = { shown: false, long: false, safe: false, missing: 0 };
    notice.update(frame(idle, { unprotected: 1, gesture: true }));
    expect(root.hidden).toBe(true);
    notice.update(frame(idle, { unprotected: 1 }));
    expect(root.hidden).toBe(false);
    // It says what could happen, never "protected" (UI review item 11).
    expect(text(root.querySelector(".workspace-notice-text")!)).toBe("Your latest changes couldn't be backed up on this computer. If XF Studio closes before your library has them, they could be lost.");
    expect(visible()).toEqual(["Try again", "Export this window's copy"]);
    // Open, it stays through the next gesture (closing it then would move the dock too).
    notice.update(frame(idle, { unprotected: 1, gesture: true }));
    expect(root.hidden).toBe(false);
    notice.update(frame(idle));
    expect(root.hidden).toBe(true);
  });

  test("a delayed backup is still being written, a known full store names the next step, and recovery buttons keep their order", async () => {
    const { notice, root, frame, visible } = await harness();
    const idle = { shown: false, long: false, safe: false, missing: 0 };
    notice.update(frame(idle, { unprotected: 1, reason: "pending" }));
    expect(text(root.querySelector(".workspace-notice-text")!)).toContain("still being backed up");
    notice.update(frame(idle, { unprotected: 1, reason: "storage-full" }));
    expect(text(root.querySelector(".workspace-notice-text")!)).toContain("Storage on this computer is full");
    expect(text(root.querySelector(".workspace-notice-text")!)).toContain("Free up some space, then try again");
    expect(visible()).toEqual(["Try again", "Export this window's copy"]);
    const copy = buttons(root).find(button => text(button) === "Export this window's copy")!;
    expect(copy.getAttribute("title")).toStartWith("Write the collection");
    expect(copy.getAttribute("title")).toEndWith("Nothing goes to your library.");
    notice.update(frame(idle));
    expect(root.hidden).toBe(true);
  });
});

describe("Polish batch 2: the profiles phase 1 UI follow-ups", () => {
  const globals = globalThis as { window?: unknown };
  const had = globals.window;
  beforeAll(() => { globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {} }; });
  afterAll(() => { if (had === undefined) delete globals.window; else globals.window = had; });
  const idle = { shown: false, long: false, safe: false, missing: 0 };
  const leaseFrame = (lease: Record<string, unknown>) => ({ status: { lease, outbox: { unprotected: 0, pending: 0, conflicts: 0, failing: false, recovering: idle } },
    preview: { gesture: null, control: null } }) as never;

  test("failed startup uses its own notice and no takeover action, before or after migration", async () => {
    const { workspaceNotice, workspaceNoticeState } = await import("../src/studio-ui/app");
    const { profileWorkspaceLease } = await import("../src/app/profiles/profile-window");
    const { leaseSnapshot, LEASE_MESSAGES } = await import("../src/app/workspace/workspace-lease");
    for (const verification of [false, true]) for (const stored of [false, true]) for (const phase of ["unsupported", "disconnected"] as const) {
      const lease = profileWorkspaceLease({ snapshot: () => leaseSnapshot({ phase, generation: null }), writable: () => false }, stored);
      const frame = { ...leaseFrame(lease) as object, status: { lease, verification } } as never;
      expect(lease.migrationPending).toBe(false);
      expect(workspaceNoticeState(frame)).toMatchObject({ message: LEASE_MESSAGES[phase], actions: [], progress: false });
      const notice = workspaceNotice({ port: {}, feedback: {} } as never);
      notice.update(frame);
      const root = notice.element as unknown as LightElement;
      expect(text(root)).toContain(phase === "unsupported" ? "Use an up-to-date browser" : "Reload the window");
      expect(text(root)).not.toContain("Workspace needs updating");
      expect(buttons(root).filter(button => !button.hidden)).toEqual([]);
    }
  });

  test("condition 1: the kept-the-workspace line offers both ways on it names, Try again and Export this window's copy", async () => {
    const { workspaceNotice, workspaceNoticeState } = await import("../src/studio-ui/app");
    const sent: string[] = [];
    const rt = { port: { workspace: { dispatch: async (action: { kind: string }) => { sent.push(action.kind); return { ok: true }; } }, documents: { dispatch: async () => ({ ok: true }) } },
      file: (action: { kind: string }) => { sent.push(action.kind); }, feedback: { toast() {} } };
    const kept = leaseFrame({ phase: "release-failed", writable: true, canTakeOver: false, canRetry: true, refusal: "",
      message: "Your latest changes couldn't be saved, so this window kept the workspace. Try again, or export this window's copy to keep them." });
    expect(workspaceNoticeState(kept)?.actions).toEqual(["retryRelease", "exportCopy"]);
    const notice = workspaceNotice(rt as never);
    notice.update(kept);
    const root = notice.element as unknown as LightElement;
    const shown = buttons(root).filter(button => !button.hidden);
    expect(shown.map(button => text(button))).toEqual(["Try again", "Export this window's copy"]);
    for (const button of shown) button.click();
    await settle();
    expect(sent).toEqual(["workspace.retryRelease", "collection.exportWindowCopy"]);
    // A read-only window offers Use it here alone; a message alone (taking over) offers nothing and keeps no empty button row.
    expect(workspaceNoticeState(leaseFrame({ phase: "read-only", writable: false, canTakeOver: true, canRetry: false, refusal: "x", message: "This workspace is open in another window." }))?.actions)
      .toEqual(["takeOver"]);
    notice.update(leaseFrame({ phase: "taking-over", writable: false, canTakeOver: false, canRetry: false, refusal: "x", message: "Taking over from the other window…" }));
    expect(buttons(root).filter(button => !button.hidden)).toEqual([]);
    expect((root.querySelector(".workspace-notice-actions") as LightElement).hidden).toBe(true);
  });

  test("condition 5: while the restoring line shows, the status bar's idle \"Ready\" gives way; real activity stays", async () => {
    const { statusActivity } = await import("../src/studio-ui/app");
    const frame = (recovering: typeof idle, library: Record<string, unknown> = {}) =>
      ({ status: { outbox: { unprotected: 0, pending: 1, conflicts: 0, failing: false, recovering } }, library: { busy: false, ...library } }) as never;
    const restoring = { shown: true, long: false, safe: false, missing: 0 };
    expect(statusActivity(frame(idle), undefined)).toEqual({ text: "Ready", tone: "info", hidden: false });
    expect(statusActivity(frame(restoring), undefined)).toMatchObject({ hidden: true });
    expect(statusActivity(frame(restoring), { message: "Opened “Night market set”.", tone: "success" })).toEqual({ text: "Opened “Night market set”.", tone: "success", hidden: false });
    expect(statusActivity(frame(restoring, { busy: true, progress: { phase: "working", message: "Saving…" } }), undefined)).toEqual({ text: "Saving…", tone: "progress", hidden: false });
  });

  test("UI-188: the workspace notice is the library's component: labelled ways out in the owner's order, Discard asks first", async () => {
    const { WorkspaceNotice, WORKSPACE_NOTICE_ACTIONS } = await import("../src/studio-ui/components");
    const chosen: string[] = [];
    const notice = new WorkspaceNotice({ onAction: action => chosen.push(action) });
    const root = notice.element as unknown as LightElement;
    expect(root.hidden).toBe(true);
    notice.update({ message: "Restored", actions: ["exportCopy", "retryRestore"] });
    const visible = () => buttons(root).filter(button => !button.hidden).map(button => text(button));
    expect(visible()).toEqual(["Export this window's copy", "Try again"]);
    notice.update({ message: "Restored", actions: ["retryRestore", "exportCopy"] });
    expect(visible()).toEqual(["Try again", "Export this window's copy"]);
    // A gesture in progress: a closed notice waits; an open one changes in place.
    notice.update(null);
    notice.update({ message: "Unprotected", actions: ["exportCopy", "protect"] }, { deferOpen: true });
    expect(root.hidden).toBe(true);
    notice.update({ message: "Unprotected", actions: ["exportCopy", "protect"] });
    notice.update({ message: "Missing", actions: ["importSave", "discardWaiting"] }, { deferOpen: true });
    expect([root.hidden, visible()]).toEqual([false, ["Import save…", "Discard those changes"]]);
    buttonNamed(root, "Discard those changes")!.click();
    expect(chosen).toEqual([]);
    lightDocument.body.querySelector(".confirm-popover")!.dispatchEvent(lightEvent("submit"));
    expect(chosen).toEqual(["discardWaiting"]);
    // The three Try agains say what each tries.
    expect(new Set([WORKSPACE_NOTICE_ACTIONS.retryRelease.title, WORKSPACE_NOTICE_ACTIONS.protect.title, WORKSPACE_NOTICE_ACTIONS.retryRestore.title]).size).toBe(3);
  });

  test("UI-187: the header gives way in its fixed order until the names have room", async () => {
    const { HEADER_STAGES, MIN_CHARACTERS, headerStages, nameFits, stagesThatFit } = await import("../src/studio-ui/header-fit");
    expect(HEADER_STAGES).toEqual(["commands", "flag", "package", "brand", "save", "collection"]);
    expect(MIN_CHARACTERS).toBe(12);
    // The fewest stages that fit; all of them when none does.
    expect(stagesThatFit(applied => applied >= 3)).toBe(3);
    expect(stagesThatFit(() => true)).toBe(0);
    expect(stagesThatFit(() => false)).toBe(HEADER_STAGES.length);
    // Whole names first, with up to five stages given way (never the collection's name); else readable names, the collection's last to go.
    expect(headerStages((applied, whole) => whole ? applied >= 5 : applied >= 2)).toBe(5);
    expect(headerStages((applied, whole) => whole ? false : applied >= 2)).toBe(2);
    expect(headerStages((applied, whole) => whole ? applied >= HEADER_STAGES.length : applied >= HEADER_STAGES.length)).toBe(HEADER_STAGES.length);
    // A name fits whole, or with at least the minimum shown; a short name never needs the minimum.
    expect([nameFits(40, 40, 96), nameFits(96, 140, 96), nameFits(60, 140, 96), nameFits(50, 60, 96)]).toEqual([true, true, false, false]);
  });

  test("UI-189 and polish: one name for reopening, no faded Open on the open row, no edge case in the save toast", async () => {
    const { RecordList } = await import("../src/studio-ui/components");
    const list = new RecordList({ label: "Saved collections" });
    list.update([{ id: "a", name: "Night market set", meta: ["4 presets"], badge: { text: "Open now", tone: "info" }, current: true }]);
    expect((list.element as unknown as LightElement).querySelectorAll("button")).toEqual([]);
    const { CONTEXT_LABELS } = await import("../src/studio-ui/target-menus");
    expect(CONTEXT_LABELS["collection.undoOpen"]![0]).toBe("Reopen previous collection");
    const { reopenPreviousAction } = await import("../src/studio-ui/panels/collection");
    expect(reopenPreviousAction({ port: { library: { summary: () => ({ draft: { id: "c" } }) } } } as never).label).toBe("Reopen previous");
  });
});
