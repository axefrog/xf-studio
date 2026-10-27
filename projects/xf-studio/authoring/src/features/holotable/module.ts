/**
 * The Holotable Studio module (research/live-world-view/proposal.md §4): a replay of what the game and XF's systems recorded, drawn
 * over offline world data. Early access behind its experiment until the replay is useful; part-less, one panel, no view tools. Data only.
 */
import type { StudioModule } from "../../platform/api";
import type { ActionDescriptor } from "../../platform/api";
import type { HoloAction } from "./service";
import { HOLOTABLE_DEFAULTS } from "./defaults";

const input = (type: "string" | "number" | "boolean" | "object" | "enum", values?: readonly (string | number)[]) => ({ type, required: true, from: "input" as const, ...(values ? { values } : {}) });
const action = (payload: ActionDescriptor["payload"] = {}): ActionDescriptor => ({ scope: ["holotable"], effect: "workspace", undo: "none", payload });
export const HOLOTABLE_ACTIONS = {
  "holo.refresh": action(), "holo.open": action({ dir: input("string") }), "holo.focus": action({ position: input("object") }),
  "holo.view.focus": action({ view: input("string"), id: {...input("string"),required:false}, layer: {...input("string"),required:false}, position: {...input("object"),required:false} }),
  "holo.view.back": action({ view: input("string") }),
  "holo.watch": action(), "holo.follow": action(), "holo.seek": action({ t: input("number") }), "holo.play": action({ on: input("boolean") }),
  "holo.speed": action({ speed: input("enum", [1, 4, 16, 60, 600, 3600]) }), "holo.change.previous": action(), "holo.change.next": action({ allVisible: { ...input("boolean"), required: false } }),
  "holo.change.scope": action({layer:{...input("string"),required:false}}),
  "holo.layer": action({ id: input("string"), on: input("boolean") }), "holo.level": action({ level: input("enum", ["structure", "full"]) }),
  "holo.select": action({ id: { ...input("string"), required: false }, members: { ...input("object"), required: false } }), "holo.place": action({ position: input("object") }),
  "holo.agentLayer": action({ id: input("string"), on: input("boolean") }), "holo.producer": action({ producer: input("string"), on: input("boolean") }),
  "holo.branch": action({ branch: input("string") }),
} satisfies Record<HoloAction["kind"], ActionDescriptor>;

export const HOLOTABLE_MODULE: StudioModule = Object.freeze({
  id: "holotable", label: "Holotable", icon: "layers", group: "world", stage: "preview", shownByDefault: true,
  description: "Replay what the game recorded: where V went, what the camera saw and what happened, over a wireframe of Night City.",
  defaults: HOLOTABLE_DEFAULTS, actions: HOLOTABLE_ACTIONS,
});
