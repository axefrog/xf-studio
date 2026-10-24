import { expect, test } from "bun:test";
import { tabVerification } from "../src/compose/tab-verification";
import { createProfileServices, createTargetResolver, sceneCommands, tabDefaults } from "../src/app/profiles/profile-window";
import { emptyChoicesPort } from "../src/app/profiles/empty-choices";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { defaultViewGraph } from "../src/preview/preview-view-graph";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { createStudioSubjects } from "../src/compose/subjects";
import { STUDIO_LAYOUT_DEFAULTS, STUDIO_FRAGMENT_KNOWLEDGE } from "../src/compose/layout-defaults";
import { createHistoryService } from "../src/platform/core/history-service";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { fixtureHost } from "./fixtures/creator-host";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { openSession } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";
import { layoutTabsPort } from "../src/app/profiles/tab-presentation";
import { starterParts } from "../src/app/workspace/collection-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

test("verification fixtures drive the real substitution and default readers, and refuse writes in a read-only page", async () => {
  const documents = storeDocuments(), outbox = new DocumentOutbox(documents, memoryOutboxStorage()); outbox.open();
  const host = await fixtureHost();
  const services = createProfileServices({ documents, outbox, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(host.port),
    history: createHistoryService(), layouts: { contributed: STUDIO_LAYOUT_DEFAULTS, known: STUDIO_FRAGMENT_KNOWLEDGE } });
  await services.load();
  const profile = await services.profiles.dispatch({ kind: "profile.create", name: "Capture" });
  if (!profile.ok) throw Error(profile.reason);
  const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "Capture" }), { profile: profile.profile });
  const actions = tabDefaults(session, services, { known: STUDIO_FRAGMENT_KNOWLEDGE });
  let writable = true;
  const hooks = tabVerification(session, services, outbox, () => writable);
  const made = await hooks.seed();
  const port = layoutTabsPort(session, actions, services);
  const character = services.characters.character(made.subjects[0]!);
  expect(port.subject({ kind: "character", id: made.subjects[0]! })).toBe(character!.label);
  let plan = actions.substitution("eye-makeup/default");
  if (!("subjects" in plan)) throw Error(plan.reason);
  expect(plan.oneClick).toBe(false); expect(plan.subjects[0]!.candidates).toHaveLength(2); expect(plan.looks[0]!.candidates).toHaveLength(10);
  await hooks.removeSubject(made.subjects[0]!); hooks.removeLook(made.collection, made.looks[0]!);
  plan = actions.substitution("eye-makeup/default");
  if (!("subjects" in plan)) throw Error(plan.reason);
  expect(plan.subjects[0]!.candidates).toHaveLength(1); expect(plan.looks[0]!.candidates).toHaveLength(9);
  const newer = await hooks.unavailableDefault();
  expect(services.defaults.get(newer)?.unavailable).toContain("newer version");
  expect(actions.capability({ kind: "tabs.new", default: newer }).available).toBe(false);
  const resolver = createTargetResolver({ state: session, services, history: createHistoryService(), contexts: type => STUDIO_CATALOGUE.context(type) });
  const scenes = sceneCommands(session, services), choices = emptyChoicesPort({ session, resolver, services, access: hooks.choiceAccess,
    starter: () => starterParts(STUDIO_DOCUMENTS),
    baseline: () => defaultViewGraph(freshWorkspace().preview), dispatch: action => { scenes.dispatch(action); return { ok: true }; } });
  for (const route of ["subject", "look", "view"] as const) for (const count of [0, 1, 8]) {
    const capture = await hooks.u6(route, count), state = choices.snapshot(capture.panel)!;
    expect(state.choices[0]!.action.destination.route).toBe(route);
    expect(state.choices).toHaveLength(route === "look" ? count || 1 : count ? count + 2 : route === "subject" ? 2 : 1);
    hooks.u6ReadOnly(); expect(choices.snapshot(capture.panel)!.capability.available).toBe(false);
    expect(await choices.execute(state.choices[0]!.action)).toMatchObject({ ok: false, code: "unavailable" }); hooks.u6ReadOnly(false);
  }
  writable = false;
  await expect(hooks.seed()).rejects.toThrow("writable verification workspace");
  await expect(hooks.unavailableDefault()).rejects.toThrow("writable verification workspace");
  expect(() => hooks.removeSubject(made.subjects[1]!)).toThrow("writable verification workspace");
  expect(() => hooks.removeLook(made.collection, made.looks[1]!)).toThrow("writable verification workspace");
  await expect(hooks.u6("subject")).rejects.toThrow("writable verification workspace");
  await outbox.settle();
});
