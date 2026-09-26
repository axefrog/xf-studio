import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailHost, type CharacterDetailSettings } from "../src/character-detail-host";
import { CharacterDetailActions, type CharacterDetailPort } from "../src/character-detail-actions";
import { CharacterDetailError } from "../src/character-detail-service";
import { createCharacterDetailHandler } from "../src/character-detail-server";
import { createBrowserCharacterDetailDevice } from "../src/browser-character-detail-device";
import { CHARACTER_DETAIL_SCHEMA } from "../src/render-detail";
import type { CharacterRequest } from "../src/character-detail-request";
import { REQUEST_A, REQUEST_B } from "./character-detail-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-character-pages-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const settings: CharacterDetailSettings = { gameRoot: join(root, "game"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
  manualModRoot: null, wolvenKitCli: process.execPath };
const name = (request: CharacterRequest) => request.source === "save" ? request.appearances[0]!.option : "default";

/** A host whose preparation takes `ms`, notices a cancel a little later (like a WolvenKit export in progress) and logs each step. */
function slowHost(log: string[], ms = 60) {
  let running = 0, overlap = 0;
  const host = new CharacterDetailHost({ cacheRoot: join(root, `host-${Math.random().toString(36).slice(2)}`), settings: () => settings,
    prepare: options => new Promise((resolve, reject) => {
      const who = name(options.request);
      overlap = Math.max(overlap, ++running);
      log.push(`start ${who}`);
      const done = setTimeout(() => { running--; log.push(`finish ${who}`);
        resolve({ record: {} as never, recordFile: `${(who === "default" ? "d" : "e").repeat(64)}.json`, degraded: false }); }, ms);
      options.signal?.addEventListener("abort", () => setTimeout(() => {
        clearTimeout(done); running--; log.push(`cancelled ${who}`);
        reject(new CharacterDetailError("character_cancelled", "cancelled"));
      }, 5));
    }) });
  return { host, overlap: () => overlap };
}

/** One open page's port onto the host: it asks as that page, polls, and "shows" a record at once. */
function pagePort(host: CharacterDetailHost, page: string): CharacterDetailPort {
  return {
    request: async request => host.request(request, page),
    poll: async key => host.state(key),
    show: async () => ({ slots: [] }),
    clear() {},
    wait: (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(resolve, 5);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}
const within = <T>(work: Promise<T>, ms: number) => Promise.race([work, new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), ms))]);

// PIPE-103: two open pages (the person's own tab and a `?verify=1` tab, or a stale tab left open) following different Vs used to cancel
// each other forever: each page's request superseded the other's preparation, whose page then saw `unknown` and asked again.
describe("two open pages on one host", () => {
  test("each page's V is prepared to the end; neither cancels the other's", async () => {
    const log: string[] = [];
    const { host, overlap } = slowHost(log);
    const first = new CharacterDetailActions(pagePort(host, "page-1")), second = new CharacterDetailActions(pagePort(host, "page-2"));
    const both = Promise.all([first.setCharacter(REQUEST_A), second.setCharacter(REQUEST_B)]);
    expect(await within(both, 3000)).not.toBe("timeout");
    expect(first.snapshot().phase).toBe("ready");
    expect(second.snapshot().phase).toBe("ready");
    // One after the other, never overlapping on the shared cache, and neither started over.
    expect(log).toEqual(["start skin_type_01", "finish skin_type_01", "start skin_type_03", "finish skin_type_03"]);
    expect(overlap()).toBe(1);
    first.dispose(); second.dispose();
  });

  // NATIVE-47's re-ask while a V waits for WolvenKit: one page asking again every few seconds never cancels another page's V.
  test("a page asking again while its V waits for WolvenKit leaves another page's preparation to finish", async () => {
    const log: string[] = [];
    let running = 0, overlap = 0;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host-need"), settings: () => settings,
      prepare: options => new Promise((resolve, reject) => {
        const who = name(options.request);
        overlap = Math.max(overlap, ++running);
        log.push(`start ${who}`);
        // Page 2's V finds WolvenKit unable to run (a need, re-asked by its page); page 1's V takes a while.
        const done = setTimeout(() => { running--;
          if (who === "skin_type_03") { log.push(`needs ${who}`); reject(new CharacterDetailError("character_tool_missing", "WolvenKit can't run.")); return; }
          log.push(`finish ${who}`); resolve({ record: {} as never, recordFile: `${"f".repeat(64)}.json`, degraded: false }); }, who === "skin_type_03" ? 5 : 150);
        options.signal?.addEventListener("abort", () => { clearTimeout(done); running--; log.push(`cancelled ${who}`);
          reject(new CharacterDetailError("character_cancelled", "cancelled")); });
      }) });
    const waiting = new CharacterDetailActions(pagePort(host, "page-2"));
    void waiting.setCharacter(REQUEST_B);
    await new Promise(resolve => setTimeout(resolve, 20));
    const first = new CharacterDetailActions(pagePort(host, "page-1"));
    expect(await within(first.setCharacter(REQUEST_A), 3000)).not.toBe("timeout");
    expect(first.snapshot().phase).toBe("ready");
    waiting.dispose(); first.dispose();
    await host.settled();
    expect(log).toContain("finish skin_type_01");
    expect(log.filter(line => line === "cancelled skin_type_01")).toEqual([]);
    expect(overlap).toBe(1);
  });

  test("a page still supersedes its own earlier V (a quick V1 -> V2 finishes only V2), without touching another page's", async () => {
    const log: string[] = [];
    const { host } = slowHost(log);
    const a1 = host.request(REQUEST_A, "page-1");
    const other = host.request({ ...REQUEST_B, body: false } as CharacterRequest, "page-2");
    const b1 = host.request(REQUEST_B, "page-1");
    await host.settled();
    expect(host.state(a1.key).phase).toBe("unknown");
    expect(host.state(b1.key).phase).toBe("ready");
    expect(host.state(other.key).phase).toBe("ready");
    expect(log.filter(line => line.startsWith("cancelled"))).toEqual(["cancelled skin_type_01"]);
  });

  test("two pages on the same V share one preparation", async () => {
    const log: string[] = [];
    const { host } = slowHost(log);
    const one = host.request(REQUEST_A, "page-1"), two = host.request(REQUEST_A, "page-2");
    expect(two).toMatchObject({ key: one.key, phase: "preparing" });
    await host.settled();
    expect(host.state(one.key).phase).toBe("ready");
    expect(log).toEqual(["start skin_type_01", "finish skin_type_01"]);
  });

  test("the browser device names its page, and the endpoint hands it to the host", async () => {
    const seen: (string | undefined)[] = [];
    const fake = { request: (_request: CharacterRequest, page?: string) => { seen.push(page); return { schema: "xfs/character-detail-state-1",
      recordSchema: CHARACTER_DETAIL_SCHEMA, key: "a".repeat(32), phase: "preparing", message: "", progress: null, record: null }; },
      refresh: async () => {} };
    const handler = createCharacterDetailHandler(fake as never);
    const scene = { setCharacterDetails: () => null, details: { load: async () => { throw Error("unused"); } } };
    const device = createBrowserCharacterDetailDevice(scene as never, (url, init) =>
      handler(new Request(`http://127.0.0.1${url}`, { ...init, headers: { ...init?.headers as Record<string, string>, Origin: "http://127.0.0.1" } })));
    const again = createBrowserCharacterDetailDevice(scene as never, (url, init) =>
      handler(new Request(`http://127.0.0.1${url}`, { ...init, headers: { ...init?.headers as Record<string, string>, Origin: "http://127.0.0.1" } })));
    const signal = new AbortController().signal;
    await device.request(REQUEST_A, signal);
    await device.request(REQUEST_B, signal);
    await again.request(REQUEST_A, signal);
    expect(seen[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[0]);
    // A request without a page name (a tool, an older page) is one anonymous page, as before.
    await handler(new Request("http://127.0.0.1/api/preview-character", { method: "POST", body: JSON.stringify(REQUEST_A),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" } }));
    await handler(new Request("http://127.0.0.1/api/preview-character", { method: "POST", body: JSON.stringify(REQUEST_A),
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1", "X-XFS-Page": "../not a page" } }));
    expect(seen.slice(3)).toEqual(["", ""]);
  });
});
