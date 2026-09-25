import { expect, test } from "bun:test";
import type { LocalSetupFields, LocalSetupView } from "../src/local-settings-server";
import { LocalSetupActions } from "../src/local-setup-actions";

// The settings port owns field merges and queued refreshes, so views never re-implement them (UI-26).
function fixture() {
  let fields: LocalSetupFields = { gameRoot: null, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: "D:\Mods",
    wolvenKitCli: null, eyePlateHead: "installed" };
  let revision = 1, gets = 0, release: (() => void) | undefined;
  const view = (): LocalSetupView => ({ revision, source: "primary", fields, overridden: [],
    readiness: {} as LocalSetupView["readiness"], eyePlateHead: { label: "Head used for the eye plate", options: [] } });
  const actions = new LocalSetupActions(async (method, body) => {
    if (method === "GET") { gets++; if (release === undefined) await new Promise<void>(resolve => { release = resolve; }); }
    if (method === "PATCH") { fields = (body as { fields: LocalSetupFields }).fields; revision++; }
    return { ok: true, status: 200, data: view() };
  });
  return { actions, get gets() { return gets; }, get fields() { return fields; }, release: () => release?.() };
}

test("setup.update loads the saved settings first and changes only the named fields", async () => {
  const f = fixture();
  const saving = f.actions.dispatch({ kind: "setup.update", fields: { gameRoot: "D:\Games\Cyberpunk 2077" } });
  await Bun.sleep(5);
  f.release();
  expect(await saving).toEqual({ ok: true });
  expect(f.fields).toMatchObject({ gameRoot: "D:\Games\Cyberpunk 2077", manualModRoot: "D:\Mods" });
  expect(f.actions.snapshot().view?.revision).toBe(2);
});

test("a refresh asked for while busy runs once the request in flight finishes", async () => {
  const f = fixture();
  const first = f.actions.dispatch({ kind: "setup.refresh" });
  await Bun.sleep(5);
  f.actions.requestRefresh();
  f.actions.requestRefresh();
  expect(f.gets).toBe(1);
  f.release();
  await first;
  await Bun.sleep(5);
  expect(f.gets).toBe(2);
  expect(f.actions.snapshot().busy).toBe(false);
});
