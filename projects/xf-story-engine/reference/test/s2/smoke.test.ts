import { describe, expect, test } from 'bun:test';
import { R1_ID, R1_PACK, r1Pack } from './r1.ts';
import { makeWorld, setFact, spots, takemura, settle, tickTo } from './world.ts';

const dump = (inst: any, n = 8) => inst.st.record.slice(-n).map((r: any) => `${r.kind}:${JSON.stringify(r.data)}`).join('\n');

describe('smoke', () => {
  test('R1 flow', () => {
    const w = makeWorld('SF-7');
    spots(w);
    takemura(w, 0);
    setFact(w, 'q112_done', 0, 0);
    setFact(w, 'q115_point_of_no_return', 0, 0);
    setFact(w, 'q112_takemura_dead', 0, 0);
    w.l2.installPack(r1Pack());
    settle(w);
    const inst = w.l2.ofTemplate(R1_ID)[0]!;
    setFact(w, 'q112_done', 1, 10);
    settle(w);
    console.log('state', inst.st.state, dump(inst, 6), [...w.l2.queue.keys()].length, w.k.layer2 === w.l2);
    w.l2.advancePlay(5);
    const offer = inst.st.deliveries[0]!;
    console.log('offer', offer.id, offer.state);
    w.l2.display({ delivery: offer.id, channel: 'message', grade: 'confirmed', atPlay: 6 });
    console.log('after display', offer.state, offer.offerEvent);
    expect(w.l2.respond(offer.id, { kind: 'decline', id: 'decline' })).toBe(true);
    settle(w);
    console.log('after decline', inst.st.state);
    console.log(dump(inst, 10));
    console.log(JSON.stringify(inst.st.deliveries.map((d) => ({ id: d.id, state: d.state, beat: d.beat, what: d.what })), null, 1));
    w.l2.advancePlay(70);
    console.log(dump(inst, 6));
    const exit = inst.st.deliveries.find((d) => d.beat === 'exit-decline')!;
    console.log('exit', exit?.state);
    w.l2.display({ delivery: exit.id, channel: 'message', grade: 'presented', atPlay: 71 });
    w.l2.contentCompleted(exit.id);
    settle(w);
    console.log(dump(inst, 6), inst.st.state);
    tickTo(w, 10 + 1209600 + 700);
    console.log(inst.st.state, dump(inst, 8));
  });
});
