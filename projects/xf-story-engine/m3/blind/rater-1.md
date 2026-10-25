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

Watch your pockets: Kenji Sato is working the crowd again, and Kenji Tanaka found out first.

### H-083

Kenji Mori messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-053

Maria Hale owes Dmitri Novak money and has stopped answering. Collect it from Maria Hale, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### H-019

Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

### H-087

Alex Reyes messages you: Yui Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-016

Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-082

Kenji Mori, a labourer, has a sealed case that has to get from the market stalls to Kenji Tanaka before closing. 250 eddies on delivery, no questions.

### H-058

Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-033

Jordan Novak messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-090

Yui Sato, a club worker, has a sealed case that has to get from the ripperdoc to Yui Mori before closing. 250 eddies on delivery, no questions.

### H-088

Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

### H-055

Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

### H-032

Kabuki: Jordan Hale was treated for injuries after an assault. Witnesses name Maria Hale. No arrest has been made.

### H-074

Haruto Mori, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Reyes before closing. 250 eddies on delivery, no questions.

### H-095

Maria Novak messages you: Kenji Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-022

Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### H-028

Yui Mori was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-063

Kabuki: Kenji Sato was treated for injuries after an assault. Witnesses name Yui Mori. No arrest has been made.

### H-070

Jordan Hale messages you: Yui Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-061

Yui Mori has not heard from Kenji Tanaka in three days. Find out where Kenji Tanaka went. 500 eddies.

### H-023

Kabuki: police detained Alex Reyes during a street sweep. No charge has been announced.

### H-001

An NCPD patrol pulled Yui Mori off the street in Kabuki. Nobody stopped to watch.

### H-017

Alex Novak wants Maria Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-008

Yui Sato messages you: Alex Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-009

Kenji Tanaka messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-091

Jordan Reyes has to cross Kabuki after dark and does not want to go alone. Walk with Jordan Reyes from a bar off the market to the ripperdoc. 250 eddies.

### H-075

Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-002

Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

### H-050

Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

### H-003

Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-080

Alex Reyes thinks Dmitri Novak is meeting someone at the ripperdoc. Follow Dmitri Novak and report who it is. 500 eddies.

### H-057

Kenji Mori messages you: Haruto Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-036

Kenji Tanaka owes Dmitri Novak money and has stopped answering. Collect it from Kenji Tanaka, who drinks near a bar off the market. You keep a cut: 500 eddies.

### H-040

Haruto Mori messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-029

Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

### H-065

Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

### H-067

Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-086

Someone took Dmitri Novak's credstick near a bar off the market. Dmitri Novak wants it back and does not care how. 500 eddies when it is returned.

### H-051

Watch your pockets: Kenji Mori is working the crowd again, and Jordan Hale found out first.

### H-079

Haruto Sato messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-011

Watch your pockets: Yui Tanaka is working the crowd again, and Kenji Mori found out first.

### H-046

Someone took Haruto Tanaka's jacket near the metro entrance. Haruto Tanaka wants it back and does not care how. 500 eddies when it is returned.

### H-062

An NCPD patrol pulled Haruto Tanaka off the street in Kabuki. Nobody stopped to watch.

### H-014

Alex Reyes messages you: Dmitri Hale was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-081

Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-018

Alex Reyes wants Dmitri Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-045

Kenji Sato messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-052

Watch your pockets: Haruto Tanaka is working the crowd again, and Kenji Sato found out first.

### H-064

An NCPD patrol pulled Alex Hale off the street in Kabuki. Nobody stopped to watch.

### H-043

Maria Novak owes Alex Hale money and has stopped answering. Collect it from Maria Novak, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### H-026

Haruto Sato messages you: Maria Hale was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-030

Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### H-010

Kabuki: Yui Sato was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### H-096

Haruto Sato robbed Dmitri Hale in the Kabuki crowd. If you see either of them, you will know why.

### H-004

Jordan Hale messages you: Haruto Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-059

The terminal at Maria Novak's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

### H-006

An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

### H-094

Yui Sato messages you: Dmitri Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-049

Dmitri Hale owes Kenji Mori money and has stopped answering. Collect it from Dmitri Hale, who drinks near a bar off the market. You keep a cut: 500 eddies.

### H-021

Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

### H-012

Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-027

Yui Tanaka wants Alex Novak, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### H-089

Dmitri Reyes messages you: Maria Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-035

An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

### H-020

Kabuki: Alex Reyes was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### H-069

Jordan Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-005

Maria Hale messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-041

The terminal at Maria Novak's stall near the metro entrance has died. Get it running before the evening crowd. 250 eddies.

### H-013

Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-078

Dmitri Novak messages you: Yui Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-056

Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

### H-054

Someone took Jordan Novak's credstick near a bar off the market. Jordan Novak wants it back and does not care how. 500 eddies when it is returned.

### H-039

Alex Hale messages you: Jordan Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-084

Kabuki: Alex Hale was taken for treatment after an accident. No one else was injured.

### H-015

Kenji Tanaka has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Tanaka from a bar off the market to the metro entrance. 250 eddies.

### H-085

Word at the stalls is that Maria Reyes hit Kenji Mori hard enough to need the clinic. The rest is guesswork.

### H-066

Alex Hale messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-073

Jordan Reyes, a service worker, has a sealed case that has to get from the ripperdoc to Kenji Sato before closing. 250 eddies on delivery, no questions.

### H-042

Kabuki: a theft was reported by Maria Hale. Dmitri Novak is named as the person responsible. The goods have not been recovered.

### H-047

Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

### H-031

An NCPD patrol pulled Maria Hale off the street in Kabuki. Nobody stopped to watch.

### H-038

Jordan Novak, a technician, has a sealed case that has to get from a bar off the market to Haruto Mori before closing. 250 eddies on delivery, no questions.

### H-071

Word at the stalls is that Kenji Tanaka hit Dmitri Hale hard enough to need the clinic. The rest is guesswork.

### H-037

Alex Reyes messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-044

Jordan Reyes, a service worker, has a sealed case that has to get from the market stalls to Alex Novak before closing. 250 eddies on delivery, no questions.

### H-034

Jordan Novak messages you: Yui Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-068

Dmitri Novak put Jordan Hale on the pavement outside the market. Nobody saw why, and nobody is saying.

### H-048

Kabuki: a theft was reported by Kenji Sato. Jordan Hale is named as the person responsible. The goods have not been recovered.

### H-024

Alex Reyes has not heard from Dmitri Novak in three days. Find out where Dmitri Novak went. 500 eddies.

### H-092

Maria Hale says Haruto Sato lifted a bag in the Kabuki crowd and was gone before anyone moved.

### H-077

Yui Sato messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-072

Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### H-093

Jordan Novak messages you: Alex Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### H-025

The terminal at Kenji Tanaka's stall near the ripperdoc has died. Get it running before the evening crowd. 250 eddies.

### H-060

Watch your pockets: Haruto Tanaka is working the crowd again, and Jordan Novak found out first.

### H-076

Watch your pockets: Yui Tanaka is working the crowd again, and Yui Mori found out first.

---

## Pairs

### P-089

Left: Maria Hale messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Jordan Reyes has to cross Kabuki after dark and does not want to go alone. Walk with Jordan Reyes from a bar off the market to the ripperdoc. 250 eddies.

### P-015

Left: An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

Right: The terminal at Maria Novak's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

### P-022

Left: The terminal at Kenji Tanaka's stall near the ripperdoc has died. Get it running before the evening crowd. 250 eddies.

Right: Dmitri Novak put Jordan Hale on the pavement outside the market. Nobody saw why, and nobody is saying.

### P-020

Left: Jordan Reyes has to cross Kabuki after dark and does not want to go alone. Walk with Jordan Reyes from a bar off the market to the ripperdoc. 250 eddies.

Right: Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

### P-023

Left: Maria Hale says Haruto Sato lifted a bag in the Kabuki crowd and was gone before anyone moved.

Right: Jordan Reyes, a service worker, has a sealed case that has to get from the ripperdoc to Kenji Sato before closing. 250 eddies on delivery, no questions.

### P-021

Left: An NCPD patrol pulled Maria Hale off the street in Kabuki. Nobody stopped to watch.

Right: Maria Novak owes Alex Hale money and has stopped answering. Collect it from Maria Novak, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### P-027

Left: Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

Right: An NCPD patrol pulled Alex Hale off the street in Kabuki. Nobody stopped to watch.

### P-063

Left: Yui Sato, a club worker, has a sealed case that has to get from the ripperdoc to Yui Mori before closing. 250 eddies on delivery, no questions.

Right: Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

### P-058

Left: Watch your pockets: Kenji Mori is working the crowd again, and Jordan Hale found out first.

Right: Alex Reyes has not heard from Dmitri Novak in three days. Find out where Dmitri Novak went. 500 eddies.

### P-056

Left: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Jordan Novak, a technician, has a sealed case that has to get from a bar off the market to Haruto Mori before closing. 250 eddies on delivery, no questions.

### P-033

Left: Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-003

Left: Someone took Dmitri Novak's credstick near a bar off the market. Dmitri Novak wants it back and does not care how. 500 eddies when it is returned.

Right: Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

### P-064

Left: Alex Reyes wants Dmitri Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

### P-074

Left: Alex Reyes wants Dmitri Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Alex Reyes messages you: Yui Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-032

Left: Yui Mori was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

### P-035

Left: An NCPD patrol pulled Haruto Tanaka off the street in Kabuki. Nobody stopped to watch.

Right: Kabuki: Alex Reyes was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-028

Left: Kabuki: police detained Alex Reyes during a street sweep. No charge has been announced.

Right: Kabuki: Jordan Hale was treated for injuries after an assault. Witnesses name Maria Hale. No arrest has been made.

### P-013

Left: Jordan Novak, a technician, has a sealed case that has to get from a bar off the market to Haruto Mori before closing. 250 eddies on delivery, no questions.

Right: Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-092

Left: Alex Hale messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Yui Tanaka wants Alex Novak, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-093

Left: Maria Hale owes Dmitri Novak money and has stopped answering. Collect it from Maria Hale, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Alex Reyes messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-043

Left: Word at the stalls is that Maria Reyes hit Kenji Mori hard enough to need the clinic. The rest is guesswork.

Right: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-079

Left: Someone took Dmitri Novak's credstick near a bar off the market. Dmitri Novak wants it back and does not care how. 500 eddies when it is returned.

Right: Kenji Tanaka messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-053

Left: The terminal at Maria Novak's stall near the metro entrance has died. Get it running before the evening crowd. 250 eddies.

Right: Yui Mori was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-050

Left: Yui Mori has not heard from Kenji Tanaka in three days. Find out where Kenji Tanaka went. 500 eddies.

Right: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-007

Left: Alex Reyes has not heard from Dmitri Novak in three days. Find out where Dmitri Novak went. 500 eddies.

Right: Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-078

Left: Jordan Novak, a technician, has a sealed case that has to get from a bar off the market to Haruto Mori before closing. 250 eddies on delivery, no questions.

Right: Yui Sato messages you: Alex Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-090

Left: Haruto Mori, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Reyes before closing. 250 eddies on delivery, no questions.

Right: Dmitri Novak messages you: Yui Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-046

Left: Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

Right: Dmitri Novak put Jordan Hale on the pavement outside the market. Nobody saw why, and nobody is saying.

### P-017

Left: Someone took Haruto Tanaka's jacket near the metro entrance. Haruto Tanaka wants it back and does not care how. 500 eddies when it is returned.

Right: Jordan Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-096

Left: Kenji Mori, a labourer, has a sealed case that has to get from the market stalls to Kenji Tanaka before closing. 250 eddies on delivery, no questions.

Right: Jordan Novak messages you: Alex Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-009

Left: Haruto Mori, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Reyes before closing. 250 eddies on delivery, no questions.

Right: Watch your pockets: Jordan Reyes is working the crowd again, and Kenji Mori found out first.

### P-039

Left: Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

Right: An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

### P-095

Left: Kenji Tanaka owes Dmitri Novak money and has stopped answering. Collect it from Kenji Tanaka, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Yui Sato messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-081

Left: Haruto Mori messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Alex Reyes has not heard from Dmitri Novak in three days. Find out where Dmitri Novak went. 500 eddies.

### P-055

Left: Yui Tanaka wants Alex Novak, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

### P-071

Left: The terminal at Maria Novak's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-083

Left: Alex Reyes thinks Dmitri Novak is meeting someone at the ripperdoc. Follow Dmitri Novak and report who it is. 500 eddies.

Right: Alex Reyes messages you: Dmitri Hale was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-088

Left: Dmitri Reyes messages you: Maria Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Jordan Reyes, a service worker, has a sealed case that has to get from the market stalls to Alex Novak before closing. 250 eddies on delivery, no questions.

### P-008

Left: Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

Right: Kenji Tanaka owes Dmitri Novak money and has stopped answering. Collect it from Kenji Tanaka, who drinks near a bar off the market. You keep a cut: 500 eddies.

### P-073

Left: Kenji Mori messages you: Kenji Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Yui Mori has not heard from Kenji Tanaka in three days. Find out where Kenji Tanaka went. 500 eddies.

### P-006

Left: An NCPD patrol pulled Yui Mori off the street in Kabuki. Nobody stopped to watch.

Right: Alex Reyes thinks Dmitri Novak is meeting someone at the ripperdoc. Follow Dmitri Novak and report who it is. 500 eddies.

### P-059

Left: Someone took Jordan Novak's credstick near a bar off the market. Jordan Novak wants it back and does not care how. 500 eddies when it is returned.

Right: Watch your pockets: Yui Tanaka is working the crowd again, and Kenji Mori found out first.

### P-047

Left: Maria Hale says Haruto Sato lifted a bag in the Kabuki crowd and was gone before anyone moved.

Right: Kabuki: a theft was reported by Maria Hale. Dmitri Novak is named as the person responsible. The goods have not been recovered.

### P-075

Left: Jordan Novak messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: The terminal at Kenji Tanaka's stall near the ripperdoc has died. Get it running before the evening crowd. 250 eddies.

### P-012

Left: Watch your pockets: Haruto Tanaka is working the crowd again, and Kenji Sato found out first.

Right: Yui Mori has not heard from Kenji Tanaka in three days. Find out where Kenji Tanaka went. 500 eddies.

### P-036

Left: Watch your pockets: Haruto Tanaka is working the crowd again, and Kenji Sato found out first.

Right: Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

### P-014

Left: Kabuki: Yui Sato was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

Right: Kenji Mori, a labourer, has a sealed case that has to get from the market stalls to Kenji Tanaka before closing. 250 eddies on delivery, no questions.

### P-040

Left: Word at the stalls is that Kenji Tanaka hit Dmitri Hale hard enough to need the clinic. The rest is guesswork.

Right: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-052

Left: Someone took Dmitri Novak's credstick near a bar off the market. Dmitri Novak wants it back and does not care how. 500 eddies when it is returned.

Right: Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-069

Left: Alex Reyes thinks Dmitri Novak is meeting someone at the ripperdoc. Follow Dmitri Novak and report who it is. 500 eddies.

Right: Word at the stalls is that Kenji Tanaka hit Dmitri Hale hard enough to need the clinic. The rest is guesswork.

### P-002

Left: Someone took Jordan Novak's credstick near a bar off the market. Jordan Novak wants it back and does not care how. 500 eddies when it is returned.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-082

Left: Maria Novak owes Alex Hale money and has stopped answering. Collect it from Maria Novak, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Haruto Sato messages you: Yui Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-065

Left: The terminal at Kenji Tanaka's stall near the ripperdoc has died. Get it running before the evening crowd. 250 eddies.

Right: Kabuki: Alex Reyes was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-016

Left: Yui Tanaka wants Alex Novak, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-066

Left: Maria Novak owes Alex Hale money and has stopped answering. Collect it from Maria Novak, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

### P-041

Left: Kabuki: Alex Hale was taken for treatment after an accident. No one else was injured.

Right: Jordan Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-026

Left: Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-051

Left: Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

Right: Kenji Tanaka owes Dmitri Novak money and has stopped answering. Collect it from Kenji Tanaka, who drinks near a bar off the market. You keep a cut: 500 eddies.

### P-004

Left: Kabuki: Jordan Hale was treated for injuries after an assault. Witnesses name Maria Hale. No arrest has been made.

Right: Kenji Tanaka has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Tanaka from a bar off the market to the metro entrance. 250 eddies.

### P-030

Left: An NCPD patrol pulled Yui Mori off the street in Kabuki. Nobody stopped to watch.

Right: Watch your pockets: Kenji Sato is working the crowd again, and Kenji Tanaka found out first.

### P-085

Left: The terminal at Maria Novak's stall near a bar off the market has died. Get it running before the evening crowd. 250 eddies.

Right: Haruto Sato messages you: Maria Hale was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-067

Left: Kabuki: Alex Hale was taken for treatment after an accident. No one else was injured.

Right: Jordan Reyes has to cross Kabuki after dark and does not want to go alone. Walk with Jordan Reyes from a bar off the market to the ripperdoc. 250 eddies.

### P-010

Left: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: The terminal at Maria Novak's stall near the metro entrance has died. Get it running before the evening crowd. 250 eddies.

### P-049

Left: Watch your pockets: Kenji Sato is working the crowd again, and Kenji Tanaka found out first.

Right: Kenji Mori, a labourer, has a sealed case that has to get from the market stalls to Kenji Tanaka before closing. 250 eddies on delivery, no questions.

### P-031

Left: Kabuki: a theft was reported by Kenji Sato. Jordan Hale is named as the person responsible. The goods have not been recovered.

Right: Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-048

Left: Watch your pockets: Yui Tanaka is working the crowd again, and Yui Mori found out first.

Right: Haruto Sato robbed Dmitri Hale in the Kabuki crowd. If you see either of them, you will know why.

### P-072

Left: Maria Hale owes Dmitri Novak money and has stopped answering. Collect it from Maria Hale, who drinks near the ripperdoc. You keep a cut: 500 eddies.

Right: Watch your pockets: Haruto Tanaka is working the crowd again, and Jordan Novak found out first.

### P-042

Left: Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-044

Left: Watch your pockets: Haruto Tanaka is working the crowd again, and Jordan Novak found out first.

Right: Kabuki: Haruto Mori was taken for treatment after an accident. No one else was injured.

### P-038

Left: Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

Right: Kabuki: Yui Sato was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-011

Left: An NCPD patrol pulled Haruto Tanaka off the street in Kabuki. Nobody stopped to watch.

Right: Maria Hale owes Dmitri Novak money and has stopped answering. Collect it from Maria Hale, who drinks near the ripperdoc. You keep a cut: 500 eddies.

### P-080

Left: Kenji Mori messages you: Haruto Sato was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Yui Sato, a club worker, has a sealed case that has to get from the ripperdoc to Yui Mori before closing. 250 eddies on delivery, no questions.

### P-029

Left: Kabuki: Kenji Sato was treated for injuries after an assault. Witnesses name Yui Mori. No arrest has been made.

Right: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

### P-061

Left: Kenji Tanaka has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Tanaka from a bar off the market to the metro entrance. 250 eddies.

Right: An NCPD patrol pulled Alex Hale off the street in Kabuki. Nobody stopped to watch.

### P-087

Left: The terminal at Maria Novak's stall near the metro entrance has died. Get it running before the evening crowd. 250 eddies.

Right: Yui Sato messages you: Dmitri Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-045

Left: An NCPD patrol pulled Maria Hale off the street in Kabuki. Nobody stopped to watch.

Right: Heard it from three people already: Kenji Mori went for Dmitri Reyes in the street. Thought you should know before it gets bigger.

### P-054

Left: Haruto Mori, a shopkeeper, has a sealed case that has to get from the ripperdoc to Jordan Reyes before closing. 250 eddies on delivery, no questions.

Right: Kabuki: police detained Alex Reyes during a street sweep. No charge has been announced.

### P-084

Left: Kenji Tanaka has to cross Kabuki after dark and does not want to go alone. Walk with Kenji Tanaka from a bar off the market to the metro entrance. 250 eddies.

Right: Kenji Sato messages you: Kenji Mori was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-068

Left: Jordan Reyes, a service worker, has a sealed case that has to get from the ripperdoc to Kenji Sato before closing. 250 eddies on delivery, no questions.

Right: Kabuki: a theft was reported by Maria Hale. Dmitri Novak is named as the person responsible. The goods have not been recovered.

### P-018

Left: Alex Hale was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Yui Sato, a club worker, has a sealed case that has to get from the ripperdoc to Yui Mori before closing. 250 eddies on delivery, no questions.

### P-001

Left: Alex Novak wants Maria Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

Right: Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

### P-086

Left: Jordan Hale messages you: Haruto Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Someone took Haruto Tanaka's jacket near the metro entrance. Haruto Tanaka wants it back and does not care how. 500 eddies when it is returned.

### P-037

Left: Watch your pockets: Yui Tanaka is working the crowd again, and Kenji Mori found out first.

Right: Kabuki: Maria Novak was treated for injuries after an assault. Witnesses name Kenji Mori. No arrest has been made.

### P-094

Left: Jordan Novak messages you: Yui Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Alex Novak wants Maria Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-070

Left: Kabuki: a theft was reported by Kenji Sato. Jordan Hale is named as the person responsible. The goods have not been recovered.

Right: Alex Novak wants Maria Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-091

Left: Alex Hale messages you: Jordan Novak was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Jordan Reyes, a service worker, has a sealed case that has to get from the ripperdoc to Kenji Sato before closing. 250 eddies on delivery, no questions.

### P-062

Left: Jordan Reyes, a service worker, has a sealed case that has to get from the market stalls to Alex Novak before closing. 250 eddies on delivery, no questions.

Right: Haruto Sato robbed Dmitri Hale in the Kabuki crowd. If you see either of them, you will know why.

### P-077

Left: Dmitri Hale owes Kenji Mori money and has stopped answering. Collect it from Dmitri Hale, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Jordan Hale messages you: Yui Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

### P-025

Left: An NCPD patrol pulled Alex Reyes off the street in Kabuki. Nobody stopped to watch.

Right: Watch your pockets: Dmitri Hale is working the crowd again, and Yui Tanaka found out first.

### P-005

Left: Dmitri Hale owes Kenji Mori money and has stopped answering. Collect it from Dmitri Hale, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Kabuki: Kenji Sato was treated for injuries after an assault. Witnesses name Yui Mori. No arrest has been made.

### P-060

Left: Jordan Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Someone took Haruto Tanaka's jacket near the metro entrance. Haruto Tanaka wants it back and does not care how. 500 eddies when it is returned.

### P-057

Left: Dmitri Hale owes Kenji Mori money and has stopped answering. Collect it from Dmitri Hale, who drinks near a bar off the market. You keep a cut: 500 eddies.

Right: Kabuki: a theft was reported by Haruto Tanaka. Kenji Mori is named as the person responsible. The goods have not been recovered.

### P-034

Left: Maria Novak was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.

Right: Watch your pockets: Kenji Mori is working the crowd again, and Jordan Hale found out first.

### P-024

Left: Watch your pockets: Yui Tanaka is working the crowd again, and Yui Mori found out first.

Right: Jordan Reyes, a service worker, has a sealed case that has to get from the market stalls to Alex Novak before closing. 250 eddies on delivery, no questions.

### P-019

Left: Word at the stalls is that Maria Reyes hit Kenji Mori hard enough to need the clinic. The rest is guesswork.

Right: Alex Reyes wants Dmitri Reyes, a gang member, out of the neighbourhood. Convince them. 1000 eddies.

### P-076

Left: Maria Novak messages you: Kenji Tanaka was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?

Right: Someone took Jordan Novak's credstick near a bar off the market. Jordan Novak wants it back and does not care how. 500 eddies when it is returned.
