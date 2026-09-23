import * as THREE from "three";
import { clamp, curve, type Layer } from "./recipe";
import {
  SurfaceMap,
  anchorPosition,
  type Anchor,
  type UV,
} from "./surface-map";
import type { createScene } from "./scene";

type Handle = {
  kind: "point" | "origin" | "field";
  index: number;
  mirror: boolean;
  uv: UV;
  anchor: Anchor;
  world: THREE.Vector3;
};
type Hooks = {
  layer: () => Layer | undefined;
  selected: () => number;
  select: (i: number) => void;
  begin: () => void;
  change: () => void;
  cancel: () => void;
  message: (text: string) => void;
};

/** Face controls operate on the same recipe as the UV editor. No baked geometry edits. */
export function createSurfaceEditor(
  viewer: Awaited<ReturnType<typeof createScene>>,
  hooks: Hooks,
) {
  const { renderer, scene, camera, plate, head, controls } = viewer,
    canvas = renderer.domElement;
  const map = new SurfaceMap(plate.geometry),
    group = new THREE.Group();
  scene.add(group);
  const pointGeometry = new THREE.BufferGeometry(),
    lineGeometry = new THREE.BufferGeometry();
  // Recipe limit: 24 curve points + 2 field handles, mirrored; 6 curve samples
  // per point + 16 field segments. Reuse GPU buffers throughout a drag.
  for (const name of ["position", "color"])
    pointGeometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(new Float32Array(52 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  lineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(640 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const pointMaterial = new THREE.PointsMaterial({
    size: 10,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  // Round handles without external bitmap dependencies.
  pointMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;",
    );
  };
  const points = new THREE.Points(pointGeometry, pointMaterial);
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({
      color: 0xb9d0c2,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  points.frustumCulled = lines.frustumCulled = false;
  points.renderOrder = 51;
  lines.renderOrder = 50;
  group.add(points, lines);
  let enabled = true,
    signature = "",
    handles: Handle[] = [],
    segments: [Anchor, Anchor][] = [];
  let drag:
    | { handle: Handle; last: UV; pointer: number; changed: boolean }
    | undefined;
  let hovered: Handle | undefined,
    unmapped = 0;
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();

  function rebuild() {
    const layer = hooks.layer();
    if (!layer) return;
    const key = JSON.stringify([
        layer.points,
        layer.field,
        layer.symmetry,
        layer.enabled,
        hooks.selected(),
      ]);
    if (key === signature) return;
    signature = key;
    handles = [];
    segments = [];
    unmapped = 0;
    function handle(
      kind: Handle["kind"],
      index: number,
      uv: UV,
      mirror: boolean,
    ) {
      const anchor = map.anchor(uv);
      if (anchor)
        handles.push({
          kind,
          index,
          uv,
          mirror,
          anchor,
          world: new THREE.Vector3(),
        });
      else unmapped++;
    }
    function path(path: UV[]) {
      for (let i = 1; i < path.length; i++) {
        const a = map.anchor(path[i - 1]),
          b = map.anchor(path[i]);
        if (a && b && map.continuous(path[i - 1], path[i]))
          segments.push([a, b]);
      }
    }
    for (const mirror of layer.symmetry ? [false, true] : [false]) {
      const reflect = (p: UV) => ({ u: mirror ? 1 - p.u : p.u, v: p.v });
      layer.points.forEach((p, i) => handle("point", i, reflect(p), mirror));
      const f = layer.field;
      handle("field", -1, reflect({ u: f.u + f.du, v: f.v + f.dv }), mirror);
      handle("origin", -1, reflect(f), mirror);
      const outline = curve(layer.points, 6);
      path([...outline, outline[0]].map(reflect));
      path(
        Array.from({ length: 17 }, (_, i) =>
          reflect({ u: f.u + (f.du * i) / 16, v: f.v + (f.dv * i) / 16 }),
        ),
      );
    }
    pointGeometry.setDrawRange(0, handles.length);
    lineGeometry.setDrawRange(0, segments.length * 2);
  }
  function update() {
    group.visible = enabled && !!hooks.layer()?.enabled;
    if (!group.visible) return;
    rebuild();
    const vertices = new Map<number, THREE.Vector3>();
    const vertex = (i: number) => {
      let p = vertices.get(i);
      if (!p) {
        p = plate
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(plate.matrixWorld);
        vertices.set(i, p);
      }
      return p;
    };
    const positions = pointGeometry.getAttribute("position"),
      colors = pointGeometry.getAttribute("color");
    handles.forEach((h, i) => {
      h.world.copy(anchorPosition(h.anchor, vertex, 0.0007));
      positions.setXYZ(i, h.world.x, h.world.y, h.world.z);
      const selected = h.kind === "point" && h.index === hooks.selected(),
        hover =
          h.kind === hovered?.kind &&
          h.index === hovered.index &&
          h.mirror === hovered.mirror;
      const c = new THREE.Color(
        hover
          ? 0xffffb5
          : selected
            ? 0xffffff
            : h.kind === "point"
              ? 0xe7a7d1
              : h.kind === "origin"
                ? 0x5ba985
                : 0xb1ffcd,
      );
      colors.setXYZ(i, c.r, c.g, c.b);
    });
    positions.needsUpdate = colors.needsUpdate = true;
    const p = lineGeometry.getAttribute("position");
    segments.forEach((pair, i) =>
      pair.forEach((a, k) => {
        const v = anchorPosition(a, vertex, 0.00055);
        p.setXYZ(i * 2 + k, v.x, v.y, v.z);
      }),
    );
    p.needsUpdate = true;
  }
  viewer.onFrame(update);
  function setRay(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    mouse.set(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
  }
  function hit(x: number, y: number) {
    setRay(x, y);
    plate.computeBoundingSphere();
    const result = ray
      .intersectObject(plate, false)
      .find(
        (h) =>
          h.face &&
          h.face.normal
            .clone()
            .transformDirection(plate.matrixWorld)
            .dot(ray.ray.direction) < 0,
      );
    if (!result?.uv) return;
    head.computeBoundingSphere();
    const blocker = ray.intersectObjects([head, viewer.eyes], false)[0];
    if (blocker && blocker.distance < result.distance - 0.001) return;
    return { u: result.uv.x, v: result.uv.y };
  }
  function handleAt(x: number, y: number) {
    if (!enabled || !hooks.layer()?.enabled) return;
    const r = canvas.getBoundingClientRect();
    let best: Handle | undefined,
      distance = 13;
    // At a zero-length field, prefer its endpoint so the first drag creates direction.
    for (const h of handles) {
      const p = h.world.clone().project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const d = Math.hypot(
        r.left + ((p.x + 1) * r.width) / 2 - x,
        r.top + ((1 - p.y) * r.height) / 2 - y,
      );
      if (d < distance - 0.1) {
        distance = d;
        best = h;
      }
    }
    if (!best) return;
    // Verify at the handle's centre, not at the edge of its clickable radius.
    const p = best.world.clone().project(camera),
      uv = hit(
        r.left + ((p.x + 1) * r.width) / 2,
        r.top + ((1 - p.y) * r.height) / 2,
      );
    if (!uv || Math.hypot(uv.u - best.uv.u, uv.v - best.uv.v) > 0.012) return;
    return best;
  }
  function stop(cancel = false) {
    if (!drag) return;
    const old = drag;
    drag = undefined;
    controls.enabled = true;
    if (canvas.hasPointerCapture(old.pointer))
      canvas.releasePointerCapture(old.pointer);
    if (cancel && old.changed) hooks.cancel();
    canvas.style.cursor = "";
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)
        return;
      const handle = handleAt(e.clientX, e.clientY);
      if (!handle) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      controls.enabled = false;
      if (handle.kind === "point") hooks.select(handle.index);
      drag = { handle, last: handle.uv, pointer: e.pointerId, changed: false };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!drag) {
        hovered = handleAt(e.clientX, e.clientY);
        canvas.style.cursor = hovered ? "grab" : "";
        return;
      }
      if (e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const uv = hit(e.clientX, e.clientY);
      if (!uv || !map.continuous(drag.last, uv)) {
        hooks.message(
          "Drag paused at the surface edge · return to the handle, or Esc to cancel",
        );
        return;
      }
      if (Math.hypot(uv.u - drag.last.u, uv.v - drag.last.v) < 1e-5) return;
      if (!drag.changed) {
        hooks.begin();
        drag.changed = true;
      }
      const l = hooks.layer();
      if (!l) { stop(); return; }
      const h = drag.handle,
        u = h.mirror ? 1 - uv.u : uv.u,
        v = uv.v;
      if (h.kind === "point") {
        l.points[h.index].u = clamp(u);
        l.points[h.index].v = clamp(v);
      } else if (h.kind === "origin") {
        l.field.u = clamp(u);
        l.field.v = clamp(v);
      } else {
        l.field.du = clamp(u - l.field.u, -0.1, 0.1);
        l.field.dv = clamp(v - l.field.v, -0.1, 0.1);
      }
      drag.last = uv;
      hooks.change();
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
    },
    true,
  );
  canvas.addEventListener("pointercancel", () => stop(true), true);
  canvas.addEventListener("lostpointercapture", () => stop(true));
  window.addEventListener("blur", () => stop(true));
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        drag &&
        (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === "z"))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        stop(true);
      }
    },
    true,
  );
  return {
    setEnabled: (value: boolean) => {
      stop();
      enabled = value;
      group.visible = value;
    },
    diagnostics: () => ({
      enabled,
      dragging: !!drag,
      unmapped,
      handles: handles.map((h) => {
        const p = h.world.clone().project(camera),
          r = canvas.getBoundingClientRect();
        const x = r.left + ((p.x + 1) * r.width) / 2,
          y = r.top + ((1 - p.y) * r.height) / 2;
        setRay(x, y);
        head.computeBoundingSphere();
        const obstruction = ray.intersectObject(head, false)[0];
        return {
          kind: h.kind,
          index: h.index,
          mirror: h.mirror,
          uv: h.uv,
          screen: { x, y },
          world: h.world.toArray(),
          headOcclusion: obstruction
            ? ray.ray.origin.distanceTo(h.world) - obstruction.distance
            : null,
        };
      }),
    }),
  };
}
