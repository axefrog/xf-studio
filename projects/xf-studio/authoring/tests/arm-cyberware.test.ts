// Arm cyberware (render gap plans §5): the holster state from the equipped item (arm-cyberware.ts), the request that carries it, and the
// planner drawing that state's two halves (the skin half and the cyberware half, with its masked metal decal and glass window) instead of
// the default arms. A private, save- and game-derived fixture (experiment 034's check_arms.ts) checks the chain on a real save where present.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { armsStateFor, armsStateNote, DEFAULT_HOLSTER, holsterGroup } from "../src/arm-cyberware";
import type { CcoResource } from "../src/cco-model";
import { bodyGroups, bodyStateFor, ENABLE_MASK, planCharacterDetails, previewInput, type TemplateIdentities } from "../src/character-detail-plan";
import { CHARACTER_REQUEST_SCHEMA, characterRequestOf, inputFromCharacterRequest, parseCharacterRequest, sameCharacter } from "../src/character-detail-request";
import { templateIdentity } from "../src/character-detail-service";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "../src/character-resolver";
import { refFromPath } from "../src/depot-path";
import { templateDefaults } from "../src/material-template";
import { BODY_REQUEST, detailFixture, P } from "./character-detail-fixtures";

/** A creator resource with just the parts the holster rule reads. */
const creator = (perspectives: CcoResource["perspectives"], groups: string[]): CcoResource => ({ label: "test", version: 12, ...(perspectives ? { perspectives } : {}),
  parts: { head: { options: [], groups: [] }, body: { options: [], groups: [] }, arms: { options: [], groups: groups.map(name => ({ name, options: [] })) } } });
const FEMININE = creator([{ name: "FPP_Body", fpp: "FPP_Body", tpp: "TPP_Body" }, { name: "holstered_default", fpp: "holstered_default_fpp", tpp: "holstered_default_tpp" },
  { name: "holstered_strong", fpp: "holstered_strong_fpp", tpp: "holstered_strong_tpp" }], ["holstered_default_tpp", "holstered_default_fpp", "holstered_strong_tpp"]);
/** The masculine resource doesn't split the states per perspective: its groups are named after the states. */
const MASCULINE = creator([{ name: "FPP_Body", fpp: "FPP_Body", tpp: "TPP_Body" }], ["holstered_default", "holstered_strong", "holstered_mantis"]);

describe("the holster state (arm-cyberware.ts)", () => {
  test("the item's holstered item names the state; the creator resource's perspective pair, or a group of that name, gives the group", () => {
    const lookup = (item: string) => ({ "1": "holstered_strong", "2": "holstered_mantis" } as Record<string, string>)[item] ?? null;
    expect(armsStateFor("1", lookup, FEMININE)).toEqual({ name: "holstered_strong", group: "holstered_strong_tpp", item: "1" });
    expect(armsStateFor("1", lookup, MASCULINE)).toEqual({ name: "holstered_strong", group: "holstered_strong", item: "1" });
    expect(holsterGroup(FEMININE, DEFAULT_HOLSTER)).toBe("holstered_default_tpp");
    expect(holsterGroup(MASCULINE, DEFAULT_HOLSTER)).toBe("holstered_default");
  });

  test("every step that can't be followed shows the default state, with the reason", () => {
    const lookup = (item: string) => item === "9" ? undefined : item === "2" ? "holstered_mantis" : null;
    expect(armsStateFor(null, lookup, FEMININE)).toEqual({ name: DEFAULT_HOLSTER, group: "holstered_default_tpp", reason: "none-equipped" });
    expect(armsStateFor("9", lookup, FEMININE).reason).toBe("tweakdb-unread");
    expect(armsStateFor("5", lookup, FEMININE)).toMatchObject({ group: "holstered_default_tpp", reason: "item-unknown", item: "5" });
    // The feminine resource of this test has no mantis group: default, said.
    expect(armsStateFor("2", lookup, FEMININE)).toMatchObject({ name: DEFAULT_HOLSTER, reason: "group-missing" });
    expect(armsStateNote(armsStateFor("2", lookup, FEMININE))).toContain("no group");
    expect(armsStateNote(armsStateFor("2", lookup, MASCULINE))).toContain("from the equipped arm cyberware (item 2)");
    // A resource with no group for the default state either: no arms group (the plan then reads the built-in default groups).
    expect(armsStateFor(null, lookup, creator(undefined, [])).group).toBeNull();
  });

  test("the body state carries the group; the arms part reads only it, the default groups without it", () => {
    expect(bodyGroups("arms", bodyStateFor(null, undefined, FEMININE as never, "holstered_strong_tpp"))).toEqual(["holstered_strong_tpp"]);
    expect(bodyGroups("arms", bodyStateFor(null, undefined, FEMININE as never))).toEqual(["holstered_default_tpp", "holstered_default"]);
    expect(bodyStateFor("lifted", undefined, FEMININE as never, "holstered_strong_tpp")).toEqual({ feet: "lifted", arms: "holstered_strong_tpp" });
  });
});

describe("the request carries the equipped arm cyberware (xfs/character-request-9 `arms`)", () => {
  test("built from the save's loadout while the body shows; read strictly; the same V with or without it", () => {
    const base = { bodyGender: "female" as const, saved: null };
    const armed = characterRequestOf(base, [], undefined, null, true, false, false, "179425979353");
    expect(armed).toMatchObject({ schema: CHARACTER_REQUEST_SCHEMA, arms: "179425979353" });
    expect(characterRequestOf(base, [], undefined, null, false, false, false, "179425979353").arms).toBeUndefined();
    expect(parseCharacterRequest(JSON.parse(JSON.stringify(armed)))).toEqual(armed);
    expect(() => parseCharacterRequest({ ...armed, arms: "Items.StrongArms" })).toThrow();
    expect(() => parseCharacterRequest({ ...armed, body: false })).toThrow("no arms");
    // A v8 request (a page from before) is read as before: the default state.
    expect(() => parseCharacterRequest({ ...armed, schema: "xfs/character-request-8" })).toThrow("unknown fields");
    const v8 = parseCharacterRequest({ schema: "xfs/character-request-8", source: "default", bodyGender: "female", puppet: "creator" });
    expect(v8).toEqual({ schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female", puppet: "creator" });
    expect(sameCharacter(armed, characterRequestOf(base))).toBe(true);
  });
});

async function planArms(arms?: string) {
  const { graph } = detailFixture().installation();
  const cco = await loadMergedCco(graph, "female");
  const state = bodyStateFor(null, undefined, cco.merged.cco, arms);
  const input = previewInput(inputFromCharacterRequest(BODY_REQUEST as Extract<typeof BODY_REQUEST, { source: "save" }>), state);
  const resolved = await resolveCharacter(graph, input, cco);
  const defaults = new Map<string, ResolvedParam[]>(), identities = new Map<string, { name: string | null; priority: string | null }>();
  for (const path of [P.skinMt, P.layeredMt, P.meshDecalMt, P.metalBaseRemt, P.glassOnesidedMt, P.hairMt, P.decalMt, P.capMt, P.eyeMt, P.eyeGradMt, P.eyeShadowMt]) {
    const loaded = await graph.load(refFromPath(path), path.endsWith(".remt") ? "remt" : "mt");
    identities.set(path.toLowerCase(), templateIdentity(loaded!.root));
    defaults.set(path.toLowerCase(), templateDefaults(loaded!.root).map(([name, value]) => ({ name, kind: value.kind, setBy: "template",
      value: value.kind === "scalar" ? JSON.stringify(value.value) : value.kind === "resource" ? value.text ?? "" : value.value,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })));
  }
  return { cco: cco.merged.cco, plan: planCharacterDetails(resolved, cco.merged.cco, defaults, identities satisfies TemplateIdentities, state) };
}

describe("the planner draws the holster state's two halves", () => {
  test("with Gorilla Arms: the skin half and the cyberware half replace the default arms; the masked decal and the glass window draw", async () => {
    const { cco, plan } = await planArms("holstered_strong_tpp");
    expect(cco.perspectives?.map(entry => entry.name)).toEqual(["FPP_Body", "holstered_default", "holstered_strong"]);
    const arms = plan.components.filter(c => c.slot === "body" && c.component.startsWith("a0_"));
    expect(arms.map(c => `${c.option}:${c.component}`)).toEqual(["h_strong_arms_colors_base_tpp:a0_strong_arms",
      "h_strong_arms_colors_cyberware01_tpp:a0_strong_arms_cyberware"]);
    const cyberware = arms[1]!;
    expect(cyberware.materials.map(m => [m.chunk, m.templateName])).toEqual([[0, "metal_base"], [1, "glass_onesided"]]);
    // PREV-117: the instance's enableMask travels with the chunk, so the adapter alpha-tests it.
    expect(cyberware.materials[0]!.scalars[ENABLE_MASK]).toBe(1);
    expect(cyberware.materials[1]!.scalars[ENABLE_MASK]).toBeUndefined();
    expect(cyberware.materials[1]!.colours.GlassSpecularColor).toEqual([0, 0, 0, 255]);
  });

  test("without arm cyberware the default state draws, as before", async () => {
    const { plan } = await planArms();
    expect(plan.components.filter(c => c.slot === "body" && c.component.startsWith("a0_")).map(c => c.component)).toEqual(["a0_arms", "a0_nails_l"]);
  });
});

// Private (save- and game-derived): experiment 034's check_arms.ts writes it from a local save with arm cyberware and the installed game.
const FIXTURE = new URL("../data/private-fixtures/arm-cyberware-save.json", import.meta.url);
test.skipIf(!existsSync(FIXTURE))("on a real save with arm cyberware the chain names its state's group, whose two halves the save lists", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { item: string; expected: { name: string; group: string };
    tweakDb: Record<string, string | null>; creator: { perspectives: NonNullable<CcoResource["perspectives"]>; armsGroups: string[] };
    savedOptions: { option: string }[] };
  const cco = creator(fixture.creator.perspectives, fixture.creator.armsGroups);
  const state = armsStateFor(fixture.item, item => fixture.tweakDb[item], cco);
  expect({ name: state.name, group: state.group }).toEqual(fixture.expected);
  expect(state.reason).toBeUndefined();
  // Each state is two creator options: the skin half and the cyberware half (render gap plans §5).
  const halves = fixture.savedOptions.map(entry => entry.option).filter(option => /_arms_colors_/.test(option));
  expect(halves).toHaveLength(2);
});
