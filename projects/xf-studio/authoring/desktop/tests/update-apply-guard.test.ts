import { expect, test } from "bun:test";
import { DesktopUpdateApplyGuard } from "../update-apply-guard";
import { DesktopWorkActivity } from "../work-activity";

test("update restart refuses active package and install work before asking for a workspace save", async () => {
  const activity = new DesktopWorkActivity();
  const requested: string[] = [];
  const guard = new DesktopUpdateApplyGuard(activity, nonce => requested.push(nonce));
  const endPackage = activity.begin("package")!;
  await expect(guard.prepare()).rejects.toThrow("Finish active package or install work");
  expect(requested).toEqual([]);
  endPackage();
  const endInstall = activity.begin("install")!;
  await expect(guard.prepare()).rejects.toThrow("Finish active package or install work");
  expect(requested).toEqual([]);
  endInstall();
  const preparing = guard.prepare();
  expect(requested).toHaveLength(1);
  expect(activity.begin("package")).toBeNull();
  expect(activity.begin("install")).toBeNull();
  const quit: { response?: { allow: boolean } } = {};
  guard.beforeQuit(quit);
  expect(quit.response).toEqual({ allow: false });
  expect(guard.acknowledge("stale", "saved")).toBe(false);
  expect(guard.noteWorkspaceWrite("stale")).toBe(false);
  expect(guard.noteWorkspaceWrite(requested[0])).toBe(true);
  expect(guard.acknowledge(requested[0], "saved")).toBe(true);
  await preparing;
  guard.finish();
  const resumed = activity.begin("package");
  expect(resumed).toBeFunction();
  resumed?.();
});

test("failed, missing and late workspace acknowledgements never arm restart", async () => {
  const activity = new DesktopWorkActivity();
  const requested: string[] = [];
  const guard = new DesktopUpdateApplyGuard(activity, nonce => requested.push(nonce), 20);
  const failed = guard.prepare();
  expect(guard.acknowledge(requested[0], "failed")).toBe(true);
  await expect(failed).rejects.toThrow("Workspace save failed");
  const packageWork = activity.begin("package");
  expect(packageWork).toBeFunction();
  packageWork?.();
  const timedOut = guard.prepare();
  await expect(timedOut).rejects.toThrow("timed out");
  expect(guard.acknowledge(requested[1], "saved")).toBe(false);
  const installWork = activity.begin("install");
  expect(installWork).toBeFunction();
  installWork?.();
  const noWrite = guard.prepare();
  expect(guard.acknowledge(requested[2], "saved")).toBe(false);
  await expect(noWrite).rejects.toThrow("was not written to the host");
});

test("a renderer flush that cannot start releases the restart reservation", async () => {
  const activity = new DesktopWorkActivity();
  const guard = new DesktopUpdateApplyGuard(activity, () => { throw Error("renderer unavailable"); });
  await expect(guard.prepare()).rejects.toThrow("could not start");
  expect(activity.begin("package")).toBeFunction();
});

test("a later workspace write vetoes the native quit after an acknowledged save", async () => {
  const activity = new DesktopWorkActivity();
  let nonce = "";
  const guard = new DesktopUpdateApplyGuard(activity, value => { nonce = value; });
  const preparing = guard.prepare();
  guard.noteWorkspaceWrite(nonce);
  expect(guard.acknowledge(nonce, "saved")).toBe(true);
  await preparing;
  guard.noteWorkspaceWrite(null);
  const quit: { response?: { allow: boolean } } = {};
  guard.beforeQuit(quit);
  expect(quit.response).toEqual({ allow: false });
  guard.finish();
});
