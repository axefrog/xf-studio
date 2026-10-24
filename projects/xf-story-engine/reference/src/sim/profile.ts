// The profile of a resident and of a household (S1 4.2): one cell of the district's joint table over four attributes.
//
// The person profile is the enum "0" ... "2303", index `x = ((a * 12 + r) * 4 + i) * 6 + f` over age band (8), role (12),
// income band (4) and affiliation class (6), plus "none" for a household member who does not exist. The household profile is the
// enum "0" ... "59", `x = (ty * 3 + te) * 4 + we` over type (5), tenure (3) and wealth (4).

export const ROLES = ['vendor', 'shopkeeper', 'service', 'nightlife', 'labourer', 'technician', 'corporate', 'gang', 'police', 'student', 'unemployed', 'retired'] as const;
export type Role = (typeof ROLES)[number];
export const INCOMES = ['destitute', 'low', 'middle', 'high'] as const;
export const HH_TYPES = ['single', 'couple', 'family', 'shared', 'crew'] as const;
export const TENURES = ['rent', 'own', 'other'] as const;
export const WEALTHS = ['poor', 'modest', 'comfortable', 'rich'] as const;
export const ARCHETYPES = ['resident', 'street-vendor', 'gang-member', 'gang-leader', 'fixer', 'police', 'service-worker', 'young-street', 'elder'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export const SOCIABILITY = ['low', 'mid', 'high'] as const;

export const N_AGE = 8;
export const N_ROLE = 12;
export const N_INCOME = 4;
export const N_AFFC = 6;
export const N_PROFILES = N_AGE * N_ROLE * N_INCOME * N_AFFC; // 2304
export const N_HPROFILES = 5 * 3 * 4; // 60

export const profileIndex = (a: number, r: number, i: number, f: number): number => ((a * N_ROLE + r) * N_INCOME + i) * N_AFFC + f;
export const profileA = (x: number): number => Math.floor(x / 288);
export const profileR = (x: number): number => Math.floor(x / 24) % N_ROLE;
export const profileI = (x: number): number => Math.floor(x / N_AFFC) % N_INCOME;
export const profileF = (x: number): number => x % N_AFFC;

export const hprofileIndex = (ty: number, te: number, we: number): number => (ty * 3 + te) * 4 + we;
export const hprofileType = (x: number): number => Math.floor(x / 12);
export const hprofileTenure = (x: number): number => Math.floor(x / 4) % 3;
export const hprofileWealth = (x: number): number => x % 4;

/** Every person profile enum value, in index order, then "none". */
export const PROFILE_VALUES: string[] = [...Array.from({ length: N_PROFILES }, (_, x) => String(x)), 'none'];
export const HPROFILE_VALUES: string[] = Array.from({ length: N_HPROFILES }, (_, x) => String(x));

/** The profile indices matching a test, as enum strings. */
export function profilesWhere(test: (x: number) => boolean): string[] {
  const out: string[] = [];
  for (let x = 0; x < N_PROFILES; x++) if (test(x)) out.push(String(x));
  return out;
}
export function hprofilesOfType(ty: number): string[] {
  const out: string[] = [];
  for (let x = 0; x < N_HPROFILES; x++) if (hprofileType(x) === ty) out.push(String(x));
  return out;
}

/** The class of an affiliation index of the recipe: used by the seed factors. */
export type RecipeClass = 'civilian' | 'gang' | 'corp' | 'ncpd';
