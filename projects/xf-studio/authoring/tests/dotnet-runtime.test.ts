import { expect, test } from "bun:test";
import { detectDotNet, frameworkSatisfied, missingFramework, parseRuntimeConfig, runtimeGuidance, type DotNetPorts } from "../src/dotnet-runtime";

const WOLVENKIT_9 = `\uFEFF{ "runtimeOptions": { "tfm": "net10.0", "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" },
  "configProperties": { "System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization": false } } }`;

test("a runtimeconfig names the frameworks and roll-forward policy the host applies", () => {
  expect(parseRuntimeConfig(WOLVENKIT_9)).toEqual({ frameworks: [{ name: "Microsoft.NETCore.App", version: "10.0.0" }], rollForward: "Minor" });
  expect(parseRuntimeConfig(`{ "runtimeOptions": { "rollForward": "LatestMajor", "frameworks": [
    { "name": "Microsoft.NETCore.App", "version": "8.0.0" }, { "name": "Microsoft.WindowsDesktop.App", "version": "8.0.0" }] } }`))
    .toMatchObject({ rollForward: "LatestMajor", frameworks: [{ name: "Microsoft.NETCore.App" }, { name: "Microsoft.WindowsDesktop.App" }] });
  // Self-contained apps name no shared framework.
  expect(parseRuntimeConfig(`{ "runtimeOptions": { "tfm": "net10.0", "includedFrameworks": [] } }`)).toBeNull();
});

test("roll-forward follows the .NET host: same major by default, never onto a pre-release", () => {
  const net10 = { name: "Microsoft.NETCore.App", version: "10.0.0" };
  expect(frameworkSatisfied(net10, ["8.0.31", "9.0.6", "10.0.12"])).toBe(true);
  expect(frameworkSatisfied(net10, ["8.0.31", "9.0.6"])).toBe(false);
  expect(frameworkSatisfied(net10, ["10.0.0-rc.2.25502.107"])).toBe(false);
  expect(frameworkSatisfied(net10, ["11.0.1"])).toBe(false);
  expect(frameworkSatisfied(net10, ["11.0.1"], "Major")).toBe(true);
  expect(frameworkSatisfied({ name: "x", version: "10.2.0" }, ["10.1.9"])).toBe(false);
  expect(frameworkSatisfied({ name: "x", version: "10.2.0" }, ["10.3.0"], "LatestPatch")).toBe(false);
  expect(frameworkSatisfied({ name: "x", version: "10.2.0" }, ["10.2.0"], "Disable")).toBe(true);
});

function ports(tree: Record<string, string[]>, patch: Partial<DotNetPorts> = {}): DotNetPorts {
  const norm = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const known = new Map(Object.entries(tree).map(([key, value]) => [norm(key), value]));
  return { env: { ProgramFiles: "C:\\Program Files" }, platform: "win32", registeredLocation: () => null,
    isDirectory: path => known.has(norm(path)) || [...known.keys()].some(key => key.startsWith(norm(path) + "\\")),
    list: path => known.get(norm(path)) ?? [], ...patch };
}
const INSTALL = {
  "C:\\Program Files\\dotnet\\host\\fxr": ["10.0.12"],
  "C:\\Program Files\\dotnet\\shared": ["Microsoft.NETCore.App", "Microsoft.WindowsDesktop.App"],
  "C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App": ["8.0.31", "10.0.12", "notes.txt"],
  "C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App": ["8.0.31"],
};

test("detection looks where the apphost looks, and reports what is missing", () => {
  const found = detectDotNet(ports(INSTALL));
  expect(found).toMatchObject({ root: "C:\\Program Files\\dotnet", source: "default" });
  expect(found.frameworks["Microsoft.NETCore.App"]).toEqual(["10.0.12", "8.0.31"]);
  const requirement = parseRuntimeConfig(WOLVENKIT_9);
  expect(missingFramework(requirement, found)).toBeNull();
  // A registered location wins over the default folder.
  const registered = detectDotNet(ports({ ...INSTALL, "D:\\dotnet\\host\\fxr": ["8.0.31"], "D:\\dotnet\\shared": ["Microsoft.NETCore.App"],
    "D:\\dotnet\\shared\\Microsoft.NETCore.App": ["8.0.31"] }, { registeredLocation: () => "D:\\dotnet" }));
  expect(registered.source).toBe("registry");
  expect(missingFramework(requirement, registered)).toEqual({ name: "Microsoft.NETCore.App", version: "10.0.0" });
  // DOTNET_ROOT is exclusive: an empty folder there means no runtime, even with one installed elsewhere.
  const overridden = detectDotNet(ports(INSTALL, { env: { DOTNET_ROOT: "E:\\empty", ProgramFiles: "C:\\Program Files" } }));
  expect(overridden).toMatchObject({ source: "DOTNET_ROOT", frameworks: {} });
  expect(missingFramework(requirement, overridden)).not.toBeNull();
  expect(detectDotNet(ports({}))).toMatchObject({ root: null, frameworks: {} });
  expect(detectDotNet(ports(INSTALL, { platform: "linux" }))).toMatchObject({ root: null });
});

test("guidance names the runtime plainly and links only to Microsoft", () => {
  expect(runtimeGuidance({ name: "Microsoft.NETCore.App", version: "10.0.0" })).toEqual({ name: ".NET 10 Runtime",
    installerUrl: "https://aka.ms/dotnet/10.0/dotnet-runtime-win-x64.exe", pageUrl: "https://dotnet.microsoft.com/download/dotnet/10.0" });
  expect(runtimeGuidance({ name: "Microsoft.WindowsDesktop.App", version: "8.0.0" }).name).toBe(".NET 8 Desktop Runtime");
});
