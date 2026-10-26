// D-30 / S2 2.16a: the authorisation belongs to the world's decision and is
// rechecked at every play/write, including after an earlier beat was released.
import { processCause } from '../evolution.ts';
import type { Instance, Layer2 } from './layer2.ts';

export function encounterAllowed(l2: Layer2, inst: Instance): boolean {
  const k = l2.k;
  for (const role of Object.values(inst.st.roles)) {
    if (!role.cast) continue;
    const event = k.events.mintedSpec(role.cast);
    if (event?.kind !== 'confront' || !event.participants?.some((p) => p.role === 'confronted' && p.who === k.vId)) continue;
    const refuse = (why: string): false => {
      l2.record(inst, 'write-refused', { rule: 'encounter-authorisation', event: role.cast, why });
      l2.withdraw(inst, why); return false;
    };
    if (event.creator !== processCause('scene.acts')) return refuse('the encounter was not minted by scene.acts');
    if (k.settings.current().tempo !== 'restless') return refuse('the current tempo does not allow a hunt encounter');
    const decision = (event.causes ?? []).map((id) => k.events.mintedSpec(id)).find((e) => e?.kind === 'decide.punish');
    const group = decision?.participants?.find((p) => p.role === 'group')?.who;
    const port = l2.reg.sim;
    if (!group || !port?.builds('intentAgainst')) {
      l2.record(inst, 'prepare-failed', { rule: 'encounter-authorisation', why: 'the group intention cannot be read' });
      return false;
    }
    const transitions = port.transitions('intentAgainst', [group, k.vId], event.time, k.now);
    if (!transitions.length || transitions.some((x) => x.value === 'maybe')) {
      l2.record(inst, 'prepare-failed', { rule: 'encounter-authorisation', why: 'the intention history is incomplete' });
      return false;
    }
    if (transitions[0].t !== event.time || transitions.some((x) => x.value !== 'hunt')
      || port.eval('intentAgainst', [group, k.vId], k.now) !== 'hunt')
      return refuse('the group has not continuously hunted since this encounter');
  }
  return true;
}
