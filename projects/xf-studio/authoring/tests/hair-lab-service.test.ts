import { expect, test } from "bun:test";
import { Aborter, MemoryStore } from "strata";
import { Scheduler, seededRandom, simClock, settle } from "strata/testing";
import { createExperiments } from "../src/platform/core/experiments";
import { createHairLab, type Generation, type GenerationDevice } from "../src/features/hair-lab/service";
import { defaultGroom } from "../src/features/hair-lab/groom";
import { sphereSurface } from "./hair-lab-domain.test";

test("scene jobs pre-empt, reject late results, preserve independent documents and support Undo/Redo", async () => {
  const life = new Aborter(), platform = await createExperiments({ sources: { clock: simClock(new Scheduler()), random: seededRandom(1) },
    store: new MemoryStore(), signal: life.signal, definitions: [], overrides: {} });
  const jobs: { target: string; aborted(): boolean; publish(result: Generation): void; finish(): void }[] = [];
  const device: GenerationDevice = { generate(target, _surface, _groom, signal, publish) { return new Promise<void>(resolve => {
    jobs.push({ target, aborted: () => signal.aborted, publish, finish: resolve }); signal.addEventListener("abort", () => resolve());
  }); } };
  const lab = createHairLab(platform.context, device), head = sphereSurface(), a = new Aborter(life.signal), b = new Aborter(life.signal);
  lab.bind("a", head, a.signal); lab.bind("b", { ...head, resource: "another-head" }, b.signal);
  expect(jobs).toHaveLength(0);
  await lab.facade.dispatch({ kind: "hairLab.activate", target: "a", active: true });
  await lab.facade.dispatch({ kind: "hairLab.activate", target: "b", active: true }); await settle();
  expect(jobs.map(j => j.target)).toEqual(["a", "b"]);
  const generation = (resource = head): Generation => ({ groom: defaultGroom(resource), paths: { paths: [] }, stage: "coarse", residuals: null, milliseconds: {} });
  jobs[0].publish(generation()); jobs[1].publish(generation({ ...head, resource: "another-head" })); await settle();
  const original = lab.session("a")!.document!;
  expect(lab.session("b")!.document).not.toEqual(original);
  await lab.facade.dispatch({ kind: "hairLab.set", target: "a", field: "length", value: .60 }); await settle();
  expect(jobs[0].aborted()).toBe(true); expect(jobs[1].aborted()).toBe(false); expect(jobs).toHaveLength(3);
  jobs[0].publish(generation()); expect(lab.session("a")!.result).toBeNull();
  expect((platform.context.graph.resolve(original, ["document"]) as any).fields.length.value).toBe(.60);
  await lab.facade.dispatch({ kind: "hairLab.undo", target: "a" });
  expect((platform.context.graph.resolve(original, ["document"]) as any).fields.length.value).toBe(.55);
  await lab.facade.dispatch({ kind: "hairLab.redo", target: "a" });
  expect((platform.context.graph.resolve(original, ["document"]) as any).fields.length.value).toBe(.60);
  await lab.facade.dispatch({ kind: "hairLab.preview", target: "a", display: "scalp" });
  expect(lab.session("a")!.display).toBe("scalp");
  await lab.facade.dispatch({ kind: "hairLab.preview", target: "a", display: "reference-scalp" });
  expect(lab.session("a")!.display).toBe("reference-scalp");
  expect((platform.context.graph.resolve(original, ["document"]) as any).fields.length.value).toBe(.60);
  lab.withdraw(); await settle();
  expect(lab.facade.snapshot().sessions.every(s => !s.active && s.result === null)).toBe(true);
  expect(jobs.every(j => j.aborted())).toBe(true);
  life.abort();
});
