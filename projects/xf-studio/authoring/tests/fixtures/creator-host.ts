/**
 * A creator host over the fixture catalogue for tests that need characters with a real catalogue: the host's answers for both bodies, its
 * own choice prefetcher on a real scheduler, and what it was asked and told to stop.
 */
import { CatalogueIndex } from "../../src/character/cc-catalogue";
import { choicePage, panelProjection, searchChoices } from "../../src/character/cc-panel";
import { catalogueCoverage } from "../../src/character/cc-render-coverage";
import { deriveCharacter } from "../../src/character/character-context";
import type { CreatorPort } from "../../src/character/character-context-actions";
import { ChoicePrefetcher } from "../../src/character/choice-prefetch";
import { createJobScheduler } from "../../src/platform/core/jobs";
import { hostClock } from "../../src/platform/core/clock";
import { fixtureSource } from "../cc-fixtures";

/**
 * A host over the fixture catalogue for both bodies (each its own catalogue identity), logging every question it is asked and every one
 * stopped, and holding its answers while `held` is on.
 */
export async function fixtureHost() {
  const source = await fixtureSource(true);
  const index = new CatalogueIndex(source.catalogue), coverage = catalogueCoverage(source.catalogue);
  const projection = { female: panelProjection(source.catalogue, coverage, "fixture-female"), male: panelProjection(source.catalogue, coverage, "fixture-male") };
  const asked: string[] = [], stopped: string[] = [];
  const stops: string[] = [], warmed: string[] = [];
  let holding = false;
  const held: (() => void)[] = [];
  const prefetcher = new ChoicePrefetcher({
    jobs: createJobScheduler({ clock: hostClock(), quietMs: 0 }),
    requestFor: async (base, option, position) => ({ ...base, choices: [...base.choices ?? [], { part: "head", option: option.split("/")[1]!, choice: `c${position}` }] }),
    readiness: async () => () => false,
    warm: async requests => {
      warmed.push(...requests.map(request => `${request.bodyGender}:${request.choices!.at(-1)!.choice}`));
      await new Promise(resolve => setTimeout(resolve, 1));
      return requests.map(() => ({ ready: true }));
    },
    preparedBytes: async () => 0,
  }, { batch: 2, maxBatch: 2, timeMs: 60_000, bytes: 1e12 });
  const gate = <T>(label: string, signal: AbortSignal | undefined, make: () => T) => new Promise<T>((resolve, reject) => {
    asked.push(label);
    signal?.addEventListener("abort", () => { stopped.push(label); reject(new DOMException("Stopped.", "AbortError")); }, { once: true });
    const answer = () => { if (!signal?.aborted) resolve(make()); };
    if (holding) held.push(answer); else queueMicrotask(answer);
  });
  const port: CreatorPort = {
    panel: (gender, signal) => gate(`panel:${gender}`, signal, () => ({ phase: "ready" as const, message: "", panel: structuredClone(projection[gender].panel) })),
    page: (gender, option, offset, signal, query) => gate(`page:${gender}:${option}:${offset}:${query ?? ""}`, signal,
      () => choicePage(index, projection[gender].mods, option, offset, { identity: `fixture-${gender}`, ...(query ? { query } : {}) })!),
    search: (gender, query, signal) => gate(`search:${gender}:${query}`, signal, () => searchChoices(index, query, `fixture-${gender}`)),
    view: (request, signal) => gate(`view:${request.bodyGender}`, signal, () => {
      const saved = request.source === "save" ? { appearances: request.appearances, morphs: request.morphs } : null;
      const { view } = deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? []);
      const values = Object.fromEntries(Object.entries(view.values).map(([id, value]) => [id, { ...value, label: value.choice, color: null, ownLabel: value.own }]));
      return { ...view, identity: `fixture-${request.bodyGender}`, values, faceMorphs: [] };
    }),
    preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }),
    wait: (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, Math.min(ms, 2)); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }); }),
    // The host's own prefetcher (choice-prefetch.ts) on a real scheduler: each requester's row is its own job there.
    prefetch: async (request, option, positions, focus, _signal, requester) => {
      const answer = prefetcher.update({ base: request, option, positions, focus, ...(requester ? { requester } : {}) });
      return { states: answer.states, stopped: answer.stopped === "failed" ? null : answer.stopped, busy: answer.busy };
    },
    stopPrefetch: async requester => { stops.push(requester ?? "(all)"); prefetcher.cancel(requester); },
  };
  return { port, asked, stopped, source, stops, prefetcher, warmed,
    hold() { holding = true; }, release() { holding = false; for (const answer of held.splice(0)) answer(); } };
}
