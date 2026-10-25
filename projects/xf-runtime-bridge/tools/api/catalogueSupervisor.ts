import type { CommandDef, Permission } from "./catalogue.ts";
import { num, obj, oneOf, str } from "./schema.ts";

const action = () => oneOf("Fixed policy action, applied once per violation edge; refusal is logged, never retried in a loop. For V: stop_behaviours, release_holds, withdraw_nearby, return_last_safe, pause_world, handover. For an XF actor: release (npc.release, despawn), return_last_safe (npc.place to its observed quiet point), pause_world, handover.", ["stop_behaviours", "release_holds", "withdraw_nearby", "return_last_safe", "pause_world", "handover", "release"]);
const actorRef = () => ({ ...obj({ kind: oneOf("Actor adapter.", ["player", "npc"]), ref: str("V, or an XF actor's handle (a1, a2, ...).", { minLength: 1, maxLength: 16 }) }, ["kind", "ref"]), description: "The entry to read or clear." });
const point = { type: "array" as const, description: "World point [x, y, z].", minItems: 3, maxItems: 3, items: num("World coordinate.", -100000, 100000) };
export const SUPERVISOR_COMMANDS: CommandDef[] = [
  { name: "supervisor.set", title: "Supervise an actor", permission: "write-player",
    requiredPermissions: input => {
      const required = new Set<Permission>();
      for (const action of Object.values(input.policy as Record<string, unknown>)) {
        if (action === "pause_world") required.add("write-world");
        if (action === "withdraw_nearby") { required.add("write-npc"); required.add("write-dm"); }
        if (["stop_behaviours", "release_holds", "return_last_safe", "handover"].includes(String(action))) required.add("control");
        if (action === "release") required.add("write-npc");
      }
      // 0.8.19: an XF actor's entry acts through npc writes.
      if ((input.actor as { kind?: unknown } | undefined)?.kind === "npc") required.add("write-npc");
      return [...required];
    },
    description: "Autonomous test build and allow_test_hooks only. Arms one entry of the supervisor: for V or (0.8.19) for an XF actor, at 3 Hz by default. Up to 5 entries are held at once (V plus four actors, or five actors); setting an actor again replaces only that actor's entry. An actor's entry takes hold_position (the observer detects departures from its radius; it never moves the actor itself) or idle_safe, the invariants alive, not_in_combat and not_lost (the actor still exists and is streamed in), and the policies release (npc.release, despawn), return_last_safe (npc.place to its observed quiet point, within 30 m of V as npc.place requires), pause_world and handover; only XF actors from npc_spawn or npc_substitute (a1, a2, ...) can be supervised, never picked passers-by. An actor's entry is cancelled by the kill switch, a handover, the pause and a load, like V's, and ends by itself when the actor is lost (unless not_lost selects a policy). Replaces V's entry at 3 Hz by default. Observes a hold-position goal (including optional facing within 15 degrees) or idle safety, then applies the selected fixed policy on a violation edge. No walking or movement hold is implied. Last safe means a stationary quiet interval under partial contact coverage; traffic risk stays unknown. Unknown road classification causes a note only. Player input, kill, handover, pause, load or owner disconnect cancels it. Spawned-object references are a reserved adapter and are refused. Arming requires every selected policy capability: world for pause, both NPC and DM for withdrawal, and control for stop/return/handover alongside player. Each native action retains the arming caller grant and also obeys config; nearby withdrawal removes only our spawned NPCs, props and vehicles still within 30 m, never adopted passers-by. Return first releases our holds then uses the last observed quiet point through the normal teleport checks; missing evidence or combat refuses it. Start recording with the supervisor channel to retain interventions, or read the session events.",
    input: obj({
      schema: oneOf("Versioned entry schema.", ["xfb/supervisor-entry-1"]),
      actor: { ...obj({ kind: oneOf("Actor adapter.", ["player", "npc", "spawn"]), ref: str("V (v is accepted too), an XF actor's handle (a1, a2, ...; a picked passer-by's p1 is refused), or a spawned-object numeric handle (refused: reserved).", { minLength: 1, maxLength: 16 }) }, ["kind", "ref"]), description: "Actor identity, resolved afresh by its adapter." },
      goal: { ...obj({ kind: oneOf("Goal to observe.", ["hold_position", "idle_safe"]), at: point, radius_m: num("Hold-position radius, default 1 m.", .2, 10), facing: num("Optional hold-position yaw, with 15 degree tolerance.", -360, 360) }, ["kind"]), description: "hold_position requires at and a goal policy; idle_safe takes only kind." },
      invariants: { type: "array", description: "Safety invariants; every selected invariant requires a policy. V: not_in_combat, no_contact, not_on_road, alive. An XF actor: not_in_combat, alive, not_lost.", maxItems: 4, items: oneOf("Invariant.", ["not_in_combat", "no_contact", "not_on_road", "alive", "not_lost"]) },
      policy: { ...obj({ goal: action(), not_in_combat: action(), no_contact: action(), not_on_road: action(), alive: action(), not_lost: action() }), description: "One fixed action per enabled invariant and hold-position goal deviation." },
      tick_hz: num("Bounded evaluation rate, default 3 Hz; no catch-up bursts.", 1, 5),
      safe_after_s: num("Stationary time with no observed contact or combat before recording a last safe point, default 3 seconds.", 1, 30),
    }, ["schema", "actor", "goal", "invariants", "policy"]),
    undo: "supervisor.clear cancels the entry and queued actions. Actions already performed keep their ordinary command undo.",
    bridge: { method: "supervisor.set" }, refusals: ["test_hooks_off", "actor_unavailable", "supervisor_unavailable", "interrupted", "permission_denied", "supervisor_limit"] },
  { name: "supervisor.state", title: "Read actor supervision", permission: "read",
    description: "Autonomous test build and allow_test_hooks only. Reads the supervisor: with no actor (or actor all) every armed entry (schema xfb/supervisor-state-2: count, limit 5 and the entries); with an actor, that entry's cancellation generation, observed quiet-position evidence, current violation edges and explicit contact/input coverage limits (an actor never armed reads as inactive). Changes nothing.",
    input: obj({ actor: { ...actorRef(), description: "One entry to read; leave out (or use all in the bridge's own form) for every entry." } }), bridge: { method: "supervisor.state" }, refusals: ["test_hooks_off"] },
  { name: "supervisor.clear", title: "Clear actor supervision", permission: "control",
    description: "Autonomous test build and allow_test_hooks only. Immediately cancels supervisor entries and invalidates actions awaiting an executing frame, including a set still waiting for admission: every entry, or with actor just that one (the others keep running). Available on the control route. Its independent input listener is removed on the next live game tick once V's entry is gone. The answer lists what is still armed (schema xfb/supervisor-state-2) and names what was cleared.",
    input: obj({ actor: { ...actorRef(), description: "Clear only this entry; leave out to clear every entry." } }), undo: "Set a new entry explicitly to resume supervision.", bridge: { method: "supervisor.clear" }, refusals: ["test_hooks_off"] },
];
