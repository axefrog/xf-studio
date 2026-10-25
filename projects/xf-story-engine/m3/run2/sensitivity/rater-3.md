# Blind rating: hooks in a city district

You are one of several independent raters. You will read short pieces of text, each a "card". Each card is something that reaches the player character, V, in the Kabuki district of Night City in the game Cyberpunk 2077. The cards come from different sources. You are not told which, and you should not try to find out from anything but the text itself.

Rate each card on the four scales below, on your own, before looking at any other card's rating. Then answer the two guess questions. Then do the pairs: for each pair, pick the one you would rather follow up and the one that reads as more caused.

Scales (1 to 7, whole numbers):
- **caused**: Does it read as something that happened for a reason (rather than being arranged to give you a task)? 1 = no reason at all, 7 = clearly caused.
- **legible**: Is it clear what is going on and what a person in your position could do about it? 1 = baffling, 7 = completely clear.
- **setting**: Does it sound like it belongs in a Night City district: its people, its pressures, its voice? 1 = could be anywhere, 7 = unmistakably here.
- **pull**: Would you want to follow this up? 1 = not at all, 7 = at once.

Guess questions, for each card:
- **made_by**: "person" if you think a person wrote this card for this exact situation, "program" if you think a program put it together from a template or parts. Say one word.
- **cue**: in a few words, what in the text gave it away, or "none".

Answer in JSON only, in this shape:

{"rater": "<your name or id>", "cards": {"H-001": {"caused": 4, "legible": 5, "setting": 3, "pull": 4, "made_by": "program", "cue": "..."}, ...}, "pairs": {"P-001": {"follow": "left", "caused": "right"}, ...}, "critic": "<optional: after finishing, a paragraph naming what made some cards read as generated, and which patterns you saw repeat>"}

Use the cards in the order given to you. Do not skip any.

---

## Cards

### H-007

Sakura Mori writes that the crews clashed on the street and Woojin Kim picked them out of it. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

### H-092

Message from Quinn Nolan: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You have a name for getting things done around here, and I am hoping that is true.

### H-082

Fang Liu, a labourer, has a sealed case that has to get from the market stalls to Sanjay Rao before closing. 250 eddies on delivery, no questions.

### H-022

Hui Sun messages you: Jiro Okada was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-039

Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

### H-090

Diego Salazar messages you: Misaki Sakamoto was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-096

Bo Zhang wants Quynh Ly, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-088

Bea Tolentino writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You will not know me from anyone, but there is nobody else I can send.

### H-050

Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

### H-053

Emi Mori writes that the crews met on the street, Hui Zhang went for them, and they have not slept since. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### H-051

Huong Ngo messages you: Dahye Han was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-076

Lidia Orlov owes Amara Osei money and has stopped answering. Collect it from Lidia Orlov, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### H-045

Jiho Kang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. Somebody wanted that crowd angry. Find out who, keep the corner calm, or see me through it. You do not know me, and that may be why somebody will talk to you.

### H-011

Takeshi Hayashi messages you: Yui Inoue was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-080

Ryo Maeda, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Dawson before closing. 250 eddies on delivery, no questions.

### H-025

Maricel Pangilinan writes that Zora Washington worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Everyone on the row says you are the one to ask when something goes missing.

### H-024

Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### H-065

Aiko Matsuda has not heard from Javier Vargas in three days. Find out where Javier Vargas went. 500 eddies.

### H-034

Tatsuya Yamaguchi messages you: Itsuki Yamaguchi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-018

Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

### H-085

Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

### H-030

Noriko Hashimoto messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

### H-047

Yui Shimizu messages you: Haruto Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-013

Jericho Villanueva has not heard from Katya Novak in three days. Find out where Katya Novak went. 500 eddies.

### H-004

Leila Jaber messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You have a name for getting things done around here, and I am hoping that is true.

### H-008

Taeyang Kim, a service worker, has a sealed case that has to get from the market stalls to Thao Duong before closing. 250 eddies on delivery, no questions.

### H-006

Walid Jaber messages you: Kaori Inoue was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-068

Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

### H-021

Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

### H-027

Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

### H-084

Ryo Watanabe, a service worker, has a sealed case that has to get from the market stalls to Rui Sun before closing. 250 eddies on delivery, no questions.

### H-037

Malik Mitchell messages you: Mei Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-073

Ivo Popov on the line, short of breath: the Claws collector Haneul Song was at the till, and I told them to come back Friday. Someone has to square this before Friday or they send someone less patient. Pay it, bargain it down, or face the next collector yourself. The stalls have started to say no among themselves, and a push from outside might tip it.

### H-012

Linh Ngo writes from a clinic cot that Daichi Yamaguchi jumped them in the street, took nothing, and left. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. I had never seen them before today, and that is what frightens me.

### H-033

Darnell Tucker messages you: Jiro Hayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-001

Someone took Qing Zhao's credstick near a bar off the market. Qing Zhao wants it back and does not care how. 500 eddies when it is returned.

### H-060

Kaori Okada, a labourer, has a sealed case that has to get from the market stalls to Yan Liu before closing. 250 eddies on delivery, no questions.

### H-058

Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

### H-063

Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### H-093

Daeho Kang messages you: Nestor Bautista was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-054

Amara Osei has to cross Kabuki after dark and does not want to go alone. Walk with Amara Osei from a bar off the market to the metro entrance. 250 eddies.

### H-066

Jordan Garrett messages you: Sora Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-079

Elena Reyes on the line: Daichi Ishikawa robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### H-056

Misaki Aoki writes that the crews clashed on the street and Hyunwoo Choi picked them out of it. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. With patrols about, the crews are watching each other and nobody else, so a quiet word might still work.

### H-041

Elena Cruz wants Bao Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-052

Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

### H-091

Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

### H-020

Rania Saleh messages you: Bao Nguyen was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-070

Someone took Lidia Zielinski's credstick near a bar off the market. Lidia Zielinski wants it back and does not care how. 500 eddies when it is returned.

### H-005

Itsuki Ogawa writes that the crews met on the street, Carlo Roxas went for them, and they have not slept since. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You will not know me, and I know it is a lot to ask a stranger.

### H-094

Mei Hayashi messages you: Misaki Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-095

Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### H-031

Message from Misaki Shimizu: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

### H-061

Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### H-029

Keisha Rhodes messages you: Yui Yamaguchi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-048

Kenji Matsuda has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Matsuda from a bar off the market to the metro entrance. 250 eddies.

### H-078

Jericho Villanueva thinks Katya Novak is meeting someone at the ripperdoc. Follow Katya Novak and report who it is. 500 eddies.

### H-087

Yui Shimizu messages you: someone saw Jericho Magsaysay slip a hand into my bag at the market and walk off with it. I will take the goods or the value of them. Trace the bag, put pressure on the thief's crowd, or stand me the loss. The patrols are watching curfew, not pickpockets, so this is down to whoever will do it.

### H-035

Itsuki Fujita messages you: Sora Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-015

Tatsuya Okada messages you from the clinic: Emi Mori put me on the pavement outside the market without a word of warning. Find out why they did it, or make sure they keep away from me, or just see me through the clinic. I had never seen them before today, and that is what frightens me.

### H-042

Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

### H-086

Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### H-075

Mai Lam messages you: Hui Wu was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-043

Ling Sun owes Jericho Santos money and has stopped answering. Collect it from Ling Sun, who drinks near a bar off the market. You keep a cut: 500 eddies.

### H-083

Jisoo Choi has not heard from Tatsuya Shimizu in three days. Find out where Tatsuya Shimizu went. 500 eddies.

### H-028

Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

### H-019

Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

### H-064

Bo Huang messages you: Samira Said was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-072

Fang Xu messages you: Emi Kondo was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-077

Noriko Sato wants Minh Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-032

Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### H-026

Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

### H-049

Zara Reddy messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. People trust you with their things around here, so I am trusting you with mine.

### H-089

Kaori Okada thinks Haruto Matsuda is meeting someone at the ripperdoc. Follow Haruto Matsuda and report who it is. 500 eddies.

### H-057

Liza Roxas messages you: Yui Shimizu was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-046

Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

### H-071

Bogdan Kovacs messages you: Sora Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-009

Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

### H-067

Taeyang Kim, a service worker, has a sealed case that has to get from the ripperdoc to Takeshi Ishikawa before closing. 250 eddies on delivery, no questions.

### H-014

Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

### H-016

Sora Okada messages you: Ying Wu and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### H-074

Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

### H-062

Hana Watanabe messages you: Yui Hayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-003

Someone took Zara Nair's jacket near the market stalls. Zara Nair wants it back and does not care how. 500 eddies when it is returned.

### H-002

Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

### H-023

Tyler Pierce messages you: Itsuki Sakamoto and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### H-055

Yan Zhao messages you: Misaki Hashimoto was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-036

The terminal at Mai Trinh's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

### H-040

Sakura Inoue owes Haruto Sakamoto money and has stopped answering. Collect it from Sakura Inoue, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### H-081

Khoa Tran messages you: Kaori Matsuda was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-038

Message from Joon Han: Daichi Sakamoto went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### H-069

Xiu Zhou messages you: Tatsuya Mori swung at me in a fight between two crews near the market, and now I am a target. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. I do not know them at all, so I cannot guess what they think I did.

### H-059

Taeyang Park wants Karim Khalil, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-044

Message from Zora Rhodes: Daichi Inoue went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

### H-017

Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

### H-010

Fang Zhao messages you: Fang He was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

---

## Pairs

### P-068

Left: Bo Zhang wants Quynh Ly, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### P-046

Left: Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

Right: Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

### P-036

Left: Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

Right: Tyler Pierce messages you: Itsuki Sakamoto and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### P-058

Left: The terminal at Mai Trinh's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

Right: Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

### P-074

Left: Someone took Zara Nair's jacket near the market stalls. Zara Nair wants it back and does not care how. 500 eddies when it is returned.

Right: Fang Zhao messages you: Fang He was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-051

Left: Amara Osei has to cross Kabuki after dark and does not want to go alone. Walk with Amara Osei from a bar off the market to the metro entrance. 250 eddies.

Right: Message from Quinn Nolan: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You have a name for getting things done around here, and I am hoping that is true.

### P-042

Left: Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

### P-004

Left: Lidia Orlov owes Amara Osei money and has stopped answering. Collect it from Lidia Orlov, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Bea Tolentino writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You will not know me from anyone, but there is nobody else I can send.

### P-088

Left: Jericho Villanueva thinks Katya Novak is meeting someone at the ripperdoc. Follow Katya Novak and report who it is. 500 eddies.

Right: Keisha Rhodes messages you: Yui Yamaguchi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-080

Left: Someone took Lidia Zielinski's credstick near a bar off the market. Lidia Zielinski wants it back and does not care how. 500 eddies when it is returned.

Right: Yui Shimizu messages you: Haruto Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-086

Left: Kaori Okada thinks Haruto Matsuda is meeting someone at the ripperdoc. Follow Haruto Matsuda and report who it is. 500 eddies.

Right: Rania Saleh messages you: Bao Nguyen was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-093

Left: Liza Roxas messages you: Yui Shimizu was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Fang Liu, a labourer, has a sealed case that has to get from the market stalls to Sanjay Rao before closing. 250 eddies on delivery, no questions.

### P-001

Left: Jericho Villanueva thinks Katya Novak is meeting someone at the ripperdoc. Follow Katya Novak and report who it is. 500 eddies.

Right: Xiu Zhou messages you: Tatsuya Mori swung at me in a fight between two crews near the market, and now I am a target. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. I do not know them at all, so I cannot guess what they think I did.

### P-021

Left: Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: Someone took Qing Zhao's credstick near a bar off the market. Qing Zhao wants it back and does not care how. 500 eddies when it is returned.

### P-025

Left: Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

Right: Xiu Zhou messages you: Tatsuya Mori swung at me in a fight between two crews near the market, and now I am a target. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. I do not know them at all, so I cannot guess what they think I did.

### P-019

Left: Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

Right: Kaori Okada thinks Haruto Matsuda is meeting someone at the ripperdoc. Follow Haruto Matsuda and report who it is. 500 eddies.

### P-092

Left: Fang Xu messages you: Emi Kondo was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Bo Zhang wants Quynh Ly, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-065

Left: Yui Shimizu messages you: someone saw Jericho Magsaysay slip a hand into my bag at the market and walk off with it. I will take the goods or the value of them. Trace the bag, put pressure on the thief's crowd, or stand me the loss. The patrols are watching curfew, not pickpockets, so this is down to whoever will do it.

Right: Taeyang Kim, a service worker, has a sealed case that has to get from the ripperdoc to Takeshi Ishikawa before closing. 250 eddies on delivery, no questions.

### P-030

Left: Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

Right: Maricel Pangilinan writes that Zora Washington worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Everyone on the row says you are the one to ask when something goes missing.

### P-090

Left: Aiko Matsuda has not heard from Javier Vargas in three days. Find out where Javier Vargas went. 500 eddies.

Right: Mai Lam messages you: Hui Wu was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-060

Left: Ryo Maeda, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Dawson before closing. 250 eddies on delivery, no questions.

Right: Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### P-031

Left: Itsuki Ogawa writes that the crews met on the street, Carlo Roxas went for them, and they have not slept since. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You will not know me, and I know it is a lot to ask a stranger.

Right: Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### P-089

Left: Itsuki Fujita messages you: Sora Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Taeyang Kim, a service worker, has a sealed case that has to get from the ripperdoc to Takeshi Ishikawa before closing. 250 eddies on delivery, no questions.

### P-010

Left: Taeyang Kim, a service worker, has a sealed case that has to get from the market stalls to Thao Duong before closing. 250 eddies on delivery, no questions.

Right: Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

### P-029

Left: Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

Right: Emi Mori writes that the crews met on the street, Hui Zhang went for them, and they have not slept since. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### P-038

Left: Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

Right: Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

### P-076

Left: Diego Salazar messages you: Misaki Sakamoto was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Taeyang Kim, a service worker, has a sealed case that has to get from the market stalls to Thao Duong before closing. 250 eddies on delivery, no questions.

### P-094

Left: Bogdan Kovacs messages you: Sora Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Lidia Orlov owes Amara Osei money and has stopped answering. Collect it from Lidia Orlov, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### P-016

Left: Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

Right: Fang Liu, a labourer, has a sealed case that has to get from the market stalls to Sanjay Rao before closing. 250 eddies on delivery, no questions.

### P-066

Left: Kaori Okada thinks Haruto Matsuda is meeting someone at the ripperdoc. Follow Haruto Matsuda and report who it is. 500 eddies.

Right: Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### P-059

Left: Ling Sun owes Jericho Santos money and has stopped answering. Collect it from Ling Sun, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Linh Ngo writes from a clinic cot that Daichi Yamaguchi jumped them in the street, took nothing, and left. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. I had never seen them before today, and that is what frightens me.

### P-037

Left: Yui Shimizu messages you: someone saw Jericho Magsaysay slip a hand into my bag at the market and walk off with it. I will take the goods or the value of them. Trace the bag, put pressure on the thief's crowd, or stand me the loss. The patrols are watching curfew, not pickpockets, so this is down to whoever will do it.

Right: Misaki Aoki writes that the crews clashed on the street and Hyunwoo Choi picked them out of it. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. With patrols about, the crews are watching each other and nobody else, so a quiet word might still work.

### P-039

Left: Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

Right: Message from Quinn Nolan: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You have a name for getting things done around here, and I am hoping that is true.

### P-045

Left: Message from Joon Han: Daichi Sakamoto went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

Right: Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

### P-071

Left: Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

Right: Jericho Villanueva thinks Katya Novak is meeting someone at the ripperdoc. Follow Katya Novak and report who it is. 500 eddies.

### P-073

Left: Khoa Tran messages you: Kaori Matsuda was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Jericho Villanueva has not heard from Katya Novak in three days. Find out where Katya Novak went. 500 eddies.

### P-082

Left: Kenji Matsuda has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Matsuda from a bar off the market to the metro entrance. 250 eddies.

Right: Malik Mitchell messages you: Mei Kobayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-096

Left: Yan Zhao messages you: Misaki Hashimoto was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Ryo Maeda, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Dawson before closing. 250 eddies on delivery, no questions.

### P-091

Left: Bo Huang messages you: Samira Said was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Sakura Inoue owes Haruto Sakamoto money and has stopped answering. Collect it from Sakura Inoue, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### P-063

Left: Itsuki Ogawa writes that the crews met on the street, Carlo Roxas went for them, and they have not slept since. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You will not know me, and I know it is a lot to ask a stranger.

Right: Jericho Villanueva has not heard from Katya Novak in three days. Find out where Katya Novak went. 500 eddies.

### P-023

Left: Taeyang Park wants Karim Khalil, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Sora Okada messages you: Ying Wu and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### P-049

Left: Lidia Orlov owes Amara Osei money and has stopped answering. Collect it from Lidia Orlov, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Message from Joon Han: Daichi Sakamoto went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

### P-078

Left: Noriko Sato wants Minh Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Takeshi Hayashi messages you: Yui Inoue was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-028

Left: Bea Tolentino writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You will not know me from anyone, but there is nobody else I can send.

Right: Jiho Kang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. Somebody wanted that crowd angry. Find out who, keep the corner calm, or see me through it. You do not know me, and that may be why somebody will talk to you.

### P-069

Left: Zara Reddy messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. People trust you with their things around here, so I am trusting you with mine.

Right: Elena Cruz wants Bao Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-053

Left: Jisoo Choi has not heard from Tatsuya Shimizu in three days. Find out where Tatsuya Shimizu went. 500 eddies.

Right: Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

### P-095

Left: Jisoo Choi has not heard from Tatsuya Shimizu in three days. Find out where Tatsuya Shimizu went. 500 eddies.

Right: Hana Watanabe messages you: Yui Hayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-013

Left: Misaki Aoki writes that the crews clashed on the street and Hyunwoo Choi picked them out of it. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. With patrols about, the crews are watching each other and nobody else, so a quiet word might still work.

Right: Someone took Lidia Zielinski's credstick near a bar off the market. Lidia Zielinski wants it back and does not care how. 500 eddies when it is returned.

### P-033

Left: Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: Leila Jaber messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You have a name for getting things done around here, and I am hoping that is true.

### P-085

Left: Amara Osei has to cross Kabuki after dark and does not want to go alone. Walk with Amara Osei from a bar off the market to the metro entrance. 250 eddies.

Right: Jordan Garrett messages you: Sora Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-014

Left: Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

Right: Bo Zhang wants Quynh Ly, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-041

Left: Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

Right: Tatsuya Okada messages you from the clinic: Emi Mori put me on the pavement outside the market without a word of warning. Find out why they did it, or make sure they keep away from me, or just see me through the clinic. I had never seen them before today, and that is what frightens me.

### P-040

Left: Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

Right: Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

### P-017

Left: Someone took Zara Nair's jacket near the market stalls. Zara Nair wants it back and does not care how. 500 eddies when it is returned.

Right: Tatsuya Okada messages you from the clinic: Emi Mori put me on the pavement outside the market without a word of warning. Find out why they did it, or make sure they keep away from me, or just see me through the clinic. I had never seen them before today, and that is what frightens me.

### P-020

Left: Taeyang Kim, a service worker, has a sealed case that has to get from the ripperdoc to Takeshi Ishikawa before closing. 250 eddies on delivery, no questions.

Right: Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

### P-064

Left: Message from Misaki Shimizu: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

Right: Aiko Matsuda has not heard from Javier Vargas in three days. Find out where Javier Vargas went. 500 eddies.

### P-008

Left: Kaori Okada, a labourer, has a sealed case that has to get from the market stalls to Yan Liu before closing. 250 eddies on delivery, no questions.

Right: Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

### P-055

Left: Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

Right: Someone took Lidia Zielinski's credstick near a bar off the market. Lidia Zielinski wants it back and does not care how. 500 eddies when it is returned.

### P-075

Left: Kaori Okada, a labourer, has a sealed case that has to get from the market stalls to Yan Liu before closing. 250 eddies on delivery, no questions.

Right: Hui Sun messages you: Jiro Okada was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-083

Left: Darnell Tucker messages you: Jiro Hayashi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Ryo Watanabe, a service worker, has a sealed case that has to get from the market stalls to Rui Sun before closing. 250 eddies on delivery, no questions.

### P-024

Left: Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

Right: Noriko Sato wants Minh Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-022

Left: Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

Right: Amara Osei has to cross Kabuki after dark and does not want to go alone. Walk with Amara Osei from a bar off the market to the metro entrance. 250 eddies.

### P-034

Left: Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

Right: Noriko Hashimoto messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

### P-087

Left: Mei Hayashi messages you: Misaki Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Taeyang Park wants Karim Khalil, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-005

Left: Sakura Inoue owes Haruto Sakamoto money and has stopped answering. Collect it from Sakura Inoue, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Emi Mori writes that the crews met on the street, Hui Zhang went for them, and they have not slept since. I cannot go back to that corner while this is open. Take word to the other crew, see me home, or face them with me. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### P-044

Left: Jiro Ishikawa messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. You will not know me from anyone, but there is nobody else I can send.

Right: Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

### P-018

Left: Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: The terminal at Mai Trinh's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

### P-012

Left: Jericho Villanueva has not heard from Katya Novak in three days. Find out where Katya Novak went. 500 eddies.

Right: Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

### P-084

Left: Elena Cruz wants Bao Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Daeho Kang messages you: Nestor Bautista was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-052

Left: Kenji Matsuda has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Matsuda from a bar off the market to the metro entrance. 250 eddies.

Right: Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

### P-067

Left: Sakura Inoue owes Haruto Sakamoto money and has stopped answering. Collect it from Sakura Inoue, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Itsuki Ishikawa writes that Nora Carter beat them bloody near the market, and nobody will say what it was about. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. You helped people around here before, and word has gotten round.

### P-047

Left: Sora Okada messages you: Ying Wu and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

Right: Zara Reddy messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. People trust you with their things around here, so I am trusting you with mine.

### P-035

Left: Javier Romero on the line: Ryo Maeda robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Get the bag back to me, whatever shape it is in. Find who is holding it, lean on whoever put the thief up to it, or make good the loss yourself. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: Ivo Popov on the line, short of breath: the Claws collector Haneul Song was at the till, and I told them to come back Friday. Someone has to square this before Friday or they send someone less patient. Pay it, bargain it down, or face the next collector yourself. The stalls have started to say no among themselves, and a push from outside might tip it.

### P-056

Left: Noriko Hashimoto messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

Right: Taeyang Kim, a service worker, has a sealed case that has to get from the market stalls to Thao Duong before closing. 250 eddies on delivery, no questions.

### P-079

Left: Tatsuya Yamaguchi messages you: Itsuki Yamaguchi was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Someone took Qing Zhao's credstick near a bar off the market. Qing Zhao wants it back and does not care how. 500 eddies when it is returned.

### P-032

Left: Aiko Sato writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You are new enough here that nobody will think you are on a side.

Right: Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### P-009

Left: Jisoo Choi has not heard from Tatsuya Shimizu in three days. Find out where Tatsuya Shimizu went. 500 eddies.

Right: Leila Jaber messages you from the clinic: an accident in the street put me on a bed for days, and I have work waiting that will not wait. I have a package that must reach a client across Kabuki by tomorrow night and I cannot walk it. Carry it for me, ask the client to wait, or cover my shift so I keep the work. You have a name for getting things done around here, and I am hoping that is true.

### P-070

Left: Ren Mori messages you: Bao Tran and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. The stalls say you are not afraid of crews, and that is what I need.

Right: Someone took Zara Nair's jacket near the market stalls. Zara Nair wants it back and does not care how. 500 eddies when it is returned.

### P-072

Left: Tyler Pierce messages you: Itsuki Sakamoto and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I had never seen them before the fight, so I do not know what I am supposed to have done.

Right: Ryo Watanabe, a service worker, has a sealed case that has to get from the market stalls to Rui Sun before closing. 250 eddies on delivery, no questions.

### P-054

Left: Jiho Kang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. Somebody wanted that crowd angry. Find out who, keep the corner calm, or see me through it. You do not know me, and that may be why somebody will talk to you.

Right: Taeyang Park wants Karim Khalil, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-015

Left: Takeshi Hashimoto messages you: Alejandro Campos and I ended up on opposite sides of a street fight in Kabuki, and I came off worse. Whoever they run with will come for me next. Carry word to the other crew that it is finished, find me a safe way home, or stand with me when they do. You owe me nothing and I cannot promise much, but I am asking because I have no one else.

Right: Ling Sun owes Jericho Santos money and has stopped answering. Collect it from Ling Sun, who drinks near a bar off the market. You keep a cut: 500 eddies.

### P-006

Left: Aiko Matsuda has not heard from Javier Vargas in three days. Find out where Javier Vargas went. 500 eddies.

Right: Maricel Pangilinan writes that Zora Washington worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Everyone on the row says you are the one to ask when something goes missing.

### P-027

Left: Sakura Mori writes that the crews clashed on the street and Woojin Kim picked them out of it. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

Right: Marcus Osei writes that Dolores Romero bumped into them by the stalls and left with a bag that was not theirs. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### P-003

Left: Sakura Mori writes that the crews clashed on the street and Woojin Kim picked them out of it. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

Right: Elena Cruz wants Bao Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-081

Left: Ling Sun owes Jericho Santos money and has stopped answering. Collect it from Ling Sun, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Walid Jaber messages you: Kaori Inoue was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-043

Left: Jun Tang writes that the street went from busy to a brawl in a minute, and they still do not know who started it. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. Everyone says you keep your head when others lose theirs.

Right: Elena Reyes on the line: Daichi Ishikawa robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### P-048

Left: Linh Ngo writes from a clinic cot that Daichi Yamaguchi jumped them in the street, took nothing, and left. I need to know why they did it before it happens again. Ask the people who saw, speak to them if you can, or pay my clinic bill while I find out for myself. I had never seen them before today, and that is what frightens me.

Right: Tamara Jankowski messages you: someone saw Xiu Zhao slip a hand into my bag at the market and walk off with it. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. Nobody on the row had seen the thief before, so somebody must have given the nod.

### P-026

Left: Message from Misaki Shimizu: the accident in Kabuki broke my leg, and the job I should be doing is going undone. I need someone to take over for me for a day or two. Deliver the parcel, speak to the client, or cover my place on the rota. People trust you with their things around here, so I am trusting you with mine.

Right: Message from Zora Rhodes: Daichi Inoue went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

### P-062

Left: Message from Haruto Nakamura: someone shoved someone in the Kabuki crowd, and it turned into a fight that swallowed me. I want to know who stirred it up. Ask around the stalls, quiet the corner before it happens again, or walk me clear of it tonight. You do not know me, and that may be why somebody will talk to you.

Right: Kaori Okada, a labourer, has a sealed case that has to get from the market stalls to Yan Liu before closing. 250 eddies on delivery, no questions.

### P-002

Left: Message from Zora Rhodes: Daichi Inoue went for me in the middle of a crew fight near the market, and I am still shaking. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. I do not know them at all, so I cannot guess what they think I did.

Right: Ryo Maeda, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Dawson before closing. 250 eddies on delivery, no questions.

### P-077

Left: Huong Ngo messages you: Dahye Han was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: The terminal at Mai Trinh's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

### P-061

Left: Fang Liu, a labourer, has a sealed case that has to get from the market stalls to Sanjay Rao before closing. 250 eddies on delivery, no questions.

Right: Elena Reyes on the line: Daichi Ishikawa robbed me in the crowd by the market, and I want what was in the bag more than I want an apology. Can you get it back for me? Track down whoever has it, make it worth the thief's while to say where it went, or pay what it was worth and wait for my thanks. Nobody on the row had seen the thief before, so somebody must have given the nod.

### P-050

Left: Noriko Sato wants Minh Dang, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Huong Duong messages you: Thao Trinh swung at me in a fight between two crews near the market, and now I am a target. I cannot fix this myself. Speak to the other crew for me, walk me past their corner, or be there when they come looking. People say the stalls look to you when there is trouble, which is why I am writing to you and not to the police.

### P-011

Left: Ivo Popov on the line, short of breath: the Claws collector Haneul Song was at the till, and I told them to come back Friday. Someone has to square this before Friday or they send someone less patient. Pay it, bargain it down, or face the next collector yourself. The stalls have started to say no among themselves, and a push from outside might tip it.

Right: Ryo Watanabe, a service worker, has a sealed case that has to get from the market stalls to Rui Sun before closing. 250 eddies on delivery, no questions.

### P-007

Left: Kenji Matsuda has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Matsuda from a bar off the market to the metro entrance. 250 eddies.

Right: Aiko Maeda writes from the clinic that the accident in the street left them unable to walk, with a job waiting. I cannot make my run. Take the delivery for me, ask the client for more time, or take my shift at the bar. People trust you with their things around here, so I am trusting you with mine.

### P-057

Left: Maricel Magsaysay writes that Tatsuya Inoue worked the crowd and took a bag, and the bag has not turned up anywhere. I want what was in it back. Find out who has it, lean on the thief's people until they hand it over, or cover the loss and I will square it with you later. The thief is no one from this row, which makes it a job for someone with no ties here.

Right: Someone took Qing Zhao's credstick near a bar off the market. Qing Zhao wants it back and does not care how. 500 eddies when it is returned.
