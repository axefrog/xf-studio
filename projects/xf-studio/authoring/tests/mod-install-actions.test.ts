// "Add to my mod manager" as the presentation drives it (UI-82): a view names a built mod; the service finds its verified build in
// the latest Build result, reviews the host's plan, and sends consent only for that reviewed plan. A plan that no longer matches is
// dropped so the view reviews again; a blocked plan refuses with its plain reason; nothing is sent where the host can't install.
import { expect, test } from "bun:test";
import { builtModsOf, ModInstallActions, type BuiltMod, type ModInstallPlan } from "../src/mod-install-actions";

const plan = (over: Partial<ModInstallPlan> = {}): ModInstallPlan => ({ schema: "xfs/mod-install-plan-1", candidateId: "c1", modName: "XF Eye Artistry",
  route: "mo2", place: "Mod Organizer 2 (profile “Main”)", changes: ["Add the mod …"], notes: [], blocked: null, replacing: false, token: "t1", ...over });

function fixture(answers: Record<string, { ok: boolean; status?: number; data: unknown }[]>, builds: BuiltMod[] = [{ product: "p1", candidateId: "c1", modName: "XF Eye Artistry" }]) {
  const sent: unknown[] = [];
  const actions = new ModInstallActions(async body => {
    sent.push(body);
    const answer = answers[body.action]!.shift()!;
    return { ok: answer.ok, status: answer.status ?? (answer.ok ? 200 : 409), data: answer.data };
  }, () => builds);
  return { actions, sent, builds };
}

test("review, then consent to exactly that plan", async () => {
  const f = fixture({ plan: [{ ok: true, data: plan() }], install: [{ ok: true, data: { schema: "xfs/mod-install-result-1", candidateId: "c1",
    modName: "XF Eye Artistry", route: "mo2", message: "“XF Eye Artistry” is in Mod Organizer 2 and switched on." } }] });
  // No consent before a review.
  expect(f.actions.capability({ kind: "modInstall.apply", product: "p1" })).toMatchObject({ available: false, code: "needs_input" });
  expect((await f.actions.dispatch({ kind: "modInstall.review", product: "p1" })).ok).toBe(true);
  expect(f.actions.snapshot().plans.p1?.token).toBe("t1");
  expect(f.actions.capability({ kind: "modInstall.apply", product: "p1" })).toEqual({ available: true });
  const done = await f.actions.dispatch({ kind: "modInstall.apply", product: "p1" });
  expect(done).toEqual({ ok: true, message: "“XF Eye Artistry” is in Mod Organizer 2 and switched on." });
  expect(f.sent).toEqual([{ action: "plan", candidateId: "c1" }, { action: "install", candidateId: "c1", token: "t1" }]);
  expect(f.actions.snapshot().outcomes.p1).toMatchObject({ ok: true });
  // The same build isn't added twice; its folder can still be shown.
  expect(f.actions.capability({ kind: "modInstall.apply", product: "p1" }).code).toBe("invalid_value");
  expect(f.actions.capability({ kind: "modInstall.review", product: "p1" }).reason).toBe("XF Eye Artistry is already added from this build. Build again to add a newer copy.");
  expect(f.actions.capability({ kind: "modInstall.reveal", product: "p1" })).toEqual({ available: true });
});

test("a blocked plan refuses consent with its plain reason; a stale one is dropped for a new review", async () => {
  const blocked = fixture({ plan: [{ ok: true, data: plan({ blocked: "Mod Organizer 2 is open. Close it first, then try again." }) }] });
  await blocked.actions.dispatch({ kind: "modInstall.review", product: "p1" });
  expect(blocked.actions.capability({ kind: "modInstall.apply", product: "p1" }))
    .toEqual({ available: false, code: "unavailable", reason: "Mod Organizer 2 is open. Close it first, then try again." });
  const stale = fixture({ plan: [{ ok: true, data: plan() }], install: [{ ok: false, data: { code: "stale_plan", error: "Something changed since you reviewed this. Review it again." } }] });
  await stale.actions.dispatch({ kind: "modInstall.review", product: "p1" });
  expect(await stale.actions.dispatch({ kind: "modInstall.apply", product: "p1" }))
    .toEqual({ ok: false, code: "stale_plan", message: "Something changed since you reviewed this. Review it again." });
  expect(stale.actions.snapshot().plans.p1).toBeUndefined();
  expect(stale.actions.capability({ kind: "modInstall.apply", product: "p1" }).code).toBe("needs_input");
});

test("a new build forgets the last build's plan; unknown products and hosts without an installer are refused", async () => {
  const f = fixture({ plan: [{ ok: true, data: plan() }], reveal: [{ ok: true, data: { ok: true } }] });
  await f.actions.dispatch({ kind: "modInstall.review", product: "p1" });
  expect((await f.actions.dispatch({ kind: "modInstall.reveal", product: "p1" })).ok).toBe(true);
  f.builds[0] = { product: "p1", candidateId: "c2", modName: "XF Eye Artistry" };
  expect(f.actions.snapshot().plans).toEqual({});
  expect(f.actions.capability({ kind: "modInstall.apply", product: "p1" }).code).toBe("needs_input");
  expect(f.actions.capability({ kind: "modInstall.review", product: "other" })).toMatchObject({ available: false, code: "missing_target", reason: "Build this mod first." });
  const none = new ModInstallActions(null, () => f.builds);
  expect(none.capability({ kind: "modInstall.review", product: "p1" })).toMatchObject({ available: false, code: "unavailable" });
  expect(Object.keys(none.descriptors())).toEqual(["modInstall.review", "modInstall.apply", "modInstall.reveal"]);
});

test("the built mods are read from the latest Build result only", () => {
  const products = [{ productId: "p1", modName: "XF Eye Artistry", package: "C:\\Data\\package-candidates\\a1b2" },
    { productId: "p2", modName: "XF Brows", package: "/data/package-candidates/c3d4" }];
  expect(builtModsOf({ kind: "packageBuild", result: { products } })).toEqual([
    { product: "p1", candidateId: "a1b2", modName: "XF Eye Artistry" }, { product: "p2", candidateId: "c3d4", modName: "XF Brows" }]);
  expect(builtModsOf({ kind: "packageCheck", result: { products } })).toEqual([]);
  expect(builtModsOf(undefined)).toEqual([]);
});
