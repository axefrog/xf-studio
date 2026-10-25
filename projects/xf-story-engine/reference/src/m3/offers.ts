// M3 run 2's offer kits: hooks with an ask, grounded in what happened. Each kit tells one pattern of S1's record (a collector's demand at a
// stall, a theft, a beating, an accident, a street fight between crews, a scuffle in the crowd) as a request: the person it happened to tells
// the player's character about it, asks for something, and says what it is worth. The words are plain stand-ins written for the run, in the
// voice of a message from a local.
//
// Every pattern has two stages: the incident, and the victim telling V (a `disclosure` event caused by the incident, with V as its listener).
// The second stage is what the engine asks of an offer: V-link (V takes part in a stage's event, S3 gate 5) and a recorded cause on the last
// event (gate 3). S1 opens an incident into people only where V's focus is, so the incidents with named people are those V was near; the
// harness reports V's being told (`RunExtra.witness`), as the game's own report of what V saw will.
//
// The people are the ones the pattern binds (`subject`, `other`), so nothing in the words is a claim the world did not make. No kit names a
// main-story character, and nothing depends on who the player's character is: the words say "you". Stakes and rewards are not a price list: the
// clause of a request is chosen by what the world holds (the district's prices, whether the people know one another, how the stalls stand with
// the protagonist, how hard the fee is pressed, whether the police are pressing the district). Each kit has three actions with different stances
// and different costs, a decline, a null path, a lapse, and a consequence for each answer that an exit beat reads.

import type { SiftPattern } from '../procedural/types.ts';
import type { Role } from '../seeding/types.ts';
import { type OfferKit, offerPack, offerPattern } from './kits.ts';

const person: Role = { kind: 'core:person', onUnfilled: ['wait'] };
const CLAWS = { path: 'affc', op: 'eq', arg: 2 } as const;
const clawsPerson: Role = { ...person, must: [CLAWS] };
const stage = (kind: string, who: Array<[string, string]>, effects: NonNullable<SiftPattern['stages'][number]['effects']> = []): SiftPattern['stages'][number] => ({
  kind, who: who.map(([role, as]) => ({ role, as })), ...(effects.length ? { effects } : {}),
});
const pp = { kind: 'core:person' } as const;
/** The second stage of every offer pattern: the person it happened to tells V about it. */
const told = (teller: string): SiftPattern['stages'][number] => stage('disclosure', [['teller', teller], ['listener', '?me']]);
const WITHIN = 21_600;

/** A collector's demand at a stall: the stall is left owing. */
export const FEE_SHORTFALL: OfferKit = {
  id: 'fee-shortfall', tags: ['fee'], sender: 'other', stakeOf: 'the stall',
  roles: { subject: clawsPerson, other: person },
  pattern: {
    roles: { '?a': { kind: 'core:person', where: [CLAWS] }, '?v': pp, '?me': pp },
    stages: [stage('shakedown', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'take' }]), told('?v')],
    within: WITHIN, once: ['?a', '?v'], tags: ['fee'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} came to the stall for the Friday fee the Claws collect, and the till is short.' },
    { t: '{other.name}, who trades in the market, writes that the Claws sent {subject.name} for the Friday money, and there is not enough to give.' },
    { t: 'Message from {other.name}: {subject.name} had a hand out for the Claws again this morning, and I could not make the number.' },
    { t: '{other.name} on the line, short of breath: the Claws collector {subject.name} was at the till, and I told them to come back Friday.' },
    { t: '{other.name} messages you from behind the counter: the Claws sent {subject.name} for this Friday\'s fee early, and I could not cover it.' },
    { t: 'Heard from {other.name}, who sells in the market, that {subject.name} was at the till this morning with the Claws\' hand out and nothing in the till to put in it.' },
  ],
  ask: [
    { t: 'The Claws will want the fee from somebody by Friday, and it will be me. Cover the gap, speak to them for me, or tell them the stalls are done paying.' },
    { t: 'Someone has to square this before Friday or they send someone less patient. Pay it, bargain it down, or face the next collector yourself.' },
    { t: 'They will not let it lie. Will you cover what is owed, go and talk to them, or stand at the till when they come back?' },
    { t: 'The Claws are patient until they are not. Pay what is owed, bargain for time, or let them know the stalls will not be squeezed again.' },
  ],
  clause: [
    { t: 'I cannot put eddies on it, but I will owe you, and I pay what I owe.' },
    { t: 'There is nothing in the till for you, only a favour I will not forget.' },
    { t: 'Everything costs more this month and the till shows it. I can find two hundred and forty toward it, and your tab stays open.', when: ['priceHigh'] },
    { t: 'Goods are cheap and nobody is buying, so all I have is ninety eddies and my word.', when: ['priceLow'] },
    { t: 'The rows know you. Whatever you pick, they will back it.', when: ['trusted'] },
    { t: 'We have not really met, and I would not ask if the Claws would listen to anyone else.', when: ['unknownV'] },
    { t: 'The whole row is sick of the fee, and it would not take much for them to say so out loud.', when: ['feePressed'] },
    { t: 'With the police all over the district the Claws are jumpy, so whatever you do, do it quietly.', when: ['crackdown'] },
    { t: 'They have collected from this row for years and know what each of us makes.', when: ['known'] },
    { t: 'I had never seen that collector before this month, so this is the Claws leaning on us harder.', when: ['strangers'] },
    { t: 'I can only offer you a place behind the counter any time you come by, and my honest thanks.' },
    { t: 'Prices are climbing and the fee never does, so I can spare one hundred and eighty toward it, plus my thanks.', when: ['priceHigh'] },
    { t: 'Business is flat and goods are cheap, so I can offer sixty eddies and a discount on whatever you buy here.', when: ['priceLow'] },
    { t: 'The whole row has heard what you did and will stand behind you.', when: ['trusted'] },
    { t: 'I know nothing about you except that the Claws do not own you, which is more than I can say for most.', when: ['unknownV'] },
    { t: 'The police are out in force, so the Claws will not push hard before the weekend, which gives you time.', when: ['crackdown'] },
    { t: 'The stalls have started to say no among themselves, and a push from outside might tip it.', when: ['feePressed'] },
    { t: 'They have known this row for years and know exactly whose till to lean on.', when: ['known'] },
    { t: 'This one is new to the row, which means the Claws are testing us.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'cover', stance: 'help', foresight: 'Cover what is owed to the Claws.', cost: { bearer: 'v', what: 'money', when: 'now', shown: 'named' },
      outcomes: [
        { t: '{other.name} counted the notes twice and said nothing, then pressed a skewer into your hand. The next stall along had already seen.', when: ['trusted'] },
        { t: '{other.name} took the money with relief and some shame. The Claws will send somebody next Friday all the same.' },
        { t: '{other.name} paid the Claws on the spot with your money and did not meet your eye. The tab stays open.' },
      ],
    },
    {
      id: 'bargain', stance: 'bargain', foresight: 'Go and talk to the Claws about the fee.', cost: { bearer: 'v', what: 'time and standing with the Claws', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The Claws would not hear it. With the police about, nobody on their side is bargaining this week.', when: ['crackdown'] },
        { t: 'They listened, shrugged and settled for half. {other.name} will take the smaller fee and not look at you for long.' },
        { t: 'The Claws named a smaller figure and a date. {other.name} says it is fair and does not sound sure.' },
      ],
    },
    {
      id: 'stand', stance: 'oppose', foresight: 'Tell the next collector the stalls are done paying.', cost: { bearer: 'third', what: 'the stall, if the Claws answer', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The next collector looked at the row of stalls and at you, and went away without a word. For now.', when: ['feePressed'] },
        { t: 'You said it at the stall and the collector stared at you for a long moment before walking off. {other.name} did not breathe out until they were gone.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} nodded as if they had expected nothing else and went back to counting the till.' },
    { t: '{other.name} said they understood. The shutter on the stall came down early that Friday.' },
  ],
  notNow: 'Another time.', closing: 'That Friday is over.',
  settles: 'the fee is paid or it is not',
};

/** A theft in the crowd: the goods are still missing. */
export const GOODS_BACK: OfferKit = {
  id: 'goods-back', tags: ['theft'], sender: 'other', stakeOf: 'the stolen goods',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?a': pp, '?v': pp, '?me': pp },
    stages: [stage('theft', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'take' }]), told('?v')],
    within: WITHIN, once: ['?a', '?v'], tags: ['theft'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} lifted a bag off me in the Kabuki crowd and was gone before anyone moved.' },
    { t: 'Message from {other.name}: {subject.name} took my bag in the market crush, and nobody did a thing.' },
    { t: '{other.name} writes that {subject.name} worked the crowd and took a bag, and the bag has not turned up anywhere.' },
    { t: '{other.name} on the line: {subject.name} robbed me in the crowd by the market, and I want what was in the bag more than I want an apology.' },
    { t: '{other.name} messages you: someone saw {subject.name} slip a hand into my bag at the market and walk off with it.' },
    { t: '{other.name} writes that {subject.name} bumped into them by the stalls and left with a bag that was not theirs.' },
  ],
  ask: [
    { t: 'I want what was in it back. Find out who has it, lean on the thief\'s people until they hand it over, or cover the loss and I will square it with you later.' },
    { t: 'Can you get it back for me? Track down whoever has it, make it worth the thief\'s while to say where it went, or pay what it was worth and wait for my thanks.' },
    { t: 'I will take the goods or the value of them. Trace the bag, put pressure on the thief\'s crowd, or stand me the loss.' },
    { t: 'Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself.' },
  ],
  clause: [
    { t: 'What was in the bag matters more to me than the money. There is no other copy.' },
    { t: 'If it comes back, I will make sure the whole market hears who did it.' },
    { t: 'Replacing it would cost twice what it did last year, so I can spare three hundred and fifty for whoever gets it back.', when: ['priceHigh'] },
    { t: 'It was not worth much on a good day, but I will put eighty eddies on its return.', when: ['priceLow'] },
    { t: 'People say you look after this market, and this is what that looks like.', when: ['trusted'] },
    { t: 'I know you owe me nothing, and I am asking anyway.', when: ['unknownV'] },
    { t: 'The police are too busy sweeping the district to look for a bag, so nobody else is going to.', when: ['crackdown'] },
    { t: 'The thief drinks with half the row, which is why nobody will say where the bag went.', when: ['known'] },
    { t: 'Nobody on the row had seen the thief before, so somebody must have given the nod.', when: ['strangers'] },
    { t: 'There is a keepsake in it nobody else would want, and getting it back is worth more to me than the eddies.' },
    { t: 'With prices what they are, the bag was worth five hundred new, and I will give two hundred for it back.', when: ['priceHigh'] },
    { t: 'The bag was cheap and so is the reward, but there are fifty eddies and a free meal at my stall.', when: ['priceLow'] },
    { t: 'Everyone on the row says you are the one to ask when something goes missing.', when: ['trusted'] },
    { t: 'I do not know you, only that you are not part of whatever crowd has been working the market.', when: ['unknownV'] },
    { t: 'The patrols are watching curfew, not pickpockets, so this is down to whoever will do it.', when: ['crackdown'] },
    { t: 'The thief and I know the same people, so asking around myself would tell them I am looking.', when: ['known'] },
    { t: 'The thief is no one from this row, which makes it a job for someone with no ties here.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'trace', stance: 'bargain', foresight: 'Find out who has the goods.', cost: { bearer: 'v', what: 'time', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'A ripperdoc down the street had seen the bag change hands. {other.name} got the name and sat very still for a while.', when: ['known'] },
        { t: 'You followed the bag through two hands and a pawn counter. {other.name} will go and ask for it back themselves.' },
        { t: 'Nobody would say. After a day of asking, all you could tell {other.name} was which doors had closed.' },
      ],
    },
    {
      id: 'lean', stance: 'oppose', foresight: 'Lean on the thief\'s crowd for the goods.', cost: { bearer: 'third', what: 'a grudge from the thief\'s crowd', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The goods came back in a plastic sack with nothing missing. The thief\'s crowd would like it known they did not enjoy that.', when: ['trusted'] },
        { t: 'The bag turned up on {other.name}\'s doorstep the next morning with a note that said only "not again".' },
      ],
    },
    {
      id: 'replace', stance: 'help', foresight: 'Cover the loss yourself.', cost: { bearer: 'v', what: 'money', when: 'now', shown: 'named' },
      outcomes: [
        { t: '{other.name} took the money gratefully and said the thief would surface soon enough in a market this small.', when: ['strangers'] },
        { t: '{other.name} took the money, said it was more than fair, and pressed the receipt on you as if it mattered.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said they would manage and did not ask again.' },
    { t: '{other.name} turned back to the stall. The bag was never mentioned in your hearing again.' },
  ],
  notNow: 'Not yet.', closing: 'The talk about the bag moved on.',
  settles: 'the goods are found or they are not',
};

/** A beating, and nobody saying why. */
export const ASSAULT_WHY: OfferKit = {
  id: 'assault-why', tags: ['assault'], sender: 'other', stakeOf: 'the victim\'s safety and work',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?a': pp, '?v': pp, '?me': pp },
    stages: [stage('assault', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'harm' }]), told('?v')],
    within: WITHIN, once: ['?a', '?v'], tags: ['assault'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you from the clinic: {subject.name} put me on the pavement outside the market without a word of warning.' },
    { t: '{other.name} writes that {subject.name} beat them bloody near the market, and nobody will say what it was about.' },
    { t: 'Message from {other.name}: {subject.name} came at me in the street out of nowhere, and no one stepped in.' },
    { t: '{other.name} on the line, voice thick: {subject.name} did this, and it still makes no sense.' },
    { t: '{other.name} messages you, mostly in fragments: {subject.name} hit me hard outside the market, and I have no idea what for.' },
    { t: '{other.name} writes from a clinic cot that {subject.name} jumped them in the street, took nothing, and left.' },
  ],
  ask: [
    { t: 'Find out why they did it, or make sure they keep away from me, or just see me through the clinic.' },
    { t: 'Someone should learn what this was about, and someone should look after me while I cannot work. Ask around, have a word with the one who did it, or cover the clinic.' },
    { t: 'Will you ask around about why, face the one who did it, or see me home from the clinic?' },
    { t: 'I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself.' },
  ],
  clause: [
    { t: 'I cannot afford to lose a week of work, and nobody else is going to chase this for me.' },
    { t: 'If you find out why, I will tell you everything I know about them, which is more than I have told anyone else.' },
    { t: 'The clinic charges what it likes now. I can give you two hundred and sixty of what I have left.', when: ['priceHigh'] },
    { t: 'I have sixty eddies and a spare room, if either is any use to you.', when: ['priceLow'] },
    { t: 'I heard you stood up for someone near here before, and I am hoping that was not only a story.', when: ['trusted'] },
    { t: 'We have never spoken, and I know that makes this a lot to ask.', when: ['unknownV'] },
    { t: 'The police will not follow this up, not while they have the whole district to lean on.', when: ['crackdown'] },
    { t: 'We used to drink together, so this was never a stranger\'s quarrel.', when: ['known'] },
    { t: 'I had never seen them before today, and that is what frightens me.', when: ['strangers'] },
    { t: 'I have been here for years, and nobody has ever laid a hand on me before this.' },
    { t: 'The clinic bill alone is four hundred and I am short, so I can offer one hundred and fifty out of what is left.', when: ['priceHigh'] },
    { t: 'I do not have much, but there are forty eddies and a hot meal waiting any time you come by.', when: ['priceLow'] },
    { t: 'You helped people around here before, and word has gotten round.', when: ['trusted'] },
    { t: 'We have never met, and I would not ask if I had anyone else to turn to.', when: ['unknownV'] },
    { t: 'With the NCPD busy elsewhere, this will go nowhere unless somebody takes it up.', when: ['crackdown'] },
    { t: 'We have known each other for years, which makes this hurt more than a stranger\'s blow.', when: ['known'] },
    { t: 'They were a stranger to me, which is why I cannot even guess at a reason.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'ask-around', stance: 'bargain', foresight: 'Ask around about why it happened.', cost: { bearer: 'v', what: 'time', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'It took an evening. {subject.name} owed money to someone who owed money to someone else, and {other.name} was in the way of one of them.', when: ['strangers'] },
        { t: 'It took an evening. {subject.name} and {other.name} had history, and it was not the kind either would have told you about.', when: ['known'] },
        { t: 'You learned that {subject.name} had been paid to do it, and by whom nobody would say. {other.name} did not sleep that night.' },
      ],
    },
    {
      id: 'warn-off', stance: 'oppose', foresight: 'Face the attacker and warn them off.', cost: { bearer: 'third', what: 'a fight with the attacker\'s friends', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'You waited outside the precinct. {subject.name} looked at you, then at the pavement, and nodded once. That was all.', when: ['crackdown'] },
        { t: 'You told {subject.name} what would happen. They said nothing, and {other.name} says they have not seen them in the street since.' },
      ],
    },
    {
      id: 'see-home', stance: 'help', foresight: 'Cover the clinic and see them home.', cost: { bearer: 'v', what: 'money', when: 'now', shown: 'named' },
      outcomes: [
        { t: '{other.name} was home by dark and the stall next door sent over soup. The row noticed who had paid.', when: ['trusted'] },
        { t: 'You paid the clinic. {other.name} tried to refuse and then did not.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said that was fair and did not ask again.' },
    { t: 'You did not answer. {other.name} lay back and looked at the ceiling.' },
  ],
  notNow: 'Not right now.', closing: 'The beating was talked about for a day, and then it was not.',
  settles: 'the matter is talked about and left',
};

/** An accident that leaves someone laid up with a job they cannot do. */
export const ACCIDENT_ERRAND: OfferKit = {
  id: 'accident-errand', tags: ['accident'], sender: 'other', stakeOf: 'the job',
  roles: { other: person },
  pattern: {
    roles: { '?s': pp, '?me': pp },
    stages: [stage('accident', [['victim', '?s']], [{ on: '?s', effect: 'harm' }]), told('?s')],
    within: WITHIN, once: ['?s'], tags: ['accident'], binds: { other: '?s' },
  },
  opener: [
    { t: '{other.name} messages you from a clinic bed: an accident in Kabuki put me here, and the day\'s work is going to waste.' },
    { t: 'Message from {other.name}: I was caught in that accident in Kabuki and I cannot stand yet.' },
    { t: '{other.name} writes from the clinic that the accident in the street left them unable to walk, with a job waiting.' },
    { t: '{other.name} messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait.' },
    { t: 'Message from {other.name}: the accident in Kabuki broke my leg, and the job I should be doing is going undone.' },
  ],
  ask: [
    { t: 'I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work.' },
    { t: 'I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar.' },
    { t: 'I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota.' },
  ],
  clause: [
    { t: 'It is only a parcel, but it pays my rent, and the client does not give second chances.' },
    { t: 'I will pay you back by working for you, whatever you need, once I can stand.' },
    { t: 'Delivery rates have doubled this season, so there are three hundred and ten eddies in it for you.', when: ['priceHigh'] },
    { t: 'Runs pay badly now, but there are seventy eddies in it and my thanks.', when: ['priceLow'] },
    { t: 'People trust you with their things around here, so I am trusting you with mine.', when: ['trusted'] },
    { t: 'You will not know me from anyone, but there is nobody else I can send.', when: ['unknownV'] },
    { t: 'The police are checking couriers across the district, so you will have to move carefully.', when: ['crackdown'] },
    { t: 'It is a small thing, but small things keep me housed, and I have nobody else to ask.' },
    { t: 'Courier rates are up, so there is two hundred and sixty in it for you, and a tip from the client.', when: ['priceHigh'] },
    { t: 'Delivery work pays little now, but there are fifty eddies and a debt I will remember.', when: ['priceLow'] },
    { t: 'You have a name for getting things done around here, and I am hoping that is true.', when: ['trusted'] },
    { t: 'I have never seen you before, and still I would rather it was you than the people I know.', when: ['unknownV'] },
    { t: 'Checkpoints have been tightened, so whoever carries the parcel needs a clean story.', when: ['crackdown'] },
  ],
  actions: [
    {
      id: 'deliver', stance: 'help', foresight: 'Carry the parcel across Kabuki.', cost: { bearer: 'v', what: 'a night of your time', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'The client counted the contents, grunted, and sent word back that {other.name} was still on their list. You had checked every checkpoint on the way.', when: ['crackdown'] },
        { t: 'The client took the parcel without comment. {other.name} had the payment the next morning and sent half of it to you.' },
      ],
    },
    {
      id: 'delay', stance: 'bargain', foresight: 'Ask the client to wait.', cost: { bearer: 'v', what: 'a favour owed to the client', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The client wanted a favour for the delay, and you gave it. {other.name} kept the work and knows what it cost.', when: ['unknownV'] },
        { t: 'The client grumbled and gave {other.name} three more days. {other.name} says it will be enough.' },
      ],
    },
    {
      id: 'cover-shift', stance: 'help', foresight: 'Take the injured person\'s shift.', cost: { bearer: 'v', what: 'a shift of your own', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'You worked {other.name}\'s shift and the boss kept {other.name}\'s name on the rota. The staff offered you a drink after.', when: ['trusted'] },
        { t: 'You worked the shift. The tips were poor, the boss was fair, and {other.name} kept the job.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said they would find another way and lay back down.' },
    { t: '{other.name} thanked you for reading it. The parcel stayed on the locker.' },
  ],
  notNow: 'I will think about it.', closing: 'The accident was forgotten by the end of the week.',
  settles: 'the parcel is late, or someone else takes it',
};

/** A street fight between crews: the person who came off worse tells V, and fears what follows. */
export const CLASH_AFTERMATH: OfferKit = {
  id: 'clash-aftermath', tags: ['clash', 'gang'], sender: 'other', stakeOf: 'the victim\'s safety',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?a': pp, '?v': pp, '?me': pp },
    stages: [stage('gang-clash', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'harm' }]), told('?v')],
    within: WITHIN, once: ['?a', '?v'], tags: ['clash', 'gang'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} and I ended up on opposite sides of a street fight in Kabuki, and I came off worse.' },
    { t: 'Message from {other.name}: {subject.name} went for me in the middle of a crew fight near the market, and I am still shaking.' },
    { t: '{other.name} writes that the crews clashed on the street and {subject.name} picked them out of it.' },
    { t: '{other.name} messages you: {subject.name} swung at me in a fight between two crews near the market, and now I am a target.' },
    { t: '{other.name} writes that the crews met on the street, {subject.name} went for them, and they have not slept since.' },
  ],
  ask: [
    { t: 'Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do.' },
    { t: 'I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me.' },
    { t: 'I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking.' },
  ],
  clause: [
    { t: 'I have nothing the crews want, and that is exactly why I am afraid.' },
    { t: 'If you take this on, I will tell you who runs that corner and who they owe.' },
    { t: 'Everything is dearer and I have little, but there are three hundred eddies in it for you.', when: ['priceHigh'] },
    { t: 'There is not much to give, only eighty eddies and a place to sleep for the week.', when: ['priceLow'] },
    { t: 'People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.', when: ['trusted'] },
    { t: 'You will not know me, and I know it is a lot to ask a stranger.', when: ['unknownV'] },
    { t: 'With the police sweeping the district nobody will be looking at one more fight.', when: ['crackdown'] },
    { t: 'We used to run errands for the same people, so this is not a stranger\'s grudge.', when: ['known'] },
    { t: 'I had never seen them before the fight, so I do not know what I am supposed to have done.', when: ['strangers'] },
    { t: 'I never joined a crew, and I do not know why they think I did.' },
    { t: 'Rents are up and I have little, but there are two hundred and seventy eddies in it for you.', when: ['priceHigh'] },
    { t: 'I have fifty eddies and a corner of my floor to give.', when: ['priceLow'] },
    { t: 'The stalls say you are not afraid of crews, and that is what I need.', when: ['trusted'] },
    { t: 'You owe me nothing and I cannot promise much, but I am asking because I have no one else.', when: ['unknownV'] },
    { t: 'With patrols about, the crews are watching each other and nobody else, so a quiet word might still work.', when: ['crackdown'] },
    { t: 'We drank at the same bar, so I know exactly how petty a grudge can get.', when: ['known'] },
    { t: 'I do not know them at all, so I cannot guess what they think I did.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'carry-word', stance: 'bargain', foresight: 'Carry word to the other crew that it is over.', cost: { bearer: 'v', what: 'standing with the crew', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The crew listened to you in a doorway, took what you said as a favour owed and not as an apology, and let it be known that it was settled.', when: ['trusted'] },
        { t: 'You took the word across the street. {subject.name} shrugged, and nobody has come for {other.name} since.' },
      ],
    },
    {
      id: 'walk-home', stance: 'help', foresight: 'See them home by the safe way.', cost: { bearer: 'v', what: 'an evening', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'You walked {other.name} home by the long way. Nobody followed, and {other.name} left the light on until you were out of sight.', when: ['crackdown'] },
        { t: 'You saw {other.name} home. The street was empty, which was somehow worse.' },
      ],
    },
    {
      id: 'stand-with', stance: 'oppose', foresight: 'Stand with them when the crew comes.', cost: { bearer: 'third', what: 'a fight you did not start', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The crew came, saw the two of you on the corner, and kept walking. {subject.name} looked back once.', when: ['known'] },
        { t: 'It did not come to blows. {other.name} says the crew has found a different corner to worry about.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said they understood. Their stall was shut for a week.' },
    { t: 'You did not answer. {other.name} moved to a cousin\'s place across the district.' },
  ],
  notNow: 'Not tonight.', closing: 'The street fight turned into a story, and the story into a rumour.',
  settles: 'the grudge fades or it does not',
};

/** A scuffle in the crowd: someone who was caught in it asks V to find out who stirred it up. */
export const CROWD_SCUFFLE: OfferKit = {
  id: 'crowd-scuffle', tags: ['disorder'], sender: 'other', stakeOf: 'the market\'s peace',
  roles: { other: person },
  pattern: {
    roles: { '?p': pp, '?me': pp },
    stages: [stage('disorder', [['participant', '?p']]), told('?p')],
    within: WITHIN, once: ['?p'], tags: ['disorder'], binds: { other: '?p' },
  },
  opener: [
    { t: '{other.name} messages you: a scuffle broke out in the Kabuki crowd and I was caught in the middle of it.' },
    { t: 'Message from {other.name}: the crowd by the market turned ugly, and I was in the thick of it before I knew what was happening.' },
    { t: '{other.name} writes that the street went from busy to a brawl in a minute, and they still do not know who started it.' },
    { t: '{other.name} messages you: the crowd by the market went from calm to a brawl in seconds, and I still do not know why.' },
    { t: 'Message from {other.name}: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me.' },
  ],
  ask: [
    { t: 'I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight.' },
    { t: 'Somebody wanted that crowd angry. Find out who, keep the corner calm, or see me through it.' },
    { t: 'Whoever started it will do it again. Find out who, put yourself between them and the market, or help me get out of here.' },
  ],
  clause: [
    { t: 'It will happen again if nobody learns why, and next time I might not walk away.' },
    { t: 'I cannot pay you, but I know every stall on that row, and they will talk to me.' },
    { t: 'Prices are up and tempers with them. I can put two hundred and ten eddies toward finding out who is paying for this.', when: ['priceHigh'] },
    { t: 'Nobody has money to start a fight over, which is what makes it strange. I can give you seventy eddies.', when: ['priceLow'] },
    { t: 'The row says you keep a cool head, which is what the corner needs.', when: ['trusted'] },
    { t: 'You do not know me, and that may be why somebody will talk to you.', when: ['unknownV'] },
    { t: 'The police are busy sweeping the district and will not care about one scuffle.', when: ['crackdown'] },
    { t: 'I will tell you everything I saw, which was not much, and everything I heard, which was more.' },
    { t: 'Everything costs more, but I can give you two hundred and forty to learn who paid for the trouble.', when: ['priceHigh'] },
    { t: 'There is not much to give, only sixty eddies and my thanks.', when: ['priceLow'] },
    { t: 'Everyone says you keep your head when others lose theirs.', when: ['trusted'] },
    { t: 'You are new enough here that nobody will think you are on a side.', when: ['unknownV'] },
    { t: 'The NCPD are running sweeps instead of watching the crowd, so someone else has to.', when: ['crackdown'] },
  ],
  actions: [
    {
      id: 'find-instigator', stance: 'bargain', foresight: 'Ask around about who stirred it up.', cost: { bearer: 'v', what: 'time and a few favours', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'Someone had paid two kids to shove a stranger and shout. {other.name} was told, and decided to say nothing.', when: ['crackdown'] },
        { t: 'It began with a stolen seat and a grudge from last year. {other.name} laughed for the first time in days.' },
      ],
    },
    {
      id: 'cool-corner', stance: 'oppose', foresight: 'Quiet the corner before it boils over again.', cost: { bearer: 'third', what: 'a few enemies on the corner', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'You stood at the corner with the stallholders for an evening. Tempers cooled the way they do when someone is watching.', when: ['trusted'] },
        { t: 'You stood on the corner until closing and pointed out the one who kept starting it. They left, and the crowd let out its breath.' },
      ],
    },
    {
      id: 'see-clear', stance: 'help', foresight: 'See them clear of it.', cost: { bearer: 'v', what: 'an evening', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'You walked {other.name} out by the back of the market. They said very little and thanked you at the door.' },
        { t: '{other.name} took your arm past the stalls and did not let go until the metro.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said they would keep away from that corner and meant it.' },
    { t: 'The message sat unanswered. The crowd by the market was thinner for a week.' },
  ],
  notNow: 'Maybe later.', closing: 'The scuffle was forgotten by the end of the week.',
  settles: 'the corner calms, or it does not',
};

export const KITS: OfferKit[] = [FEE_SHORTFALL, GOODS_BACK, ASSAULT_WHY, ACCIDENT_ERRAND, CLASH_AFTERMATH, CROWD_SCUFFLE];
export const offerKitPack = () => offerPack(KITS);
export const offerPatterns = (): SiftPattern[] => KITS.map(offerPattern);
