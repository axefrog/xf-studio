import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNativeGlobals, checkNativeGlobals, packageScripts, registeredGlobals, stagedScripts } from "../redscript-natives.ts";
import { stageVariant, PLUGIN_DIR } from "../packaging.ts";
import { tempDir } from "./temp-dir.ts";
const project = resolve(import.meta.dir, "../..");
const cpp = readFileSync(join(project, "native/src/plugin/Natives.cpp"), "utf8");
const ui = readFileSync(join(project, "redscript-probes/autonomous/XFRuntimeBridgeTestUi.reds"), "utf8");

test("exact launch regression: module prefixes XFBridge_TestUiTake and must fail offline", () => {
  const errors = checkNativeGlobals([{ path: "XFRuntimeBridgeTestUi.reds", text: `module XFRuntimeBridge\n${ui}` }], cpp, true);
  expect(errors.some(e => e.includes("must have no module line"))).toBe(true);
  expect(errors.some(e => e.includes("Missing native global") || e.includes("missing native global 'XFRuntimeBridge.XFBridge_TestUiTake'"))).toBe(true);
  expect(checkNativeGlobals([{ path: "fixed.reds", text: ui }], cpp, true)).toEqual([]);
});
test("matching DLL flags: autonomous native cannot enter normal DLL set", () => {
  expect(checkNativeGlobals([{ path: "ui.reds", text: ui }], cpp, false).join("\n")).toContain("XFBridge_TestUiTake");
  expect(registeredGlobals(cpp, true).size).toBe(31);
  expect(registeredGlobals(cpp, false).size).toBe(27);
});
test("unknown and wrong-case natives fail under exact names", () => {
  for (const name of ["XFBridge_Nonexistent", "xfbridge_Info"]) {
    expect(checkNativeGlobals([{ path: "native.reds", text: `public static native func ${name}() -> String` }], cpp, true).join("\n")).toContain(name);
  }
});
test("methods, comments and string contents are not native globals", () => {
  expect(checkNativeGlobals([{ path: "class.reds", text: `module Engine\n// native func Fake()\n/* native func Fake2() */
    public native class Engine { public native func Member() -> Void; }
    public func Text() -> String { return "native func StringFake()"; }` }], cpp, false)).toEqual([]);
});
test("conditional registrations fail closed for unmodelled build expressions", () => {
  expect(() => registeredGlobals('#if NEW_BUILD_FLAG\nRegisterGlobal(rtti, "Foo", &Foo, "Bool", {});\n#endif', false)).toThrow(/Unmodelled/);
});
test("every package source set passes; autonomous declarations and taps never ship in normal variants", () => {
  for (const [variant, hooks] of [["default", false], ["diagnostic", false], ["writes", false], ["writes", true]] as const) {
    const scripts = packageScripts(project, variant, hooks);
    expect(assertNativeGlobals(scripts, cpp, hooks)).toBe(hooks ? 31 : 27);
    expect(scripts.some(s => s.path.endsWith("XFRuntimeBridgeRecording.reds"))).toBe(hooks);
    expect(scripts.find(s => s.path.endsWith("Natives.reds"))?.text.includes("native func XFBridge_Record(")).toBe(hooks);
  }
});
test("autonomous staged set cross-checks natives, including probes; tampered staged regression fails", () => {
  const root = tempDir("xfb-native-package-");
  const dll = join(root, "test.dll"); writeFileSync(dll, "XFB_AUTONOMOUS_TEST_HOOKS=1");
  const companion = join(root, "companion.exe"); writeFileSync(companion, "fixture");
  const stageDir = join(root, "stage");
  const manifest = stageVariant({ projectDir: project, variant: "writes", autonomousTests: true, dll, companion, stageDir, version: "test", commit: "0".repeat(40) });
  expect(manifest.native_count).toBe(31);
  expect(assertNativeGlobals(stagedScripts(stageDir), cpp, true)).toBe(31);
  writeFileSync(join(stageDir, PLUGIN_DIR, "Scripts/XFRuntimeBridgeTestUi.reds"), `module XFRuntimeBridge\n${ui}`);
  expect(() => assertNativeGlobals(stagedScripts(stageDir), cpp, true)).toThrow(/XFRuntimeBridge.XFBridge_TestUiTake/);
});
