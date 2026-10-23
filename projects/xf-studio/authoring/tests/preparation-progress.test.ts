/**
 * Profiles phase 4a-v (experiment 043 §11): a scene runtime's typed preparation progress on its way to the head pane. The viewport
 * attachment carries it beside the pane's phase (and drops it when it ends), and the presentation words each stage in one plain line, for
 * the pane's loading state and for its quiet status line while the V shown stays.
 */
import { expect, test } from "bun:test";
import { ViewportAttachment, type PreparationState } from "../src/app/viewport-attachment";
import { preparationLine } from "../src/studio-ui/preparation-text";
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
  const core = { stage: "core" as const, waiting: "host" as const, detail: "Preparing the masculine V's head… (step 3 of 9)" };
  expect(preparationLine(core, "pane")).toBe(core.detail);
  expect(preparationLine(core, "next")).toBe("Next V: preparing the masculine V's head… (step 3 of 9)");
  expect(preparationLine({ stage: "details", waiting: "host" }, "next")).toBe("Next V: preparing skin, hair and clothes…");
  expect(preparationLine({ stage: "details", waiting: "files" }, "next")).toBe("Next V: loading skin, hair and clothes…");
});
