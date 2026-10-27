/** W1's plain kind is the sole classification input. Unknown kinds are counted. */
export const SERVICE_KINDS: Readonly<Record<string, string>> = Object.freeze({
  'Food vendor': 'vendor', Ripperdoc: 'ripperdoc', 'Gun shop': 'gun-shop', Clothing: 'clothing', Bar: 'bar',
  'Junk shop': 'junk-shop', Medicine: 'medicine', 'Netrunner trainer': 'netrunner-trainer', Fixer: 'fixer',
  Apartment: 'safehouse', 'Apartment for sale': 'lodging', 'Drop point': 'drop-point', 'Fast travel': 'fast-travel',
  'Melee trainer': 'melee-trainer', 'Sex worker': 'sex-worker', 'Tech vendor': 'tech-vendor', Cyberware: 'cyberware',
  'Black market': 'black-market', Metro: 'metro',
});
/** Retail vendor services establish a market; clinics, transport and lodging do not. */
export const VENDOR_SERVICE_TYPES = new Set(['vendor', 'gun-shop', 'clothing', 'bar', 'junk-shop', 'medicine', 'tech-vendor', 'cyberware', 'black-market']);
export const COVERAGE_KINDS = new Set([
  'Quest', 'Quest marker', 'Quest giver', 'Gig', 'NCPD gig', 'Gang activity', 'Cyberpsycho', 'Bounty hunt', 'Bounty',
  'Theft', 'Retrieval', 'Sabotage', 'Client in distress', 'Courier activity', 'Activity', 'Race', 'Outpost',
  'Hidden stash', 'Smuggler hideout',
  // W1 w1.6 preserves these verified variants without a friendly-kind mapping.
  'QuestGiverVariant', 'Zzz06_NCPDGigVariant',
]);
export const OTHER_KINDS = new Set(['Tarot', 'Resources', 'Car for sale', 'Motorcycle for sale', 'Dogtown gate']);

export const PLACE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'Districts.JudysApartment': "Judy's Apartment", 'Districts.LizziesBar': "Lizzie's Bar", 'Districts.NoTellMotel': 'No-Tell Motel',
});
