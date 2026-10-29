/** Captured from unchanged 6cfdbb86 before the 13d production edit. No browser layout claim. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installLightDom, uninstallLightDom, type LightElement } from "./light-dom";
import { h, setText } from "../src/studio-ui/dom";
import { progressBar } from "../src/studio-ui/components";
import { readinessText } from "../src/studio-ui/readiness-text";
import { EYE_MAKEUP_VIEW_BINDING } from "../src/features/eye-makeup/view";
import type { Frame, StudioRuntime } from "../src/studio-ui/runtime";
import type { FeatureViewBinding } from "../src/studio-ui/views/feature-view";

// Exercise the actual private status-bar implementation without exporting a shell test API.
const source = readFileSync(new URL("../src/studio-ui/app.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("function statusBar("), source.indexOf("function cycleRegions("));
const makeStatus = new Function("h", "progressBar", "setText", "restoringLine", "statusActivity", "RESTORING", "readinessText",
  new Bun.Transpiler({ loader: "ts" }).transformSync(body) + "; return statusBar;")(
  h, progressBar, setText, () => "", () => ({ text: "", tone: "info", hidden: true }), "Restoring", readinessText,
) as (rt: StudioRuntime, bindings: readonly FeatureViewBinding[]) => { element: HTMLElement; update(frame: Frame): void };
function tree(node: LightElement): unknown {
  return { tag: node.tagName, attributes: [...node.attributes], hidden: node.hidden, title: node.title,
    text: node.children.length ? undefined : node.textContent, children: node.children.map(tree) };
}
const runtime = { feedback: { log: [] }, dock: { reveal() {} } } as unknown as StudioRuntime;
function frame(phase: string, size: number, head: boolean, error?: string, headError?: string): Frame {
  return { status: { workspace: { kind: "saved" } }, preview: {}, readiness: { phase, size, pending: phase === "updating" ? 2 : 0, error },
    viewport: { head: { phase: head ? "ready" : "empty", error: headError } } } as unknown as Frame;
}
test("normal status-bar structure, strings and tooltip precedence match 6cfdbb86", () => {
  installLightDom();
  try {
    const rows: unknown[] = [];
    for (const phase of ["ready", "updating", "error"]) for (const size of [256, 512, 1024, 2048]) for (const head of [false, true]) {
      const bar = makeStatus(runtime, [EYE_MAKEUP_VIEW_BINDING]); bar.update(frame(phase, size, head));
      rows.push(tree(bar.element as unknown as LightElement));
    }
    for (const [error, headError] of [["Texture failure", "Head failure"], [undefined, "Head failure"]]) {
      const bar = makeStatus(runtime, [EYE_MAKEUP_VIEW_BINDING]); bar.update(frame("error", 1024, false, error, headError));
      rows.push(tree(bar.element as unknown as LightElement));
    }
    expect(rows).toMatchSnapshot();
  } finally { uninstallLightDom(); }
});
test("empty composition reads no texture or viewport readiness and renders no badge", () => {
  installLightDom();
  try {
    const neutral = frame("ready", 1024, false);
    Object.defineProperties(neutral, { readiness: { get() { throw Error("No texture readiness owner"); } },
      viewport: { get() { throw Error("No feature viewport"); } } });
    const bar = makeStatus(runtime, []); bar.update(neutral);
    const ready = bar.element.querySelector<HTMLElement>(".ready-badge")!;
    expect([ready.hidden, ready.textContent, ready.title, ready.dataset.phase]).toEqual([true, "", "", undefined]);
  } finally { uninstallLightDom(); }
});
