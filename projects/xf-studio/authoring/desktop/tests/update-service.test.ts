import { expect, test } from "bun:test";
import { DesktopUpdateService, type NativeUpdater, type UpdateApplyGuard } from "../update-service";

const installed = { version: "0.1.0", channel: "canary", buildHash: "aaaaaaaa" };
const accepted = { verifiedPrivateFeed: true, signedRelease: true, twoVersionTrialAccepted: true };
const readyGuard: UpdateApplyGuard = { async prepare() {}, finish() {} };

test("private two-version trial requires separate consent for check, download and restart", async () => {
  const calls: string[] = [];
  let current = { version: "0.2.0", hash: "bbbbbbbb", updateAvailable: true, updateReady: false };
  const native: NativeUpdater = {
    async checkForUpdate() { calls.push("check"); return current; },
    async downloadUpdate() { calls.push("download"); current = { ...current, updateReady: true }; },
    updateInfo() { calls.push("info"); return current; },
    async applyUpdate() { calls.push("apply/restart"); },
  };
  const service = new DesktopUpdateService(installed, native, accepted, readyGuard);
  expect(calls).toEqual([]);
  expect(service.snapshot()).toMatchObject({ phase: "idle", canCheck: true, canDownload: false });
  expect((await service.dispatch("check")).available).toEqual({ version: "0.2.0", buildHash: "bbbbbbbb" });
  expect(calls).toEqual(["check"]);
  expect((await service.dispatch("download")).phase).toBe("ready");
  expect(calls).toEqual(["check", "download", "info"]);
  expect((await service.dispatch("applyAndRestart")).phase).toBe("applying");
  expect(calls).toEqual(["check", "download", "info", "apply/restart"]);
});

test("missing authenticity evidence and invalid update metadata fail closed", async () => {
  let called = false;
  const native: NativeUpdater = {
    async checkForUpdate() { called = true; return { version: "0.2.0", hash: "", updateAvailable: true, updateReady: false }; },
    async downloadUpdate() { called = true; }, updateInfo() { throw Error("unexpected"); },
    async applyUpdate() { called = true; },
  };
  const disabled = new DesktopUpdateService(installed, native,
    { ...accepted, signedRelease: false });
  expect((await disabled.dispatch("check")).phase).toBe("unavailable");
  expect(called).toBe(false);
  const enabled = new DesktopUpdateService(installed, native, accepted, readyGuard);
  await expect(enabled.dispatch("download")).rejects.toThrow();
  expect((await enabled.dispatch("check")).phase).toBe("error");
  expect(enabled.snapshot().available).toBeNull();
  expect(new DesktopUpdateService(installed, native, accepted).snapshot().phase).toBe("unavailable");
});

test("native apply is never called before workspace preparation and releases the gate on failure", async () => {
  let applyCalls = 0, finishCalls = 0, saveAllowed = false;
  const native: NativeUpdater = {
    async checkForUpdate() { return { version: "0.2.0", hash: "bbbbbbbb", updateAvailable: true, updateReady: false }; },
    async downloadUpdate() {},
    updateInfo() { return { version: "0.2.0", hash: "bbbbbbbb", updateAvailable: true, updateReady: true }; },
    async applyUpdate() { applyCalls++; throw Error("Native apply failed."); },
  };
  const guard: UpdateApplyGuard = {
    async prepare() { if (!saveAllowed) throw Error("Workspace save failed."); },
    finish() { finishCalls++; },
  };
  const service = new DesktopUpdateService(installed, native, accepted, guard);
  await service.dispatch("check");
  await service.dispatch("download");
  expect((await service.dispatch("applyAndRestart")).reason).toBe("Workspace save failed.");
  expect(applyCalls).toBe(0);
  expect(finishCalls).toBe(0);
  saveAllowed = true;
  await service.dispatch("check");
  await service.dispatch("download");
  expect((await service.dispatch("applyAndRestart")).reason).toBe("Native apply failed.");
  expect(applyCalls).toBe(1);
  expect(finishCalls).toBe(1);
});
