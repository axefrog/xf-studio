import { afterEach, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightEvent, type LightElement } from "./light-dom";
import { WorkspaceNotice } from "../src/studio-ui/components/workspace-notice";
import { workspaceNoticeState, restoringLine } from "../src/studio-ui/app";
import type { Frame } from "../src/studio-ui/runtime";
import { emptyPresentationStatus } from "../src/app/presentation-status";
import { polish4Verification } from "../src/compose/polish4-verification";
import { viewTitles } from "../src/platform/api/view-graph";
import { profileWorkspaceLease } from "../src/app/profiles/profile-window";
import { leaseSnapshot } from "../src/app/workspace/workspace-lease";

afterEach(() => uninstallLightDom());

test("workspace progress keeps the same nodes and Waiting dispatches typed Cancel", () => {
  installLightDom();
  const chosen: string[] = [], notice = new WorkspaceNotice({ onAction: action => chosen.push(action) });
  const element = notice.element as unknown as LightElement, children = [...element.children];
  notice.update({ message: "Taking over…", actions: [], progress: true });
  const bar = element.querySelector('[role="progressbar"]')!;
  expect(bar.hidden).toBe(false);
  expect(bar.getAttribute("aria-valuenow")).toBeNull();
  notice.update({ message: "Waiting…", actions: ["cancelTakeOver"], progress: true });
  element.querySelector('[data-action="cancelTakeOver"]')!.dispatchEvent(lightEvent("click"));
  expect(chosen).toEqual(["cancelTakeOver"]);
  notice.update({ message: "Read-only", actions: ["takeOver"] });
  expect(bar.hidden).toBe(true);
  expect(element.children).toEqual(children);
});

test("restore safety changes the explanation, and folder reveal is offered only by a file host", () => {
  const fixtures = polish4Verification(() => {});
  const frame = (file = false) => ({ status: fixtures.snapshot(emptyPresentationStatus(true)), files: { workspaceFile: file } }) as unknown as Frame;
  fixtures.state("restore-short");
  expect(workspaceNoticeState(frame())).toBeNull();
  expect(restoringLine(frame())).toContain("Restoring changes");
  fixtures.state("restore-safe");
  expect(workspaceNoticeState(frame())).toMatchObject({ progress: true, actions: ["retryRestore", "keepRestored"] });
  fixtures.state("restore-unsafe");
  expect(workspaceNoticeState(frame())).toMatchObject({ progress: true, actions: ["retryRestore", "exportCopy"] });
  expect(workspaceNoticeState(frame())!.message).toContain("hasn't confirmed them yet");
  fixtures.state("waiting");
  expect(workspaceNoticeState(frame())).toMatchObject({ progress: true, actions: ["cancelTakeOver"] });
  fixtures.state("unprotected");
  expect(workspaceNoticeState(frame())!.actions).not.toContain("showInFolder");
  expect(workspaceNoticeState(frame(true))!.actions).toContain("showInFolder");
});

test("only unnamed views are counted and numbered, within their tab", () => {
  expect(viewTitles([{ id: "a", tab: "one" }, { id: "b", tab: "one", title: "Side" }, { id: "c", tab: "two" }]))
    .toEqual(["3D view", "Side", "3D view"]);
  expect(viewTitles([{ id: "a" }, { id: "b", title: "Side" }, { id: "c" }])).toEqual(["3D view 1", "Side", "3D view 2"]);
});

test("migration pending is read-only presentation data, without recording a migration", () => {
  const lease = { snapshot: () => leaseSnapshot({ phase: "read-only", generation: null }), writable: () => false };
  expect(profileWorkspaceLease(lease, false).migrationPending).toBe(true);
  expect(profileWorkspaceLease(lease, true).migrationPending).toBe(false);
  expect(profileWorkspaceLease({ ...lease, writable: () => true }, false).migrationPending).toBe(false);
});
