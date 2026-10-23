/**
 * Profiles phase 4a-v (experiment 043 §11): a scene runtime's typed preparation progress on its way to the head pane. The viewport
 * attachment carries it beside the pane's phase (and drops it when it ends), and the presentation words each stage in one plain line, for
 * the pane's loading state and for its quiet status line while the V shown stays.
 */
import { expect, test } from "bun:test";
import { ViewportAttachment, type PreparationState } from "../src/app/viewport-attachment";
import { LIGHTING_LINES, NEXT_LINE_MAX_CHARS, preparationLine } from "../src/studio-ui/preparation-text";
import { PREPARATION_STAGES } from "../src/preview/scene-residency";

const port = { moveHost: () => {}, measure: () => ({ width: 300, height: 200 }), resize: () => {}, cancelInput: () => {}, inputCapture: () => false,
  headView: () => undefined, uvView: () => undefined, uvCommand: () => false, hitAt: () => undefined,
  queryContext: () => { throw Error("No hit expected"); } };

test("the attachment carries the preparation beside the phase, publishes each change once, and drops it when it ends", () => {
  const attachment = new ViewportAttachment<unknown>(port as never);
  let published = 0;
  attachment.subscribe(() => { published++; });
  attachment.setReady("head");
  const state: PreparationState = { scene: "s1", key: "s1|v1|male", stage: "programs", fraction: 0.4, waiting: "driver", warm: false, change: "subject" };
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

test("a lighting setup made ready on the V shown says so in the same place and form, within the same one-line budget (4a-v-b)", () => {
  for (const stage of ["programs", "textures", "warm-up"] as const) for (const place of ["pane", "next"] as const) {
    const line = preparationLine({ stage, waiting: "driver", change: "shown" }, place);
    expect(LIGHTING_LINES).toContain(line);
    expect(line.startsWith("Lighting: ")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(NEXT_LINE_MAX_CHARS);
    expect(line).not.toMatch(/shader|program|runtime|GPU|compile|warm-up|\d/i);
  }
  expect(preparationLine({ stage: "programs", waiting: "driver", change: "shown" }, "next")).toBe("Lighting: getting ready…");
  expect(preparationLine({ stage: "warm-up", waiting: "gpu", change: "shown" }, "next")).toBe("Lighting: almost ready…");
  // A subject change keeps its own words.
  expect(preparationLine({ stage: "programs", waiting: "driver", change: "subject" }, "next")).toBe("Next V: readying the look…");
});
