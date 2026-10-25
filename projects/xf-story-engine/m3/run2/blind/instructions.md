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
