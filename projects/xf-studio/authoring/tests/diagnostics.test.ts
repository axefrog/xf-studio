import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { personalDataIn, redactPersonalData } from "../src/private-data";
import { redactKnownRoots, redactSaveNames, redactText } from "../src/diagnostics/redact";
import { boundJson, DIAGNOSTIC_FORWARD_SCHEMA, DIAGNOSTIC_LIMITS, isErrorRef, isExpectedFailure, newErrorRef, parseForward } from "../src/diagnostics/model";
import { DiagnosticLog, hostDiagnosticsAt, hostFailure, hostTrace, withDiagnostics } from "../src/diagnostics/host-log";
import { TRACE_BOUNDS, TraceWindow } from "../src/diagnostics/trace-window";
import { createDiagnosticsHandler, ERROR_REF_HEADER, withRequestDiagnostics } from "../src/diagnostics/host-endpoint";
import { ISSUE_URL_LIMIT, issueUrl, reportLeaks, type ReportManifest } from "../src/diagnostics/report";
import { DiagnosticsActions, type DiagnosticsDevice } from "../src/diagnostics/actions";
import { involvedMods } from "../src/diagnostics/mod-identity";
import { crc32, zip } from "../src/diagnostics/zip";
import { defaultLocalSettings } from "../src/local-settings";

const vectors = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../tools/private-data.json"), "utf8")).vectors as
  { userPath: string[]; email: string[]; clean: string[] };
const root = mkdtempSync(resolve(tmpdir(), "xfs-diagnostics-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
/** A user folder name assembled at run time, so this file itself holds no personal path for the repository check. */
const WHO = ["j", "doe"].join("");
const everyVector =[...vectors.userPath, ...vectors.email].join("\n");

/** The text of every entry in a ZIP (deflated or stored), by name. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<string, Uint8Array>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true), size = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const body = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(body)) : body);
    at += 30 + nameLength + size;
  }
  return out;
}

describe("redaction with the shared vectors (tools/private-data.json)", () => {
  test("no user-path or e-mail vector survives, and the clean vectors are left as they are", () => {
    for (const vector of [...vectors.userPath, ...vectors.email]) {
      expect(personalDataIn(vector), vector).not.toBeNull();
      expect(personalDataIn(redactPersonalData(vector)), vector).toBeNull();
      expect(personalDataIn(redactText(vector)), vector).toBeNull();
    }
    for (const vector of vectors.clean) expect(redactPersonalData(vector), vector).toBe(vector);
    expect(redactPersonalData(`C:\\Users\\${WHO}\\AppData\\Local\\xf`)).toBe("C:\\Users\\<user>\\AppData\\Local\\xf");
    expect(redactPersonalData(`mail ${["jane.doe", "company.co.uk"].join("@")}`)).toBe("mail <email>");
    // Idempotent.
    expect(redactText(redactText(everyVector))).toBe(redactText(everyVector));
  });
  test("configured folders become labels in any slash direction, escaping or case; save names become <save>", () => {
    const roots = [{ label: "<game>", path: "D:\\jdoe\\Games\\Cyberpunk 2077" }, { label: "<mo2>", path: "E:/Modding/MO2" }];
    expect(redactKnownRoots("D:\\jdoe\\Games\\Cyberpunk 2077\\archive\\pc\\mod\\x.archive", roots)).toBe("<game>\\archive\\pc\\mod\\x.archive");
    expect(redactKnownRoots('{"p":"d:\\\\JDOE\\\\games\\\\cyberpunk 2077\\\\bin"}', roots)).toBe('{"p":"<game>\\\\bin"}');
    expect(redactKnownRoots("E:\\Modding\\MO2\\mods\\A", roots)).toBe("<mo2>\\mods\\A");
    expect(redactKnownRoots("C:\\", [{ label: "<x>", path: "C:\\" }])).toBe("C:\\");
    expect(redactSaveNames("loaded ManualSave-12 and AutoSave-3")).toBe("loaded <save> and <save>");
    expect(redactSaveNames("…\\Cyberpunk 2077\\My Run 7\\sav.dat")).toBe("…\\Cyberpunk 2077\\<save>\\sav.dat");
  });
});

describe("error references and entries", () => {
  test("references are XF- and six unambiguous characters (four-character ones still read)", () => {
    const refs = new Set(Array.from({ length: 200 }, () => newErrorRef()));
    for (const ref of refs) expect(isErrorRef(ref)).toBe(true);
    expect(refs.size).toBeGreaterThan(190);
    expect(newErrorRef(bytes => bytes.fill(18))).toBe("XF-JJJJJJ");
    expect(isErrorRef("XF-7K3Q")).toBe(true);
    expect(isErrorRef("XF-7K3O")).toBe(false);
  });
  test("a forward is bounded and read field by field", () => {
    const entry = { level: "error", area: "page", code: "uncaught_error", message: "x".repeat(5000), ref: "XF-7K3Q", extra: "ignored",
      details: { stack: "s".repeat(10_000), related: ["XF-0000", "nope"], source: "Library" } };
    const parsed = parseForward({ schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: [entry] });
    if (!parsed.ok) throw Error(parsed.message);
    const [kept] = parsed.entries;
    expect(kept!.message.length).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.message);
    expect(kept!.details!.stack!.length).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.stack);
    expect(kept!.details!.related).toEqual(["XF-0000"]);
    expect(kept).toMatchObject({ origin: "page", ref: "XF-7K3Q" });
    expect("extra" in kept!).toBe(false);
    expect(parseForward({ schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: Array(11).fill(entry) }).ok).toBe(false);
    expect(parseForward({ entries: [entry] }).ok).toBe(false);
  });
  test("expected refusals get no reference; anything else does", () => {
    for (const code of ["busy", "limit", "cancelled", "conflict", "invalid_value", "no_exportable_content"]) expect(isExpectedFailure(code)).toBe(true);
    for (const code of [undefined, "internal", "transport", "request_failed", "storage_failed", "package_build_failed"]) expect(isExpectedFailure(code)).toBe(false);
  });
  test("bounded JSON drops payload keys, clips and keeps shape", () => {
    const value = boundJson({ a: [1, 2, 3, 4, 5, 6, 7], Bytes: "AAAA", deep: { b: { c: { d: 1 } } }, s: "abcdef", n: Infinity },
      { depth: 3, items: 5, text: 3, drop: /^Bytes$/ });
    expect(value).toEqual({ a: [1, 2, 3, 4, 5, "… 2 more"], Bytes: "(left out)", deep: { b: { c: "…" } }, s: "abc… (6 characters)", n: null });
  });
});

describe("the host log", () => {
  test("JSON Lines, redacted as written, rotated at its bound into one previous file", () => {
    const log = new DiagnosticLog(join(root, "log"), { maxBytes: 4_000 });
    const ref = log.failure("character", "details_failed", `Failed under C:\\Users\\${WHO}\\AppData`, Error(`boom at /home/${WHO}/x.ts`));
    expect(isErrorRef(ref)).toBe(true);
    const text = readFileSync(log.path, "utf8");
    expect(personalDataIn(text)).toBeNull();
    expect(JSON.parse(text.trim())).toMatchObject({ level: "error", area: "character", code: "details_failed", ref, origin: "host" });
    for (let i = 0; i < 100; i++) log.info("test", "event", `line ${i} ${"x".repeat(80)}`);
    expect(statSync(log.path).size).toBeLessThanOrEqual(4_000);
    expect(statSync(log.previous).size).toBeLessThanOrEqual(4_000);
    const tail = log.tail(5);
    expect(tail.map(entry => entry.message.slice(0, 7))).toEqual(["line 95", "line 96", "line 97", "line 98", "line 99"]);
    new DiagnosticLog(join(root, "missing", "\0bad")).info("a", "b", "never throws");
  });
  test("hostFailure reaches the log of the request that started the work, even later", async () => {
    const one = hostDiagnosticsAt(join(root, "host-one")), two = hostDiagnosticsAt(join(root, "host-two"));
    let later!: Promise<string | null>;
    withDiagnostics(one, () => { later = new Promise<void>(done => setTimeout(done, 5)).then(() => hostFailure("resolver", "extract_failed", "later", Error("x"))); });
    withDiagnostics(two, () => { hostTrace().event("character", "resolved", { path: "base\\x.app" }); });
    const ref = await later;
    expect(one.log.tail(5).some(entry => entry.ref === ref)).toBe(true);
    expect(two.log.tail(5).some(entry => entry.ref === ref)).toBe(false);
    expect(two.trace.read().map(entry => entry.event)).toEqual(["resolved"]);
    expect(one.trace.read().map(entry => entry.event)).toEqual(["failure"]);
  });
});

describe("the rolling detail window", () => {
  test("bounded by time and size, redacted, and diagnostic mode lapses by itself", () => {
    let now = Date.parse("2026-09-26T00:00:00Z");
    const window = new TraceWindow(join(root, "trace"), () => now);
    window.event("character", "resolved", { path: `C:\\Users\\${WHO}\\Games\\x`, archive: "hair.archive" });
    window.flush();
    expect(personalDataIn(JSON.stringify(window.read()))).toBeNull();
    expect(window.read()).toHaveLength(1);
    now += (TRACE_BOUNDS.normal.minutes + 10) * 60_000;
    window.event("character", "prepared", { record: "x.json" });
    window.flush();
    expect(window.read().map(entry => entry.event)).toEqual(["prepared"]);
    for (let i = 0; i < 40; i++) { now += 1_000; window.event("resolver", "read", { blob: "y".repeat(300_000) }); window.flush(); }
    expect(window.bytes()).toBeLessThanOrEqual(TRACE_BOUNDS.normal.bytes + 600_000);
    expect(window.setMode("deep")).toMatchObject({ mode: "deep", minutes: TRACE_BOUNDS.deep.minutes });
    expect(new TraceWindow(join(root, "trace"), () => now).mode).toBe("deep");
    now += 25 * 3_600_000;
    expect(window.mode).toBe("normal");
    expect(new TraceWindow(join(root, "trace"), () => now).mode).toBe("normal");
  });
});

describe("the host endpoint", () => {
  const dataRoot = join(root, "endpoint");
  const diagnostics = hostDiagnosticsAt(dataRoot);
  const settings = { ...defaultLocalSettings(), gameRoot: join(root, "game-jdoe") };
  const handler = createDiagnosticsHandler(diagnostics, { app: () => ({ version: "0.1.0", commit: "abc1234", channel: null, host: "localhost" }),
    settings: () => settings, roots: () => [{ label: "<data>", path: dataRoot }], testHook: true });
  const serve = withRequestDiagnostics(diagnostics, handler);
  const origin = "http://127.0.0.1:4317";
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => serve(new Request(`${origin}/api/diagnostics/${path}`,
    { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  test("a host failure becomes a plain 500 carrying a reference that names its log entry", async () => {
    const response = await post("test-failure", {});
    expect(response.status).toBe(500);
    const ref = response.headers.get(ERROR_REF_HEADER)!;
    expect(isErrorRef(ref)).toBe(true);
    expect((await response.json()).ref).toBe(ref);
    const entry = diagnostics.log.tail(20).find(item => item.ref === ref)!;
    expect(entry).toMatchObject({ level: "error", area: "server", code: "unhandled" });
    expect(entry.details?.stack).toContain("deliberate host failure");
  });
  test("writes need the Studio's origin and JSON; forwards are size-capped and rate-limited", async () => {
    expect((await post("entries", {}, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post("entries", "x", { "Content-Type": "text/plain" })).status).toBe(403);
    expect((await post("entries", "x".repeat(DIAGNOSTIC_LIMITS.body + 1))).status).toBe(413);
    const entry = { level: "error", area: "notice", code: "failed", message: "Build failed", ref: "XF-7K3Q" };
    expect((await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: [entry] })).status).toBe(204);
    const kept = diagnostics.log.tail(10).find(item => item.ref === "XF-7K3Q")!;
    // Linked to the host failure a moment before.
    expect(kept.details?.related?.length).toBeGreaterThan(0);
    for (let i = 0; i < 8; i++)
      expect((await post("entries", { schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: Array(10).fill({ ...entry, ref: undefined, message: `flood ${i}` }) })).status).toBe(204);
    const flood = diagnostics.log.tail(200).filter(item => item.message.startsWith("flood"));
    expect(flood.length).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.perMinute);
  });
  test("a report holds the entry for its reference and nothing the shared rules flag, and saves as one ZIP", async () => {
    const ref = diagnostics.log.failure("character", "details_failed", `Failed: ${everyVector}`, Error(`at ${vectors.userPath[0]}`));
    diagnostics.trace.event("character", "resolved", { appearances: [{ app: { ref: { hash: "123", path: "base\\x.app" }, status: "archive",
      archive: "basegame_4_appearance.archive", provider: "Installed game", group: "content", alternatives: [] } }], note: everyVector });
    const prepared = await post("report", { ref });
    expect(prepared.status).toBe(200);
    const manifest = await prepared.json() as ReportManifest;
    expect(manifest.problem.map(entry => entry.ref)).toContain(ref);
    expect(manifest.items.map(item => item.id)).toEqual(expect.arrayContaining(["environment", "settings", "problem", "log", "trace", "winners"]));
    expect(manifest.items.every(item => item.group !== "optional" || !item.included)).toBe(true);
    expect(reportLeaks(JSON.stringify(manifest))).toBe(false);
    const page = { facts: { browser: "Chrome 140", gpu: "ANGLE", webgl2: true, state: { note: vectors.email[0]! } },
      items: [{ id: "activity", label: "Recent messages", detail: "", content: [{ message: vectors.userPath[3] }] }] };
    const bundle = await post("bundle", { id: manifest.id, include: [...manifest.items.filter(item => item.included).map(item => item.id), "activity"],
      description: `I was loading ${vectors.userPath[1]}`, page });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("Content-Type")).toBe("application/zip");
    const files = unzip(new Uint8Array(await bundle.arrayBuffer()));
    expect([...files.keys()]).toEqual(expect.arrayContaining(["README.md", "report.json", "happened/problem.json", "happened/activity.json"]));
    const all = [...files.values()].map(bytes => new TextDecoder().decode(bytes)).join("\n");
    expect(all).toContain(ref);
    expect(reportLeaks(all)).toBe(false);
    expect(new TextDecoder().decode(files.get("README.md"))).toContain("I was loading");
    // A report expires with the host's memory of it; a malformed page part is refused.
    expect((await post("bundle", { id: "gone", include: [] })).status).toBe(409);
    expect((await post("bundle", { id: manifest.id, include: [], page: { items: [{ id: "arbitrary", content: 1 }] } })).status).toBe(400);
  });
  test("diagnostic mode switches through the endpoint", async () => {
    const on = await post("mode", { mode: "deep" });
    expect(await on.json()).toMatchObject({ mode: "deep" });
    expect(await (await post("mode", { mode: "normal" })).json()).toMatchObject({ mode: "normal" });
    expect((await post("mode", { mode: "loud" })).status).toBe(400);
  });
});

describe("mods involved, for reproduction without their files", () => {
  test("MO2 mods with Nexus IDs are re-downloadable; a small local-only mod may be offered, never by default", async () => {
    const mo2 = join(root, "mo2");
    for (const [name, meta] of [["Hair Pack", "[General]\nmodid=12345\nfileid=67890\nversion=1.2.0\ninstallationFile=Hair Pack-12345-1-2.zip\nrepository=Nexus\n"],
      ["My Tweaks", "[General]\nversion=0.1\n"]] as const) {
      mkdirSync(join(mo2, "mods", name, "archive", "pc", "mod"), { recursive: true });
      writeFileSync(join(mo2, "mods", name, "meta.ini"), meta);
    }
    writeFileSync(join(mo2, "mods", "Hair Pack", "archive", "pc", "mod", "hair.archive"), "hair");
    writeFileSync(join(mo2, "mods", "My Tweaks", "archive", "pc", "mod", "tweak.archive"), "tweak");
    const settings = { ...defaultLocalSettings(), gameRoot: join(root, "game"), launchRoute: "mo2" as const, mo2Root: mo2, mo2ProfileId: "Default" };
    const mods = await involvedMods([
      { archive: "hair.archive", provider: "Hair Pack", group: "mod", alternatives: ["tweak.archive (mod, My Tweaks)"] },
      { archive: "basegame_4_appearance.archive", provider: "Installed game", group: "content", alternatives: [] },
    ], settings);
    const byName = new Map(mods.map(mod => [mod.name, mod]));
    expect(byName.get("Hair Pack")).toMatchObject({ kind: "mo2-mod", status: "re-downloadable", version: "1.2.0",
      source: { site: "nexusmods", modId: "12345", fileId: "67890", installationFile: "Hair Pack-12345-1-2.zip" } });
    expect(byName.get("Hair Pack")!.archives[0]).toMatchObject({ name: "hair.archive", bytes: 4, won: 1,
      sha256: new Bun.CryptoHasher("sha256").update("hair").digest("hex") });
    expect(byName.get("My Tweaks")).toMatchObject({ status: "local-only", archives: [{ name: "tweak.archive", lost: 1 }] });
    expect(byName.get("Cyberpunk 2077 (the game's own files)")).toMatchObject({ status: "base-game" });
  });

  test("Vortex mods: Nexus IDs from Vortex's state, else the staging name's mod ID only when it follows Nexus's naming", async () => {
    const game = join(root, "vortex-game"), appData = join(root, "vortex-appdata"), mod = join(game, "archive", "pc", "mod");
    mkdirSync(mod, { recursive: true });
    // Vortex's files carry the time the manifest records (VORTEX-03); the hand-placed one doesn't.
    const deployedMs = 1727000000000;
    for (const name of ["hair.archive", "tweak.archive", "odd.archive", "hand.archive"]) {
      writeFileSync(join(mod, name), name);
      if (name !== "hand.archive") utimesSync(join(mod, name), deployedMs / 1000, deployedMs / 1000);
    }
    const files = [["hair.archive", "Hair Pack-12345-1-2-1727000000"], ["tweak.archive", "My Tweaks-54321-1-0-1727000001"], ["odd.archive", "Cool Hair-1-2-3"]]
      .map(([file, source]) => ({ relPath: `archive\\pc\\mod\\${file}`, source, time: deployedMs }));
    writeFileSync(join(game, "vortex.deployment.json"), JSON.stringify({ version: 1, instance: "i1", gameId: "cyberpunk2077", files }));
    const state = { app: { instanceId: "i1" }, settings: { profiles: { activeProfileId: "p" } },
      persistent: { profiles: { p: { gameId: "cyberpunk2077", modState: { "Hair Pack-12345-1-2-1727000000": { enabled: true } } } },
        mods: { cyberpunk2077: { "Hair Pack-12345-1-2-1727000000": { installationPath: "Hair Pack-12345-1-2-1727000000",
          attributes: { logicalFileName: "Hair Pack", version: "1.2", modId: 12345, fileId: 67890, source: "nexus", downloadGame: "cyberpunk2077" } } } } } };
    mkdirSync(join(appData, "Vortex", "temp", "state_backups_full"), { recursive: true });
    writeFileSync(join(appData, "Vortex", "temp", "state_backups_full", "hourly.json"), JSON.stringify(state));
    const settings = { ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" as const };
    // Source discovery names a Vortex-deployed provider after its staging folder; a file Vortex didn't deploy stays "Installed game".
    const mods = await involvedMods([
      { archive: "hair.archive", provider: "Hair Pack-12345-1-2-1727000000", group: "mod", alternatives: ["tweak.archive (mod, My Tweaks-54321-1-0-1727000001)"] },
      { archive: "odd.archive", provider: "Cool Hair-1-2-3", group: "mod", alternatives: ["hand.archive (mod, Installed game)"] },
    ], settings, name => name === "APPDATA" ? appData : undefined);
    const byName = new Map(mods.map(row => [row.name, row]));
    expect(byName.get("Hair Pack")).toMatchObject({ kind: "vortex-mod", version: "1.2", status: "re-downloadable",
      source: { site: "nexusmods", modId: "12345", fileId: "67890" }, archives: [{ name: "hair.archive", bytes: 12, won: 1 }] });
    expect(byName.get("My Tweaks-54321-1-0-1727000001")).toMatchObject({ kind: "vortex-mod", status: "findable",
      source: { site: "vortex", staging: "My Tweaks-54321-1-0-1727000001", modId: "54321" } });
    // A name without Nexus's upload-time suffix yields no guessed mod ID.
    expect(byName.get("Cool Hair-1-2-3")).toMatchObject({ kind: "vortex-mod", status: "local-only", source: { site: "vortex", modId: null } });
    // A game-folder file Vortex didn't deploy is its own entry, not one "Installed game" mod (DIAG-05).
    expect(byName.get("hand.archive (in the game folder)")).toMatchObject({ kind: "game-folder", source: null, archives: [{ name: "hand.archive", identifiedBy: "sha-256" }] });
  });
});

describe("the diagnostics actions", () => {
  const forwarded: unknown[] = [];
  const manifest: ReportManifest = { schema: "xfs/problem-report-manifest-1", id: "r1", ref: "XF-7K3Q", made: "2026-09-26T00:00:00.000Z",
    facts: { app: { version: "0.1.0", commit: null, channel: null, host: "localhost" }, os: "Windows", runtime: "Bun", webView2: null,
      game: { version: null, found: false }, launchRoute: "game folder", frameworks: null, wolvenKit: { version: null, source: "not ready" } },
    problem: [], recent: [], limits: { total: 1_000, modFiles: 500 }, window: { mode: "normal", minutes: 30, until: null },
    items: [{ id: "log", group: "happened", label: "Log", detail: "", bytes: 100, included: true, preview: "" },
      { id: "mod-file:0", group: "optional", label: "Files", detail: "", bytes: 400, included: false, modFiles: true, preview: "" },
      { id: "resources-full", group: "optional", label: "Full", detail: "", bytes: 800, included: false, preview: "" }] };
  const saved: string[] = [];
  const device: DiagnosticsDevice = {
    forward: entries => { forwarded.push(...entries); }, pending: () => [], claimHostRef: () => null,
    pageFacts: () => ({ browser: "Chrome", gpu: null, webgl2: true, state: {} }), state: async () => null,
    setMode: async mode => ({ mode, until: null, minutes: 30 }), prepare: async () => structuredClone(manifest), item: async () => "full",
    bundle: async () => new Uint8Array(10), save: name => { saved.push(name); }, copy: async () => {}, openIssue: async () => {},
  };
  test("notices: a reference only for unexpected failures, logged once", () => {
    const actions = new DiagnosticsActions(device);
    expect(actions.notice({ source: "Library", message: "Busy.", code: "busy" })).toBeNull();
    const ref = actions.notice({ source: "Mod package", message: `Build failed in ${vectors.userPath[0]}`, code: "package_build_failed" });
    expect(isErrorRef(ref)).toBe(true);
    expect(forwarded).toHaveLength(1);
    expect(personalDataIn(JSON.stringify(forwarded))).toBeNull();
    actions.uncaught("error", Error("x"), "ResizeObserver loop completed with undelivered notifications.");
    expect(forwarded).toHaveLength(1);
  });
  test("review: mod files need the sharing confirmation, the total its limit; saving saves the ticked items", async () => {
    const actions = new DiagnosticsActions(device);
    expect(actions.capability({ kind: "diagnostics.saveReport" }).available).toBe(false);
    expect((await actions.dispatch({ kind: "diagnostics.prepareReport", ref: "XF-7K3Q" })).ok).toBe(true);
    expect(actions.capability({ kind: "diagnostics.setIncluded", item: "mod-file:0", included: true })).toMatchObject({ available: false, code: "needs_input" });
    await actions.dispatch({ kind: "diagnostics.confirmSharing", confirmed: true });
    expect((await actions.dispatch({ kind: "diagnostics.setIncluded", item: "mod-file:0", included: true })).ok).toBe(true);
    expect(actions.capability({ kind: "diagnostics.setIncluded", item: "resources-full", included: true })).toMatchObject({ available: false, code: "limit" });
    expect(actions.snapshot().report!.totalSize).toContain("of");
    expect((await actions.dispatch({ kind: "diagnostics.saveReport" })).ok).toBe(true);
    expect(saved[0]).toMatch(/^xf-studio-report-XF-7K3Q-.*\.zip$/);
    await actions.dispatch({ kind: "diagnostics.confirmSharing", confirmed: false });
    expect(actions.snapshot().report!.groups.flatMap(group => group.items).find(item => item.id === "mod-file:0")!.included).toBe(false);
  });
  test("the issue link fits and carries only the short summary", () => {
    const url = issueUrl("Problem report XF-7K3Q", "x".repeat(20_000), undefined);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(url).toStartWith("https://github.com/axefrog/xf-studio/issues/new?");
  });
});

test("the ZIP writer's CRC and layout", () => {
  expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  const files = unzip(zip([{ name: "a/b.txt", data: "hello ".repeat(100) }, { name: "c.bin", data: new Uint8Array([1, 2, 3]) }]));
  expect(new TextDecoder().decode(files.get("a/b.txt"))).toBe("hello ".repeat(100));
  expect([...files.get("c.bin")!]).toEqual([1, 2, 3]);
  expect(() => zip([{ name: "../x", data: "" }])).toThrow();
});
