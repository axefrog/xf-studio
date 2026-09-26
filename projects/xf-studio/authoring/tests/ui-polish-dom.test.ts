// The UI/UX review fixes (UI-80..97) over the light DOM harness (light-dom.ts): ordinary refusals fade, unavailable actions stay
// focusable and say why, a Build offers "Add to my mod manager" with a reviewed plan and "Show in folder", Game & tools offers what
// XF Studio found and saves each choice at once, and the failure card offers a report instead of a log path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { InstallDetectionActions } from "../src/install-detection-actions";
import { LocalSetupActions, type LocalSetupTransport } from "../src/local-setup-actions";
import { ModInstallActions, type ModInstallPlan } from "../src/mod-install-actions";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => {
  installLightDom();
  Object.assign(globalThis, { requestAnimationFrame: (run: () => void) => setTimeout(run, 0) });
});
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
  route: "mo2", place: "Mod Organizer 2 (profile “Main”)", blocked: null, replacing: false, token: "t1", notes: [],
  changes: ["Add the mod “XF Eye Artistry” to Mod Organizer 2, with its 2 files in D:\\MO2\\mods\\XF Eye Artistry\\archive\\pc\\mod.",
    "Add “XF Eye Artistry” to the profile “Main”, switched on. At the bottom of the \"Looks\" section, where Mod Organizer puts newly installed mods.",
    "Nothing else in your mod list changes."], ...over });
const VIEW = (fields: Record<string, unknown> = {}) => ({ revision: 1, source: "primary", overridden: [],
  fields: { gameRoot: null, launchRoute: "mo2", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null, eyePlateHead: "installed", ...fields },
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

async function packageHarness(options: { plan?: ModInstallPlan; files?: Record<string, unknown>; picker?: boolean; view?: ReturnType<typeof VIEW> } = {}) {
  const { Feedback } = await import("../src/studio-ui/feedback");
  const { Frame } = await import("../src/studio-ui/runtime");
  const { packagePanel } = await import("../src/studio-ui/panels/collection");
  const saved: unknown[] = [], sentInstall: unknown[] = [];
  let view = options.view ?? VIEW();
  const transport: LocalSetupTransport = async (method, body) => {
    if (method === "PATCH") { saved.push((body as { fields: Record<string, unknown> }).fields); view = { ...view, fields: { ...view.fields, ...(body as { fields: object }).fields } }; }
    return { ok: true, status: 200, data: view as never };
  };
  const setup = new LocalSetupActions(transport, options.picker ? async () => "E:\\Games\\Cyberpunk 2077" : null);
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
  const files = options.files ?? { package: BUILD };
  const port = {
    files: { capability: () => ({ available: true }), snapshot: () => files },
    library: { capability: () => ({ available: true }), summary: () => ({ busy: false, products: [], draft: { presets: [{ id: "look1", name: "Night market" }] } }) },
    authoring: { capability: () => ({ available: true }), requestCapability: () => ({ available: true }) },
    localSetup: { snapshot: () => setup.snapshot(), capability: (a: never) => setup.capability(a), dispatch: (a: never) => setup.dispatch(a) },
    installDetection: { snapshot: () => detection.snapshot(), capability: (a: never) => detection.capability(a), dispatch: (a: never) => detection.dispatch(a) },
    modInstall: { snapshot: () => install.snapshot(), capability: (a: never) => install.capability(a), dispatch: (a: never) => install.dispatch(a) },
    diagnostics: { expected: (code?: string) => code === "package_build_unavailable", capability: () => ({ available: true }) },
    preferences: { snapshot: () => ({ researchTools: false }) },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  for (const service of [setup, detection, install]) service.subscribe(() => { for (const listener of listeners) listener(); });
  const feedback = new Feedback();
  const rt = { port, feedback, finishes: [], anchors: { register() {} }, dock: { reveal() {} }, request: async () => {}, dispatch: () => true,
    changed: () => paint(), report: () => true };
  const panel = packagePanel(rt as never);
  lightDocument.body.append(panel.spec.element as never);
  const paint = () => panel.update(new Frame(port as never) as never);
  paint();
  return { panel, root: panel.spec.element as unknown as LightElement, paint, saved, sentInstall, setup, detection, feedback };
}

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
    h.panel.spec.element.remove();
  });

  test("a blocked plan says why, offers the one next step, and can't be accepted", async () => {
    const h = await packageHarness({ plan: PLAN({ blocked: "Choose your Mod Organizer 2 instance and profile in Game & tools first." }) });
    buttonNamed(h.root, "Add to Mod Organizer 2…")!.click();
    expect(await until(() => !!openSheet()?.querySelector(".install-status")?.textContent, h.paint)).toBe(true);
    const sheet = openSheet()!;
    expect(text(sheet.querySelector(".install-status")!)).toBe("Choose your Mod Organizer 2 instance and profile in Game & tools first.");
    expect(buttonNamed(sheet, "Open Game & tools")!.hidden).toBe(false);
    const consent = buttonNamed(sheet, "Add to Mod Organizer 2")!;
    expect(consent.getAttribute("aria-disabled")).toBe("true");
    consent.click();
    await settle();
    expect(h.sentInstall.filter(body => (body as { action: string }).action === "install")).toEqual([]);
    buttonNamed(sheet, "Close")!.click();
    h.panel.spec.element.remove();
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

describe("Game & tools: one form, what XF Studio found, saved as chosen (UI-83, UI-03)", () => {
  test("detected folders and profiles are choices, and choosing one saves it", async () => {
    const h = await packageHarness();
    const section = h.root.querySelector(".setup-section")!;
    section.open = true;
    section.dispatchEvent(lightEvent("toggle"));
    await settle(); h.paint();
    const selects = section.querySelectorAll("select");
    const game = selects.find(select => select.options.some(option => option.getAttribute("value") === "D:\\Steam\\Cyberpunk 2077"))!;
    expect(game.options.map(option => text(option))).toEqual(["D:\\Steam\\Cyberpunk 2077 (Steam)", "Another folder…", "Not chosen yet"]);
    game.value = "D:\\Steam\\Cyberpunk 2077";
    game.dispatchEvent(lightEvent("change"));
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ gameRoot: "D:\\Steam\\Cyberpunk 2077" });
    const mo2 = selects.find(select => select.options.some(option => option.getAttribute("value") === "D:\\MO2"))!;
    mo2.value = "D:\\MO2";
    mo2.dispatchEvent(lightEvent("change"));
    await settle(); h.paint();
    expect(h.saved.at(-1)).toMatchObject({ mo2Root: "D:\\MO2" });
    const profile = section.querySelectorAll("select").find(select => select.options.some(option => text(option) === "Main (last used)"))!;
    expect(profile.options.map(option => text(option))).toEqual(["Choose a profile", "Main (last used)", "Testing"]);
    // No native picker on this host: no Browse… to press.
    expect(buttons(section).filter(button => text(button) === "Browse…").every(button => button.hidden)).toBe(true);
    // One plain line says what is missing.
    expect(text(section.querySelector(".setup-status")!)).toBe("To build your mod files: Choose your Cyberpunk 2077 folder.");
    h.panel.spec.element.remove();
  });

  test("with the desktop's folder picker, Browse… chooses and saves a folder", async () => {
    const h = await packageHarness({ picker: true });
    const section = h.root.querySelector(".setup-section")!;
    const browse = buttons(section).find(button => text(button) === "Browse…" && !button.hidden)!;
    expect(browse).toBeTruthy();
    browse.click();
    await settle();
    expect(h.saved.at(-1)).toMatchObject({ gameRoot: "E:\\Games\\Cyberpunk 2077" });
    h.panel.spec.element.remove();
  });
});

describe("the layer list says what the flag shows (UI-95)", () => {
  test("a layer left out of the mod files is described to screen readers, not only drawn", async () => {
    const { layersPanel } = await import("../src/features/eye-makeup/view/layers");
    const recipe = { layers: [{ id: "a", name: "Glitter lid", color: "#ffffff", opacity: 1, symmetry: true, enabled: true, finish: "glitter" },
      { id: "b", name: "Liner", color: "#000000", opacity: 1, symmetry: true, enabled: true, finish: "matte" }] };
    const facade = { view: () => ({ recipe: () => recipe, layer: () => recipe.layers[0], selected: () => 0 }),
      finishCatalogue: () => [{ id: "glitter", label: "Glitter", stored: [], exportAdapter: "none" }, { id: "matte", label: "Matte", stored: [], exportAdapter: "flat-provisional" }],
      glitterModelCatalogue: () => [{ id: "classic", label: "Classic", summary: "", stored: [] }],
      layerExport: (id: string) => id === "a" ? { exportable: false, reason: "Glitter can't be built into a mod yet.", blockedBy: "layer" } : { exportable: true, experimental: false, note: "" },
      capability: () => ({ available: true }), contextCapability: () => ({ available: true }) };
    const ctx = { facade, dispatch: () => true, platform: () => true, feedback: { toast() {}, announce() {} }, anchors: { register() {} }, links: { open: async () => ({ ok: true }) } };
    const panel = layersPanel(ctx as never);
    panel.update({ recipe, library: { draft: undefined }, locked: undefined, layer: recipe.layers[0] } as never);
    const rows = (panel.spec.element as unknown as LightElement).querySelectorAll(".item-main");
    const glitter = rows.find(row => row.textContent.includes("Glitter lid"))!, liner = rows.find(row => row.textContent.includes("Liner"))!;
    expect(glitter.getAttribute("aria-description")).toBe("Left out of your mod files: Glitter can't be built into a mod yet.");
    expect(liner.getAttribute("aria-description")).toBeNull();
  });
});

describe("wording helpers", () => {
  test("the preview's readiness says the same thing everywhere (UI-92)", async () => {
    const { readinessText } = await import("../src/studio-ui/readiness-text");
    const at = (phase: string, head: string, extra = {}) => readinessText({ readiness: { phase, size: 2048, pending: 2, ...extra } as never,
      viewport: { head: { phase: head } } as never });
    expect(at("ready", "ready").label).toBe("Preview 2K · ready");
    expect(at("updating", "loading").label).toBe("UV map 2K · updating");
    expect(at("updating", "ready").detail).toBe("2 textures still to make. Until then, layers show their last finished texture.");
    expect(at("blocked", "ready", { error: "Out of memory." })).toMatchObject({ label: "Preview couldn't update", detail: "Out of memory." });
  });

  test("the palette shows each group once, where it first appears (UI-91)", async () => {
    const { matchCommands } = await import("../src/studio-ui/commands");
    const list = [{ title: "Front view", group: "View" }, { title: "Calibrate", group: "Research" }, { title: "Quality 1K", group: "View" }];
    expect(matchCommands(list, "").map(command => command.title)).toEqual(["Front view", "Quality 1K", "Calibrate"]);
  });
});
