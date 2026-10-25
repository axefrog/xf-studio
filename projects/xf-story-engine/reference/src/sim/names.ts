// The wide name registry of S1's pack (M3 run 2): the names residents are given, as pack data. The kernel's own name kind draws from seven
// given names and six family names under two origins, which is enough for a fixture and far too few for a district: a card that names two
// residents shows the same names again and again. Here every origin has its own given and family names, an origin is drawn by weight from
// the resident's affiliation class and from the district, and the draw feeds nothing (the schema audit keeps it display-only, S1-I-7).
//
// The origins are the ones Night City's streets are written with: a port city of many diasporas, weighted by where the setting puts them. Kabuki
// is a Watson market district beside Little China, held by the Tyger Claws (knowledge/places.md and population-and-affiliations.md: 205 Claws, 112
// Mox, 48 Scavengers in its entry), a gang with Japanese roots that recruits from the whole harbour; the NCPD recruits from everywhere. The game's
// records give no names for street characters (population-and-affiliations.md, section 7), so the registry is the pack's own. A weight is a pack
// judgement, not a census of the game, and no origin is ever excluded: the tables only tilt the draw.
//
// Every name is one capitalised word of plain letters, so that a name never reads as two people and a skeleton check can mask it. None is
// the name of a character in the game's own stories: the pools are checked against a list of those names in the tests.

import type { NameData } from './data.ts';

export const WIDE_NAMES: NameData = {
  origins: {
    japanese: {
      given: ['Haruto', 'Yui', 'Kenji', 'Sora', 'Ren', 'Aiko', 'Daichi', 'Mei', 'Takeshi', 'Hana', 'Ryo', 'Sakura', 'Itsuki', 'Noriko', 'Shun', 'Emi', 'Kaori', 'Tatsuya', 'Misaki', 'Jiro'],
      family: ['Tanaka', 'Sato', 'Mori', 'Kobayashi', 'Watanabe', 'Ishikawa', 'Nakamura', 'Hayashi', 'Fujita', 'Okada', 'Matsuda', 'Yamaguchi', 'Kondo', 'Aoki', 'Sakamoto', 'Maeda', 'Inoue', 'Hashimoto', 'Shimizu', 'Ogawa'],
    },
    chinese: {
      given: ['Wei', 'Jun', 'Meiling', 'Chen', 'Xiu', 'Hao', 'Lan', 'Bo', 'Yan', 'Feng', 'Ling', 'Tao', 'Ying', 'Kai', 'Rui', 'Jing', 'Long', 'Qing', 'Hui', 'Fang'],
      family: ['Wang', 'Li', 'Zhang', 'Liu', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Lin', 'He', 'Guo', 'Luo', 'Deng', 'Xie', 'Tang'],
    },
    korean: {
      given: ['Minjun', 'Seoyeon', 'Jiho', 'Joon', 'Sooah', 'Daeho', 'Eunji', 'Hyunwoo', 'Yuna', 'Taeyang', 'Haneul', 'Jisoo', 'Seungmin', 'Dahye', 'Woojin', 'Nayeon'],
      family: ['Kim', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Shin', 'Seo', 'Hwang', 'Ahn', 'Song', 'Baek'],
    },
    vietnamese: {
      given: ['Minh', 'Linh', 'Anh', 'Thao', 'Duc', 'Huong', 'Khoa', 'Mai', 'Tuan', 'Hanh', 'Phuc', 'Trang', 'Nam', 'Quynh', 'Bao', 'Lien'],
      family: ['Nguyen', 'Tran', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Ngo', 'Duong', 'Truong', 'Phan', 'Dinh', 'Lam', 'Trinh', 'Ly', 'Cao'],
    },
    latin: {
      given: ['Mateo', 'Lucia', 'Diego', 'Camila', 'Rafael', 'Elena', 'Santiago', 'Valeria', 'Javier', 'Rosa', 'Mario', 'Ines', 'Alejandro', 'Marisol', 'Tomas', 'Paloma', 'Hector', 'Dolores', 'Emilio', 'Carmen'],
      family: ['Reyes', 'Morales', 'Ortega', 'Castillo', 'Vargas', 'Herrera', 'Romero', 'Navarro', 'Mendoza', 'Cruz', 'Salazar', 'Ibarra', 'Delgado', 'Fuentes', 'Rojas', 'Campos', 'Guerrero', 'Pineda', 'Ramirez', 'Serrano'],
    },
    anglo: {
      given: ['Alex', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Tyler', 'Dana', 'Cole', 'Nora', 'Wade', 'Jamie', 'Quinn', 'Ellis', 'Tess', 'Wyatt', 'Lena'],
      family: ['Hale', 'Brooks', 'Carter', 'Hughes', 'Sullivan', 'Whitaker', 'Doyle', 'Marsh', 'Keller', 'Pierce', 'Dawson', 'Fraser', 'Holt', 'Garrett', 'Nolan', 'Spencer'],
    },
    black: {
      given: ['Marcus', 'Imani', 'Darnell', 'Keisha', 'Andre', 'Tasha', 'Terrence', 'Amara', 'Malik', 'Zora', 'Desmond', 'Nia', 'Isaiah', 'Kaya', 'Cedric', 'Simone'],
      family: ['Washington', 'Jackson', 'Mitchell', 'Okafor', 'Adeyemi', 'Bell', 'Ford', 'Coleman', 'Banks', 'Mensah', 'Tucker', 'Osei', 'Freeman', 'Abara', 'Rhodes', 'Boateng'],
    },
    slavic: {
      given: ['Dmitri', 'Katya', 'Pavel', 'Irina', 'Anton', 'Sasha', 'Mila', 'Oleg', 'Nadia', 'Stanislav', 'Vera', 'Bogdan', 'Tamara', 'Ivo', 'Lidia', 'Emil'],
      family: ['Novak', 'Petrov', 'Kovacs', 'Volkov', 'Sokolov', 'Marek', 'Kuznetsov', 'Horvat', 'Lebedev', 'Jankowski', 'Orlov', 'Zielinski', 'Popov', 'Kozlov', 'Dvorak', 'Smirnov'],
    },
    southasian: {
      given: ['Arjun', 'Priya', 'Rahul', 'Anika', 'Vikram', 'Meera', 'Sanjay', 'Deepa', 'Kabir', 'Zara', 'Rohan', 'Nisha', 'Imran', 'Sunita', 'Dev', 'Farah'],
      family: ['Patel', 'Singh', 'Sharma', 'Iyer', 'Khan', 'Das', 'Rao', 'Gupta', 'Nair', 'Chopra', 'Bhatt', 'Malik', 'Reddy', 'Joshi', 'Menon', 'Qureshi'],
    },
    filipino: {
      given: ['Jun', 'Maricel', 'Rico', 'Liza', 'Paolo', 'Joy', 'Ramon', 'Cheska', 'Nestor', 'Aileen', 'Jericho', 'Bea', 'Rolando', 'Marites', 'Carlo', 'Gemma'],
      family: ['Santos', 'Bautista', 'Aquino', 'Villanueva', 'Pascual', 'Soriano', 'Mercado', 'Tolentino', 'Manalo', 'Dizon', 'Lacson', 'Magsaysay', 'Evangelista', 'Pangilinan', 'Roxas', 'Abad'],
    },
    middleeastern: {
      given: ['Omar', 'Layla', 'Karim', 'Samira', 'Yusuf', 'Leila', 'Tariq', 'Rania', 'Hassan', 'Dalia', 'Idris', 'Salma', 'Walid', 'Noor', 'Amir', 'Huda'],
      family: ['Haddad', 'Nasser', 'Aziz', 'Khalil', 'Mansour', 'Farah', 'Saleh', 'Rahman', 'Barakat', 'Suleiman', 'Jaber', 'Habib', 'Said', 'Hamdan', 'Sabbagh', 'Taha'],
    },
  },
  // The origin weights of a resident by affiliation class (the class index of the slice: civilian, NCPD, Tyger Claws, Mox, Scavengers, other).
  // A class not listed draws every origin at weight 1.
  byClass: [
    {},
    { anglo: 2.2, latin: 1.6, black: 1.6, slavic: 1.3, japanese: 0.7, chinese: 0.6, korean: 0.6, vietnamese: 0.6 },
    { japanese: 5, chinese: 1.8, korean: 1.8, vietnamese: 1.2, filipino: 0.8, latin: 0.4, anglo: 0.4, black: 0.35, slavic: 0.35, southasian: 0.35, middleeastern: 0.3 },
    { anglo: 1.6, latin: 1.3, japanese: 1.3, black: 1.2, korean: 1.2, filipino: 1.1 },
    { anglo: 2.2, black: 1.8, slavic: 1.6, latin: 1.3, japanese: 0.3, chinese: 0.3, korean: 0.3 },
    {},
  ],
  // The multipliers of a district's origins by its key: Kabuki leans to the Claws' own origin, with Little China's and the harbour's diasporas beside it.
  byDistrict: {
    wat_kab: { japanese: 4, chinese: 2, korean: 1.3, vietnamese: 1.3, filipino: 0.9, latin: 0.9, anglo: 0.9, black: 0.8, slavic: 0.6, southasian: 0.7, middleeastern: 0.5 },
  },
};

/** Every name of the registry as a flat set (a skeleton check masks them all, whoever drew which). */
export function allNames(n: NameData = WIDE_NAMES): string[] {
  const out = new Set<string>();
  for (const o of Object.values(n.origins)) for (const x of [...o.given, ...o.family]) out.add(x);
  return [...out].sort();
}

/** The names of people in the game's own stories that no pool may hold as a given name or a family name. */
export const RESERVED_NAMES: readonly string[] = [
  'Goro', 'Takemura', 'Saburo', 'Arasaka', 'Yorinobu', 'Hanako', 'Johnny', 'Silverhand', 'Judy', 'Alvarez', 'Panam', 'Palmer', 'Jackie', 'Welles', 'River', 'Ward',
  'Kerry', 'Eurodyne', 'Rogue', 'Amendiares', 'Evelyn', 'Parker', 'Dexter', 'Deshawn', 'Claire', 'Russell', 'Viktor', 'Vektor', 'Misty', 'Placide', 'Wakako', 
  'Regina', 'Smasher', 'Songbird', 'Reed', 'Hellman', 'Mitch', 'Bes', 'Jotaro', 'Hansen', 'Jefferson', 'Peralez', 'Delamain', 'Yaiba', 'Oda', 'Mama', 'Kurt',
];

export function nameProblems(n: NameData): string[] {
  const out: string[] = [];
  const word = /^[A-Z][a-z]+$/;
  const origins = Object.keys(n.origins);
  if (origins.length < 2) out.push('names: at least two origins');
  for (const [o, lists] of Object.entries(n.origins)) {
    for (const kind of ['given', 'family'] as const) {
      const xs = lists[kind];
      if (xs.length < 2) out.push(`names: ${o} needs two ${kind} names at least`);
      if (new Set(xs).size !== xs.length) out.push(`names: ${o} repeats a ${kind} name`);
      if (kind === 'given') for (const x of xs) if (lists.family.includes(x)) out.push(`names: "${x}" (${o}) is both a given and a family name`);
      for (const x of xs) if (!word.test(x)) out.push(`names: "${x}" (${o}) is not one plain capitalised word`);
    }
  }
  const weights = (t: Record<string, number>, where: string): void => {
    for (const [o, w] of Object.entries(t)) {
      if (!origins.includes(o)) out.push(`names: ${where} weights an origin that is not in the registry: ${o}`);
      if (!(w > 0 && Number.isFinite(w))) out.push(`names: ${where} weight of ${o} must be positive`);
    }
  };
  n.byClass.forEach((t, i) => weights(t, `class ${i}`));
  for (const [d, t] of Object.entries(n.byDistrict)) weights(t, `district ${d}`);
  return out;
}
