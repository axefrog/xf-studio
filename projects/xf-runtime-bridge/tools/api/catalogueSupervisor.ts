import type { CommandDef } from "./catalogue.ts";
import { num, obj, oneOf, str } from "./schema.ts";

const action = () => oneOf("Fixed policy action, applied once per violation edge; refusal is logged, never retried in a loop.", ["stop_behaviours", "release_holds", "withdraw_nearby", "return_last_safe", "pause_world", "handover"]);
const point = { type: "array" as const, description: "World point [x, y, z].", minItems: 3, maxItems: 3, items: num("World coordinate.", -100000, 100000) };
export const SUPERVISOR_COMMANDS: CommandDef[] = [
  { name: "supervisor.set", title: "Supervise an actor", permission: "write-player",
    description: "Autonomous test build and allow_test_hooks only. Replaces V's supervisor at 3 Hz by default. Observes a hold-position goal (including optional facing within 15 degrees) or idle safety, then applies the selected fixed policy on a violation edge. No walking or movement hold is implied. Last safe means a stationary quiet interval under partial contact coverage; traffic risk stays unknown. Unknown road classification causes a note only. Player input, kill, handover, pause, load or owner disconnect cancels it. NPC and spawned-object actor references reserve future adapters and are currently refused. Each action still needs its own permission; nearby withdrawal removes only our spawned NPCs, props and vehicles still within 30 m, never adopted passers-by. Return first releases our holds then uses the last observed quiet point through the normal teleport checks; missing evidence or combat refuses it. Start recording with the supervisor channel to retain interventions, or read the session events.",
    input: obj({
      schema: oneOf("Versioned entry schema.", ["xfb/supervisor-entry-1"]),
      actor: { ...obj({ kind: oneOf("Actor adapter.", ["player", "npc", "spawn"]), ref: str("V, a returned NPC handle, or a spawned-object numeric handle.", { minLength: 1, maxLength: 16 }) }, ["kind", "ref"]), description: "Actor identity, resolved afresh by its adapter." },
      goal: { ...obj({ kind: oneOf("Goal to observe.", ["hold_position", "idle_safe"]), at: point, radius_m: num("Hold-position radius, default 1 m.", .2, 10), facing: num("Optional hold-position yaw, with 15 degree tolerance.", -360, 360) }, ["kind"]), description: "hold_position requires at and a goal policy; idle_safe takes only kind." },
      invariants: { type: "array", description: "Safety invariants; every selected invariant requires a policy.", maxItems: 4, items: oneOf("Invariant.", ["not_in_combat", "no_contact", "not_on_road", "alive"]) },
      policy: { ...obj({ goal: action(), not_in_combat: action(), no_contact: action(), not_on_road: action(), alive: action() }), description: "One fixed action per enabled invariant and hold-position goal deviation." },
      tick_hz: num("Bounded evaluation rate, default 3 Hz; no catch-up bursts.", 1, 5),
      safe_after_s: num("Stationary time with no observed contact or combat before recording a last safe point, default 3 seconds.", 1, 30),
    }, ["schema", "actor", "goal", "invariants", "policy"]),
    undo: "supervisor.clear cancels the entry and queued actions. Actions already performed keep their ordinary command undo.",
    bridge: { method: "supervisor.set" }, refusals: ["test_hooks_off", "actor_unavailable", "supervisor_unavailable", "interrupted"] },
  { name: "supervisor.state", title: "Read actor supervision", permission: "read",
    description: "Autonomous test build and allow_test_hooks only. Reads the entry, cancellation generation, observed quiet-position evidence, current violation edges and explicit contact/input coverage limits. Changes nothing.",
    input: obj({}), bridge: { method: "supervisor.state" }, refusals: ["test_hooks_off"] },
  { name: "supervisor.clear", title: "Clear actor supervision", permission: "control",
    description: "Autonomous test build and allow_test_hooks only. Immediately cancels the supervisor entry and invalidates actions awaiting an executing frame, including a set still waiting for admission. Available on the control route. Its independent input listener is removed on the next live game tick.",
    input: obj({}), undo: "Set a new entry explicitly to resume supervision.", bridge: { method: "supervisor.clear" }, refusals: ["test_hooks_off"] },
];
