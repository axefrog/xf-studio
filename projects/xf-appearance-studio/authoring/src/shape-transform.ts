import { coverage, curve, parseRecipe, type Layer } from "./recipe";

type UV = { u: number; v: number };
export type ShapeTransform =
  | { kind: "translate"; du: number; dv: number }
  | { kind: "scale"; pivot: UV; factor: number }
  | { kind: "rotate"; pivot: UV; radians: number };

const finiteUV = (uv: UV) => uv != null && Number.isFinite(uv.u) && Number.isFinite(uv.v);

/** Transform one authored shape and its displacement field as a single unit.
 * Reject the whole edit at recipe limits rather than silently distorting it.
 * Symmetry stays a rendering rule; adapters reflect gestures into source UV.
 */
export function transformLayer(layer: Layer, command: ShapeTransform): Layer | null {
  if (!command || typeof command !== "object") return null;
  let position: (uv: UV) => UV, vector: (uv: UV) => UV;
  let scale = 1;
  const identity = (uv: UV): UV => ({ u: uv.u, v: uv.v });
  if (command.kind === "translate") {
    if (!Number.isFinite(command.du) || !Number.isFinite(command.dv)) return null;
    position = uv => ({ u: uv.u + command.du, v: uv.v + command.dv });
    vector = identity;
  } else if (command.kind === "scale") {
    if (!finiteUV(command.pivot) || !Number.isFinite(command.factor) || command.factor <= 0) return null;
    scale = command.factor;
    vector = uv => ({ u: uv.u * scale, v: uv.v * scale });
    position = scale === 1 ? identity : uv => ({
      u: command.pivot.u + (uv.u - command.pivot.u) * scale,
      v: command.pivot.v + (uv.v - command.pivot.v) * scale,
    });
  } else if (command.kind === "rotate") {
    if (!finiteUV(command.pivot) || !Number.isFinite(command.radians)) return null;
    const cos = Math.cos(command.radians), sin = Math.sin(command.radians);
    vector = uv => ({ u: uv.u * cos - uv.v * sin, v: uv.u * sin + uv.v * cos });
    position = command.radians === 0 ? identity : uv => {
      const moved = vector({ u: uv.u - command.pivot.u, v: uv.v - command.pivot.v });
      return { u: command.pivot.u + moved.u, v: command.pivot.v + moved.v };
    };
  } else return null;
  try {
    // Validate before transforming, so invalid source data cannot be repaired
    // accidentally and accepted as an otherwise valid edit.
    const next = parseRecipe({schema: "xfs/recipe-6", uv: "gltf-uv0-top-left", layers: [layer]}).layers[0];
    if ((command.kind === "translate" && command.du === 0 && command.dv === 0) ||
      (command.kind === "scale" && command.factor === 1) ||
      (command.kind === "rotate" && command.radians === 0)) return next;
    next.points = next.points.map(p => ({
      ...p, ...position(p),
      ...(p.feather !== undefined ? {feather: p.feather * scale} : {}),
      ...(p.handles ? {handles: {...p.handles, in: vector(p.handles.in), out: vector(p.handles.out)}} : {}),
    }));
    next.fields = next.fields.map(f => {
      const direction = vector({ u: f.du, v: f.dv });
      return {...f, ...position(f), du: direction.u, dv: direction.v, radius: f.radius * scale};
    });
    next.feather *= scale;
    if (next.softness.mode === "boundary") next.softness.blend *= scale;
    if (next.strength.mode === "smooth-boundary") next.strength.blend *= scale;
    return parseRecipe({schema: "xfs/recipe-6", uv: "gltf-uv0-top-left", layers: [next]}).layers[0];
  } catch { return null; }
}

/** Pick the painted footprint, including warp and edge falloff, not its hull. */
export function shapeHit(layer: Layer, uv: UV): { mirror: boolean } | null {
  if (!layer.enabled || !finiteUV(uv)) return null;
  const source = { ...layer, symmetry: false }, polygon = curve(layer.points);
  const authored = coverage(uv.u, uv.v, source, polygon);
  const reflected = layer.symmetry ? coverage(1 - uv.u, uv.v, source, polygon) : 0;
  if (Math.max(authored, reflected) < .01) return null;
  return { mirror: reflected > authored };
}

/** Negative wheel movement enlarges. Delta modes use 16px lines / 800px pages;
 * cap a single event at 25% to make large device bursts controllable.
 */
export function wheelScaleFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || ![0, 1, 2].includes(deltaMode)) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
  const exponent = Math.max(-Math.log(1.25), Math.min(Math.log(1.25), -deltaY * unit * .002));
  return Math.exp(exponent);
}
