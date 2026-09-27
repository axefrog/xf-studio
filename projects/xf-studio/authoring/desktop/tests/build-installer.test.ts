import { expect, test } from "bun:test";
import { buildPath, installerPlan, readyMessage } from "../build-installer";

test("build:installer prepares the devkit only on the first build, then runs the verified canary build", () => {
  expect(installerPlan("missing", "win32")).toEqual({ steps: [
    { label: "Preparing the Electrobun toolchain (first build in this checkout; it downloads about 150 MB)", args: ["run", "prepare:devkit"] },
    { label: "Building and verifying the setup", args: ["run", "build:canary"] }] });
  expect(installerPlan("folder", "win32")).toEqual({ steps: [{ label: "Building and verifying the setup", args: ["run", "build:canary"] }] });
});

test("build:installer refuses plainly off Windows and with a .hutch linked to another checkout, with the one next step", () => {
  expect(installerPlan("folder", "linux")).toEqual({ refusal: "The desktop app's setup is built on Windows. Run this on a Windows PC with this checkout." });
  const linked = installerPlan("link", "win32");
  expect("refusal" in linked && linked.refusal).toContain("cmd /c rmdir .hutch, which leaves the other checkout's folder alone");
});

test("the build runs with Windows' own tar first on PATH, once", () => {
  expect(buildPath({ SystemRoot: "C:\\Windows", PATH: "C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\System32;C:\\Tools" }))
    .toBe("C:\\Windows\\System32;C:\\Program Files\\Git\\usr\\bin;C:\\Tools");
});

test("the closing message names the setup relative to the checkout, its hash, how to install it and the unsigned-alpha note", () => {
  const message = readyMessage("projects/xf-studio/authoring/desktop/artifacts/canary-win-x64-XFStudio-Setup-canary.exe", 43_932_863, "ab".repeat(32));
  expect(message).toContain("The XF Studio setup is ready: projects/xf-studio/authoring/desktop/artifacts/canary-win-x64-XFStudio-Setup-canary.exe");
  expect(message).toContain("42 MB, SHA-256 " + "ab".repeat(32));
  expect(message).toContain("Help > Get the desktop app > Install from your build");
  expect(message).toContain("More info, then Run anyway");
});

test("a disposable trial identity's setup is named as Electrobun names it, never as the real app's setup", async () => {
  const { artifactAppName } = await import("../release");
  const { INSTALLER_NAME } = await import("../../src/desktop-app-host");
  expect(artifactAppName("XF Studio")).toBe("XFStudio");
  expect(artifactAppName("XF Studio UI Trial")).toBe("XFStudioUITrial");
  expect(artifactAppName("XF Studio Build Trial")).toBe("XFStudioBuildTrial");
  // "Install from your build" offers only the real app's setup, so a trial build in artifacts/ is never installed over it.
  expect(INSTALLER_NAME.test(`canary-win-x64-${artifactAppName("XF Studio")}-Setup-canary.exe`)).toBe(true);
  expect(INSTALLER_NAME.test(`canary-win-x64-${artifactAppName("XF Studio UI Trial")}-Setup-canary.exe`)).toBe(false);
});
