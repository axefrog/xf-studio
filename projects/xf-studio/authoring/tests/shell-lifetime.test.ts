import { expect, test } from "bun:test";
import { installLightDom, lightDocument, lightEvent, uninstallLightDom } from "./light-dom";
import { Feedback } from "../src/studio-ui/feedback";
import { installHelpTips, helpTip } from "../src/studio-ui/help-tip";
import { installReasonTips } from "../src/studio-ui/reason-tip";
import { HeaderFit } from "../src/studio-ui/header-fit";
import { PreferenceViewState } from "../src/studio-ui/view-state";
import { Callout } from "../src/studio-ui/guidance/overlay";
import { openMenu } from "../src/studio-ui/menu";
import { UpdateCheckActions, type UpdateCheckClock } from "../src/setup/update-check-actions";
import { UPDATE_CHECK_SCHEMA } from "../src/setup/update-check";

test("feedback abort clears every timer/frame and refuses late toast, log, announcement and retained actions", () => {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, keys = ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = keys.map(key => ({ key, value: globals[key] }));
  let id = 0, actions = 0; const timers = new Map<number, () => void>(), frames = new Map<number, () => void>();
  globals.setTimeout = (run: () => void) => { timers.set(++id, run); return id; };
  globals.clearTimeout = (id: number) => { timers.delete(id); };
  globals.requestAnimationFrame = (run: () => void) => { frames.set(++id, run); return id; };
  globals.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  const life = new AbortController();
  try {
    const feedback = new Feedback(undefined, life.signal);
    const close = feedback.toast("info", "Fixture", "Visible", [{ label: "Run", run: () => { actions++; } }]);
    feedback.announce("Queued");
    const late = [...timers.values(), ...frames.values()];
    expect([timers.size, frames.size, feedback.log.length]).toEqual([1, 1, 1]);
    life.abort(); expect([timers.size, frames.size]).toEqual([0, 0]);
    const text = feedback.toasts.textContent;
    for (const run of late) run(); // A callback already dispatched by the browser is still harmless.
    close(); feedback.toast("error", "Late", "Nothing"); feedback.record("info", "Late", "Nothing"); feedback.announce("Nothing");
    feedback.toasts.querySelector<HTMLButtonElement>(".toast-actions button")?.click();
    expect([actions, feedback.log.length, feedback.live.textContent, feedback.toasts.textContent]).toEqual([0, 1, "", text]);
    expect([timers.size, frames.size]).toEqual([0, 0]);
  } finally { life.abort(); for (const { key, value } of previous) globals[key] = value; uninstallLightDom(); }
});

test("tips remove document listeners and bubbles, and can install again after abort", () => {
  installLightDom(); const life = new AbortController();
  const globals = globalThis as unknown as Record<string, unknown>, dimensions = [globals.innerWidth, globals.innerHeight];
  globals.innerWidth = 1200; globals.innerHeight = 800;
  // A fresh document identity avoids another test's deliberately page-long standalone tip installation.
  const doc = Object.assign(Object.create(lightDocument) as typeof lightDocument, { listeners: new Map() });
  try {
    const baseline = () => [...doc.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    installHelpTips(doc as unknown as Document, life.signal); installReasonTips(doc as unknown as Document, life.signal);
    expect(baseline()).toBe(14);
    const help = helpTip("Fixture", "A description"); doc.body.append(help as never);
    doc.dispatchEvent(lightEvent("click", { target: help as never }));
    life.abort(); expect(baseline()).toBe(0);
    expect(doc.body.querySelector(".help-bubble, .reason-tip")).toBeNull();
    const next = new AbortController(); installHelpTips(doc as unknown as Document, next.signal); installReasonTips(doc as unknown as Document, next.signal);
    expect(baseline()).toBe(14); next.abort(); expect(baseline()).toBe(0);
  } finally { life.abort(); [globals.innerWidth, globals.innerHeight] = dimensions; uninstallLightDom(); }
});

test("header font readiness, guidance input origin and preference writes end with their owner", async () => {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, previousObserver = globals.ResizeObserver;
  let ready!: () => void, disconnected = 0, writes = 0;
  const doc = Object.assign(Object.create(lightDocument) as typeof lightDocument, { fonts: { ready: new Promise<void>(resolve => { ready = resolve; }) } });
  globals.document = doc;
  globals.ResizeObserver = class { observe() {} disconnect() { disconnected++; } };
  const life = new AbortController();
  try {
    const header = document.createElement("header"), fit = new HeaderFit(header, []);
    let fits = 0; fit.refit = () => { fits++; };
    life.signal.addEventListener("abort", () => fit.disconnect(), { once: true });
    new Callout({ signal: life.signal, className: "fixture", closeLabel: "Close", onClose() {} });
    expect(doc.listenerCount("keydown")).toBe(1);
    const preferences = new PreferenceViewState({ snapshot: () => ({}), capability: () => ({ available: true }), dispatch: () => { writes++; } }, life.signal);
    preferences.setExpanded(["fixture"], false); expect(writes).toBe(1);
    life.abort(); ready(); await Promise.resolve();
    preferences.setSize("fixture", 200); preferences.setAnchor("fixture", { top: 10 });
    expect([disconnected, fits, writes, doc.listenerCount("keydown"), doc.listenerCount("pointerdown")]).toEqual([1, 0, 1, 0, 0]);
  } finally { life.abort(); globals.ResizeObserver = previousObserver; uninstallLightDom(); }
});

test("menu blur/outside listeners and pending focus frame belong only to the open menu", () => {
  installLightDom(); const globals = globalThis as unknown as Record<string, unknown>, previousWindow = globals.window;
  const win = new EventTarget(); globals.window = Object.assign(win, { innerWidth: 1200, innerHeight: 800 });
  const life = new AbortController(); let blur = 0;
  const add = win.addEventListener.bind(win), remove = win.removeEventListener.bind(win);
  win.addEventListener = ((...args: Parameters<EventTarget["addEventListener"]>) => { if (args[0] === "blur") blur++; add(...args); }) as typeof win.addEventListener;
  win.removeEventListener = ((...args: Parameters<EventTarget["removeEventListener"]>) => { if (args[0] === "blur") blur--; remove(...args); }) as typeof win.removeEventListener;
  try {
    openMenu([{ kind: "action", label: "Fixture", run() {} }], { x: 0, y: 0 }, { label: "Fixture", signal: life.signal });
    expect([blur, lightDocument.listenerCount("pointerdown")]).toEqual([1, 1]);
    life.abort(); expect([blur, lightDocument.listenerCount("pointerdown")]).toEqual([0, 0]);
  } finally { life.abort(); globals.window = previousWindow; uninstallLightDom(); }
});

for (const phase of ["quiet wait", "transport"] as const) test(`application abort stops update-check ${phase} without a late state publication`, async () => {
  const life = new AbortController(), pending = new Set<() => void>(); let calls = 0, publications = 0;
  let finish!: (value: { ok: boolean; status: number; data: unknown }) => void;
  const reply = new Promise<{ ok: boolean; status: number; data: unknown }>(resolve => { finish = resolve; });
  const clock: UpdateCheckClock = { after: (_ms, run, signal) => { pending.add(run); signal?.addEventListener("abort", () => pending.delete(run), { once: true }); } };
  const checks = new UpdateCheckActions(async (_body, signal) => { calls++; expect(signal.aborted).toBe(false); return reply; }, clock, life.signal);
  checks.subscribe(() => { publications++; });
  const running = checks.dispatch({ kind: phase === "quiet wait" ? "updates.startupCheck" : "updates.check" });
  life.abort(); const retired = checks.snapshot(), before = publications;
  finish({ ok: true, status: 200, data: { schema: UPDATE_CHECK_SCHEMA, installed: "0.1.0", result: "current" } });
  expect(await running).toMatchObject({ ok: false, code: "cancelled" });
  expect(checks.snapshot()).toEqual(retired); expect(publications).toBe(before);
  expect([pending.size, calls]).toEqual([0, phase === "quiet wait" ? 0 : 1]);
  expect(await checks.dispatch({ kind: "updates.check" })).toMatchObject({ ok: false, code: "cancelled" });
});
