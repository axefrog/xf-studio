/** Palette hygiene (release-readiness-audit.md item 8): the commands that wait for the 3D view are one entry until it is ready. */
import { expect, test } from "bun:test";
import { withPreviewSetup } from "../src/studio-ui/app";
import type { Command } from "../src/studio-ui/commands";

const HEAD = "The 3D view needs your Cyberpunk 2077 game folder.";
function palette(head: { phase: string; message?: string; error?: string }, next: { kind: string } | null = { kind: "previewSetup.show" }) {
  const dispatched: string[] = [];
  const rt = { port: {
    viewport: { snapshot: () => ({ head }) },
    previewSetup: { snapshot: () => ({ card: { open: false }, head: { next: next && { label: "Set up 3D view", action: next } } }),
      capability: () => ({ available: true }), dispatch: async (action: { kind: string }) => { dispatched.push(action.kind); return { ok: true }; } },
  }, feedback: { toast: () => {} }, changed: () => {} } as never;
  return { rt, dispatched };
}
const command = (id: string, capability: { available: boolean; reason?: string; code?: string }, keywords?: string): Command =>
  ({ id, title: id, group: "View", keywords, capability: () => capability, run: () => {} });

test("before the game is set, the 3D view's commands become one Set up the 3D view… entry, where the first one was", () => {
  const { rt, dispatched } = palette({ phase: "unavailable", message: HEAD });
  const list = [command("undo", { available: true }), command("camera.front", { available: false, reason: HEAD, code: "asset_unavailable" }, "front view"),
    command("idle", { available: false, reason: HEAD }, "motion idle"), command("uv.fit", { available: true }),
    command("lighting.creator", { available: false, reason: "Some other reason." })];
  const shown = withPreviewSetup(rt, list);
  expect(shown.map(item => item.id)).toEqual(["undo", "preview.setup", "uv.fit", "lighting.creator"]);
  const entry = shown[1]!;
  expect(entry.title).toBe("Set up the 3D view…");
  expect(entry.keywords).toContain("front view");
  expect(entry.keywords).toContain("motion idle");
  expect(entry.capability()).toEqual({ available: true });
  entry.run();
  expect(dispatched).toEqual(["previewSetup.show"]);
});

test("once the 3D view is ready, or nothing waits for it, the palette is unchanged", () => {
  const list = [command("undo", { available: true }), command("camera.front", { available: true })];
  expect(withPreviewSetup(palette({ phase: "ready" }).rt, list)).toBe(list);
  expect(withPreviewSetup(palette({ phase: "unavailable", message: HEAD }).rt, list)).toBe(list);
});

test("the setup entry asks and runs the setup's next step as it is then, not as it was when the palette opened (UI-164)", () => {
  const dispatched: string[] = [];
  let setup = { card: { open: false }, head: { next: { label: "Set up 3D view", action: { kind: "previewSetup.show" } } } };
  const rt = { port: {
    viewport: { snapshot: () => ({ head: { phase: "unavailable", message: HEAD } }) },
    previewSetup: { snapshot: () => setup, capability: (action: { kind: string }) => ({ available: action.kind !== "previewSetup.show" }),
      dispatch: async (action: { kind: string }) => { dispatched.push(action.kind); return { ok: true }; } },
  }, feedback: { toast: () => {} }, changed: () => {} } as never;
  const [entry] = withPreviewSetup(rt, [command("idle", { available: false, reason: HEAD })]);
  // While the palette is open the setup moves on: the next step is now to choose the folder found.
  setup = { card: { open: true }, head: { next: { label: "Use this folder", action: { kind: "previewSetup.useDetectedGame" } } } };
  expect(entry!.capability()).toEqual({ available: true });
  entry!.run();
  expect(dispatched).toEqual(["previewSetup.useDetectedGame"]);
});
