// The Character panel review's fixes (code-health ledger, claude/cleanup-ccpanel): a failing catalogue build, the shared name and
// limit rule, the structural derivation, identities of pages, same-named choices, the quick action's home, generation tags, gating,
// kept preset entries, the tried-style migration, the follower of the context and the host search. Asset-free fixtures only.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatalogue, CatalogueIndex, readCcoWithPresentation } from "../src/cc-catalogue";
import { CreatorCatalogueHost, CreatorFailedError, structuralInput } from "../src/cc-catalogue-service";
import { createCreatorHandler } from "../src/cc-catalogue-server";
import { choicePage, makeupOff, panelProjection, rowOption, searchChoices, type CcPanel, type CreatorView } from "../src/cc-panel";
import { CC_PRESET_SCHEMA, parseCcPreset, serializeCcPreset } from "../src/cc-preset";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { carryPreset, type CharacterChoice, type CharacterSource, deriveCharacter, lastChoices, matchChoice } from "../src/character-context";
import { CharacterContextActions, type CreatorPort, storedCharacterOf } from "../src/character-context-actions";
import { characterRequestOf, DEFAULT_CHARACTER, parseCharacterRequest, type CharacterRequest } from "../src/character-detail-request";
import { createCharacterDetailHandler } from "../src/character-detail-server";
import { followCharacter } from "../src/character-follow";
import { loadMergedCco } from "../src/character-resolver";
import { CREATOR_LIMITS, isCreatorName, isOptionId } from "../src/creator-names";
import { appearance, creator, fixtureSource, switcher } from "./cc-fixtures";
import { fixtureInstallation } from "./resolver-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-ccpanel-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
const set = (option: string, choice: string, extra: Partial<CharacterChoice> = {}): CharacterChoice => ({ part: "head", option, choice, ...extra });

/** A creator whose hairstyle switcher lists two choices with the same name, each turning on its own hair (two mods' "Long"). */
async function duplicateSource(): Promise<CharacterSource & { index: CatalogueIndex }> {
  const cco = creator([
    switcher("hairstyle", [["Off", []], ["Long", ["hair_a"]], ["Long", ["hair_b"]]], { uiSlot: "hairstyle", slots: ["hair_color"], index: 20, category: "Hair" }),
    appearance("hair_a", "base\\hair_a.app", ["a_brown", "a_black"], { uiSlot: "hair_color", enabled: false, index: 21, category: "Hair" }),
    appearance("hair_b", "base\\hair_b.app", ["b_brown", "b_black"], { uiSlot: "hair_color", enabled: false, index: 21, category: "Hair" }),
  ], { TPP: ["hair_a", "hair_b"] });
  const { graph } = fixtureInstallation([{ virtualPath: "archive/pc/content/basegame_4_gamedata.archive",
    files: { "base\\gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization": cco } }]);
  const merged = await loadMergedCco(graph, "female", readCcoWithPresentation);
  const catalogue = buildCatalogue({ bodyGender: "female", cco: merged.merged.cco, text: null, presentation: null, customs: [] });
  return { catalogue, cco: merged.merged.cco, index: new CatalogueIndex(catalogue) };
}

/** A catalogue service over the fixture creator; `fail` makes every build throw. */
async function service(options: { fail?: () => boolean; now?: () => number } = {}) {
  const source = await fixtureSource(true);
  let builds = 0;
  const host = new CreatorCatalogueHost({ route: () => ({ gameRoot: root, launchRoute: "direct", wolvenKitCli: "wk" }), fingerprint: () => "one",
    resolverCache: join(root, "resolver"), open: () => ({}) as never, now: options.now,
    load: async () => { builds++; if (options.fail?.()) throw Error("TweakDB unreadable after a patch"); return { source, catalogue: source.catalogue,
      evidence: { language: { code: "en-us", from: "default" }, texts: [], tweakDb: null, customResources: 1 } }; } });
  return { host, builds: () => builds, source };
}

/** A context port over a source, interpreting requests as the host does; `panel` may be adjusted (a marked makeup section). */
async function port(source: CharacterSource, adjust: (panel: CcPanel) => CcPanel = panel => panel) {
  const { panel, mods } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
  const index = new CatalogueIndex(source.catalogue);
  const log: string[] = [];
  let identity = "fixture";
  const pending: (() => void)[] = [];
  let hold = false;
  const creatorPort: CreatorPort = {
    panel: async () => { log.push("panel"); return { phase: "ready", message: "", panel: { ...structuredClone(adjust(panel)), identity } }; },
    page: async (_gender, option, offset, _signal, query) => {
      log.push(`page:${option}${query ? `?${query}` : ""}`);
      if (hold) await new Promise<void>(resolve => pending.push(resolve));
      return choicePage(index, mods, option, offset, { identity, query })!;
    },
    search: async (_gender, query) => searchChoices(index, query, identity),
    view: async request => {
      log.push("view");
      const saved = request.source === "save" ? { appearances: request.appearances, morphs: request.morphs } : null;
      const { view } = deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? []);
      const values = Object.fromEntries(Object.entries(view.values).map(([id, value]) => [id, { ...value, label: value.choice, color: null, ownLabel: value.own }]));
      return { ...view, identity, values, faceMorphs: [] } as CreatorView;
    },
    preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }),
    wait: async () => {},
  };
  return { port: creatorPort, log, setIdentity: (value: string) => { identity = value; }, hold: (value: boolean) => { hold = value; }, release: () => { for (const go of pending.splice(0)) go(); } };
}

describe("PIPE-78: a failing catalogue build", () => {
  test("state() never builds again; the failure is reported plainly; a question builds again only after the backoff; Try again builds at once", async () => {
    let now = 0;
    const { host, builds } = await service({ fail: () => true, now: () => now });
    expect(host.state("female").phase).toBe("preparing");
    await settle();
    const phases: string[] = [];
    for (let i = 0; i < 20; i++) { phases.push(host.state("female").phase); await settle(1); }
    expect(new Set(phases)).toEqual(new Set(["failed"]));
    expect(host.state("female").message).toBe("XF Studio couldn't read your game's character-creator options, so they can't be changed here yet.");
    expect(builds()).toBe(1);
    // A question inside the backoff answers the kept failure without building.
    await expect(host.page("female", "head/eyes_color", 0)).rejects.toBeInstanceOf(CreatorFailedError);
    expect(builds()).toBe(1);
    // After the backoff (10 s, then doubling), a question builds once more.
    now = 10_001;
    await expect(host.page("female", "head/eyes_color", 0)).rejects.toBeInstanceOf(CreatorFailedError);
    expect(builds()).toBe(2);
    now = 20_000;
    await expect(host.view(DEFAULT_CHARACTER)).rejects.toBeInstanceOf(CreatorFailedError);
    expect(builds()).toBe(2);
    // Try again builds at once.
    host.retry("female"); await settle();
    expect(builds()).toBe(3);
  });

  test("the endpoint: a failed catalogue answers `failed` with a plain line; POST retry answers the state; the context shows it and offers Try again", async () => {
    let failing = true;
    const { host, builds } = await service({ fail: () => failing });
    const handler = createCreatorHandler(host);
    const get = (query: string) => handler(new Request(`http://127.0.0.1/api/preview-character/creator?${query}`));
    const post = (body: unknown) => handler(new Request("http://127.0.0.1/api/preview-character/creator", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: JSON.stringify(body) }));
    await get("gender=female"); await settle();
    expect(await (await get("gender=female")).json()).toMatchObject({ phase: "failed" });
    const page = await get("gender=female&option=head%2Feyes_color&offset=0");
    expect(page.status).toBe(503);
    expect(await page.json()).toMatchObject({ code: "failed" });
    failing = false;
    expect(await (await post({ kind: "retry", bodyGender: "female" })).json()).toMatchObject({ phase: "preparing" });
    await settle();
    expect(await (await get("gender=female")).json()).toMatchObject({ phase: "ready" });
    expect(builds()).toBe(2);
  });

  test("the context stops at a failure (no polling), offers Try again, and Try again follows the catalogue once more", async () => {
    const source = await fixtureSource(true);
    const { port: base } = await port(source);
    let answer: "failed" | "ready" = "failed", panels = 0, retries = 0;
    const creatorPort: CreatorPort = { ...base,
      panel: async (gender, signal) => { panels++; return answer === "failed" ? { phase: "failed", message: "XF Studio couldn't read it." } : base.panel(gender, signal); },
      retry: async (gender, signal) => { retries++; return base.panel(gender, signal); } };
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    expect(context.snapshot()).toMatchObject({ phase: "failed", message: "XF Studio couldn't read it.", retry: true });
    await settle(30);
    expect(panels).toBe(1);
    answer = "ready";
    context.dispatch({ kind: "character.retry" });
    await settle();
    expect(retries).toBe(1);
    expect(context.snapshot()).toMatchObject({ phase: "ready", retry: false });
    expect(context.capability({ kind: "character.retry" })).toMatchObject({ available: false });
  });
});

describe("PIPE-79: one name and limit rule from preset to request to storage", () => {
  const names = ["o".repeat(255), `quote"d <angle> and/slash`, "LocKey#12345", "x"];

  test("every step accepts the same names; over the limit is refused by all of them", () => {
    for (const name of names) {
      expect(isCreatorName(name)).toBe(true);
      expect(isOptionId(`head/${name}`)).toBe(true);
    }
    for (const bad of ["o".repeat(256), "a\\b", "tab\there", ""]) expect(isCreatorName(bad)).toBe(false);
    expect(isOptionId("torso/x")).toBe(false);
  });

  test("preset → request → host → stored round-trips names at the limits", () => {
    const values = names.map((name, i) => ({ part: "head", option: `${name.slice(0, 250)}${i}`, choice: name, activates: [name], mod: "m".repeat(255) }));
    const preset = parseCcPreset({ schema: CC_PRESET_SCHEMA, bodyGender: "female", name: "n".repeat(CREATOR_LIMITS.presetName), values });
    const { choices, notCarried } = carryPreset(preset);
    expect(notCarried).toEqual([]);
    expect(choices).toHaveLength(names.length);
    const request = characterRequestOf({ bodyGender: "female", saved: null }, choices);
    const parsed = parseCharacterRequest(JSON.parse(JSON.stringify(request)));
    expect(parsed.choices).toEqual(choices);
    expect(storedCharacterOf({ origin: "preset", choices: parsed.choices })?.choices).toEqual(choices);
  });

  test("a preset larger than one V carries the first 2,048 and reports the rest; a name only too long is kept verbatim and reported; nothing is sent that the host refuses", () => {
    const values = Array.from({ length: 3000 }, (_, i) => ({ part: "head", option: `opt_${i}`, definition: "x" }));
    values.push({ part: "head", option: "y".repeat(300), definition: "x" });
    const preset = parseCcPreset({ schema: CC_PRESET_SCHEMA, bodyGender: "female", values });
    expect(preset.values).toHaveLength(3000);
    const { choices, notCarried } = carryPreset(preset);
    expect(choices).toHaveLength(CREATOR_LIMITS.choices);
    expect(notCarried).toHaveLength(3000 - CREATOR_LIMITS.choices + 1);
    expect(notCarried.every(entry => entry.reason === "not-carried" && entry.from === "preset")).toBe(true);
    expect(() => parseCharacterRequest(JSON.parse(JSON.stringify(characterRequestOf({ bodyGender: "female", saved: null }, choices))))).not.toThrow();
    expect(storedCharacterOf({ origin: "preset", choices })?.choices).toHaveLength(CREATOR_LIMITS.choices);
    // The verbatim entry is written back as it was read.
    expect(serializeCcPreset(preset).values).toHaveLength(3001);
  });

  test("the context reports what it couldn't carry and keeps it for Save preset", async () => {
    const source = await fixtureSource(true);
    const { port: creatorPort } = await port(source);
    let kept: Record<string, unknown> | undefined;
    const context = new CharacterContextActions({ creator: { ...creatorPort, preset: async (_request, _name, value) => { kept = value; return { text: "", values: 0, leftOut: 0, personal: 0 }; } },
      showSave: () => {} });
    context.start(); await settle();
    const values = [{ part: "head", option: "eyes_color", definition: "he__03_violet" }, { part: "head", option: "z".repeat(300), definition: "x" }];
    context.dispatch({ kind: "character.loadPreset", value: { schema: CC_PRESET_SCHEMA, bodyGender: "female", values } });
    await settle();
    expect(context.request().choices).toEqual([set("eyes_color", "he__03_violet")]);
    expect(context.snapshot().notes).toEqual([expect.stringContaining("1 choice in the preset can't be used by this XF Studio")]);
    await context.exportPreset(null);
    expect((kept as { values: unknown[] }).values).toEqual([{ part: "head", option: "z".repeat(300), definition: "x" }]);
  });

  test("both endpoints refuse a body over the limit from its declared length, before reading it (PIPE-83)", async () => {
    const { host } = await service();
    const big = { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1", "Content-Length": String(CREATOR_LIMITS.requestBytes + 1) },
      body: "{}" };
    expect((await createCreatorHandler(host)(new Request("http://127.0.0.1/api/preview-character/creator", big))).status).toBe(413);
    expect((await createCharacterDetailHandler({} as never)(new Request("http://127.0.0.1/api/preview-character", big))).status).toBe(413);
    // Counted in bytes as it arrives: a multi-byte body over the limit is refused even with no declared length.
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("\"" + "é".repeat(CREATOR_LIMITS.requestBytes / 2 + 1))); controller.close(); } });
    const streamed = await createCreatorHandler(host)(new Request("http://127.0.0.1/api/preview-character/creator", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: stream, duplex: "half" } as RequestInit));
    expect(streamed.status).toBe(413);
  });
});

describe("PIPE-80: the preparation derives a V with choices from a structural catalogue", () => {
  test("the structural input equals the full catalogue's, without texts or TweakDB", async () => {
    const { host } = await service();
    const full = await fixtureSource(true);
    const request: CharacterRequest = { ...DEFAULT_CHARACTER, choices: [set("eyes_color", "he__03_violet"), set("skin_color", "tone_c"), set("piercings", "XL-Pretty-Ring")] };
    const merged = { merged: { cco: full.cco } as never, customs: [] };
    const structural = structuralInput(request, merged as never);
    expect(structural).toEqual(await host.inputFor(request));
    // Memoised per merged resource: the second call reuses the structural catalogue.
    expect(structuralInput(request, merged as never)).toEqual(structural);
  });
});

describe("PIPE-81 and CORE-72: identities and generations", () => {
  test("every page names its catalogue; an answer from another catalogue starts the panel again", async () => {
    const source = await fixtureSource(true);
    const { port: creatorPort, log, setIdentity } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    expect(context.choices("head/eyes_color").loading).toBe(true);
    await settle();
    expect(context.choices("head/eyes_color").choices.length).toBe(4);
    setIdentity("another installation");
    context.choices("head/teeth"); await settle();
    // The page from another catalogue restarted the panel (a second panel read), and its choices were not kept.
    expect(log.filter(entry => entry === "panel")).toHaveLength(2);
    expect(context.panel()!.identity).toBe("another installation");
  });

  test("a page in flight across a body change never lands under the new body's option", async () => {
    const source = await fixtureSource(true);
    const { port: creatorPort, hold, release } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    hold(true);
    context.choices("head/eyes_color");
    context.dispatch({ kind: "character.loadPreset", value: { schema: CC_PRESET_SCHEMA, bodyGender: "male", values: [] } });
    await settle();
    hold(false); release(); await settle();
    const now = context.choices("head/eyes_color");
    expect(now.choices).toEqual([]);
  });
});

describe("CORE-70: same-named choices", () => {
  test("a switcher's two same-named choices are told apart by the options they activate, from the page to R5", async () => {
    const source = await duplicateSource();
    const { mods } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "dup");
    const page = choicePage(source.index, mods, "head/hairstyle", 0, { identity: "dup" })!;
    expect(page.choices.map(choice => [choice.key, choice.position, choice.activates])).toEqual([["Off", 0, []], ["Long", 1, ["hair_a"]], ["Long", 2, ["hair_b"]]]);
    const second = deriveCharacter(source, { kind: "default" }, [set("hairstyle", "Long", { activates: ["hair_b"] })]);
    expect(second.request.appearances.map(entry => entry.option)).toEqual(["hair_b"]);
    expect(second.view.values["head/hairstyle"]).toMatchObject({ choice: "Long", position: 2 });
    const first = deriveCharacter(source, { kind: "default" }, [set("hairstyle", "Long", { activates: ["hair_a"] })]);
    expect(first.request.appearances.map(entry => entry.option)).toEqual(["hair_a"]);
    expect(first.view.values["head/hairstyle"]).toMatchObject({ position: 1 });
    // Matching by activation is indexed, and a name alone picks the first that turns something on.
    expect(matchChoice(source.index, source.index.option("head", "hairstyle")!, { choice: "Long" })?.position).toBe(1);
  });

  test("the context sends the identity with setOption and checks it against the loaded choices", async () => {
    const source = await duplicateSource();
    const { port: creatorPort } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    context.choices("head/hairstyle"); await settle();
    context.dispatch({ kind: "character.setOption", part: "head", option: "hairstyle", choice: "Long", activates: ["hair_b"] });
    expect(context.request().choices).toEqual([set("hairstyle", "Long", { activates: ["hair_b"] })]);
    await settle();
    expect(context.view()!.values["head/hairstyle"]).toMatchObject({ position: 2 });
    expect(context.capability({ kind: "character.setOption", part: "head", option: "hairstyle", choice: "Long", activates: ["hair_c"] }))
      .toMatchObject({ available: false, code: "invalid_value" });
  });
});

describe("CORE-71 and CORE-73: the quick action and gating", () => {
  test("hide my V's own makeup is an action of the context: the host marks the section, the context turns its rows Off in one step", async () => {
    const source = await fixtureSource(true);
    const { port: creatorPort } = await port(source, panel => ({ ...panel, sections: panel.sections.map(section => ({ ...section, makeup: section.id === "Scars" })) }));
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    expect(context.capability({ kind: "character.hideOwnMakeup" })).toMatchObject({ code: "not_ready" });
    context.start(); await settle();
    // The fixture's scars default to Off: nothing to hide yet.
    expect(context.capability({ kind: "character.hideOwnMakeup" })).toMatchObject({ available: false, reason: "Every makeup row on your V is already Off." });
    context.dispatch({ kind: "character.setOption", part: "head", option: "scars", choice: "scar_01" });
    await settle();
    expect(makeupOff(context.panel()!, context.view())).toEqual([set("scars", "")]);
    // A row shows the option the view marks active; its first while the view is on its way.
    const panel = context.panel()!, piercingRow = panel.sections.flatMap(section => section.rows).find(row => row.options.length > 1)!;
    expect(rowOption(panel, piercingRow, null)).toBe(panel.options[piercingRow.options[0]!]!);
    expect(rowOption(panel, piercingRow, context.view())?.id).toBe(piercingRow.options.map(i => panel.options[i]!).find(option => context.view()!.values[option.id]?.active)?.id);
    expect(makeupOff(panel, null)).toEqual([]);
    context.dispatch({ kind: "character.hideOwnMakeup" });
    expect(context.snapshot()).toMatchObject({ undo: "Hide my V's own makeup" });
    expect(context.request().choices).toEqual([set("scars", "")]);
  });

  test("every action that changes choices waits for the catalogue; a V change and Undo don't; changes are validated whole", async () => {
    const source = await fixtureSource(true);
    const { port: creatorPort } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} }, { stored: { origin: "default", choices: [set("teeth", "t_gold")] } });
    for (const action of [{ kind: "character.reset", part: "head", option: "teeth" }, { kind: "character.resetAll" }] as const)
      expect(context.capability(action)).toMatchObject({ code: "not_ready" });
    expect(context.capability({ kind: "character.useDefault", bodyGender: "male" })).toMatchObject({ available: true });
    context.start(); await settle();
    expect(context.capability({ kind: "character.setOptions", changes: [{ part: "head", option: "teeth", choice: "t_default" }, { part: "torso" as never, option: "x", choice: "y" }] }))
      .toMatchObject({ available: false, code: "invalid_value" });
    expect(context.capability({ kind: "character.setOptions", changes: [{ part: "head", option: "a\\b", choice: "y" }] })).toMatchObject({ code: "invalid_value" });
    expect(context.capability({ kind: "character.setOptions", changes: "nope" as never })).toMatchObject({ code: "invalid_value" });
  });
});

describe("CORE-74: kept entries and the tried style", () => {
  test("once the host matched a preset's choices, only the entries it couldn't match are kept", async () => {
    const source = await fixtureSource(false);
    const { port: creatorPort } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    context.dispatch({ kind: "character.loadPreset", value: { schema: CC_PRESET_SCHEMA, bodyGender: "female", values: [
      { part: "head", option: "eyes_color", definition: "he__02_blue" }, { part: "head", option: "xl_ring", definition: "ring_gold", mod: "Rings" }] } });
    await settle();
    const stored = context.stored()!;
    expect(parseCcPreset(stored.kept).values.map(entry => entry.option)).toEqual(["xl_ring"]);
  });

  test("an earlier build's tried piercing style becomes the matching creator choices on an untouched context", async () => {
    const source = await fixtureSource(true);
    const { host } = await service();
    expect(await host.legacyChoices("female", "01", "gold")).toEqual([set("piercings", "01", { activates: ["piercings_01"] }), set("piercings_01", "gold")]);
    expect(await host.legacyChoices("female", "01", "nope")).toEqual([]);
    const { port: creatorPort } = await port(source);
    const context = new CharacterContextActions({ creator: { ...creatorPort, legacy: (gender, style, definition) => host.legacyChoices(gender, style, definition) },
      showSave: () => {} }, { legacy: { style: "01", definition: "gold" } });
    context.start(); await settle(20);
    expect(context.request().choices).toEqual([set("piercings", "01", { activates: ["piercings_01"] }), set("piercings_01", "gold")]);
    expect(context.snapshot().undo).toBeNull();
    expect(context.stored()?.choices).toHaveLength(2);
    // A stored context is never overwritten by the retired fields.
    const stored = new CharacterContextActions({ creator: { ...creatorPort, legacy: async () => { throw Error("not asked"); } }, showSave: () => {} },
      { stored: { origin: "default", choices: [] }, legacy: { style: "01", definition: "gold" } });
    stored.start(); await settle();
    expect(stored.request().choices).toBeUndefined();
  });
});

describe("PIPE-83: duplicate choices and activation keys", () => {
  test("repeated choices for one option count once, the last in its place", () => {
    expect(lastChoices([set("a", "1"), set("b", "1"), set("a", "2")])).toEqual([set("b", "1"), set("a", "2")]);
  });
});

describe("PREV-86 and PREV-87: following the context", () => {
  function harness() {
    const listeners = new Set<() => void>(), savedListeners = new Set<() => void>();
    let request: CharacterRequest = DEFAULT_CHARACTER, view: CreatorView | null = null, current = false;
    const asked: string[] = [], faces: string[] = [];
    const release = followCharacter({
      context: { detailRequest: () => request, view: () => view, viewCurrent: () => current, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
      details: { setCharacter: async value => { asked.push(JSON.stringify(value.choices ?? [])); } },
      savedV: { subscribe: listener => { savedListeners.add(listener); return () => savedListeners.delete(listener); } },
      setFaceMorphs: morphs => { faces.push(JSON.stringify(morphs)); },
    });
    const publish = () => { for (const listener of listeners) listener(); };
    const savedChanged = () => { for (const listener of savedListeners) listener(); };
    return { asked, faces, publish, savedChanged, release, listeners, savedListeners,
      set: (value: CharacterRequest) => { request = value; }, show: (value: CreatorView | null, isCurrent: boolean) => { view = value; current = isCurrent; } };
  }
  const viewWith = (target: string) => ({ bodyGender: "female", identity: "x", values: {}, missing: { entries: [], summary: [] }, saveCheck: null,
    faceMorphs: [{ region: "eyes", target }] }) as CreatorView;

  test("the details are asked for once per request, never again on a publish", () => {
    const h = harness();
    expect(h.asked).toEqual(["[]"]);
    for (let i = 0; i < 5; i++) h.publish();
    expect(h.asked).toEqual(["[]"]);
    h.set({ ...DEFAULT_CHARACTER, choices: [set("teeth", "t_gold")] });
    h.publish(); h.publish();
    expect(h.asked).toHaveLength(2);
    h.release();
    expect(h.listeners.size + h.savedListeners.size).toBe(0);
  });

  test("the face follows only a view of the current state, and is written again after the saved-V service wrote it", () => {
    const h = harness();
    h.show(viewWith("h011"), false); h.publish();
    expect(h.faces).toEqual([]);
    h.show(viewWith("h011"), true); h.publish();
    expect(h.faces).toEqual([`[{"region":"eyes","target":"h011"}]`]);
    h.publish();
    expect(h.faces).toHaveLength(1);
    // The saved-V service zeroed the face (Default V, a save cleared): the same key is written again, not skipped.
    h.savedChanged();
    expect(h.faces).toHaveLength(2);
  });
});

describe("UI-72: the search runs on the host over every choice", () => {
  test("the options with a matching choice, and a page of only the matching choices", async () => {
    const source = await fixtureSource(true);
    const index = new CatalogueIndex(source.catalogue);
    const { mods } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
    expect(searchChoices(index, "violet").options).toEqual(["head/eyes_color"]);
    expect(searchChoices(index, "  ").options).toEqual([]);
    const page = choicePage(index, mods, "head/eyes_color", 0, { query: "Violet" })!;
    expect(page).toMatchObject({ query: "violet", total: 1 });
    expect(page.choices.map(choice => choice.key)).toEqual(["he__03_violet"]);
    const { port: creatorPort } = await port(source);
    const context = new CharacterContextActions({ creator: creatorPort, showSave: () => {} });
    context.start(); await settle();
    expect(context.search("violet").loading).toBe(true);
    await settle();
    expect([...context.search("violet").options!]).toEqual(["head/eyes_color"]);
    context.choices("head/eyes_color", undefined, "violet"); await settle();
    expect(context.choices("head/eyes_color", undefined, "violet").choices.map(choice => choice.key)).toEqual(["he__03_violet"]);
  });
});

describe("CORE-74: the retired tried style is kept until the context stores choices", () => {
  test("written back as read while nothing is set, written empty once choices are stored", async () => {
    const { WorkspaceComposer } = await import("../src/workspace-composer");
    const { freshWorkspace } = await import("./fixtures/eye-region");
    const initial = freshWorkspace();
    initial.preview.piercingStyle = "01"; initial.preview.piercingDefinition = "gold";
    let stored: ReturnType<CharacterContextActions["stored"]> | null = null;
    const composer = new WorkspaceComposer(initial, { editor: () => ({}) as never, uvView: () => initial.uvView, savedV: () => undefined,
      collections: () => initial.collections, quality: () => initial.preview.textureSize, preview: () => undefined, motion: () => undefined,
      character: () => stored });
    composer.setPreviewReady();
    expect(composer.capture().preview).toMatchObject({ piercingStyle: "01", piercingDefinition: "gold" });
    stored = { origin: "default", bodyGender: "female", choices: [set("piercings", "01", { activates: ["piercings_01"] }), set("piercings_01", "gold")] };
    expect(composer.capture().preview).toMatchObject({ piercingStyle: "", piercingDefinition: "", character: stored });
  });
});
