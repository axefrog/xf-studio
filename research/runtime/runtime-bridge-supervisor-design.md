# Runtime bridge supervisor: first slice (0.8.15)

**Status: source/offline, 25 October 2026.** Round 3 adds V's autonomous-build supervisor. It has not run in game. The coordinator commits and reviews this candidate before the [SV815 session](runtime-bridge-test-card.md#supervisor-0815-round-3). R6 [navigation/contact limits](../../knowledge/navigation-and-safety.md) apply throughout. This is a bounded observer and policy executor, not a movement controller or proof of safety.

An actor owns a versioned plain entry. `actor:{kind:"player",ref:"V"}`, `actor:{kind:"npc",ref:"a1"}` and `actor:{kind:"spawn",ref:"1"}` share the schema; only V's adapter can currently be armed. The latter references are validated and refused with `actor_unavailable`, rather than acquiring a misleading inactive entry. No entity pointer is retained. Replacement discards the previous anchor and invalidates its work. The first slice has one active slot; extending storage to an actor-keyed bounded collection does not change entry data.

```json
{
  "schema": "xfb/supervisor-entry-1",
  "actor": {"kind": "player", "ref": "V"},
  "goal": {"kind": "hold_position", "at": [0, 0, 0], "radius_m": 1},
  "invariants": ["not_in_combat", "no_contact", "not_on_road", "alive"],
  "policy": {
    "goal": "return_last_safe",
    "not_in_combat": "pause_world",
    "no_contact": "return_last_safe",
    "not_on_road": "handover",
    "alive": "handover"
  },
  "tick_hz": 3,
  "safe_after_s": 3
}
```

Replace the example point with the observed destination. `hold_position` detects departures from its radius (0.2–10 m); optional `facing` has a fixed 15° tolerance. It requires a `goal` policy. `idle_safe` has no movement target and takes only its kind. Neither installs a movement hold, periodically teleports V, nor fabricates a game idle. Each selected invariant requires exactly one whitelisted policy. Unknown fields, arbitrary methods, scripts, expressions and actions outside the whitelist refuse. The entry accepts 1–5 Hz and 1–30 seconds for quiet dwell. There is no host timer: the game Running tick evaluates at deadlines, never bursts after a stall.

| Policy | Existing dispatcher route | Scope and refusal |
|---|---|---|
| `stop_behaviours` | `behave.stop {all:true}` | Stops our behaviour runner; ordinary cleanup follows on the game tick. |
| `release_holds` | `player.stop {}` | Releases the bridge's player effects/look/motion, not arbitrary mods' effects. |
| `withdraw_nearby` | individual `npc.release {who,how:"despawn"}` / `world.despawn {id}` | Only bridge-spawned actors, props and vehicles observed within 30 m; rechecks ownership and live position on the executing frame. Adopted passers-by and lights are excluded. Each command retains its NPC/DM permission. |
| `return_last_safe` | `player.stop`, then `player.teleport` after 0.4 seconds | Normal player/phase/busy/traffic/pacer checks apply. No anchor, death, combat, changed owner or takeover refuses. The short delay lets the stop cleanup run; it does not grant permission. No far/road override. |
| `pause_world` | `world.pause {paused:true}` | Needs world permission; successful pause cancels supervision. |
| `handover` | `bridge.handover {on:true}` | Cancels supervision and follows the established handover cleanup route. |

The game-independent `core/Supervisor` owns entry transitions, quiet dwell, contact sequences and violation edges. A single bounded worker submits only the routes above through the normal dispatcher: authentication, rate/write-class/kill/pause/handover/script gates still apply. Trusted C++ execution guards propagate to **each** queued game step, including teleport's later write. They compare entry generation, actual player identity, world/connection generation, fresh phase, input and the violation immediately before that step. This guard cannot be supplied by request data. Existing restore scopes remain unconditional cleanup. A bridge-thread bookkeeping action receives a guarded game-frame admission first; the native behaviour stop itself changes bookkeeping only. Setting a replacement is also guarded against a clear admitted while it waited in the queue.

Each violation edge queues one policy, never an automatic retry loop. A new contact receipt batch is a new edge. Persistent combat/death/goal deviation does not cause a command storm; a refusal remains visible until an explicit new entry or a newly observed edge. At most 16 actions are pending; overflow is an explicit `supervisor.action` refusal. Deletion plans resolve at most the existing 3 actor / 24 object limits. Their position-only adapter never changes DM watcher subscriptions or drains watcher events. Each executed or refused command gets its result, including multi-command returns. A planning/read failure is also a result. Kill, bridge pause, handover and accepted load invalidate the owner immediately through bookkeeping; detach, lost connection, invalid observations and observed non-gameplay/world-freeze cancel it too. No automatic re-arm after resume/load.

The independent player listener uses the existing mapped movement/camera/jump/crouch/sprint/dodge reads, plus primary/secondary attack, quick melee and interact buttons. It shares the existing thresholds (mouse action delta 3; axes 0.3). With Codeware it also observes raw mouse/stick axes (6 counts in a report or 15 accumulated; stick 0.3). First observed deliberate input cancels the native owner in its callback, without waiting for the supervisor deadline; all already-queued game actions then fail their guard. Listener removal follows on the next live tick, or system detach. It never unregisters another glide's listener. This is not complete hardware coverage; consumed/unmapped buttons, raw buttons, very small deltas and brief phase changes between observations are not proven observed. Current policies create no supervisor-owned movement holds to release on takeover.

The last safe point is an **observed quiet anchor**, recorded by the supervisor after V remains within 0.15 m for N seconds, alive, outside combat, with no covered contact receipt. A hold goal must also be satisfied; positive Road cannot mature an anchor. A missed interval longer than two evaluation periods resets dwell. Positive contacts reset candidate dwell but preserve the prior mature anchor. This is intentionally not a no-contact proof: R6's controller reports can include supporting ground, have no body identity and miss continuous passive contacts. Road containment remains unknown (RB-232), so `not_on_road` only reports a note and performs no intervention. Anchor and return evidence carry that uncertainty. V cannot be returned before an anchor exists, even if a target was supplied in `hold_position`.

Supervisor/contact ingress is independent of recorder selection and has no private history store. It copies bounded pending receipts into the existing session log and optional/default `supervisor` recorder channel. Native ingress never calls gameplay functions or recorder sinks while holding the supervisor mutex. Sinks flush outside VM sampling; bounded pending-event overflow emits `supervisor.gap`, increments state drops and makes catch-up history incomplete. `supervisor.violation`, `supervisor.action` (full result), quiet-anchor, contact and cancellation receipts feed `game.catchup.supervisor_summary`: “while you were away: …”. Recorder/session duplicates are reconciled by incident and generation. The tools share one heartbeat/connection lease for recording and supervision, so stopping recording cannot drop supervision; the heartbeat observes native cancellation and releases the supervisor lease, while clear overtakes a pending set on the control route. With recording stopped, session receipts still work; session/ring/archive losses remain explicit. A stopped recorder run is still needed by today's catch-up cursor API; `session.events` works independently.

Extension points are deliberately small:

- **NPCs and vehicles:** actor adapters supply fresh identity, position, combat/liveness/contact and takeover ownership. Add bounded actor-keyed slots, not a V-only schema. A spawned vehicle's driver/input ownership needs its own commissioning.
- **Scene beats:** a scene owner can replace versioned entries at beat boundaries, retaining incident causality. Do not put loops, callbacks or source code into policy data.
- **Goal-shaped movement:** add a goal planner such as “safe pavement near X” only after live traffic containment/nearest pavement are commissioned (RB-232), then select from safe existing movement executors. The current point/radius observer is not a path follower.
- **Frame-rate reflexes:** a distinct game-frame adapter can consume the same actor observations and policy ownership token for twitchy benchmarks. It needs measured budgets, input arbitration and a bounded action pipeline; increasing this 3 Hz tick to frame rate is not commissioning a realtime controller.

Offline verification and native counts are recorded in the [bridge README](../../projects/xf-runtime-bridge/README.md). Runtime commissioning remains the session card, especially parked-car contact delivery (RB-233), input under consumed camera actions and queued load/clear races. No game.quit or native lifecycle consumer invocation is added.
