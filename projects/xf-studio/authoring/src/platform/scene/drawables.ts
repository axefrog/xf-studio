import type * as THREE from "three";

/** Whether `object` is drawn with a material of its own (a mesh, points, a line). */
export const isDrawable = (object: THREE.Object3D) => !!((object as THREE.Mesh).isMesh || (object as THREE.Points).isPoints || (object as THREE.Line).isLine);

/**
 * Run `draw` with only `only` of `drawables` visible (and every drawable that holds one of them, which a hidden parent would hide too), then
 * put every visibility back. The warm-up's pieces (`warmUp(only)`).
 */
export function drawOnly<T>(drawables: Iterable<THREE.Object3D>, only: ReadonlySet<THREE.Object3D> | undefined, draw: () => T): T {
  if (!only) return draw();
  const keep = new Set<THREE.Object3D>();
  for (const object of only) for (let at: THREE.Object3D | null = object; at && !keep.has(at); at = at.parent) keep.add(at);
  const hidden: THREE.Object3D[] = [];
  for (const object of drawables) if (object.visible && !keep.has(object)) { object.visible = false; hidden.push(object); }
  try { return draw(); }
  finally { for (const object of hidden) object.visible = true; }
}
