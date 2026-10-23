/**
 * Profiles phase 4a-v (experiment 043 §11): a scene runtime's typed preparation progress on its way to the head pane. The viewport
 * attachment carries it beside the pane's phase (and drops it when it ends), and the presentation words each stage in one plain line, for
 * the pane's loading state and for its quiet status line while the V shown stays.
 */
import { expect, test } from "bun:test";
import { ViewportAttachment, type PreparationState } from "../src/app/viewport-attachment";
import { NEXT_LINE_MAX_CHARS, PREPARATION_LINE_MIN_VISIBLE_MS, PreparationLineGate, preparationLine } from "../src/studio-ui/preparation-text";
import { PREPARATION_STAGES } from "../src/preview/scene-residency";

const port = { moveHost: () => {}, measure: () => ({ width: 300, height: 200 }), resize: () => {}, cancelInput: () => {}, inputCapture: () => false,
  headView: () => undefined, uvView: () => undefined, uvCommand: () => false, hitAt: () => undefined,
  queryContext: () => { throw Error("No hit expected"); } };

test("the attachment carries the preparation beside the phase, publishes each change once, and drops it when it ends", () => {
  const attachment = new ViewportAttachment<unknown>(port as never);
  let published = 0;
  attachment.subscribe(() => { published++; });
  attachment.setReady("head");
  const state: PreparationState = { scene: "s1", key: "s1|v1|male", stage: "programs", fraction: 0.4, waiting: "driver", warm: false };
  attachment.setPreparation("head", state);
  attachment.setPreparation("head", { ...state });
  expect(published).toBe(2);
  expect(attachment.snapshot().head).toMatchObject({ phase: "ready", preparation: state });
  expect(attachment.snapshot().uv.preparation).toBeUndefined();
  attachment.setPreparation("head", null);
  expect(attachment.snapshot().head.preparation).toBeUndefined();
  expect(published).toBe(3);
});

test("every stage has a plain line in both places, the host's own line wins while it prepares a core, and the wait picks the verb", () => {
  for (const stage of PREPARATION_STAGES) for (const place of ["pane", "next"] as const) {
    const line = preparationLine({ stage, waiting: null }, place);
    expect(line.length).toBeGreaterThan(5);
    expect(line.endsWith("…")).toBe(true);
    if (place === "next") expect(line.startsWith("Next V: ")).toBe(true);
    // No developer words reach the person.
    expect(line).not.toMatch(/shader|program|runtime|GPU|compile|warm-up/i);
  }
  // The host's own line wins in the pane while it prepares a core, and a step count never shows beside the bar.
  const host = "Preparing the masculine V's head from your Cyberpunk 2077 files…";
  expect(preparationLine({ stage: "core", waiting: "host", detail: host }, "pane")).toBe(host);
  expect(preparationLine({ stage: "core", waiting: "host", detail: `${host} (step 3 of 9)` }, "pane")).toBe(host);
  expect(preparationLine({ stage: "core", waiting: "host", detail: "Preparing the head (step 3 of 9)…" }, "pane")).toBe("Preparing the head…");
  // The same head wording in both places: the pane without a host line says what the host says.
  expect(preparationLine({ stage: "core", waiting: null }, "pane")).toBe(host);
  expect(preparationLine({ stage: "details", waiting: "host" }, "pane")).toBe("Preparing your V's skin, hair and clothes…");
  expect(preparationLine({ stage: "details", waiting: "files" }, "pane")).toBe("Loading your V's skin, hair and clothes…");
  expect(preparationLine({ stage: "programs", waiting: "driver" }, "pane")).toBe("Getting the look ready…");
});

test("the quiet line is one line at every stage: each `next` string fits the narrowest width, with or without the host's line", () => {
  for (const stage of PREPARATION_STAGES) for (const waiting of [null, "host", "files", "driver", "gpu"] as const) for (const detail of [undefined, "Preparing the masculine V's head from your Cyberpunk 2077 files… (step 3 of 9)"]) {
    const line = preparationLine({ stage, waiting, ...(detail ? { detail } : {}) }, "next");
    expect(line.length).toBeLessThanOrEqual(NEXT_LINE_MAX_CHARS);
    expect(line).not.toMatch(/step|masculine|\d/i);
  }
  expect(preparationLine({ stage: "details", waiting: "host" }, "next")).toBe("Next V: hair and clothes…");
  expect(preparationLine({ stage: "programs", waiting: null }, "next")).toBe("Next V: readying the look…");
});

test("the status line stays visible for a short minimum once it has appeared, then goes", () => {
  const gate = new PreparationLineGate();
  // Never wanted: never shown.
  expect(gate.step(0, false)).toEqual({ show: false, holdMs: null });
  // It appears at t=1000 and the preparation ends 40 ms later: the line stays for the rest of 300 ms.
  expect(gate.step(1000, true)).toEqual({ show: true, holdMs: null });
  expect(gate.step(1040, false)).toEqual({ show: true, holdMs: PREPARATION_LINE_MIN_VISIBLE_MS - 40 });
  expect(gate.step(1299, false).show).toBe(true);
  expect(gate.step(1300, false)).toEqual({ show: false, holdMs: null });
  // A line shown for longer than the minimum goes at once when the preparation ends.
  gate.step(2000, true); gate.step(2500, true);
  expect(gate.step(2501, false)).toEqual({ show: false, holdMs: null });
  // The pane no longer showing a V drops a held line at once.
  gate.step(3000, true);
  gate.reset();
  expect(gate.step(3010, false)).toEqual({ show: false, holdMs: null });
});
