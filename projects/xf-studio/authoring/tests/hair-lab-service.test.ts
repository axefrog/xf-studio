import { expect, test } from "bun:test";
import { seededRandom } from "../src/platform/core/random";
import { createExperiments } from "../src/platform/core/experiments";
import { createHairLab, HAIR_GROOM_KIND, type Generation, type GenerationDevice } from "../src/features/hair-lab/service";
import { settle, storeDocuments } from "./fixtures/platform-doubles";
import { defaultGroom, scalpSeedSurface } from "../src/features/hair-lab/groom";
import { sampleRoots } from "../src/features/hair-lab/groom";
import { coarsePaths } from "../src/features/hair-lab/solve";
import { sphereSurface } from "./hair-lab-domain.test";

/** A controller that also aborts with `parent`. */
const child = (parent: AbortSignal) => { const controller = new AbortController(); parent.addEventListener("abort", () => controller.abort(), { once: true }); return controller; };

test("re-derived scalp seeds do not depend on the selected vanilla hairstyle",()=>{
  const head=sphereSurface(),baseline={resource:"baseline",positions:head.positions,indices:head.indices,uv:head.uv};
  const a=defaultGroom(scalpSeedSurface({...head,cap:{source:"style-a",points:[0,0,0]}},baseline));
  const b=defaultGroom(scalpSeedSurface({...head,cap:{source:"style-b",points:[1,1,1]}},baseline));
  expect(a.scalp).toEqual(b.scalp);expect(a.scalp.densitySeed.source).toBe("baseline");
});

test("cap-seeded sessions wait for the stable baseline before creating their authored groom",async()=>{
  const life=new AbortController(),platform=await createExperiments({random:seededRandom(33),documents:storeDocuments(),signal:life.signal,definitions:[],overrides:{}});
  let jobs=0;const lab=createHairLab(platform.context,{generate:async()=>{jobs++;}}),head={...sphereSurface(),coverageRequired:true,cap:{source:"selected-hair",points:[0,0,0]}};
  lab.bind("head",head,life.signal);await lab.facade.dispatch({kind:"hairLab.activate",target:"head",active:true});await settle();expect(jobs).toBe(0);
  const {cap:_cap,...withoutCap}=head;lab.bind("head",withoutCap,life.signal);await settle();expect(jobs).toBe(0);
  lab.coverageState("head","failed","Reference unavailable.");await lab.facade.dispatch({kind:"hairLab.retry",target:"head"});expect(lab.session("head")?.phase).toBe("shaping");
  lab.bind("head",{...head,coverageSurface:{resource:"baseline-cap",positions:[],indices:[],uv:[]}},life.signal);await settle();expect(jobs).toBe(1);life.abort();
});

test("scene jobs pre-empt, reject late results, preserve independent documents and support Undo/Redo", async () => {
  const life = new AbortController(), documents = storeDocuments(), platform = await createExperiments({ random: seededRandom(1),
    documents, signal: life.signal, definitions: [], overrides: {} });
  const jobs: { target: string; previous?: import("../src/features/hair-lab/service").Continuation | null; aborted(): boolean; publish(result: Generation): void; finish(): void }[] = [];
  const device: GenerationDevice = { generate(target, _surface, _groom, signal, publish, previous) { return new Promise<void>(resolve => {
    jobs.push({ target, previous, aborted: () => signal.aborted, publish, finish: resolve }); signal.addEventListener("abort", () => resolve());
  }); } };
  const lab = createHairLab(platform.context, device), head = sphereSurface(), a = child(life.signal), b = child(life.signal);
  lab.bind("a", head, a.signal); lab.bind("b", { ...head, resource: "another-head" }, b.signal);
  expect(jobs).toHaveLength(0);
  await lab.facade.dispatch({ kind: "hairLab.activate", target: "a", active: true });
  await lab.facade.dispatch({ kind: "hairLab.activate", target: "b", active: true }); await settle();
  expect(jobs.map(j => j.target)).toEqual(["a", "b"]);
  const generation = (resource = head): Generation => ({ groom: defaultGroom(resource), paths: { paths: [] }, stage: "coarse", residuals: null, milliseconds: {} });
  jobs[0].publish(generation()); jobs[1].publish(generation({ ...head, resource: "another-head" })); await settle();
  const complete: Generation = { ...generation(), stage: "refined", paths: coarsePaths(defaultGroom(head), sampleRoots(defaultGroom(head), head, 1), head.down), residuals: { rootMetres: 0, lengthRatio: 0, penetrationMetres: 0, minimumClearanceMetres: .001, visibleExtentMetres: .5, curvature: { maximumPerMetre: 20, maximumTurnRadians: .2, maximumJumpPerMetre: 10 } } };
  jobs[0].publish(complete); await settle();
  expect(Object.isFrozen(lab.facade.snapshot().sessions[0])).toBe(true);
  expect(Object.isFrozen(lab.facade.snapshot().sessions[0].result!.paths.paths[0].points)).toBe(true);
  const original = lab.session("a")!.document!;
  const saved = documents.store.get(HAIR_GROOM_KIND, original)!.value as any;
  expect(saved.scalp.density).toBeUndefined(); expect(saved.scalp.binding).toBeUndefined();
  expect(lab.session("b")!.document).not.toEqual(original);
  await lab.facade.dispatch({ kind: "hairLab.set", target: "a", field: "length", value: .60 }); await settle();
  expect(jobs[0].aborted()).toBe(true); expect(jobs[1].aborted()).toBe(false); expect(jobs).toHaveLength(3);
  expect(jobs[2].previous).toEqual({ groom: complete.groom, paths: complete.paths });
  jobs[0].publish(generation()); expect(lab.session("a")!.result).toBeNull();
  expect((lab.facade.snapshot().sessions.find(s=>s.id === "a")!.groom!.fields.length as any).value).toBe(.60);
  expect(lab.facade.snapshot().sessions[0].groom?.fields.length).toMatchObject({ op: "constant", value: .60, unit: "m" });
  await settle();
  const stored = documents.store.get(HAIR_GROOM_KIND, original)!;
  expect(stored.revision).toBe(2); expect((stored.value as any).fields.length).toMatchObject({ op: "constant", value: .60, unit: "m" });
  expect(saved.fields.length.value).toBe(.55);
  await lab.facade.dispatch({ kind: "hairLab.undo", target: "a" });
  expect((lab.facade.snapshot().sessions.find(s=>s.id === "a")!.groom!.fields.length as any).value).toBe(.55);
  await lab.facade.dispatch({ kind: "hairLab.redo", target: "a" });
  expect((lab.facade.snapshot().sessions.find(s=>s.id === "a")!.groom!.fields.length as any).value).toBe(.60);
  await lab.facade.dispatch({ kind: "hairLab.preview", target: "a", display: "scalp" });
  expect(lab.session("a")!.display).toBe("scalp");
  await lab.facade.dispatch({ kind: "hairLab.preview", target: "a", display: "reference-scalp" });
  expect(lab.session("a")!.display).toBe("reference-scalp");
  expect((lab.facade.snapshot().sessions.find(s=>s.id === "a")!.groom!.fields.length as any).value).toBe(.60);
  await lab.facade.dispatch({ kind: "hairLab.retry", target: "a" }); await settle();
  expect(jobs.at(-1)!.previous).toBeNull();
  jobs.at(-1)!.publish({ ...complete, residuals: { ...complete.residuals!, penetrationMetres: .005 } }); await settle();
  expect(lab.session("a")!.phase).toBe("failed"); expect(lab.session("a")!.result).toBeNull();
  await lab.facade.dispatch({ kind: "hairLab.retry", target: "a" }); await settle();
  jobs.at(-1)!.publish({ ...complete, residuals: { ...complete.residuals!, curvature: { maximumPerMetre: 700, maximumTurnRadians: 1.7, maximumJumpPerMetre: 600 } } }); await settle();
  expect(lab.session("a")!.phase).toBe("failed"); expect(lab.session("a")!.result).toBeNull();
  const c = child(life.signal); lab.bind("c", head, c.signal);
  const beforeRevision = lab.session("c")!.revision, participant = lab.histories().find(h => h.id === `hair:${original}`)!;
  expect(platform.history!.snapshot(participant.id).steps[0].label).toBe("Hair length");
  expect(participant.dispatch({ kind: "history.jumpTo", entryId: platform.history!.snapshot(participant.id).startId })).toBe(true);
  expect((lab.facade.snapshot().sessions.find(s=>s.id === "a")!.groom!.fields.length as any).value).toBe(.55);
  expect(lab.session("c")!.revision).toBeGreaterThan(beforeRevision);
  lab.withdraw(); await settle();
  expect(lab.facade.snapshot().sessions.every(s => !s.active && s.result === null)).toBe(true);
  expect(jobs.every(j => j.aborted())).toBe(true);
  life.abort();
});

test("a groom reloads from the document store: a new session on the same head finds it, and its edits are saved over it", async () => {
  const documents = storeDocuments(), head = sphereSurface(), groom = defaultGroom(head);
  const { density: _density, binding: _binding, ...scalp } = groom.scalp;
  documents.store.put(HAIR_GROOM_KIND, "kept-groom", { ...groom, scalp }, 0);
  documents.store.put(HAIR_GROOM_KIND, "other-head", { ...groom, scalp: { ...scalp, resource: "another-head" } }, 0);
  const life = new AbortController(), platform = await createExperiments({ random: seededRandom(5), documents, signal: life.signal, definitions: [], overrides: {} });
  const lab = createHairLab(platform.context, { generate: async () => {} }, await documents.list(HAIR_GROOM_KIND));
  lab.bind("head", head, life.signal);
  expect(lab.session("head")!.document).toBe("kept-groom");
  expect(lab.facade.snapshot().sessions[0].groom!.name).toBe(groom.name);
  expect((await lab.facade.dispatch({ kind: "hairLab.set", target: "head", field: "waves", value: .02 })).ok).toBe(true);
  expect(documents.store.get(HAIR_GROOM_KIND, "kept-groom")).toMatchObject({ revision: 2, value: { fields: { waves: { value: .02 } } } });
  expect((await lab.facade.dispatch({ kind: "hairLab.undo", target: "head" })).ok).toBe(true); await settle();
  expect(documents.store.get(HAIR_GROOM_KIND, "kept-groom")).toMatchObject({ revision: 3, value: { fields: { waves: groom.fields.waves } } });
  expect((await lab.facade.dispatch({ kind: "hairLab.undo", target: "head" })).ok).toBe(false);   // nothing before the first edit
  life.abort();
});
