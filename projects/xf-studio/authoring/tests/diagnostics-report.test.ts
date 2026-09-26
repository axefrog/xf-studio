// The diagnostics cleanup (code-health DIAG-01..04, 06..09, 12): what a saved report may hold, redaction of names the shared
// patterns can't see the end of, a log that never throws, a V's resolution that survives its size, and the page's forwards.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { personalDataIn } from "../src/private-data";
import { redactText, redactValue, textRedactor } from "../src/diagnostics/redact";
import { personalRoots, RedactionRoots } from "../src/diagnostics/host-roots";
import { DIAGNOSTIC_FORWARD_SCHEMA, type DiagnosticEntry } from "../src/diagnostics/model";
import { DiagnosticLog, hostDiagnosticsAt, hostFailure, withDiagnostics } from "../src/diagnostics/host-log";
import { TraceWindow } from "../src/diagnostics/trace-window";
import { createDiagnosticsHandler, modFileEntryName, withRequestDiagnostics } from "../src/diagnostics/host-endpoint";
import { hideProfileName, resolutionResources } from "../src/diagnostics/host-report";
import { RESOLUTION_TRACE_OPTIONS, resolutionTrace } from "../src/diagnostics/resolution-trace";
import { hashingSettled, involvedMods } from "../src/diagnostics/mod-identity";
import type { ReportManifest } from "../src/diagnostics/report";
import { defaultLocalSettings, type LocalSettings } from "../src/local-settings";
import type { ResolvedCharacter } from "../src/character-resolver";

const root = mkdtempSync(resolve(tmpdir(), "xfs-diagnostics-report-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
/** Names assembled at run time, so this file itself holds no personal path for the repository check. */
const WHO = ["j", "doe"].join(""), FULL = ["John", "Doe"].join(" "), ORG = ["Contoso", "Ltd"].join(" ");
const PROFILE = `C:\\${"Users"}\\${FULL}`;

function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true), size = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const body = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    out.set(name, new TextDecoder().decode(method === 8 ? inflateRawSync(body) : body));
    at += 30 + nameLength + size;
  }
  return out;
}

/** An endpoint over its own data folder and settings; `post` sends a Studio-origin JSON request. */
function endpoint(name: string, settings: LocalSettings, extra: { openExternal?: (url: string) => boolean } = {}) {
  const dataRoot = join(root, name);
  const diagnostics = hostDiagnosticsAt(dataRoot);
  const handler = createDiagnosticsHandler(diagnostics, { app: () => ({ version: "0.1.0", commit: null, channel: null, host: "localhost" }),
    settings: () => settings, roots: () => [{ label: "<data>", path: dataRoot }], ...extra });
  const serve = withRequestDiagnostics(diagnostics, handler);
  const origin = "http://127.0.0.1:4317";
  const post = (path: string, body: unknown) => serve(new Request(`${origin}/api/diagnostics/${path}`,
    { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { diagnostics, post, dataRoot };
}

describe("names the shared patterns can't see the end of (DIAG-02)", () => {
  test("a profile folder with spaces and an OneDrive folder named after an employer leave nothing behind", () => {
    const text = `${PROFILE}\\AppData\\Local\\xf and ${PROFILE}\\OneDrive - ${ORG}\\Documents\\x and "${PROFILE.replace(/\\/g, "\\\\")}\\\\y"`;
    const shared = redactText(text);
    expect(shared).not.toContain("Doe");
    expect(shared).not.toContain("Contoso");
    expect(personalDataIn(shared)).toBeNull();
  });
  test("the host names the person's own folders and account literally, in any slash direction or JSON escaping", () => {
    const roots = personalRoots({ USERPROFILE: PROFILE, OneDriveCommercial: `${PROFILE}\\OneDrive - ${ORG}`, USERNAME: WHO },
      PROFILE, WHO, true);
    const redact = textRedactor(roots);
    const out = redact(`${PROFILE}\\OneDrive - ${ORG}\\a.txt; ${PROFILE.replace(/\\/g, "/")}/b; ${JSON.stringify(`${PROFILE}\\c`)}; signed in as ${WHO}`);
    expect(out).toBe(`%OneDrive%\\a.txt; %USERPROFILE%/b; "%USERPROFILE%\\\\c"; signed in as <user>`);
    // A placeholder account name is never treated as a person's.
    expect(textRedactor(personalRoots({}, null, "user", true))("the user folder")).toBe("the user folder");
  });
  test("the log and the window write with the host's roots", () => {
    const roots = new RedactionRoots(() => personalRoots({}, PROFILE, WHO, true));
    const log = new DiagnosticLog(join(root, "spaced-log"), { redactor: () => roots.redactor() });
    log.failure("character", "details_failed", `Failed under ${PROFILE}\\AppData`, Error(`at ${PROFILE}\\src\\x.ts for ${WHO}`));
    const window = new TraceWindow(join(root, "spaced-log"), Date.now, () => roots.redactor());
    window.event("character", "prepare", { folder: `${PROFILE}\\Games`, owner: WHO });
    window.flush();
    const written = readFileSync(log.path, "utf8") + JSON.stringify(window.read());
    expect(written).not.toContain("Doe");
    expect(written).not.toContain(WHO);
    expect(written).toContain("%USERPROFILE%");
  });
});

describe("the log never throws (DIAG-03)", () => {
  test("escape-bearing text beside a save folder is redacted value by value and stays valid JSON", () => {
    const log = new DiagnosticLog(join(root, "escapes"));
    const message = "line one\nMy Run 7\\sav.dat\tand \"quoted\" \\n literal";
    const written = log.write({ t: new Date().toISOString(), level: "error", area: "page", code: "x", message, origin: "page",
      details: { stack: `Error: boom\n\tat D:\\Games\\Cyberpunk 2077\\My Run 7\\sav.dat\n\tat "x"` } });
    expect(written.message).toBe(message);
    expect(written.details!.stack).toContain("Cyberpunk 2077\\<save>\\sav.dat");
    const lines = readFileSync(log.path, "utf8").trim().split("\n");
    expect(() => lines.map(line => JSON.parse(line))).not.toThrow();
    const window = new TraceWindow(join(root, "escapes"));
    window.event("resolver", "read_failed", { path: message, nested: { list: [message, 1, null] } });
    window.flush();
    expect(window.read()[0]!.data!.path).toBe(written.message);
  });
  test("a failure hook survives an error whose stack can't be read, and an entry that can't be written", () => {
    const hostile = new Proxy({}, { get: () => { throw Error("no"); } });
    const diagnostics = hostDiagnosticsAt(join(root, "hostile"));
    const ref = withDiagnostics(diagnostics, () => hostFailure("character", "details_failed", "Failed.", hostile));
    expect(ref).toMatch(/^XF-/);
    const cyclic: Record<string, unknown> = { level: "error" };
    cyclic.self = cyclic;
    expect(() => diagnostics.log.write(cyclic as unknown as DiagnosticEntry)).not.toThrow();
  });
  test("the forwarding endpoint answers a poison entry with 204, so the page doesn't resend it forever", async () => {
    const { diagnostics, post } = endpoint("poison", defaultLocalSettings());
    const write = diagnostics.log.write.bind(diagnostics.log);
    diagnostics.log.write = (entry: DiagnosticEntry) => { if (entry.message === "poison") throw Error("disk full"); return write(entry); };
    const entries = [{ level: "error", area: "page", code: "a", message: "poison" }, { level: "error", area: "page", code: "b", message: "fine" }];
    expect((await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries })).status).toBe(204);
    expect(diagnostics.log.tail(5).map(entry => entry.message)).toContain("fine");
  });
});

/** A synthetic V whose parts share their materials, as real ones do: `parts` components × `materials` materials, each naming the same templates. */
function syntheticV(parts: number, materials: number, alternatives: number): ResolvedCharacter {
  const provenance = (path: string) => ({ ref: { hash: String(Bun.hash(path)), path }, status: "archive", archive: `${path.split("\\")[1]}.archive`,
    provider: "Hair Pack", group: "mod", alternatives: Array.from({ length: alternatives }, (_, i) => `other_${i}.archive (mod, Other Mod ${i})`),
    rule: { rule: "mod archives load after the game's" }, via: [], extractedSha256: null, ambiguities: [] });
  const material = (index: number) => ({ chunk: index, name: `m${index}`, route: "direct", entry: `e${index}`, dynamic: false,
    chain: [{ label: "base", baseMaterial: "base", provenance: provenance(`base\\shared\\m${index % 12}.mi`) }],
    template: provenance(`base\\templates\\t${index % 4}.mt`),
    params: Array.from({ length: 6 }, (_, p) => ({ name: `p${p}`, setBy: "mi", resource: provenance(`base\\textures\\x${(index + p) % 30}.xbm`), dynamic: null })),
    gaps: [] });
  const component = (index: number) => ({ name: `c${index}`, type: "mesh", origin: "app", meshAppearance: "default", chunkMask: null, overriddenBy: [],
    geometry: { mesh: provenance(`base\\meshes\\c${index % 20}.mesh`), morphTarget: null, drawnFrom: null, patchedFrom: null, renderChunks: 4, visibleChunks: 4,
      drawsNothing: false, morphTexture: null },
    meshAppearanceResolved: true, materials: Array.from({ length: materials }, (_, m) => material(m)), notes: [] });
  return { bodyGender: "female", origin: "ui-state", cco: { base: provenance("base\\cco.inkcc"), customResources: [], hairColorTags: [] },
    appearances: Array.from({ length: 12 }, (_, a) => ({ part: `part${a}`, option: `o${a}`, groups: [], definition: `d${a}`, requestedApp: { hash: "1", path: `base\\apps\\a${a}.app` },
      app: provenance(`base\\apps\\a${a}.app`), appOverride: null, choice: 0, appearance: "default",
      components: Array.from({ length: parts }, (_, c) => component(a * parts + c)), notes: [] })),
    morphs: [], ambiguities: [], gaps: [], rules: [] } as unknown as ResolvedCharacter;
}

describe("profile names of any shape, encoded folders and identifier keys (DIAG-20, DIAG-21)", () => {
  const profile = (name: string) => `C:\\${"Users"}\\${name}`;
  test("a profile folder's whole name goes, however many words, trailing, parenthesised or percent-encoded", () => {
    const five = "Jane Quentin Public Doe Smith", odd = "Jane Doe (Work)";
    for (const [text, expected] of [
      [`${profile(five)}\\AppData\\x`, "C:\\Users\\<user>\\AppData\\x"],
      [`opened ${profile(five)}`, "opened C:\\Users\\<user>"],
      [`${profile(odd)}\\Documents`, "C:\\Users\\<user>\\Documents"],
      [`"${profile("Jane Doe").replaceAll("\\", "\\\\")}"`, "\"C:\\\\Users\\\\<user>\""],
      [encodeURIComponent(`${profile(five)}\\AppData`), "C%3A%5CUsers%5C<user>%5CAppData"],
      [`file:///C:/${"Users"}/${five.replaceAll(" ", "%20")}/x`, "file:///C:/Users/<user>/x"],
      [`/${"home"}/${five}/x`, "/home/<user>/x"],
      [`/mnt/c/${"Users"}/${odd}/x`, "/mnt/c/Users/<user>/x"],
    ] as const) {
      const out = redactText(text);
      expect(out, text).toBe(expected);
      for (const word of ["Quentin", "Smith", "Work", "Jane"]) expect(out).not.toContain(word);
      expect(redactText(out)).toBe(out);
    }
    // Shared profiles and placeholders are left as they are.
    for (const text of [profile("Public") + "\\x", profile("All Users") + "\\x", profile("Default User") + "\\x", profile("<name>") + "\\x", profile("%USERNAME%") + "\\x"])
      expect(redactText(text)).toBe(text);
  });
  test("a known folder is redacted in its percent-encoded and URL forms too", () => {
    const folder = `D:\\Games\\${FULL}'s game`;
    const roots = [{ label: "<game>", path: folder }];
    for (const form of [encodeURIComponent(`${folder}\\archive`), encodeURIComponent(`${folder}\\archive`).toLowerCase(),
      `D:/Games/${FULL.replace(" ", "+")}'s+game/archive`, `D:\\u005cGames\\u005c${FULL}'s game`])
      expect(redactText(form, roots), form).not.toContain("Doe");
  });
  test("an account named like a common word leaves identifier keys alone, and keys that redact alike are both kept", () => {
    const redact = textRedactor([{ label: "<user>", word: "game" }]);
    expect(redactValue({ game: "the game folder", route: "game" }, redact)).toEqual({ game: "the <user> folder", route: "<user>" });
    // Two paths that redact to the same text: both kept, the later numbered.
    const both = redactValue({ [`${profile("Jane Doe")}\\a`]: 1, [`${profile("John Roe")}\\a`]: 2 }, redact);
    expect(both).toEqual({ "C:\\Users\\<user>\\a": 1, "C:\\Users\\<user>\\a (2)": 2 });
    // A key "__proto__" is data, not the output's prototype.
    const hostile = redactValue(JSON.parse('{"__proto__": {"x": 1}}'), redact) as Record<string, unknown>;
    expect(Object.getPrototypeOf(hostile)).toBe(Object.prototype);
    expect(Object.keys(hostile)).toEqual(["__proto__"]);
  });
  test("the MO2 profile's name is hidden where the wording carries it, never inside other words", () => {
    expect(hideProfileName(`Mod Organizer 2 profile "Default"`, "Default")).toBe(`Mod Organizer 2 profile "<profile>"`);
    expect(hideProfileName(`MO2\\profiles\\Default\\modlist.txt`, "Default")).toBe(`MO2\\profiles\\<profile>\\modlist.txt`);
    expect(hideProfileName("Defaults are loaded by default.", "Default")).toBe("Defaults are loaded by default.");
    expect(hideProfileName("A modlist of mods", "mod")).toBe("A modlist of mods");
  });
});

describe("a V's resolution survives its size (DIAG-04)", () => {
  test("a realistically sized resolution is kept, one table of resources, and the report's resource parts fill in", async () => {
    const resolved = syntheticV(6, 10, 6);
    // Inline, as the window used to record it, this is about the reference V's size.
    const inline = JSON.stringify(resolved).length;
    expect(inline).toBeGreaterThan(1_500_000);
    const compact = resolutionTrace(resolved);
    const rows = compact.resources as unknown[];
    expect(rows.length).toBeLessThan(100);
    const { diagnostics, post } = endpoint("resolution", defaultLocalSettings());
    diagnostics.trace.event("character", "resolved", compact, RESOLUTION_TRACE_OPTIONS);
    const [event] = diagnostics.trace.read().filter(entry => entry.event === "resolved");
    expect(event!.data!.truncated).toBeUndefined();
    expect(resolutionResources(event!, null)!.length).toBe(rows.length);
    const manifest = await (await post("report", { ref: null })).json() as ReportManifest;
    const winners = manifest.items.find(item => item.id === "winners")!;
    expect(winners.bytes).toBeGreaterThan(1_000);
    expect(manifest.items.find(item => item.id === "involved-mods")!.preview).toContain("Hair Pack");
  });
  test("a record still too large keeps its resource table; without one, the preparation's parts stand in", () => {
    const window = new TraceWindow(join(root, "oversize"));
    const huge = { resources: [{ ref: { hash: "1", path: "base\\a.app" }, status: "archive", archive: "a.archive", provider: "A", group: "mod", alternatives: [] }],
      appearances: Array.from({ length: 5_000 }, (_, i) => ({ note: "x".repeat(500), i })) };
    window.event("character", "resolved", huge, RESOLUTION_TRACE_OPTIONS);
    const [kept] = window.read();
    expect(kept!.data!.truncated).toBe(true);
    expect(resolutionResources(kept!, null)).toHaveLength(1);
    // An older window's keys-only record: the preparation's parts and their winning archives.
    const old = { t: "", area: "character", event: "resolved", data: { truncated: true, bytes: 1_781_146, keys: ["appearances"] } };
    const prepared = { t: "", area: "character", event: "prepared", data: { components: [{ sources: [{ path: "base\\b.mesh", archive: "b.archive", provider: "B" }] }] } };
    expect(resolutionResources(old, prepared)).toEqual([expect.objectContaining({ ref: expect.objectContaining({ path: "base\\b.mesh" }), archive: "b.archive", provider: "B" })]);
  });
});

describe("a saved report holds only what was ticked (DIAG-01, DIAG-06, DIAG-08, DIAG-09)", () => {
  const game = join(root, `game-${WHO}`), mo2 = join(root, "mo2");
  mkdirSync(join(game, "bin", "x64"), { recursive: true });
  writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "not a real exe");
  mkdirSync(join(mo2, "mods", "Private Mod Name", "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(mo2, "mods", "Private Mod Name", "meta.ini"), "[General]\nversion=0.1\n");
  writeFileSync(join(mo2, "mods", "Private Mod Name", "archive", "pc", "mod", "private.archive"), "private bytes");
  mkdirSync(join(mo2, "profiles"), { recursive: true });
  const settings: LocalSettings = { ...defaultLocalSettings(), gameRoot: game, launchRoute: "mo2", mo2Root: mo2, mo2ProfileId: "Secret Profile" };
  let opened = "";
  const { diagnostics, post, dataRoot } = endpoint("ticks", settings, { openExternal: url => { opened = url; return true; } });

  async function prepare() {
    const ref = diagnostics.log.failure("character", "details_failed", "Failed: SECRET-MESSAGE", Error("SECRET-STACK"));
    diagnostics.log.info("test", "event", "SECRET-LOG-LINE");
    diagnostics.trace.event("character", "resolved", { resources: [
      { ref: { hash: "1", path: "base\\hair.app" }, status: "archive", archive: "private.archive", provider: "Private Mod Name", group: "mod", alternatives: [] }] },
      RESOLUTION_TRACE_OPTIONS);
    return { ref, manifest: await (await post("report", { ref })).json() as ReportManifest };
  }

  test("README.md and report.json leave out unticked parts, and never name an unticked mod", async () => {
    const { ref, manifest } = await prepare();
    const byId = new Map(manifest.items.map(item => [item.id, item]));
    // The full mod list starts unticked (DIAG-08); a small MO2 mod with no source is offered, unticked, with plain words (DIAG-09).
    expect(byId.get("mods")!.included).toBe(false);
    const offer = manifest.items.find(item => item.modFiles)!;
    expect(offer).toMatchObject({ included: false, label: "Files of “Private Mod Name”" });
    expect(offer.detail).toContain("couldn't tell where this mod came from");
    const response = await post("bundle", { id: manifest.id, include: ["settings"], description: "Only the settings." });
    expect(response.status).toBe(200);
    const files = unzip(new Uint8Array(await response.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(["README.md", "about/settings.json", "report.json"]);
    const all = [...files.values()].join("\n");
    for (const secret of ["SECRET-MESSAGE", "SECRET-STACK", "SECRET-LOG-LINE", "Private Mod Name", "0.1.0", "Secret Profile"]) expect(all, secret).not.toContain(secret);
    expect(files.get("README.md")).toContain(`Reference ${ref}; its log entries weren't included.`);
    const index = JSON.parse(files.get("report.json")!);
    expect(index).toMatchObject({ app: null, page: null, included: [{ id: "settings" }] });
    expect(index.leftOut.items).toEqual(expect.arrayContaining(["problem", "log", "mods", offer.id]));
  });

  test("the full mod list, when ticked, carries no MO2 profile name (DIAG-08)", async () => {
    const { manifest } = await prepare();
    const files = unzip(new Uint8Array(await (await post("bundle", { id: manifest.id, include: ["mods"] })).arrayBuffer()));
    expect(files.get("mods/mods.json")).toContain("<profile>");
    expect(files.get("mods/mods.json")).not.toContain("Secret Profile");
  });

  test("a mod's own files need the sharing confirmation on the host too (DIAG-09)", async () => {
    const { manifest } = await prepare();
    const offer = manifest.items.find(item => item.modFiles)!;
    const refused = await post("bundle", { id: manifest.id, include: [offer.id] });
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("sharing_not_confirmed");
    const confirmed = await post("bundle", { id: manifest.id, include: [offer.id], sharingConfirmed: true });
    expect([...unzip(new Uint8Array(await confirmed.arrayBuffer())).keys()]).toContain("optional/mod-files/Private Mod Name/private.archive");
  });

  test("configured folders are redacted in page items, page facts, the description, the issue link, the log and the window (DIAG-06)", async () => {
    const { manifest } = await prepare();
    const at = `${game}\\archive\\pc\\mod\\x.archive`;
    const page = { facts: { browser: "Chrome 140", gpu: null, webgl2: true, state: { folder: at } },
      items: [{ id: "activity", label: `Recent messages ${game}`, detail: at, content: [{ message: `Couldn't read ${at}` }] },
        { id: "page", label: "This window", detail: "", content: { folder: at } }] };
    const response = await post("bundle", { id: manifest.id, include: ["settings", "activity", "page"], description: `I opened ${at}`, page });
    const all = [...unzip(new Uint8Array(await response.arrayBuffer())).values()].join("\n");
    expect(all).not.toContain(`game-${WHO}`);
    expect(all).toContain("<game>");
    await post("open-issue", { title: `Problem in ${game}`, body: `Folder ${at}` });
    expect(decodeURIComponent(opened)).not.toContain(`game-${WHO}`);
    // The files on disk the docs call safe to attach carry the label too.
    diagnostics.log.info("test", "event", `Reading ${at}`);
    diagnostics.trace.event("character", "prepare", { folder: at });
    diagnostics.trace.flush();
    const disk = readFileSync(join(dataRoot, "diagnostics", "log.jsonl"), "utf8") +
      readdirSync(join(dataRoot, "diagnostics", "trace")).map(name => readFileSync(join(dataRoot, "diagnostics", "trace", name), "utf8")).join("");
    expect(disk).not.toContain(`game-${WHO}`);
  });

  test("without a desktop to open it, the host answers the issue link redacted with the configured folders (DIAG-19)", async () => {
    const page = endpoint("ticks-page", settings);
    const response = await page.post("open-issue", { title: `Problem in ${game}`, body: `Folder ${game}\\archive` });
    const answer = await response.json() as { code: string; url: string };
    expect([response.status, answer.code]).toEqual([200, "open_in_page"]);
    expect(answer.url).toStartWith("https://github.com/axefrog/xf-studio/issues/new?");
    expect(decodeURIComponent(answer.url)).not.toContain(`game-${WHO}`);
    expect(decodeURIComponent(answer.url.replace(/\+/g, " "))).toContain("Problem in <game>");
  });

  test("mod-file entry names in the ZIP are redacted like the rest (DIAG-23)", async () => {
    // The names come from the rolling window, redacted with the folders known when it was written; the ZIP redacts them again
    // with the report's, like every other part.
    const mail = ["jane.doe", "gmail.com"].join("@");
    const redact = textRedactor([{ label: "<game>", path: game }, { label: "<user>", word: WHO }]);
    expect(modFileEntryName(`Mod from ${mail}`, `${WHO}-hair.archive`, redact)).toBe("optional/mod-files/Mod from _email_/_user_-hair.archive");
    expect(modFileEntryName(`Mod in ${game}`, "a.archive", redact)).toBe("optional/mod-files/Mod in _game_/a.archive");
    // The existing flow still names an ordinary mod's files as they are.
    const { manifest } = await prepare();
    const offer = manifest.items.find(item => item.modFiles)!;
    const names = [...unzip(new Uint8Array(await (await post("bundle", { id: manifest.id, include: [offer.id], sharingConfirmed: true })).arrayBuffer())).keys()];
    expect(names).toContain("optional/mod-files/Private Mod Name/private.archive");
  });

  test("files of a game-folder mod are never offered (DIAG-09)", async () => {
    const plain: LocalSettings = { ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" };
    mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
    writeFileSync(join(game, "archive", "pc", "mod", "loose.archive"), "loose");
    const other = endpoint("game-folder", plain);
    other.diagnostics.trace.event("character", "resolved", { resources: [
      { ref: { hash: "2", path: "base\\x.app" }, status: "archive", archive: "loose.archive", provider: "Installed game", group: "mod", alternatives: [] }] },
      RESOLUTION_TRACE_OPTIONS);
    const manifest = await (await other.post("report", { ref: null })).json() as ReportManifest;
    expect(manifest.items.some(item => item.modFiles)).toBe(false);
  });
});

describe("the page's forwards (DIAG-07, DIAG-12)", () => {
  test("the same page entry is kept once a minute, and a flood can't hide a host failure from its report", async () => {
    const { diagnostics, post } = endpoint("flood", defaultLocalSettings());
    const ref = diagnostics.log.failure("character", "details_failed", "The host failure", Error("x"));
    const same = { level: "error", area: "page", code: "loop", message: "the same thing again" };
    for (let i = 0; i < 5; i++) await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: Array(10).fill(same) });
    expect(diagnostics.log.tail().filter(entry => entry.message === same.message)).toHaveLength(1);
    // Hundreds of distinct later entries push the failure past the last 200; "This problem" still finds it.
    for (let i = 0; i < 300; i++) diagnostics.log.info("test", "event", `later ${i}`);
    const manifest = await (await post("report", { ref })).json() as ReportManifest;
    expect(manifest.problem.map(entry => entry.ref)).toContain(ref);
  });
  test("the same failure under another reference is kept: the page showed that reference to someone (DIAG-22)", async () => {
    const { diagnostics, post } = endpoint("repeat-refs", defaultLocalSettings());
    const failure = { level: "error", area: "page", code: "loop", message: "the same thing, recorded again later" };
    await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: [{ ...failure, ref: "XF-AAAAAA" }, { ...failure, ref: "XF-AAAAAA" }] });
    await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: [{ ...failure, ref: "XF-BBBBBB" }] });
    const kept = diagnostics.log.tail().filter(entry => entry.message === failure.message);
    expect(kept.map(entry => entry.ref)).toEqual(["XF-AAAAAA", "XF-BBBBBB"]);
    const manifest = await (await post("report", { ref: "XF-BBBBBB" })).json() as ReportManifest;
    expect(manifest.problem.map(entry => entry.ref)).toContain("XF-BBBBBB");
  });
  test("a page failure links to at most three host failures of the last seconds, and none when it carries a host reference", async () => {
    const { diagnostics, post } = endpoint("links", defaultLocalSettings());
    const refs = Array.from({ length: 5 }, (_, i) => diagnostics.log.failure("server", "http_500", `failure ${i}`));
    await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: [{ level: "error", area: "notice", code: "failed", message: "page-made", ref: "XF-7K3Q" },
      { level: "error", area: "notice", code: "failed", message: "host-made", ref: refs[4] }] });
    const tail = diagnostics.log.tail(10);
    expect(tail.find(entry => entry.message === "page-made")!.details!.related).toEqual(refs.slice(-3));
    expect(tail.find(entry => entry.message === "host-made")!.details?.related).toBeUndefined();
  });
});

describe("the game folder is not one mod, and hashing is bounded in time (DIAG-05, DIAG-11)", () => {
  const game = join(root, "split-game"), mods = join(game, "archive", "pc", "mod");
  mkdirSync(mods, { recursive: true });
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  mkdirSync(join(game, "mods", "My RED Mod", "archives"), { recursive: true });
  mkdirSync(join(game, "bin", "x64", "deep"), { recursive: true });
  writeFileSync(join(game, "archive", "pc", "content", "basegame_4_appearance.archive"), "base");
  for (const name of ["a.archive", "b.archive", "vortexed.archive"]) writeFileSync(join(mods, name), `${name} bytes`);
  writeFileSync(join(game, "mods", "My RED Mod", "archives", "red.archive"), "red");
  // Where the game never loads archives from: a same-named file there must not be found by walking the game folder.
  writeFileSync(join(game, "bin", "x64", "deep", "stray.archive"), "stray");
  // Deployed by Vortex, and still the file it deployed: the manifest's time is the file's (VORTEX-03).
  const DEPLOYED_MS = 1727000000000;
  utimesSync(join(mods, "vortexed.archive"), DEPLOYED_MS / 1000, DEPLOYED_MS / 1000);
  writeFileSync(join(game, "vortex.deployment.json"), JSON.stringify({ version: 1, instance: "i1", gameId: "cyberpunk2077",
    files: [{ relPath: "archive\\pc\\mod\\vortexed.archive", source: "Vortexed Mod-1-0", time: DEPLOYED_MS },
      { relPath: "archive\\pc\\mod\\replaced.archive", source: "Replaced Mod-2-0", time: DEPLOYED_MS }] }));
  // Listed by the manifest, but replaced by hand since.
  writeFileSync(join(mods, "replaced.archive"), "someone else's bytes");
  const settings: LocalSettings = { ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" };
  const winners = [
    { archive: "basegame_4_appearance.archive", provider: "Installed game", group: "content", alternatives: ["a.archive (mod, Installed game)"] },
    { archive: "b.archive", provider: "Installed game", group: "mod", alternatives: ["vortexed.archive (mod, Installed game)", "red.archive (mod, Installed game)"] },
    { archive: "stray.archive", provider: "Installed game", group: "mod", alternatives: [] },
  ];
  const none = () => undefined;

  test("base-game archives are one entry, never located or hashed; every other game-folder archive is its own", async () => {
    const found = await involvedMods(winners, settings, none);
    const byName = new Map(found.map(mod => [mod.name, mod]));
    expect(byName.get("Cyberpunk 2077 (the game's own files)")).toMatchObject({ kind: "base-game", status: "base-game",
      archives: [{ name: "basegame_4_appearance.archive", bytes: null, sha256: null, path: null, identifiedBy: "game version" }] });
    for (const name of ["a.archive", "b.archive"])
      expect(byName.get(`${name} (in the game folder)`)).toMatchObject({ kind: "game-folder", archives: [{ name, identifiedBy: "sha-256" }] });
    // An archive Vortex deployed goes with its Vortex mod; REDmod's archives are found where the game loads them.
    expect(byName.get("Vortexed Mod-1-0")).toMatchObject({ kind: "vortex-mod", archives: [{ name: "vortexed.archive" }] });
    expect(byName.get("red.archive (in the game folder)")!.archives[0]).toMatchObject({ bytes: 3, identifiedBy: "sha-256" });
    // The game folder isn't walked: a file outside the load folders stays not found.
    expect(byName.get("stray.archive (in the game folder)")!.archives[0]).toMatchObject({ bytes: null, identifiedBy: "not found" });
  });

  test("a file replaced since Vortex deployed it is its own game-folder entry, never credited to the Vortex mod (VORTEX-03)", async () => {
    // Provider named either way: the game folder, or (by source discovery) the Vortex mod's staging name.
    for (const provider of ["Installed game", "Replaced Mod-2-0"]) {
      const found = await involvedMods([{ archive: "replaced.archive", provider, group: "mod", alternatives: [] }], settings, none);
      expect(found.map(mod => [mod.name, mod.kind, mod.source?.site ?? null])).toEqual(
        provider === "Installed game" ? [["replaced.archive (in the game folder)", "game-folder", null]] : [["Replaced Mod-2-0", "unknown", null]]);
    }
    const kept = await involvedMods([{ archive: "vortexed.archive", provider: "Vortexed Mod-1-0", group: "mod", alternatives: [] }], settings, none);
    expect(kept.map(mod => [mod.name, mod.kind])).toEqual([["Vortexed Mod-1-0", "vortex-mod"]]);
  });

  test("on the MO2 route, an MO2 mod stays an MO2 mod when a leftover manifest names a Vortex mod of the same name (VORTEX-04)", async () => {
    const mo2 = join(root, "split-mo2");
    mkdirSync(join(mo2, "mods", "Vortexed Mod-1-0", "archive", "pc", "mod"), { recursive: true });
    mkdirSync(join(mo2, "profiles", "Default"), { recursive: true });
    writeFileSync(join(mo2, "mods", "Vortexed Mod-1-0", "archive", "pc", "mod", "vortexed.archive"), "the MO2 mod's copy");
    writeFileSync(join(mo2, "mods", "Vortexed Mod-1-0", "meta.ini"), "[General]\nmodid=4242\nfileid=77\nversion=3.0\n");
    const onMo2: LocalSettings = { ...settings, launchRoute: "mo2", mo2Root: mo2, mo2ProfileId: "Default" };
    const found = await involvedMods([{ archive: "vortexed.archive", provider: "Vortexed Mod-1-0", group: "mod", alternatives: [] }], onMo2, none);
    expect(found.map(mod => [mod.name, mod.kind, mod.version, mod.status])).toEqual([["Vortexed Mod-1-0", "mo2-mod", "3.0", "re-downloadable"]]);
    expect(found[0]!.archives[0]!.path).toBe(join(mo2, "mods", "Vortexed Mod-1-0", "archive", "pc", "mod", "vortexed.archive"));
  });

  test("a hash still running when the budget ends stops there, and is finished in the background (DIAG-24)", async () => {
    const big = join(mods, "big.archive");
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024, 7));
    // A clock that moves a millisecond each time it is read: the budget ends while the file's first chunks are hashed.
    let clock = 0;
    const now = () => clock++;
    const first = await involvedMods([{ archive: "big.archive", provider: "Installed game", group: "mod", alternatives: [] }], settings, none,
      { hashBudgetMs: 4, now });
    expect(first[0]!.archives[0]).toMatchObject({ sha256: null, identifiedBy: "size and date" });
    // It was stopped part-way, not read to the end: fewer clock reads than the file has chunks.
    expect(clock).toBeLessThan(12);
    await hashingSettled();
    const again = await involvedMods([{ archive: "big.archive", provider: "Installed game", group: "mod", alternatives: [] }], settings, none, { hashBudgetMs: 0 });
    expect(again[0]!.archives[0]).toMatchObject({ identifiedBy: "sha-256", sha256: new Bun.CryptoHasher("sha256").update(readFileSync(big)).digest("hex") });
  });

  test("out of time, archives are identified by size and date, with progress, and the next report has their hashes", async () => {
    const fresh = join(mods, "late.archive");
    writeFileSync(fresh, `late ${Date.now()}`);
    const seen: [number, number][] = [];
    const first = await involvedMods([{ archive: "late.archive", provider: "Installed game", group: "mod", alternatives: [] }], settings, none,
      { hashBudgetMs: 0, progress: (done, total) => seen.push([done, total]) });
    expect(first[0]!.archives[0]).toMatchObject({ sha256: null, identifiedBy: "size and date" });
    expect(first[0]!.archives[0]!.bytes).toBeGreaterThan(0);
    expect(seen).toEqual([[0, 1], [1, 1]]);
    await hashingSettled();
    const again = await involvedMods([{ archive: "late.archive", provider: "Installed game", group: "mod", alternatives: [] }], settings, none, { hashBudgetMs: 0 });
    expect(again[0]!.archives[0]).toMatchObject({ identifiedBy: "sha-256", sha256: new Bun.CryptoHasher("sha256").update(readFileSync(fresh)).digest("hex") });
  });
});
