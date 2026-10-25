# Probe checklist: crowd substitution (requirement V17)

A checklist for one of the runtime bridge's prepared game sessions. It tests route (a) of [V17](../runtime-requirements.md): a person from the game's crowd is replaced by an XF actor with the same look, which the Story Engine then runs on its own routine, and later dissolves back into the crowd. Route (b), adopting the game's own crowd body, and a stable identity key for community-spawned people are research questions queued with XF · Meta-coordinator, and are not tested here.

**What the engine needs from it:** a simulated resident (P3 §3.5) can stand in for a passer-by the protagonist notices, keep the same look and identity afterwards, and act on the engine's routine without breaking the street's illusion.

## Set-up

- The XF diagnostic profile, with the bridge's NPC permissions on.
- A busy street with a steady crowd in daylight. Kabuki market is ideal, since it is the engine's M3 district.
- A save near it, with the protagonist out of combat and not wanted by the police.
- Session log markers at the start of each probe (`session_note`), and a friction log throughout.

## Probes

The bridge commands for each probe, the pass boundaries as prepared for the session and the probes that stay partial are in the [test card's Crowd substitution (0.8.19) section](../../runtime/runtime-bridge-test-card.md#crowd-substitution-0819) (rows CRS1 to CRS15).

Each probe records its evidence: the `npc.list` or `scene.read` rows, the actor ids, screenshots where the look matters, and the session log.

| # | Probe | Pass when | Evidence |
|---|---|---|---|
| 1 | **Read a crowd person:** list crowd people within 30 m twice, 10 s apart | Record, appearance, position, heading and crowd flag read for each; note whether ids stay the same within the session | Two `npc.list` dumps |
| 2 | **Look match:** spawn an XF actor from the same record and appearance as a chosen crowd person, standing beside them | The two are indistinguishable at 3 m, or the difference is recorded (face, clothes, colours) | A side-by-side screenshot |
| 3 | **Substitution out of view:** choose a crowd person who is outside the protagonist's view or occluded, remove them, and spawn the matching actor at their position and heading | The swap is invisible when the protagonist turns back; the actor carries on walking in the same direction | Before and after screenshots, the log |
| 4 | **Substitution in view (expected to fail):** the same swap while the person is on screen | Records what the player would see (a pop, a flicker), so we know the swap must wait for occlusion | A short `capture_burst` |
| 5 | **Routine:** send the actor to a place 30 to 50 m away through the crowd, have them stop, face another actor and exchange one line, then walk on | Paths through the crowd without sliding or collisions; the exchange reads as two people talking | The log, screenshots |
| 6 | **Crowd reaction:** with the actor walking, fire a weapon into the air nearby | The actor reacts as the crowd does (flinch, flee); a stand-in that ignores gunfire is a finding | The log, a burst |
| 7 | **Release:** walk the actor out of view and dissolve them | No ghost body, no pop seen by the protagonist, and the crowd density looks unchanged | The log, a screenshot |
| 8 | **Streaming:** adopt one actor, walk the protagonist two blocks away until the area streams out, come back, and respawn the same resident at their routine spot | The same look as before; it reads as the same person | Screenshots of the actor before and after |
| 9 | **Reload:** save, reload, and respawn the same resident | The same look and place after the reload | Screenshots, the log |
| 10 | **Scale:** five substituted actors within 30 m, each walking a short routine | Frame time and behaviour recorded; note the count at which anything degrades | Frame statistics, the log |
| 11 | **Kill switch:** trigger it with actors live | Every actor is gone and the crowd is as before | The log, a screenshot |

## What the results decide

- **Probes 2 and 3** decide whether substitution can carry a resident's identity at all. If the look can't be matched, the engine binds residents only to people it spawns itself, and noticing a passer-by becomes "a resident who looks like them from then on", swapped at the next occlusion.
- **Probe 4** sets the rule that swaps wait for occlusion.
- **Probe 6** decides whether adopted people need their own reaction behaviour, so they don't stand out in a panic.
- **Probes 8 and 9** confirm that identity lives in the engine's key, not the game's body.
- **Probe 10** gives the budget for how many people the engine may drive at once.

## Friction log

Note every point of friction met in passing: anything slow to set up, any tool that needed a workaround, and anything that would give the engine more control.
