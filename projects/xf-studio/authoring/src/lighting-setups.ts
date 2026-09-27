/**
 * Lighting setups (pure: no Three, no DOM): one flat list of complete definitions the 3D preview can be lit by, and the operations on
 * it. Knowledge: knowledge/creator-lighting.md §9 ("Lighting setups"); design: research/authoring/view-graph-design.md §3.1 (the
 * lights node) and §3.6 (the View and lighting history).
 *
 * - **A setup is complete.** Its lights (each a directional or spot light with a position, where it points, a colour, a strength,
 *   a cone and whether it casts shadows), its surroundings (the room environment's strength and the backdrop), its exposure and its
 *   display transform (`aces`: the Studio's ACES tone mapping; `game`: the game's LogC encoding and colour-grading LUT).
 * - **Built-ins are read-only templates.** Soft studio, Key light, Flat, Rim / dramatic and Mirror are the studio stage's parametric
 *   rigs (studio-lighting.ts), turned into light lists here with the arithmetic the old rig used, so they draw exactly as before.
 *   Character creator is the game's rig, resolved from the rig table and the calibration (creator-lighting.ts) for the shown body at
 *   draw time; it is never copied into a workspace until the person edits it.
 * - **Editing a built-in forks it.** The first change to any value creates a user setup, "Custom (from <base>)", with the change
 *   applied, and selects it, so a built-in's name never describes edited values and nothing is lost by switching away. A user setup
 *   can be renamed, duplicated, deleted and reset to its base, and any setup (built-in or the person's own) is a template for a new one.
 * - **Numeric parity.** A fork copies the built-in's resolved definition exactly (doubles survive JSON), and the device draws every
 *   setup through one path (lighting-setup-stage.ts), so an unedited fork draws identically to its built-in.
 *
 * Everything here is workspace view state (the view graph's lights node): never recipes, look Undo or export.
 */
import { CREATOR_EXPOSURE_RANGE, CREATOR_HEAD_SLOT, CREATOR_RIGS, CREATOR_SHADOW, creatorRigSpecs, type BodySex, type CreatorLight,
  type CreatorLightingOptions, type LightingPreset, type Rgb8, type Vec3 } from "./creator-lighting";
import { DEFAULT_STUDIO_STAGE, lightDirection, matchingStudioSetup, STUDIO_BASE_INTENSITY, STUDIO_EXPOSURE_RANGE, STUDIO_FILL_POSITION,
  STUDIO_KEY_ANGLE_RANGE, STUDIO_LIGHT_COLOURS, STUDIO_LIGHT_KEYS, STUDIO_LIGHT_RANGES, STUDIO_LIGHT_TARGET, STUDIO_RIM_DIRECTION,
  STUDIO_SETUP_IDS, STUDIO_SETUPS, type StudioLights, type StudioStage } from "./studio-lighting";

export type LightType = "directional" | "spot";
export const LIGHT_TYPES: readonly LightType[] = Object.freeze(["directional", "spot"]);
/**
 * One light, in the Studio frame (Y up, V faces −Z, V's right = +X, metres from V's feet). A directional light shines from its
 * position toward its target (only the direction counts); a spot light sits at its position and points at its target. The spot
 * fields are kept on a directional light too, so switching the type back and forth loses nothing.
 */
export type SetupLight = {
  readonly id: string;
  readonly name: string;
  readonly type: LightType;
  readonly position: Vec3;
  readonly target: Vec3;
  /** Linear-light RGB, each 0–1. */
  readonly colour: Vec3;
  /** Three's intensity: lux for a directional light, candela for a spot light. */
  readonly intensity: number;
  /** Whether it casts a shadow map onto the V (at most `LIGHTING_LIMITS.shadowCasters` per setup). */
  readonly shadows: boolean;
  /** Spot: the cone's half-angle in radians, the penumbra fraction, the decay exponent and the range in metres (0: unlimited). */
  readonly angle: number;
  readonly penumbra: number;
  readonly decay: number;
  readonly distance: number;
  /**
   * The game's own values for a light that came from the game (the Character creator rig), kept so the light can be sent back to the
   * game in its native units (research/runtime/lighting-mirror-design.md §9): the engine then converts them itself, and a linear-falloff
   * light, drawn here with its falloff folded into one head-distance intensity, isn't lost. Absent on lights made in the Studio.
   */
  readonly game?: GameLightValues;
};
/**
 * A light's values as the game stores them (knowledge/creator-lighting.md §2). Edits keep what still applies: a colour, cone or shadow
 * change rewrites the matching fields, a strength change is carried by `studioIntensity` (the mirror scales the lumens by the ratio), and
 * turning the light directional drops the block (the game light is a spot).
 */
export type GameLightValues = {
  readonly lumen: number;
  readonly unit: "lumen";
  readonly falloff: "inverse-square" | "linear";
  /** Attenuation radius, metres. */
  readonly radius: number;
  /** The engine's cone exponent. */
  readonly softness: number;
  /** Full cone angles in degrees, as the resource stores them. */
  readonly outer: number;
  readonly inner: number;
  /** 8-bit sRGB; null = unset (white). */
  readonly colour: Rgb8 | null;
  readonly localShadows: boolean;
  /** `CSR_CharacterOnly` is `character`. */
  readonly contactShadows: "none" | "character" | "all";
  /** The light's source radius in metres, when the game data gives one (the creator rig's table doesn't). */
  readonly sourceRadius?: number;
  readonly roughnessBias: number;
  /** The Studio intensity when the values were taken. */
  readonly studioIntensity: number;
};
const CONTACT_SHADOWS = Object.freeze(["none", "character", "all"] as const);
/** A creator rig row's native values, with the Studio intensity the preview drew it at. */
const gameValues = (l: CreatorLight, studioIntensity: number): GameLightValues => ({ lumen: l.lumen, unit: "lumen", falloff: l.falloff,
  radius: l.radius, softness: l.softness, outer: l.outer, inner: l.inner, colour: l.colour ? [...l.colour] as unknown as Rgb8 : null,
  localShadows: l.shadows, contactShadows: l.contactShadows ? "character" : "none", roughnessBias: l.roughnessBias, studioIntensity });
export type SetupDisplay = "aces" | "game";
export const SETUP_DISPLAYS: readonly SetupDisplay[] = Object.freeze(["aces", "game"]);
export type SetupBackdrop = "studio" | "black";
export const SETUP_BACKDROPS: readonly SetupBackdrop[] = Object.freeze(["studio", "black"]);
/** A complete lighting definition. */
export type LightingSetup = {
  readonly lights: readonly SetupLight[];
  /** The head the lights are placed about (the placement controls' centre) and the shadow maps cover. */
  readonly focus: Vec3;
  /** The room environment's strength (ambient light and reflections); 0 means no room at all. */
  readonly environment: number;
  readonly backdrop: SetupBackdrop;
  readonly display: SetupDisplay;
  /** ACES exposure, or the game display's scalar `k` before the grade. */
  readonly exposure: number;
};

export const BUILT_IN_SETUP_IDS = Object.freeze([...STUDIO_SETUP_IDS, "creator"] as const);
export type BuiltInSetupId = typeof BUILT_IN_SETUP_IDS[number];
export const isBuiltInSetup = (id: unknown): id is BuiltInSetupId => (BUILT_IN_SETUP_IDS as readonly unknown[]).includes(id);
/** A setup the person owns: named, descended from a built-in (its "Reset to" target), editable. */
export type UserSetup = { readonly id: string; readonly name: string; readonly base: BuiltInSetupId; readonly setup: LightingSetup };
/** The lights node's setups: the one shown and the person's own. */
export type SetupLibrary = { readonly setup: string; readonly setups: readonly UserSetup[] };
export const DEFAULT_SETUP_LIBRARY: SetupLibrary = Object.freeze({ setup: "soft", setups: Object.freeze([]) as readonly UserSetup[] });
/** What the device receives: a complete definition, or the built-in game rig, which it resolves for the body it shows. */
export type LightingSource =
  | { readonly kind: "setup"; readonly setup: LightingSetup }
  | { readonly kind: "game"; readonly calibration: CreatorLightingOptions };

export const CREATOR_SETUP = Object.freeze({ label: "Character creator",
  title: "The game's character-creator lights, from your game files, on black with the game's colour grade: for comparing with the game" });
/** A built-in's name and description. */
export const builtInInfo = (id: BuiltInSetupId): { label: string; title: string } =>
  id === "creator" ? CREATOR_SETUP : { label: STUDIO_SETUPS[id].label, title: STUDIO_SETUPS[id].title };

export const LIGHTING_LIMITS = Object.freeze({
  setups: 32, lights: 16, name: 60,
  /** Metres from V's feet any light may sit or point. */
  coordinate: 20,
  intensity: 10_000,
  /** Each shadow map is a texture unit in every lit material (knowledge §12). */
  shadowCasters: CREATOR_SHADOW.budget,
});
export const SETUP_EXPOSURE_RANGES: Readonly<Record<SetupDisplay, { readonly min: number; readonly max: number }>> =
  Object.freeze({ aces: STUDIO_EXPOSURE_RANGE, game: CREATOR_EXPOSURE_RANGE });
export const SETUP_ENVIRONMENT_RANGE = STUDIO_LIGHT_RANGES.environment;
/** The per-light controls: placement about the focus (degrees, metres), strength, cone half-angle (degrees) and cone softness. */
export type LightNumberKey = "azimuth" | "elevation" | "distance" | "intensity" | "cone" | "softness";
export const LIGHT_NUMBER_KEYS: readonly LightNumberKey[] = Object.freeze(["azimuth", "elevation", "distance", "intensity", "cone", "softness"]);
export const LIGHT_RANGES: Readonly<Record<LightNumberKey, { readonly min: number; readonly max: number }>> = Object.freeze({
  azimuth: Object.freeze({ min: 0, max: 360 }), elevation: Object.freeze({ min: -89, max: 89 }), distance: Object.freeze({ min: 0.1, max: 10 }),
  intensity: Object.freeze({ min: 0, max: LIGHTING_LIMITS.intensity }), cone: Object.freeze({ min: 1, max: 89.9 }),
  softness: Object.freeze({ min: 0, max: 1 }),
});
const RAD = Math.PI / 180;

// ----- Colour -----

/** Three's sRGB decode (ColorManagement `SRGBToLinear`), operation for operation, so a hex colour gives Three's exact floats. */
const srgbToLinear = (c: number) => c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const linearToSrgb = (c: number) => c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
/** A 24-bit sRGB colour as linear RGB, exactly as `new THREE.Color(hex)` holds it. */
export function hexToLinear(hex: number): Vec3 {
  return [srgbToLinear((hex >> 16 & 255) / 255), srgbToLinear((hex >> 8 & 255) / 255), srgbToLinear((hex & 255) / 255)];
}
/** A linear colour as `#rrggbb` (sRGB), for a colour control. */
export function colourHex(colour: Vec3): string {
  const byte = (c: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, c))) * 255)));
  return `#${colour.map(c => byte(c).toString(16).padStart(2, "0")).join("")}`;
}
/** `#rrggbb` as linear RGB, or null when it isn't one. */
export function parseColourHex(text: unknown): Vec3 | null {
  return typeof text === "string" && /^#[0-9a-f]{6}$/i.test(text) ? hexToLinear(Number.parseInt(text.slice(1), 16)) : null;
}
/** The same Rec. 709 luminance as grey (the studio stage's untinted option). */
const neutralOf = (c: Vec3): Vec3 => { const s = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return [s, s, s]; };

// ----- Built-ins -----

/** The original key's distance from the head; a directional light uses only the direction, the shadow camera the distance. */
const KEY_DISTANCE = Math.hypot(Math.hypot(0.3, 0.5), 1.9 - 1.67);
/** `target + direction × distance`, as Three's `copy(target).addScaledVector(direction, distance)` computes it. */
const along = (target: Vec3, direction: Vec3, distance: number): Vec3 =>
  [target[0] + direction[0] * distance, target[1] + direction[1] * distance, target[2] + direction[2] * distance];
/** Cone values a directional light carries for a later switch to spot. */
const SPOT_DEFAULTS = Object.freeze({ angle: 30 * RAD, penumbra: 0.5, decay: 2, distance: 0 });

/**
 * A studio stage (studio-lighting.ts) as a complete setup: the key, fill and rim as the old rig placed and coloured them (the rim is
 * always present, at zero strength by default, so the light count never changes), the room at its strength, ACES at the exposure.
 */
export function studioStageSetup(stage: Readonly<StudioStage>): LightingSetup {
  const l = stage.lights, target = STUDIO_LIGHT_TARGET;
  const colour = (hex: number) => l.neutral ? neutralOf(hexToLinear(hex)) : hexToLinear(hex);
  const directional = (id: string, name: string, position: Vec3, hex: number, intensity: number, shadows: boolean): SetupLight =>
    ({ id, name, type: "directional", position, target: [...target], colour: colour(hex), intensity, shadows, ...SPOT_DEFAULTS });
  return {
    lights: [
      directional("key", "Key", along(target, lightDirection(stage.angle, l.elevation), KEY_DISTANCE), STUDIO_LIGHT_COLOURS.key,
        STUDIO_BASE_INTENSITY.key * l.key, true),
      directional("fill", "Fill", [...STUDIO_FILL_POSITION], STUDIO_LIGHT_COLOURS.fill, STUDIO_BASE_INTENSITY.fill * l.fill, false),
      directional("rim", "Rim", along(target, lightDirection(STUDIO_RIM_DIRECTION.azimuth, STUDIO_RIM_DIRECTION.elevation), KEY_DISTANCE),
        STUDIO_LIGHT_COLOURS.rim, STUDIO_BASE_INTENSITY.rim * l.rim, true),
    ],
    focus: [...target], environment: l.environment, backdrop: "studio", display: "aces", exposure: stage.exposure,
  };
}

/**
 * The game's creator rig for a body under the calibration (creator-lighting.ts: the rig table, the intensity and cone readings, the
 * calibration's gains and yaw, the flagged shadow casters), on black with no room, through the game's grade at the calibration's `k`.
 * `yawOffset` replaces the calibration's turn and `casters` the budgeted shadow casters (research refits only).
 */
export function creatorSetup(sex: BodySex, calibration: CreatorLightingOptions, yawOffset?: number, casters?: readonly string[]): LightingSetup {
  const specs = creatorRigSpecs(sex, { intensity: calibration.intensity, cone: calibration.cone, shadows: calibration.shadows,
    ...(yawOffset === undefined ? {} : { yawOffset }), ...(casters === undefined ? {} : { casters }) });
  // The specs follow the rig table's rows in order; turning the rig moves a light but changes none of its native values.
  const rows = CREATOR_RIGS[sex];
  return {
    lights: specs.map((spec, i) => ({ id: spec.name, name: spec.name.replace(/_/g, " "), type: "spot", position: [...spec.position] as unknown as Vec3,
      target: [...spec.target] as unknown as Vec3, colour: [...spec.colour] as unknown as Vec3, intensity: spec.intensity, shadows: spec.castShadow,
      angle: spec.angle, penumbra: spec.penumbra, decay: spec.decay, distance: spec.distance, game: gameValues(rows[i]!, spec.intensity) })),
    focus: [...CREATOR_HEAD_SLOT[sex]] as unknown as Vec3, environment: 0, backdrop: "black", display: "game", exposure: calibration.exposure,
  };
}

/** A built-in's complete definition for the body shown. */
export function builtInSetup(id: BuiltInSetupId, sex: BodySex, calibration: CreatorLightingOptions): LightingSetup {
  return id === "creator" ? creatorSetup(sex, calibration) : studioStageSetup(STUDIO_SETUPS[id]);
}

// ----- The library -----

export const findUserSetup = (library: SetupLibrary, id: string) => library.setups.find(setup => setup.id === id);
export const setupExists = (library: SetupLibrary, id: unknown) =>
  typeof id === "string" && (isBuiltInSetup(id) || !!findUserSetup(library, id));
/** A setup's shown name. */
export function setupLabel(library: SetupLibrary, id: string): string {
  return isBuiltInSetup(id) ? builtInInfo(id).label : findUserSetup(library, id)?.name ?? id;
}
/** The base a setup resets to: a built-in is its own. */
export function setupBase(library: SetupLibrary, id: string): BuiltInSetupId {
  return isBuiltInSetup(id) ? id : findUserSetup(library, id)?.base ?? "soft";
}
/** The display transform a setup draws through. */
export function setupDisplay(library: SetupLibrary, id: string): SetupDisplay {
  if (isBuiltInSetup(id)) return id === "creator" ? "game" : "aces";
  return findUserSetup(library, id)?.setup.display ?? "aces";
}
/** The rig kind the lights node carries (the view graph's `lights` kind): the display the shown setup draws through. */
export const rigKindOf = (library: SetupLibrary): LightingPreset => setupDisplay(library, library.setup) === "game" ? "creator" : "studio";
/** A setup's complete definition for the body shown. */
export function setupDefinition(library: SetupLibrary, id: string, sex: BodySex, calibration: CreatorLightingOptions): LightingSetup {
  const user = isBuiltInSetup(id) ? undefined : findUserSetup(library, id);
  return user ? user.setup : builtInSetup(isBuiltInSetup(id) ? id : "soft", sex, calibration);
}
/** What the device draws for the shown setup: the built-in creator stays the game rig, resolved by the device for its body. */
export function lightingSource(library: SetupLibrary, calibration: CreatorLightingOptions): LightingSource {
  const id = library.setup;
  if (id === "creator") return { kind: "game", calibration };
  const user = isBuiltInSetup(id) ? undefined : findUserSetup(library, id);
  return { kind: "setup", setup: user ? user.setup : studioStageSetup(STUDIO_SETUPS[isBuiltInSetup(id) ? id as Exclude<BuiltInSetupId, "creator"> : "soft"]) };
}
/** The definition a source draws, for a body (and, for research refits, a trial turn of the game rig or trial shadow casters). */
export function resolveLightingSource(source: LightingSource, sex: BodySex, trial: { yawOffset?: number; casters?: readonly string[] } = {}): LightingSetup {
  return source.kind === "game" ? creatorSetup(sex, source.calibration, trial.yawOffset, trial.casters) : source.setup;
}

const nextUserId = (library: SetupLibrary) => `u${Math.max(0, ...library.setups.map(setup => Number(setup.id.slice(1)))) + 1}`;
/** `wanted`, or `wanted 2`, `wanted 3`… when another setup has that name. */
function uniqueName(library: SetupLibrary, wanted: string): string {
  const taken = new Set([...BUILT_IN_SETUP_IDS.map(id => builtInInfo(id).label), ...library.setups.map(setup => setup.name)]);
  const base = wanted.slice(0, LIGHTING_LIMITS.name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) { const name = `${base.slice(0, LIGHTING_LIMITS.name - String(n).length - 1)} ${n}`; if (!taken.has(name)) return name; }
}
const withSetup = (library: SetupLibrary, setup: UserSetup): SetupLibrary =>
  ({ setup: setup.id, setups: [...library.setups, setup] });

/** A new user setup from any template (built-in or the person's own), named "<template> copy", and shown. */
export function createSetup(library: SetupLibrary, from: string, sex: BodySex, calibration: CreatorLightingOptions): SetupLibrary {
  return withSetup(library, { id: nextUserId(library), name: uniqueName(library, `${setupLabel(library, from)} copy`),
    base: setupBase(library, from), setup: structuredClone(setupDefinition(library, from, sex, calibration)) });
}
/**
 * Change the shown setup's definition. A built-in is never changed: the edit forks it first into "Custom (from <base>)", a user
 * setup holding the built-in's exact definition, and shows the fork with the edit applied.
 */
export function editShownSetup(library: SetupLibrary, sex: BodySex, calibration: CreatorLightingOptions,
  edit: (setup: LightingSetup) => LightingSetup): SetupLibrary {
  const id = library.setup;
  if (isBuiltInSetup(id)) {
    return withSetup(library, { id: nextUserId(library), name: uniqueName(library, `Custom (from ${builtInInfo(id).label})`), base: id,
      setup: edit(structuredClone(builtInSetup(id, sex, calibration))) });
  }
  return { setup: id, setups: library.setups.map(setup => setup.id === id ? { ...setup, setup: edit(setup.setup) } : setup) };
}
export function renameSetup(library: SetupLibrary, id: string, name: string): SetupLibrary {
  return { ...library, setups: library.setups.map(setup => setup.id === id ? { ...setup, name: name.trim() } : setup) };
}
/** Remove a user setup; when it was shown, its base shows instead. */
export function deleteSetup(library: SetupLibrary, id: string): SetupLibrary {
  return { setup: library.setup === id ? setupBase(library, id) : library.setup, setups: library.setups.filter(setup => setup.id !== id) };
}
/** Put a user setup back to its base built-in's definition for the body shown (its name stays). */
export function resetSetup(library: SetupLibrary, id: string, sex: BodySex, calibration: CreatorLightingOptions): SetupLibrary {
  return { ...library, setups: library.setups.map(setup => setup.id === id
    ? { ...setup, setup: structuredClone(builtInSetup(setup.base, sex, calibration)) } : setup) };
}
/** Whether a user setup differs from its base built-in now. */
export function differsFromBase(setup: UserSetup, sex: BodySex, calibration: CreatorLightingOptions): boolean {
  return JSON.stringify(setup.setup) !== JSON.stringify(builtInSetup(setup.base, sex, calibration));
}

// ----- Lights -----

/** Where a light sits about the focus: degrees round V (0° from the camera's side, increasing toward V's right), up, and metres. */
export type LightPlacement = { azimuth: number; elevation: number; distance: number };
export function lightPlacement(light: Pick<SetupLight, "position">, focus: Vec3): LightPlacement {
  const d = [light.position[0] - focus[0], light.position[1] - focus[1], light.position[2] - focus[2]] as const;
  const distance = Math.hypot(d[0], d[1], d[2]) || 1e-9;
  const azimuth = (Math.atan2(d[0], -d[2]) / RAD + 360) % 360;
  return { azimuth, elevation: Math.asin(Math.max(-1, Math.min(1, d[1] / distance))) / RAD, distance };
}
const mapLight = (setup: LightingSetup, id: string, change: (light: SetupLight) => SetupLight): LightingSetup =>
  ({ ...setup, lights: setup.lights.map(light => light.id === id ? change(light) : light) });
/**
 * Set one light control. Moving a light (azimuth, elevation, distance about the focus) keeps what it points at, so a spot light stays
 * aimed where it was and a directional light keeps shining at the head.
 */
export function setLightNumber(setup: LightingSetup, id: string, key: LightNumberKey, value: number): LightingSetup {
  return mapLight(setup, id, light => {
    if (key === "intensity") return { ...light, intensity: value };
    if (key === "cone") return withGameCone({ ...light, angle: value * RAD });
    if (key === "softness") return withGameCone({ ...light, penumbra: value });
    const placement = { ...lightPlacement(light, setup.focus), [key]: value };
    return { ...light, position: along(setup.focus, lightDirection(placement.azimuth, placement.elevation), placement.distance) };
  });
}
/** The Studio's cone as the game's full angles (the default "full" reading: outer = 2 × half-angle, inner = outer × (1 − penumbra)). */
function withGameCone(light: SetupLight): SetupLight {
  if (!light.game) return light;
  const outer = 2 * light.angle / RAD;
  return { ...light, game: { ...light.game, outer, inner: outer * (1 - light.penumbra) } };
}
const srgb8 = (colour: Vec3): Rgb8 => colourHex(colour).slice(1).match(/../g)!.map(pair => Number.parseInt(pair, 16)) as unknown as Rgb8;
export const setLightColour = (setup: LightingSetup, id: string, colour: Vec3) => mapLight(setup, id, light => ({ ...light,
  colour: [...colour] as unknown as Vec3, ...(light.game ? { game: { ...light.game, colour: srgb8(colour) } } : {}) }));
/** Shadows on or off: the game's flags follow (off clears both kinds; on turns the local shadow map on and keeps a contact flag). */
export const setLightShadows = (setup: LightingSetup, id: string, shadows: boolean) => mapLight(setup, id, light => ({ ...light, shadows,
  ...(light.game ? { game: { ...light.game, localShadows: shadows,
    contactShadows: shadows ? light.game.contactShadows : "none" as const } } : {}) }));
/** A directional light has no game counterpart (the game's light is a spot), so its native values go. */
export const setLightType = (setup: LightingSetup, id: string, type: LightType) => mapLight(setup, id, light => {
  const { game, ...rest } = light;
  return type === "spot" && game ? { ...rest, type, game } : { ...rest, type };
});
export const renameLight = (setup: LightingSetup, id: string, name: string) => mapLight(setup, id, light => ({ ...light, name: name.trim() }));
export const aimLightAtHead = (setup: LightingSetup, id: string) => mapLight(setup, id, light => ({ ...light, target: [...setup.focus] as unknown as Vec3 }));
export const removeLight = (setup: LightingSetup, id: string): LightingSetup => ({ ...setup, lights: setup.lights.filter(light => light.id !== id) });
/** Move a light to an index in the list (the order the editor shows; within a type it is also Three's order). */
export function moveLight(setup: LightingSetup, id: string, index: number): LightingSetup {
  const light = setup.lights.find(item => item.id === id);
  if (!light) return setup;
  const rest = setup.lights.filter(item => item.id !== id);
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, light);
  return { ...setup, lights: rest };
}
/** A copy of a light just after it, "<name> copy", with a new ID and no shadows (the budget is the person's to spend). */
export function duplicateLight(setup: LightingSetup, id: string): { setup: LightingSetup; id: string } {
  const at = setup.lights.findIndex(item => item.id === id);
  if (at < 0) return { setup, id };
  const ids = new Set(setup.lights.map(light => light.id)), names = new Set(setup.lights.map(light => light.name));
  let n = setup.lights.length + 1;
  while (ids.has(`light-${n}`)) n++;
  const source = setup.lights[at]!, base = `${source.name} copy`.slice(0, LIGHTING_LIMITS.name);
  let name = base;
  for (let k = 2; names.has(name); k++) name = `${base.slice(0, LIGHTING_LIMITS.name - String(k).length - 1)} ${k}`;
  const copy: SetupLight = { ...structuredClone(source), id: `light-${n}`, name, shadows: false,
    ...(source.game ? { game: { ...source.game, localShadows: false, contactShadows: "none" as const } } : {}) };
  const lights = [...setup.lights];
  lights.splice(at + 1, 0, copy);
  return { setup: { ...setup, lights }, id: copy.id };
}
/**
 * A new white light aimed at the head, from the front and V's right, 30° up: a directional light at the key's distance, or a spot light
 * 1 m out whose strength gives the studio key's light at the head (2.5 at 1 m with inverse-square decay). No shadows until asked.
 */
export function addLight(setup: LightingSetup, type: LightType): { setup: LightingSetup; id: string } {
  const ids = new Set(setup.lights.map(light => light.id)), names = new Set(setup.lights.map(light => light.name));
  let n = setup.lights.length + 1;
  while (ids.has(`light-${n}`) || names.has(`Light ${n}`)) n++;
  const distance = type === "spot" ? 1 : KEY_DISTANCE;
  const light: SetupLight = { id: `light-${n}`, name: `Light ${n}`, type, position: along(setup.focus, lightDirection(45, 30), distance),
    target: [...setup.focus] as unknown as Vec3, colour: [1, 1, 1], intensity: STUDIO_BASE_INTENSITY.key * distance * distance, shadows: false,
    ...SPOT_DEFAULTS };
  return { setup: { ...setup, lights: [...setup.lights, light] }, id: light.id };
}
export const shadowCasters = (setup: LightingSetup) => setup.lights.filter(light => light.shadows).length;
/**
 * Change the display transform. Exposure means something different in each (ACES exposure against the game's `k`), so it goes to the
 * new display's default: the Studio's 1.2, or the creator calibration's `k`.
 */
export function setSetupDisplay(setup: LightingSetup, display: SetupDisplay, calibration: CreatorLightingOptions): LightingSetup {
  return display === setup.display ? setup : { ...setup, display, exposure: display === "game" ? calibration.exposure : DEFAULT_STUDIO_STAGE.exposure };
}

// ----- Validation -----

const finiteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const vector = (value: unknown, limit: number): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => finiteIn(n, -limit, limit));
/** A shown name: 1–60 characters after trimming, no control characters. */
export const validSetupName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 &&
  value.trim().length <= LIGHTING_LIMITS.name && !/[\u0000-\u001f\u007f]/.test(value);
const LIGHT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, USER_ID = /^u[1-9][0-9]{0,3}$/;
const byte = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255;
/** Stored native values, normalised to their known fields, or undefined when any is missing or out of range. */
export function parseGameLightValues(value: unknown): GameLightValues | undefined {
  const g = value as Partial<GameLightValues> | undefined;
  if (!g || typeof g !== "object" || !finiteIn(g.lumen, 0, 1e6) || g.unit !== "lumen" || (g.falloff !== "inverse-square" && g.falloff !== "linear") ||
    !finiteIn(g.radius, 0, 1000) || !finiteIn(g.softness, 0, 100) || !finiteIn(g.outer, 0, 180) || !finiteIn(g.inner, 0, 180) ||
    !(g.colour === null || Array.isArray(g.colour) && g.colour.length === 3 && g.colour.every(byte)) || typeof g.localShadows !== "boolean" ||
    !CONTACT_SHADOWS.includes(g.contactShadows!) || !(g.sourceRadius === undefined || finiteIn(g.sourceRadius, 0, 100)) ||
    !finiteIn(g.roughnessBias, -64, 64) || !finiteIn(g.studioIntensity, 0, LIGHTING_LIMITS.intensity)) return;
  return { lumen: g.lumen, unit: "lumen", falloff: g.falloff, radius: g.radius, softness: g.softness, outer: g.outer, inner: g.inner,
    colour: g.colour ? [...g.colour] as unknown as Rgb8 : null, localShadows: g.localShadows, contactShadows: g.contactShadows!,
    ...(g.sourceRadius === undefined ? {} : { sourceRadius: g.sourceRadius }), roughnessBias: g.roughnessBias, studioIntensity: g.studioIntensity };
}
const MAX_SPOT_ANGLE = 89.9 * RAD;

/** A stored light, normalised to its known fields, or undefined when any is missing or out of range. */
export function parseSetupLight(value: unknown): SetupLight | undefined {
  const l = value as Partial<SetupLight> | undefined;
  if (!l || typeof l !== "object" || typeof l.id !== "string" || !LIGHT_ID.test(l.id) || !validSetupName(l.name) || !LIGHT_TYPES.includes(l.type!) ||
    !vector(l.position, LIGHTING_LIMITS.coordinate) || !vector(l.target, LIGHTING_LIMITS.coordinate) || !vector(l.colour, 1) || l.colour.some(c => c < 0) ||
    !finiteIn(l.intensity, 0, LIGHTING_LIMITS.intensity) || typeof l.shadows !== "boolean" || !finiteIn(l.angle, 1e-4, MAX_SPOT_ANGLE) ||
    !finiteIn(l.penumbra, 0, 1) || !finiteIn(l.decay, 0, 2) || !finiteIn(l.distance, 0, 100)) return;
  if (Math.hypot(l.position[0] - l.target[0], l.position[1] - l.target[1], l.position[2] - l.target[2]) < 1e-4) return;
  const game = l.game === undefined ? undefined : parseGameLightValues(l.game);
  if (l.game !== undefined && !game) return;
  return { id: l.id, name: l.name.trim(), type: l.type!, position: [...l.position] as unknown as Vec3, target: [...l.target] as unknown as Vec3,
    colour: [...l.colour] as unknown as Vec3, intensity: l.intensity, shadows: l.shadows, angle: l.angle, penumbra: l.penumbra, decay: l.decay,
    distance: l.distance, ...(game ? { game } : {}) };
}
/** A stored setup, normalised, or undefined. */
export function parseLightingSetup(value: unknown): LightingSetup | undefined {
  const s = value as Partial<LightingSetup> | undefined;
  if (!s || typeof s !== "object" || !Array.isArray(s.lights) || s.lights.length > LIGHTING_LIMITS.lights ||
    !vector(s.focus, LIGHTING_LIMITS.coordinate) || !finiteIn(s.environment, SETUP_ENVIRONMENT_RANGE.min, SETUP_ENVIRONMENT_RANGE.max) ||
    !SETUP_BACKDROPS.includes(s.backdrop!) || !SETUP_DISPLAYS.includes(s.display!)) return;
  const range = SETUP_EXPOSURE_RANGES[s.display!];
  if (!finiteIn(s.exposure, range.min, range.max)) return;
  const lights = s.lights.map(parseSetupLight);
  if (lights.some(light => !light) || new Set(lights.map(light => light!.id)).size !== lights.length ||
    lights.filter(light => light!.shadows).length > LIGHTING_LIMITS.shadowCasters) return;
  return { lights: lights as SetupLight[], focus: [...s.focus] as unknown as Vec3, environment: s.environment, backdrop: s.backdrop!,
    display: s.display!, exposure: s.exposure };
}
/**
 * A stored library (the lights node's `setup` and `setups`), normalised, or undefined when it isn't one. A damaged setup (an out-of-range
 * value after a later range change, say) is dropped, not the library, as `parseLayoutLibrary` does (PREV-161); a repeated id keeps the
 * first. When the shown setup was dropped, its built-in base is shown instead (the one "Reset to" would give); a shown setup that
 * names no setup at all still makes the whole value invalid.
 */
export function parseSetupLibrary(value: unknown): SetupLibrary | undefined {
  const v = value as Partial<SetupLibrary> | undefined;
  if (!v || typeof v !== "object" || !Array.isArray(v.setups)) return;
  const setups: UserSetup[] = [], ids = new Set<string>();
  let droppedShown: BuiltInSetupId | null = null;
  for (const entry of (v.setups as Partial<UserSetup>[]).slice(0, LIGHTING_LIMITS.setups)) {
    const setup = entry && typeof entry === "object" ? parseLightingSetup(entry.setup) : undefined;
    if (!setup || typeof entry.id !== "string" || !USER_ID.test(entry.id) || !validSetupName(entry.name) || !isBuiltInSetup(entry.base) || ids.has(entry.id)) {
      if (entry && typeof entry === "object" && entry.id === v.setup && !ids.has(entry.id as string) && isBuiltInSetup(entry.base)) droppedShown = entry.base;
      continue;
    }
    ids.add(entry.id);
    setups.push({ id: entry.id, name: entry.name.trim(), base: entry.base, setup });
  }
  const library = { setup: v.setup as string, setups };
  if (setupExists(library, v.setup)) return library;
  // A shown setup that names nothing at all isn't a library (an edit naming an unknown setup is refused).
  return droppedShown ? { setup: droppedShown, setups } : undefined;
}

// ----- Workspaces saved before setups -----

/** The built-in whose parametric stage lies nearest a stage (normalised by each control's range), for a migrated setup's base. */
function nearestStudioBuiltIn(stage: Readonly<StudioStage>): Exclude<BuiltInSetupId, "creator"> {
  const spread = (key: keyof StudioLights & string, a: Readonly<StudioLights>, b: Readonly<StudioLights>) => {
    // The tint is a smaller change than moving a light across its whole range.
    if (key === "neutral") return a.neutral === b.neutral ? 0 : 0.25;
    const range = STUDIO_LIGHT_RANGES[key as keyof typeof STUDIO_LIGHT_RANGES];
    return Math.abs((a[key] as number) - (b[key] as number)) / (range.max - range.min);
  };
  const cost = (id: Exclude<BuiltInSetupId, "creator">) => {
    const built = STUDIO_SETUPS[id], turn = Math.abs(stage.angle - built.angle) % 360;
    return [...STUDIO_LIGHT_KEYS, "neutral" as const].reduce((sum, key) => sum + spread(key, stage.lights, built.lights), 0) +
      Math.min(turn, 360 - turn) / 180 + Math.abs(Math.log2(stage.exposure / built.exposure)) / 6;
  };
  return [...STUDIO_SETUP_IDS].sort((a, b) => cost(a) - cost(b))[0]!;
}
/**
 * A workspace saved before setups: its lighting preset and studio stage. A stage that matches a built-in exactly is that built-in;
 * any other becomes one user setup, "Custom (from <the nearest built-in>)", holding the stage's exact rig, so nothing drawn changes.
 * The creator preset shows the built-in Character creator (its calibration stays the node's `creatorLighting`).
 */
export function migrateLegacyLighting(preset: LightingPreset, stage: Readonly<StudioStage>): SetupLibrary {
  const match = matchingStudioSetup(stage);
  if (match) return { setup: preset === "creator" ? "creator" : match, setups: [] };
  const base = nearestStudioBuiltIn(stage);
  const custom: UserSetup = { id: "u1", name: `Custom (from ${STUDIO_SETUPS[base].label})`, base, setup: studioStageSetup(stage) };
  return { setup: preset === "creator" ? "creator" : custom.id, setups: [custom] };
}
/** Clamped into a legacy range, and rounded to nine decimals so a migrated stage's own values (200°, 35°) read back as written. */
const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, Math.round(value * 1e9) / 1e9));
/**
 * The legacy studio stage a build before setups reads for this library (the workspace's `preview` mirror). With no user setups it is
 * exact, so the library reads back unchanged: a studio built-in's own stage, or Soft studio beside the creator. A user setup is
 * approximated from its `key`, `fill` and `rim` lights (or its first directional light as the key).
 */
export function legacyStudioStage(library: SetupLibrary): StudioStage {
  const id = library.setup;
  if (isBuiltInSetup(id)) return id === "creator" ? structuredClone(DEFAULT_STUDIO_STAGE) : structuredClone({ lights: STUDIO_SETUPS[id].lights,
    exposure: STUDIO_SETUPS[id].exposure, angle: STUDIO_SETUPS[id].angle });
  const setup = findUserSetup(library, id)?.setup;
  if (!setup || setup.display !== "aces") return structuredClone(DEFAULT_STUDIO_STAGE);
  const named = (name: string) => setup.lights.find(light => light.id === name && light.type === "directional");
  const key = named("key") ?? setup.lights.find(light => light.type === "directional");
  const strength = (light: SetupLight | undefined, base: number, key: "key" | "fill" | "rim") =>
    light ? clamp(light.intensity / base, STUDIO_LIGHT_RANGES[key]) : 0;
  const placement = key ? lightPlacement(key, setup.focus) : { azimuth: DEFAULT_STUDIO_STAGE.angle, elevation: DEFAULT_STUDIO_STAGE.lights.elevation };
  return {
    lights: { environment: clamp(setup.environment, STUDIO_LIGHT_RANGES.environment), key: strength(key, STUDIO_BASE_INTENSITY.key, "key"),
      elevation: clamp(placement.elevation, STUDIO_LIGHT_RANGES.elevation), fill: strength(named("fill"), STUDIO_BASE_INTENSITY.fill, "fill"),
      rim: strength(named("rim"), STUDIO_BASE_INTENSITY.rim, "rim"), neutral: !!key && key.colour[0] === key.colour[1] && key.colour[1] === key.colour[2] },
    exposure: clamp(setup.exposure, STUDIO_EXPOSURE_RANGE), angle: clamp(placement.azimuth, STUDIO_KEY_ANGLE_RANGE),
  };
}
