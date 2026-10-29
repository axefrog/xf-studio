import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CharacterDetailHost, type CharacterDetailSettings } from "../src/character/host/character-detail-host";
import { PreparedAnswers } from "../src/character/host/prepared-answers";
import { InstallationRegistry, installationRouteKey, installations } from "../src/game/host/installation-registry";
import { currentStamp } from "../src/game/host/installation-snapshot";
import { openInstallation } from "../src/game/host/resolver-host";
import { pathStamp } from "../src/game/host/source-discovery";
import { CHARACTER_DETAIL_SCHEMA } from "../src/character/render-detail";
import { REQUEST_A } from "./character-detail-fixtures";
import { tempDir } from "./temp-dir";

const record = "a".repeat(64) + ".json", freshRecord = "b".repeat(64) + ".json";
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Test deadline")), 1000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Real kept-file validation and installation single flight; only native opening and the preparation result are held/faked. */
async function fixture() {
  const root = tempDir("xfs-kept-overlap-"), cacheRoot = join(root, "cache"), archive = join(root, "game", "archive", "pc", "mod", "hair.archive");
  put(archive, "archive identity");
  const cli = join(root, "WolvenKit.CLI.exe"); put(cli, "test tool");
  let settings: CharacterDetailSettings = { gameRoot: join(root, "game"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
    manualModRoot: null, wolvenKitCli: cli };
  const route = { ...settings, gameRoot: settings.gameRoot! }, stored = join(cacheRoot, "characters", "records", record);
  put(stored, "{}");
  const entered = Promise.withResolvers<void>(), open = Promise.withResolvers<void>(), checked = Promise.withResolvers<void>(), verify = Promise.withResolvers<void>();
  let failCheck = false, preparations = 0;
  const answers = new PreparedAnswers(join(cacheRoot, "answers"), { code: async () => "test code", recordSchema: CHARACTER_DETAIL_SCHEMA,
    recordExists: name => existsSync(join(cacheRoot, "characters", "records", name)), stamp: async path => {
      checked.resolve(); await verify.promise;
      if (failCheck) throw Error("Cannot inspect the installation");
      return currentStamp(path);
    } });
  await answers.remember(installationRouteKey(route), REQUEST_A, { record, message: "kept" }, [{ path: archive, stamp: pathStamp(statSync(archive)) }]);
  const find = spyOn(answers, "find");
  const registry = new InstallationRegistry({ snapshots: false, open: openInstallation,
    openNative: async () => { entered.resolve(); await open.promise; return { decoder: null, reason: "Test native reader", permanent: true }; } });
  const revalidate = spyOn(installations, "revalidate").mockImplementation(route => registry.revalidate(route));
  const generation = spyOn(installations, "generation").mockImplementation(route => registry.generation(route));
  const host = new CharacterDetailHost({ cacheRoot, settings: () => settings, keptAnswers: answers,
    prepare: async () => { preparations++; return { record: {} as never, recordFile: freshRecord, degraded: false }; } });
  const opening = registry.acquire({ ...route, cacheDir: join(root, "resolver") });
  await within(entered.promise);
  return { host, find, revalidate, checked, verify, open, archive,
    preparations: () => preparations, failCheck: () => { failCheck = true; },
    dropRecord: () => rmSync(stored),
    changeTool: () => put(cli, "a different tool identity"),
    changeRoute: () => { settings = { ...settings, gameRoot: join(root, "other-game") }; },
    async close(reads: readonly Promise<unknown>[]) {
      open.resolve(); verify.resolve();
      try { await within(Promise.allSettled([opening, ...reads])); }
      finally {
        host.cancel(); host.jobs.release("host/warm-up");
        try { await within(host.settled()); }
        finally { registry.clear(); find.mockRestore(); revalidate.mockRestore(); generation.mockRestore(); }
      }
    } };
}

for (const first of ["warm", "authoritative"] as const) test(`overlapping ${first}-first kept requests both answer before archive opening completes`, async () => {
  const f = await fixture();
  const warm = () => f.host.known(REQUEST_A, "warm-start"), authoritative = () => f.host.answer(REQUEST_A, "page");
  const one = first === "warm" ? warm() : authoritative();
  const pending = [one];
  try {
    await within(f.checked.promise);
    const two = first === "warm" ? authoritative() : warm(); pending.push(two);
    f.verify.resolve();
    const states = await within(Promise.all(pending)); // Native opening is still unresolved, so refresh cannot answer for us.
    expect(states).toEqual([expect.objectContaining({ phase: "ready", record, message: "kept" }), expect.objectContaining({ phase: "ready", record, message: "kept" })]);
    expect(f.find).toHaveBeenCalledTimes(1);
    expect(f.revalidate).not.toHaveBeenCalled();
    expect(f.preparations()).toBe(0);
    // Keep the existing fresh-authoritative-answer policy, but an ordinary page reload still revalidates the installation.
    expect((await within(authoritative())).record).toBe(record);
    expect(f.revalidate).not.toHaveBeenCalled();
    const reload = warm(); pending.push(reload);
    expect(f.revalidate).toHaveBeenCalledTimes(1);
    f.open.resolve();
    expect((await within(reload)).record).toBe(record);
  } finally { await f.close(pending); }
});

for (const refusal of ["changed archive", "failed verification", "changed route", "changed tool", "removed record"] as const) test(`overlapping kept requests refuse a ${refusal}`, async () => {
  const f = await fixture();
  const warm = f.host.known(REQUEST_A, "warm-start"), authoritative = f.host.answer(REQUEST_A, "page");
  try {
    await within(f.checked.promise);
    if (refusal === "changed archive") put(f.archive, "a changed archive identity");
    else if (refusal === "failed verification") f.failCheck();
    else if (refusal === "changed tool") f.changeTool();
    else if (refusal === "removed record") f.dropRecord();
    else {
      f.changeRoute();
      // A different installation must not join the old route's pending check.
      expect((await within(f.host.known(REQUEST_A, "other-page"))).phase).toBe("unknown");
    }
    f.verify.resolve();
    expect((await within(warm)).phase).toBe("unknown");
    f.open.resolve();
    expect((await within(authoritative)).record).not.toBe(record);
    await within(f.host.settled());
    expect(f.preparations()).toBe(1);
    expect(f.find).toHaveBeenCalledTimes(refusal === "changed route" ? 2 : 1);
  } finally { await f.close([warm, authoritative]); }
});
