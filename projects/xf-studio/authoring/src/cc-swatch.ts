/**
 * What a creator colour choice looks like, derived from the resource that wins for it (the Character panel's swatches). Pure: the host
 * (cc-swatch-host.ts) resolves each choice through the generic resolver and reads the few resources named here; this module decides
 * which choices need resolving, which resolved chunk carries the colour, and turns its inputs into a small swatch exactly as the preview
 * turns them into pixels. Nothing here names an option, a slot, a colour or a mod.
 *
 * - **Which choices** (`swatchPlan`): every user-facing appearance option the creator shows as a colour grid (`useThumbnails`). Choices
 *   that follow one link (a hair colour across 522 hairstyles, a lipstick colour across 114 lip styles) share one swatch per choice key:
 *   the colour is the same appearance on every member, so one member's chain answers for all (the "lighter path": one family is one
 *   `.app`, one entity, one mesh and each choice's own material chain and profile, instead of every member's full chain). A colour-only
 *   controller (no `.app` of its own, e.g. the skin tone) is answered by a follower that has one, by position, as the link applies it
 *   (knowledge/cc-file-chain.md "Links"; a follower with fewer choices than mods added to the controller answers the positions it has). A choice that draws nothing on an option that draws nothing at all (a bald hairstyle's colour
 *   list) borrows the same-named choice of another option in its row.
 * - **Which chunk** (`pickSwatchChunk`): by the renderer adapter of each drawn chunk's template (render-templates.ts), in the order a
 *   person reads colour from: hair strands (their profile), the eye, the skin, a double-diffuse decal (brows), a plain decal (makeup) (the
 *   head's skin types carry a decal for the personal-link port beside the skin, and no makeup appearance carries a skin chunk).
 * - **Which colour** (`swatchOf`):
 *   - hair and lashes (`hair.mt`): the `.hp` root-to-tip row as the game bakes it (hair-colour-model.ts `bakeHairProfileBytes`: stops
 *     sorted and rescaled, sampled at k/N, 8-bit interpolation truncated), five samples root to tip, as stored (sRGB bytes);
 *   - eyes: the iris ring's mean base colour: `eye_gradient.mt` blends the albedo toward the gradient at the mask's raw R by its A
 *     (eye-material.ts `irisBaseColour`), `eye.mt` is its albedo there (knowledge/eye-rendering.md §1–2);
 *   - brows (`mesh_decal_double_diffuse.mt`): the primary tint (the gradient map's texel at `GradientMapUV`, or `DiffuseColor`) times the
 *     diffuse texture's coverage-weighted colour, as face-decal-material.ts draws it;
 *   - makeup (`mesh_decal.mt`): `DiffuseColor` times the diffuse texture's coverage-weighted colour;
 *   - skin (`skin.mt`): the albedo toned by `TintColor`/`TintScale` through the tint mask (skin-material.ts `tintChannel`), averaged.
 *   Texture inputs are read at a small mip; without them a decal or eye falls back to its colour parameter alone, and anything else to
 *   the definition's own `color` (the panel's caller decides).
 * - **Replaced**: the colour's resource comes from a mod other than the one that supplies the choice (a hair-tone pack replacing a vanilla
 *   `.hp`, or one mod's profile replacing another's): the panel then draws the resolved colour instead of the choice's atlas icon, which
 *   would show the replaced colour.
 */
import type { CcCatalogue, CcOption } from "./cc-catalogue";
import { followsLink, userFacing } from "./cc-catalogue";
import type { CcoPart } from "./cco-model";
import type { PlannedChunk } from "./character-detail-plan";
import type { ResolvedAppearance, ResolvedChunkMaterial } from "./character-resolver";
import type { DepotRef } from "./depot-path";
import { bakeHairProfileBytes, type ProfileStop } from "./hair-colour-model";
import type { RenderGradientStop } from "./render-detail";
import { type RenderAdapterId } from "./render-templates";
import type { Provenance } from "./resource-graph";

/** Version of the swatch rules; part of the host's cache key. Bump it whenever what a swatch derives to changes. */
export const SWATCH_VERSION = 1;
/** Samples of a root-to-tip gradient swatch. */
export const GRADIENT_SAMPLES = 5;

// ---------------------------------------------------------------------------------------------------------------
// The swatch and its compact text.

/** One colour, or a gradient root to tip (2–8 colours), as `#rrggbb`; `replaced`: see the module note. */
export interface CcSwatch { readonly colors: readonly string[]; readonly replaced: boolean }
const HEX = /^#[0-9a-f]{6}$/;
/** `#aabbcc` or `#aabbcc>#ddeeff>…`, `!` in front when replaced. */
export const encodeSwatch = (swatch: CcSwatch) => `${swatch.replaced ? "!" : ""}${swatch.colors.join(">")}`;
/** The compact text back, or null for anything else. */
export function readSwatch(text: unknown): CcSwatch | null {
  if (typeof text !== "string" || !text || text.length > 80) return null;
  const replaced = text.startsWith("!");
  const colors = (replaced ? text.slice(1) : text).split(">");
  return colors.length >= 1 && colors.length <= 8 && colors.every(color => HEX.test(color)) ? { colors, replaced } : null;
}
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
export const hexOf = (rgb: readonly number[]) => `#${rgb.slice(0, 3).map(channel => byte(channel).toString(16).padStart(2, "0")).join("")}`;
const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number) => { const v = Math.max(0, Math.min(1, c)); return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; };
/** A linear colour as sRGB bytes. */
export const linearHex = (rgb: readonly number[]) => hexOf(rgb.map(channel => linearToSrgb(channel) * 255));

// ---------------------------------------------------------------------------------------------------------------
// Which choices need a swatch, and which option's chain answers each.

/** One way to answer a swatch: an option's choice to resolve. */
export interface SwatchCandidate {
  readonly part: CcoPart;
  readonly option: string;
  readonly app: DepotRef;
  readonly definition: string;
  /** A consumer group of the option (the descriptor's group; it doesn't change what resolves). */
  readonly group: string;
  /** The choice is the game's own (for `replaced`). */
  readonly vanilla: boolean;
  /** The mod that supplies the choice (its creator resource's provider), or null for the game's own. */
  readonly mod: string | null;
}
export interface SwatchPlan {
  /** Every offered colour-grid option: its choices' swatch keys by position (null: Off, or nothing to derive). */
  readonly options: ReadonlyMap<string, readonly (string | null)[]>;
  /** Each swatch key's candidates, in the order to try them (the first that yields a swatch wins). */
  readonly targets: ReadonlyMap<string, readonly SwatchCandidate[]>;
  /** The keys by family, in catalogue order (the host resolves a family's first candidates together). */
  readonly families: ReadonlyMap<string, readonly string[]>;
}
/** Candidates kept per key (the representative and two more members to try when its chain can't answer). */
const MAX_CANDIDATES = 3;
/** The groups whose choices draw on the third-person head or body (character-detail-plan.ts), preferred for a follower's answer. */
const DRAWN_GROUPS = new Set(["TPP", "hairs", "face", "beards", "TPP_Body"]);

/** Is this option a creator colour row: user-facing, shown as a colour grid, an appearance option. */
export const isColourRow = (option: CcOption) => option.type === "appearance" && option.useThumbnails && userFacing(option);

export function swatchPlan(catalogue: CcCatalogue): SwatchPlan {
  const options = new Map<string, (string | null)[]>(), targets = new Map<string, SwatchCandidate[]>(), families = new Map<string, string[]>();
  // Link families of appearance options (any member, followers included), in catalogue order.
  const members = new Map<string, CcOption[]>();
  for (const option of catalogue.options) {
    if (option.type !== "appearance") continue;
    const family = option.link?.key ?? option.id;
    const list = members.get(family);
    if (list) list.push(option); else members.set(family, [option]);
  }
  const candidate = (option: CcOption, definition: string, choice: { provenance: { kind: string; mod: string | null } }): SwatchCandidate => ({ part: option.part,
    option: option.name, app: option.app!, definition, group: option.groups.find(group => DRAWN_GROUPS.has(group)) ?? option.groups[0] ?? "TPP",
    vanilla: choice.provenance.kind === "vanilla", mod: choice.provenance.mod });
  const add = (family: string, key: string, list: SwatchCandidate[]) => {
    if (!targets.has(key)) {
      targets.set(key, list.slice(0, MAX_CANDIDATES));
      const keys = families.get(family);
      if (keys) keys.push(key); else families.set(family, [key]);
    }
    return key;
  };
  const rank = (option: CcOption) => (isColourRow(option) ? 0 : 2) + (option.groups.some(group => DRAWN_GROUPS.has(group)) ? 0 : 1);
  const rows = catalogue.options.filter(isColourRow);
  // Per family: its members with an `.app`, the representative first, and for each key the members that offer it (built once).
  const ranked = new Map<string, { members: CcOption[]; byKey: Map<string, CcOption[]> }>();
  const familyOf = (family: string, option: CcOption) => {
    let known = ranked.get(family);
    if (!known) {
      const list = [...(members.get(family) ?? [option])].filter(member => member.app).sort((a, b) => rank(a) - rank(b));
      const byKey = new Map<string, CcOption[]>();
      for (const member of list) for (const choice of member.choices) {
        if (choice.off) continue;
        const offering = byKey.get(choice.key);
        if (!offering) byKey.set(choice.key, [member]);
        else if (offering.length < MAX_CANDIDATES && offering.at(-1) !== member) offering.push(member);
      }
      known = { members: list, byKey };
      ranked.set(family, known);
    }
    return known;
  };
  for (const option of rows) {
    const family = option.link?.key ?? option.id;
    const known = familyOf(family, option);
    // A colour-only controller: its followers with an `.app` take the same position (those with as many choices first).
    const followers = option.app ? [] : known.members.filter(member => followsLink(member) && member.part === option.part)
      .sort((a, b) => Number(b.choices.length === option.choices.length) - Number(a.choices.length === option.choices.length));
    // Off is a choice that adds nothing while others add something (cc-panel.ts); a colour-only controller's choices all add nothing.
    const someAdd = option.choices.some(choice => !choice.off);
    const keys = option.choices.map(choice => {
      if (choice.off && someAdd) return null;
      if (option.app) {
        // One swatch per key across the family: members that offer the same key, the representative first.
        const list = (known.byKey.get(choice.key) ?? []).map(member => candidate(member, choice.key, choice));
        return list.length ? add(family, `${family}\u0000${choice.key}`, list) : null;
      }
      const list = followers.flatMap(member => { const at = member.choices[choice.position]; return at && !at.off ? [candidate(member, at.key, choice)] : []; });
      return list.length ? add(family, `${family}\u0000#${choice.position}`, list) : null;
    });
    options.set(option.id, keys);
  }
  // An option that draws nothing at all (every choice Off: a bald hairstyle's colour list) borrows its row's same-named choices.
  for (const option of rows) {
    if (option.choices.some(choice => !choice.off) || options.get(option.id)!.some(Boolean)) continue;
    const siblings = rows.filter(other => other !== option && other.part === option.part && (other.uiSlot || other.name) === (option.uiSlot || option.name));
    options.set(option.id, option.choices.map(choice => {
      for (const sibling of siblings) {
        const at = sibling.choices.findIndex(other => other.key === choice.key && !other.off);
        const key = at >= 0 ? options.get(sibling.id)?.[at] : null;
        if (key) return key;
      }
      return null;
    }));
  }
  return { options, targets, families };
}

// ---------------------------------------------------------------------------------------------------------------
// Which resolved chunk carries the colour, and what it needs read.

/** Adapters that carry a choice's colour, in the order a swatch prefers them. */
export const SWATCH_ADAPTERS: readonly RenderAdapterId[] = ["hair-strand", "eye", "skin", "double-diffuse-decal", "mesh-decal"];
/** The resolved chunk materials of an appearance with their adapter (the caller knows template identities), best first. */
export function pickSwatchChunk<T extends { adapter: RenderAdapterId | null }>(chunks: readonly T[]): T | null {
  let best: T | null = null, rank = Infinity;
  for (const chunk of chunks) {
    const at = chunk.adapter ? SWATCH_ADAPTERS.indexOf(chunk.adapter) : -1;
    if (at >= 0 && at < rank) { best = chunk; rank = at; }
  }
  return best;
}
/** Every drawn chunk material of a resolved appearance (in component order). */
export const appearanceChunks = (appearance: Pick<ResolvedAppearance, "components">): ResolvedChunkMaterial[] =>
  appearance.components.flatMap(component => component.geometry?.drawsNothing ? [] : component.materials.filter(material => material.route !== "none"));

/** Texture inputs a swatch reads, by adapter. */
const SWATCH_TEXTURES: Partial<Record<RenderAdapterId, readonly string[]>> = {
  eye: ["Albedo", "IrisMask"], "double-diffuse-decal": ["DiffuseTexture", "GradientMap"], "mesh-decal": ["DiffuseTexture"], skin: ["Albedo", "TintColorMask"],
};
/** The resources a planned chunk's swatch reads: its profile, gradients and the textures above. */
export function swatchNeeds(adapter: RenderAdapterId, chunk: Pick<PlannedChunk, "textures" | "profiles" | "gradients">):
  { profiles: Provenance[]; gradients: Provenance[]; textures: Provenance[] } {
  return { profiles: adapter === "hair-strand" ? Object.values(chunk.profiles) : [],
    gradients: adapter === "eye" ? Object.values(chunk.gradients) : [],
    textures: (SWATCH_TEXTURES[adapter] ?? []).flatMap(name => chunk.textures[name] ? [chunk.textures[name]!] : []) };
}

// ---------------------------------------------------------------------------------------------------------------
// The colour.

/** A small decoded texture: RGBA bytes, rows as the exporter writes them, and the resource's own colour flag. */
export interface SwatchTexture { readonly width: number; readonly height: number; readonly data: ArrayLike<number>; readonly isGamma: boolean }
export interface SwatchReads {
  profile(ref: Provenance): { readonly sampleCount: number; readonly rootToTip: readonly ProfileStop[] } | null;
  gradient(ref: Provenance): readonly RenderGradientStop[] | null;
  texture(ref: Provenance): SwatchTexture | null;
}
/** A texel's channel as the sampler returns it (sRGB-decoded when the texture is gamma and the input is colour). */
const texel = (texture: SwatchTexture, x: number, y: number, channel: number, colour: boolean) => {
  const value = (texture.data[(y * texture.width + x) * 4 + channel] ?? 0) / 255;
  return colour && channel < 3 && texture.isGamma ? srgbToLinear(value) : value;
};
/** Sample a texture at UV (nearest texel; rows are symmetric for every use here). */
const sample = (texture: SwatchTexture, u: number, v: number, channel: number, colour: boolean) =>
  texel(texture, Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width))), Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height))), channel, colour);
/** A texture's colour weighted by its alpha (coverage), linear; null when it covers nothing. */
function coverageColour(texture: SwatchTexture): [number, number, number] | null {
  const sum = [0, 0, 0]; let weight = 0;
  for (let y = 0; y < texture.height; y++) for (let x = 0; x < texture.width; x++) {
    const a = texel(texture, x, y, 3, false);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) sum[c]! += a * texel(texture, x, y, c, true);
    weight += a;
  }
  return weight > 0 ? sum.map(value => value / weight) as [number, number, number] : null;
}
/**
 * A `CGradient`'s 8-bit colour at `t` and the `eye_gradient.mt` base colour of one texel: twins of eye-material.ts `gradientColourAt`
 * and `irisBaseColour` (that module is the renderer's, with Three; tests hold the twins equal).
 */
export function gradientAt(stops: readonly RenderGradientStop[], t: number): [number, number, number] {
  if (!stops.length) return [0, 0, 0];
  const first = stops[0]!, last = stops[stops.length - 1]!;
  if (t <= first.value) return [first.color[0], first.color[1], first.color[2]];
  if (t >= last.value) return [last.color[0], last.color[1], last.color[2]];
  const next = stops.findIndex(stop => stop.value >= t);
  const a = stops[next - 1]!, b = stops[next]!, span = b.value - a.value, f = span > 0 ? (t - a.value) / span : 1;
  return [0, 1, 2].map(k => a.color[k]! + (b.color[k]! - a.color[k]!) * f) as [number, number, number];
}
export function irisColour(albedo: readonly number[], maskR: number, maskA: number, stops: readonly RenderGradientStop[]): [number, number, number] {
  const ramp = gradientAt(stops, Math.max(0, Math.min(1, maskR))), a = Math.max(0, Math.min(1, maskA));
  return [0, 1, 2].map(k => albedo[k]! + (srgbToLinear(ramp[k]! / 255) - albedo[k]!) * a) as [number, number, number];
}
const colourParam = (chunk: Pick<PlannedChunk, "colours">, name: string, fallback: readonly number[]) =>
  (chunk.colours[name] ?? fallback).slice(0, 3).map(channel => srgbToLinear(channel / 255));
/** The iris ring's radii in the eye tile's UV (the program's blend: 1 inside IrisCoordFactor − margin; knowledge/eye-rendering.md §1). */
const IRIS_RING = { inner: 0.06, outer: 0.145 };

/**
 * The swatch of one planned chunk (its adapter chosen by `pickSwatchChunk`), or null when its inputs can't say. `replaced` is the
 * caller's (it knows the choice and the winning archives).
 */
export function swatchColours(adapter: RenderAdapterId, chunk: Pick<PlannedChunk, "scalars" | "colours" | "textures" | "profiles" | "gradients">,
  reads: SwatchReads): string[] | null {
  const scalar = (name: string, fallback: number) => Number.isFinite(chunk.scalars[name]) ? chunk.scalars[name]! : fallback;
  const texture = (name: string) => chunk.textures[name] ? reads.texture(chunk.textures[name]!) : null;
  if (adapter === "hair-strand") {
    const ref = Object.values(chunk.profiles)[0];
    const profile = ref ? reads.profile(ref) : null;
    if (!profile || !profile.rootToTip.length) return null;
    const bytes = bakeHairProfileBytes(profile.rootToTip, profile.sampleCount), n = profile.sampleCount;
    return Array.from({ length: GRADIENT_SAMPLES }, (_, i) => {
      const k = Math.round(i * (n - 1) / (GRADIENT_SAMPLES - 1));
      return hexOf([bytes[k * 3]!, bytes[k * 3 + 1]!, bytes[k * 3 + 2]!]);
    });
  }
  if (adapter === "eye") {
    const gradientRef = Object.values(chunk.gradients)[0];
    const stops = gradientRef ? reads.gradient(gradientRef) : null;
    const albedo = texture("Albedo"), mask = texture("IrisMask");
    if (albedo) {
      const sum = [0, 0, 0]; let weight = 0;
      for (let y = 0; y < albedo.height; y++) for (let x = 0; x < albedo.width; x++) {
        const u = (x + 0.5) / albedo.width, v = (y + 0.5) / albedo.height, r = Math.hypot(u - 0.5, v - 0.5);
        if (r < IRIS_RING.inner || r > IRIS_RING.outer) continue;
        const base = [0, 1, 2].map(c => texel(albedo, x, y, c, true));
        let colour = base, w = 1;
        if (stops?.length && mask) {
          const maskA = sample(mask, u, v, 3, false);
          colour = irisColour(base, sample(mask, u, v, 0, false), maskA, stops);
          w = Math.max(maskA, 0.05);
        }
        for (let c = 0; c < 3; c++) sum[c]! += colour[c]! * w;
        weight += w;
      }
      if (weight > 0) return [linearHex(sum.map(value => value / weight))];
    }
    // Without the textures, the gradient at the iris's median mask value.
    if (stops?.length) return [hexOf(gradientAt(stops, 0.35))];
    return null;
  }
  if (adapter === "double-diffuse-decal" || adapter === "mesh-decal") {
    let tint = colourParam(chunk, "DiffuseColor", [255, 255, 255]);
    if (adapter === "double-diffuse-decal" && scalar("UseGradientMap", 0) >= 0.5) {
      const gradient = texture("GradientMap");
      if (gradient) {
        const u = Math.max(0, Math.min(1, scalar("GradientMapUV", 1))), intensity = Math.max(0, scalar("GradientMapIntensity", 1));
        tint = [0, 1, 2].map(c => Math.min(1, sample(gradient, Math.min(u, 0.9999), 0.5, c, true) * intensity));
      }
    }
    const diffuse = texture("DiffuseTexture");
    const cover = diffuse ? coverageColour(diffuse) ?? [1, 1, 1] : [1, 1, 1];
    return [linearHex(tint.map((channel, c) => channel * cover[c]!))];
  }
  if (adapter === "skin") {
    const albedo = texture("Albedo");
    if (!albedo) return null;
    const mask = texture("TintColorMask");
    const tint = (chunk.colours.TintColor ?? [0, 0, 0, 0]).slice(0, 3).map(channel => channel / 255);
    const scale = Math.max(-1, Math.min(1, scalar("TintScale", 0)));
    const sum = [0, 0, 0]; let count = 0;
    for (let y = 0; y < albedo.height; y++) for (let x = 0; x < albedo.width; x++) {
      const maskR = mask ? sample(mask, (x + 0.5) / albedo.width, (y + 0.5) / albedo.height, 0, false) : 1;
      for (let c = 0; c < 3; c++) {
        const a = texel(albedo, x, y, c, true), weight = Math.abs(scale) * maskR;
        const toned = scale >= 0 ? tint[c]! * a : a < 0.5 ? 2 * a * tint[c]! : 1 - 2 * (1 - a) * (1 - tint[c]!);
        sum[c]! += a + weight * (Math.max(0, Math.min(1, toned)) - a);
      }
      count++;
    }
    return count ? [linearHex(sum.map(value => value / count))] : null;
  }
  return null;
}
