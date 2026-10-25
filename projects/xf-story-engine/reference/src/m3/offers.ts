// M3 run 2's offer kits: hooks with an ask, grounded in what happened. Each kit tells one pattern of S1's record (a collector's demand and the
// police, a theft and the police, a beating, an accident, two thefts in the crowd, a scuffle that covered a theft) as a request: someone near
// the incident asks the player's character for something, with a reason the events supply, and says what it is worth. The words are plain
// stand-ins written for the run, in the voice of a message from a local.
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

/** A collector's demand at a stall and the police taking the collector: the stall is left owing. */
export const FEE_SHORTFALL: OfferKit = {
  id: 'fee-shortfall', tags: ['fee', 'police'], sender: 'other', stakeOf: 'the stall',
  roles: { subject: clawsPerson, other: person },
  pattern: {
    roles: { '?a': { kind: 'core:person', where: [CLAWS] }, '?v': pp },
    stages: [stage('shakedown', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'take' }]), stage('police-action', [['target', '?a'], ['victim', '?v']])],
    within: 172_800, once: ['?a', '?v'], tags: ['fee', 'police'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} came to the stall for the Friday fee and the NCPD took {subject.name} before a cred changed hands.' },
    { t: '{other.name}, who trades in the market, writes that the Claws sent {subject.name} for the Friday money and a patrol hauled {subject.name} away mid-demand.' },
    { t: 'Message from {other.name}: {subject.name} had a hand out for the Claws when the police pulled {subject.name} off the row.' },
    { t: '{other.name} on the line, short of breath: the Claws collector {subject.name} was taken by the NCPD right at the till.' },
  ],
  ask: [
    { t: 'The Claws will want the fee from somebody by Friday, and it will be me. Cover the gap, speak to them for me, or tell them the stalls are done paying.' },
    { t: 'Someone has to square this before Friday or they send someone less patient. Pay it, bargain it down, or face the next collector yourself.' },
    { t: 'They will not let it lie. Will you cover what is owed, go and talk to them, or stand at the till when they come back?' },
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
    { t: '{subject.name} has collected from this row for years and knows what each of us makes.', when: ['known'] },
    { t: 'I had never seen {subject.name} before this month, so this is the Claws leaning on us harder.', when: ['strangers'] },
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

/** A theft, the thief taken by the police, the goods still missing. */
export const GOODS_BACK: OfferKit = {
  id: 'goods-back', tags: ['theft', 'police'], sender: 'other', stakeOf: 'the stolen goods',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?a': pp, '?v': pp },
    stages: [stage('theft', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'take' }]), stage('police-action', [['target', '?a'], ['victim', '?v']])],
    within: 172_800, once: ['?a', '?v'], tags: ['theft', 'police'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} lifted a bag off {other.name} in the Kabuki crowd and a patrol had {subject.name} within the hour, but the bag was not on {subject.name}.' },
    { t: 'Message from {other.name}: the police picked up {subject.name} for the theft, and nothing {subject.name} was carrying belonged to me.' },
    { t: '{other.name} writes that {subject.name} took a bag in the market crush and was in a patrol car before dark. The goods are still missing.' },
    { t: '{other.name} on the line: {subject.name} is in custody for the theft and swears the bag was passed on before the police came.' },
  ],
  ask: [
    { t: 'I want what was in it back. Find out who has it, lean on {subject.name}\'s people until they hand it over, or cover the loss and I will square it with you later.' },
    { t: 'Can you get it back for me? Track down whoever has it, make it worth {subject.name}\'s while to say where it went, or pay what it was worth and wait for my thanks.' },
    { t: 'I will take the goods or the value of them. Trace the bag, put pressure on {subject.name}\'s crowd, or stand me the loss.' },
  ],
  clause: [
    { t: 'What was in the bag matters more to me than the money. There is no other copy.' },
    { t: 'If it comes back, I will make sure the whole market hears who did it.' },
    { t: 'Replacing it would cost twice what it did last year, so I can spare three hundred and fifty for whoever gets it back.', when: ['priceHigh'] },
    { t: 'It was not worth much on a good day, but I will put eighty eddies on its return.', when: ['priceLow'] },
    { t: 'People say you look after this market, and this is what that looks like.', when: ['trusted'] },
    { t: 'I know you owe me nothing, and I am asking anyway.', when: ['unknownV'] },
    { t: 'The police are too busy sweeping the district to look for a bag, so nobody else is going to.', when: ['crackdown'] },
    { t: '{subject.name} drinks with half the row, which is why nobody will say where the bag went.', when: ['known'] },
    { t: 'Nobody on the row had seen {subject.name} before, so somebody must have given the nod.', when: ['strangers'] },
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

/** A beating, the attacker taken by the police, and nobody saying why. */
export const ASSAULT_WHY: OfferKit = {
  id: 'assault-why', tags: ['assault', 'police'], sender: 'other', stakeOf: 'the victim\'s safety and work',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?a': pp, '?v': pp },
    stages: [stage('assault', [['aggressor', '?a'], ['victim', '?v']], [{ on: '?v', effect: 'harm' }]), stage('police-action', [['target', '?a'], ['victim', '?v']])],
    within: 172_800, once: ['?a', '?v'], tags: ['assault', 'police'], binds: { subject: '?a', other: '?v' },
  },
  opener: [
    { t: '{other.name} messages you from the clinic: {subject.name} put {other.name} on the pavement outside the market and the NCPD took {subject.name} away for it.' },
    { t: '{other.name} writes that {subject.name} beat {other.name} bloody near the market and was detained by a patrol, and nobody will say what it was about.' },
    { t: 'Message from {other.name}: {subject.name} came at {other.name} in the street without a word, and the police have {subject.name} now.' },
    { t: '{other.name} on the line, voice thick: {subject.name} did this, the NCPD hauled {subject.name} off, and it still makes no sense.' },
  ],
  ask: [
    { t: 'Find out why {subject.name} did it before they walk free, or make sure {subject.name} keeps away from me afterwards, or just see me through the clinic.' },
    { t: 'Someone should learn what this was about, and someone should look after me while I cannot work. Ask around, have a word with {subject.name}, or cover the clinic.' },
    { t: 'Will you ask around about {subject.name}, face {subject.name} when they let go, or see me home from the clinic?' },
  ],
  clause: [
    { t: 'I cannot afford to lose a week of work, and nobody else is going to chase this for me.' },
    { t: 'If you find out why, I will tell you everything I know about {subject.name}, which is more than I told the police.' },
    { t: 'The clinic charges what it likes now. I can give you two hundred and sixty of what I have left.', when: ['priceHigh'] },
    { t: 'I have sixty eddies and a spare room, if either is any use to you.', when: ['priceLow'] },
    { t: 'I heard you stood up for someone near here before, and I am hoping that was not only a story.', when: ['trusted'] },
    { t: 'We have never spoken, and I know that makes this a lot to ask.', when: ['unknownV'] },
    { t: 'The police will not follow this up, not while they have the whole district to lean on.', when: ['crackdown'] },
    { t: '{subject.name} and I used to drink together, so this was never a stranger\'s quarrel.', when: ['known'] },
    { t: 'I had never seen {subject.name} before today, and that is what frightens me.', when: ['strangers'] },
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
  id: 'accident-errand', tags: ['accident', 'police'], sender: 'other', stakeOf: 'the job',
  roles: { other: person },
  pattern: {
    roles: { '?s': pp },
    stages: [stage('accident', [['victim', '?s']], [{ on: '?s', effect: 'harm' }]), stage('police-action', [['victim', '?s']])],
    within: 172_800, once: ['?s'], tags: ['accident', 'police'], binds: { other: '?s' },
  },
  opener: [
    { t: '{other.name} messages you from a clinic bed: an accident in Kabuki put {other.name} here, and the NCPD have been asking questions all morning.' },
    { t: 'Message from {other.name}: I was caught in that accident in Kabuki, and the police report is still being written.' },
    { t: '{other.name} writes from the clinic that the accident left them unable to stand, and the NCPD turned up before the dust settled.' },
  ],
  ask: [
    { t: 'I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work.' },
    { t: 'I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar.' },
  ],
  clause: [
    { t: 'It is only a parcel, but it pays my rent, and the client does not give second chances.' },
    { t: 'I will pay you back by working for you, whatever you need, once I can stand.' },
    { t: 'Delivery rates have doubled this season, so there are three hundred and ten eddies in it for you.', when: ['priceHigh'] },
    { t: 'Runs pay badly now, but there are seventy eddies in it and my thanks.', when: ['priceLow'] },
    { t: 'People trust you with their things around here, so I am trusting you with mine.', when: ['trusted'] },
    { t: 'You will not know me from anyone, but there is nobody else I can send.', when: ['unknownV'] },
    { t: 'The police are checking couriers across the district, so you will have to move carefully.', when: ['crackdown'] },
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

/** Two thefts in the crowd close together. */
export const MARKET_HIT_TWICE: OfferKit = {
  id: 'market-hit-twice', tags: ['theft'], sender: 'other', stakeOf: 'the market\'s stalls',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?t1': pp, '?v1': pp, '?t2': pp, '?v2': pp },
    stages: [stage('theft', [['aggressor', '?t1'], ['victim', '?v1']], [{ on: '?v1', effect: 'take' }]), stage('theft', [['aggressor', '?t2'], ['victim', '?v2']], [{ on: '?v2', effect: 'take' }])],
    within: 86_400, once: ['?v1'], tags: ['theft'], binds: { subject: '?v1', other: '?v2' },
  },
  opener: [
    { t: '{other.name} messages you: {subject.name} lost a bag in the Kabuki crowd, and now so has {other.name}.' },
    { t: 'Message from {other.name}: that makes two thefts in the crowd in a day, {subject.name} first and now me.' },
    { t: '{other.name} writes that the crowd has been picked twice this week: {subject.name}\'s bag went first, and then {other.name}\'s.' },
  ],
  ask: [
    { t: 'Somebody is working the market and the police are not stopping them. Watch the stalls tonight, find out who is behind it, or put the fear into whoever it is.' },
    { t: 'If it carries on the stalls will shut. Can you keep watch for us, ask around about who is doing it, or give them reason to stop?' },
  ],
  clause: [
    { t: '{subject.name} and I will each put in what we can for whoever ends it.' },
    { t: 'I cannot name a price, but every stall on the row will remember who helped.' },
    { t: 'Everyone is stretched with prices up, but between us we can raise four hundred.', when: ['priceHigh'] },
    { t: 'We have little to give, but there are ninety eddies and free food for a week.', when: ['priceLow'] },
    { t: 'The row trusts you, which is more than I can say for the police.', when: ['trusted'] },
    { t: 'None of us knows you, which may help, because the thief will not know you either.', when: ['unknownV'] },
    { t: 'The police are chasing curfew breaches across the district and have no time for pickpockets.', when: ['crackdown'] },
    { t: '{subject.name} and I go back years, and neither of us has anything left to lose.', when: ['known'] },
    { t: '{subject.name} and I have never spoken, so this is no feud, just someone who has found an easy crowd.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'watch', stance: 'help', foresight: 'Watch the stalls through the evening.', cost: { bearer: 'v', what: 'an evening', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'You stood at the end of the row all evening. Nobody was robbed, and the stallholders left you food in a paper bag.', when: ['trusted'] },
        { t: 'You watched until the market closed. Nothing happened, which may be what watching is for.' },
      ],
    },
    {
      id: 'ask-around', stance: 'bargain', foresight: 'Ask around about who is behind it.', cost: { bearer: 'v', what: 'time and a few favours', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'Two kids from the arcade, one with a cousin on the Claws\' books. {other.name} decided not to take it further.', when: ['feePressed'] },
        { t: 'You asked in a dozen places and learned that the thefts were not the work of one person. {other.name} said that was somehow worse.' },
      ],
    },
    {
      id: 'put-fear', stance: 'oppose', foresight: 'Put the fear into whoever it is.', cost: { bearer: 'third', what: 'a score settled the hard way', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'You spent the night in the crowd. Someone with quick hands decided to work another district.', when: ['crackdown'] },
        { t: 'You found a boy with a stolen wallet and had a quiet word. The thefts stopped, and {other.name} did not ask how.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said they understood and went back to guarding their pockets.' },
    { t: 'The message sat unanswered. The row posted a handwritten notice about pickpockets and left it at that.' },
  ],
  notNow: 'Ask me again later.', closing: 'The crowd went on being a crowd.',
  settles: 'the thefts continue or they move on',
};

/** A scuffle in the crowd that left someone hurt and covered a theft. */
export const CRUSH_THEFT: OfferKit = {
  id: 'crush-theft', tags: ['theft', 'disorder'], sender: 'other', stakeOf: 'the stolen goods and the hurt',
  roles: { subject: person, other: person },
  pattern: {
    roles: { '?p': pp, '?t': pp, '?w': pp },
    stages: [stage('disorder', [['victim', '?p']], [{ on: '?p', effect: 'harm' }]), stage('theft', [['aggressor', '?t'], ['victim', '?w']], [{ on: '?w', effect: 'take' }])],
    within: 86_400, once: ['?p'], tags: ['theft', 'disorder'], binds: { subject: '?p', other: '?w' },
  },
  opener: [
    { t: '{other.name} messages you: a scuffle in the Kabuki crowd left {subject.name} hurt, and in the crush someone lifted {other.name}\'s bag.' },
    { t: 'Message from {other.name}: the crowd went wild near the market, {subject.name} was hurt, and while everyone looked the other way my bag went.' },
    { t: '{other.name} writes that the disorder in the crowd hurt {subject.name} and covered a theft, and the goods taken were {other.name}\'s.' },
  ],
  ask: [
    { t: 'I want the bag back, and I want to know who started the trouble. Find the thief, ask who was behind the scuffle, or look after {subject.name}, who took the worst of it.' },
    { t: 'Whoever caused the scuffle wanted the crowd looking the wrong way. Track down the thief, find out who stirred it up, or see {subject.name} safe.' },
  ],
  clause: [
    { t: 'I owe {subject.name} for being hurt in a crowd I should have steered us out of.' },
    { t: 'I cannot offer much, only the goods that come back and my word that I know who helped.' },
    { t: 'Everything is dearer, so I can put two hundred and ninety on finding the thief.', when: ['priceHigh'] },
    { t: 'Nothing in the bag is worth fighting over, but I will pay seventy eddies to get it back.', when: ['priceLow'] },
    { t: 'People here say the market is safer when you are in it, and I am hoping that is true.', when: ['trusted'] },
    { t: 'We have not met, but you are the only name that came up when we asked who might care.', when: ['unknownV'] },
    { t: 'The police are not looking into a scuffle when they have the whole district to sweep.', when: ['crackdown'] },
    { t: '{subject.name} and I have known each other for years, which is why I am angry as well as frightened.', when: ['known'] },
    { t: 'I do not know {subject.name} at all, so what happened to us can only have been chance, or someone else\'s plan.', when: ['strangers'] },
  ],
  actions: [
    {
      id: 'find-thief', stance: 'bargain', foresight: 'Track down the thief.', cost: { bearer: 'v', what: 'time', when: 'now', shown: 'named' },
      outcomes: [
        { t: 'The bag was in a locker at the metro. Nothing was missing but the cash. {other.name} thanked you for it and meant it.', when: ['strangers'] },
        { t: 'You found the thief in a bar two streets from the market, wearing the bag as if it were theirs. {other.name} did not press charges.' },
      ],
    },
    {
      id: 'find-instigator', stance: 'oppose', foresight: 'Find out who stirred up the scuffle.', cost: { bearer: 'third', what: 'trouble with whoever it was', when: 'later', shown: 'quiet' },
      outcomes: [
        { t: 'The trouble had been paid for, in small eddies, by someone who wanted the stalls to shut. You brought a name to {other.name}.', when: ['feePressed'] },
        { t: 'It began with a shove nobody would own up to. You came back with a story that sounded true and was not much use.' },
      ],
    },
    {
      id: 'look-after', stance: 'help', foresight: 'See the hurt person safe.', cost: { bearer: 'v', what: 'money and an evening', when: 'now', shown: 'named' },
      outcomes: [
        { t: '{subject.name} was patched up and put in a cab. The stalls remember who paid for it.', when: ['trusted'] },
        { t: '{subject.name} was seen to, grudgingly. {other.name} sent word that the debt was now between the two of you.' },
      ],
    },
  ],
  declined: [
    { t: '{other.name} said nothing and went to see to {subject.name} on their own.' },
    { t: 'The bag was never recovered. {other.name} stopped bringing a bag to the market.' },
  ],
  notNow: 'Let me think.', closing: 'The scuffle turned into a story, and the story into a rumour.',
  settles: 'the thief and the instigator are found, or they are not',
};

export const KITS: OfferKit[] = [FEE_SHORTFALL, GOODS_BACK, ASSAULT_WHY, ACCIDENT_ERRAND, MARKET_HIT_TWICE, CRUSH_THEFT];
export const offerKitPack = () => offerPack(KITS);
export const offerPatterns = (): SiftPattern[] => KITS.map(offerPattern);
