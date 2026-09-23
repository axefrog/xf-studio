import * as THREE from "three";
import { clamp, curve, MAX_FIELDS, type Layer } from "./recipe";
import { MAX_CURVE_POINTS, moveTangent, tangentEndpoint } from "./bezier-path";
import { shapeHit, transformLayer, wheelScaleFactor } from "./shape-transform";
import {
  SurfaceMap,
  anchorPosition,
  type Anchor,
  type UV,
} from "./surface-map";
import type { createScene } from "./scene";

type Handle = {
  kind: "point" | "tangent" | "origin" | "field";
  side?: "in" | "out";
  index: number;
  fieldId?: string;
  mirror: boolean;
  uv: UV;
  anchor: Anchor;
  world: THREE.Vector3;
};
type Hooks = {
  layer: () => Layer | undefined;
  selected: () => number;
  select: (i: number) => void;
  selectedField: () => string | undefined;
  selectField: (id: string) => void;
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
  // Recipe limits, mirrored: 24 knots, two selected-knot tangents, two handles/field.
  // Adaptive outlines share the raster budget; each tangent connector has 16 segments.
  const maxHandles = (24 + 2 + 2 * MAX_FIELDS) * 2,
    maxSegments = (Math.max(24 * 6, MAX_CURVE_POINTS) + 32 + MAX_FIELDS * 16 + 64) * 2;
  for (const name of ["position", "color"])
    pointGeometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(new Float32Array(maxHandles * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  lineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(maxSegments * 2 * 3), 3).setUsage(
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
  // Editor guides draw after the transparent makeup and detail cards (10–101).
  // Keep opaque head/eye depth occlusion, so far-side handles cannot show through
  // the face. This changes draw order, not their barycentric surface anchors.
  points.renderOrder = 1001;
  lines.renderOrder = 1000;
  group.add(points, lines);
  let enabled = true,
    signature = "",
    handles: Handle[] = [],
    segments: [Anchor, Anchor][] = [];
  let drag:
    | {
        handle: Handle;
        layer: Layer;
        target: Layer["points"][number] | Layer["fields"][number];
        last: UV;
        pointer: number;
        changed: boolean;
        controlsEnabled: boolean;
      }
    | undefined;
  type ShapeGesture = {
    layer: Layer; snapshot: Layer; expected: string; selected: number; pivot: UV;
    mirror: boolean; changed: boolean;
  };
  let shapeDrag: (ShapeGesture & {
    kind: "translate" | "rotate"; start: UV; last: UV; pointer: number; controlsEnabled: boolean;
  }) | undefined;
  let wheel: (ShapeGesture & { factor: number; timer?: ReturnType<typeof setTimeout> }) | undefined;
  const canonical = (uv: UV, mirror: boolean): UV => ({ u: mirror ? 1 - uv.u : uv.u, v: uv.v });
  const validShape = (state: ShapeGesture) => enabled && hooks.layer() === state.layer && state.layer.enabled
    && hooks.selected() === state.selected && JSON.stringify(state.layer) === state.expected;
  function finishWheel(cancel = false) {
    if (!wheel) return;
    const old = wheel;
    wheel = undefined;
    clearTimeout(old.timer);
    if (cancel && old.changed && validShape(old)) hooks.cancel();
  }
  function stopShape(cancel = false) {
    if (!shapeDrag) return;
    const old = shapeDrag;
    shapeDrag = undefined;
    controls.enabled = old.controlsEnabled;
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    if (cancel && old.changed && validShape(old)) hooks.cancel();
    canvas.style.cursor = "";
  }
  function applyShape(state: ShapeGesture, next: Layer | null) {
    if (!next) {
      hooks.message("Shape limit reached; move back to continue or Esc to cancel");
      return false;
    }
    if (JSON.stringify(next) === state.expected) return true;
    if (!state.changed) { hooks.begin(); state.changed = true; }
    Object.assign(state.layer, next);
    state.expected = JSON.stringify(state.layer);
    hooks.change();
    return true;
  }
  let hovered: Handle | undefined,
    unmapped = 0,
    unmappedTangents = 0,
    tangentWarningKey = "";
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();

  function rebuild() {
    const layer = hooks.layer();
    if (!layer) return;
    const key = JSON.stringify([
        layer.points,
        layer.pathMode,
        layer.fields,
        layer.symmetry,
        layer.enabled,
        hooks.selected(),
        hooks.selectedField(),
      ]);
    if (key === signature) return;
    signature = key;
    handles = [];
    segments = [];
    unmapped = 0;
    unmappedTangents = 0;
    function handle(
      kind: Handle["kind"],
      index: number,
      uv: UV,
      mirror: boolean,
      fieldId?: string,
      side?: Handle["side"],
    ) {
      const anchor = map.anchor(uv);
      if (anchor)
        handles.push({
          kind,
          side,
          index,
          fieldId,
          uv,
          mirror,
          anchor,
          world: new THREE.Vector3(),
        });
      else {
        unmapped++;
        if (kind === "tangent") unmappedTangents++;
      }
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
      const outline = curve(layer.points, 6);
      path([...outline, outline[0]].map(reflect));
      const selectedPoint = layer.points[hooks.selected()];
      if (layer.pathMode === "bezier" && selectedPoint?.handles) {
        for (const side of ["in", "out"] as const) {
          const endpoint = tangentEndpoint(selectedPoint, side);
          handle("tangent", hooks.selected(), reflect(endpoint), mirror, undefined, side);
          path(Array.from({ length: 17 }, (_, j) => reflect({
            u: selectedPoint.u + (endpoint.u - selectedPoint.u) * j / 16,
            v: selectedPoint.v + (endpoint.v - selectedPoint.v) * j / 16,
          })));
        }
      }
      layer.fields.forEach((f, i) => {
        handle("field", i, reflect({ u: f.u + f.du, v: f.v + f.dv }), mirror, f.id);
        handle("origin", i, reflect(f), mirror, f.id);
        path(Array.from({ length: 17 }, (_, j) => reflect({
          u: f.u + (f.du * j) / 16, v: f.v + (f.dv * j) / 16,
        })));
        // This is the Gaussian reach parameter, not a hard edge to the field.
        // Barycentric segment checks leave real gaps where the ring exits the plate.
        if (f.id === hooks.selectedField())
          path(Array.from({ length: 65 }, (_, j) => reflect({
            u: f.u + f.radius * Math.cos(j * Math.PI / 32),
            v: f.v + f.radius * Math.sin(j * Math.PI / 32),
          })));
      });
    }
    // Invalid work must fail explicitly rather than silently dropping guides.
    if (handles.length > maxHandles || segments.length > maxSegments)
      throw new Error("Surface guide capacity exceeded the validated path budget.");
    const warningKey = unmappedTangents ? `${layer.id}:${hooks.selected()}:${unmappedTangents}` : "";
    if (warningKey && warningKey !== tangentWarningKey)
      hooks.message("Some Bézier handles lie outside the eye plate · edit them in the UV pane");
    tangentWarningKey = warningKey;
    pointGeometry.setDrawRange(0, handles.length);
    lineGeometry.setDrawRange(0, segments.length * 2);
  }
  function update() {
    if (drag && !validDrag()) stop();
    if (shapeDrag && !validShape(shapeDrag)) stopShape();
    if (wheel && !validShape(wheel)) finishWheel();
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
      const selected = (h.kind === "point" || h.kind === "tangent")
          ? h.index === hooks.selected()
          : h.fieldId === hooks.selectedField(),
        hover =
          h.kind === hovered?.kind &&
          h.index === hovered.index &&
          h.side === hovered.side &&
          h.fieldId === hovered.fieldId &&
          h.mirror === hovered.mirror;
      const c = new THREE.Color(
        hover
          ? 0xffffb5
          : selected
            ? h.kind === "point" ? 0xffffff : h.kind === "tangent" ? 0xffcea0 : 0xb1ffcd
            : h.kind === "point"
              ? 0xe7a7d1
              : h.kind === "origin"
                ? 0x5ba985
                : 0x75b892,
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
    // If fields overlap, make the currently selected field directly draggable.
    const ordered = [...handles].sort((a, b) =>
      Number(!!b.fieldId && b.fieldId === hooks.selectedField()) -
      Number(!!a.fieldId && a.fieldId === hooks.selectedField()));
    for (const h of ordered) {
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
  function validDrag() {
    if (!drag || !enabled || hooks.layer() !== drag.layer || !drag.layer.enabled)
      return false;
    const { handle: h, target, layer } = drag;
    return h.kind === "point" || h.kind === "tangent"
      ? layer.points[h.index] === target && (h.kind !== "tangent" || (layer.pathMode === "bezier" && !!layer.points[h.index].handles))
      : layer.fields.some((f) => f.id === h.fieldId && f === target);
  }
  function stop(cancel = false) {
    if (!drag) return;
    const old = drag,
      mayCancel = validDrag();
    drag = undefined;
    controls.enabled = old.controlsEnabled;
    if (canvas.hasPointerCapture(old.pointer))
      canvas.releasePointerCapture(old.pointer);
    // A preset/layer/field replacement owns a different Undo context. Never undo
    // its edit because an old pointer gesture later loses capture or is cancelled.
    if (cancel && old.changed && mayCancel) hooks.cancel();
    canvas.style.cursor = "";
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (drag || shapeDrag || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey)
        return;
      update();
      const handle = handleAt(e.clientX, e.clientY);
      const layer = hooks.layer();
      if (!enabled || !layer?.enabled) return;
      finishWheel();
      if (e.shiftKey || !handle) {
        const uv = hit(e.clientX, e.clientY), selected = hooks.selected(), pivot = layer.points[selected];
        if (!uv || !pivot) return;
        const painted = handle ? { mirror: handle.mirror } : shapeHit(layer, uv);
        if (!painted) return;
        const start = canonical(uv, painted.mirror);
        e.preventDefault();
        e.stopImmediatePropagation();
        // Rotation at its pivot has no direction; consume it without moving/orbiting.
        if (e.shiftKey && Math.hypot(start.u - pivot.u, start.v - pivot.v) < 1e-5) {
          hooks.message("Rotate by dragging away from the selected point");
          return;
        }
        shapeDrag = { kind: e.shiftKey ? "rotate" : "translate", layer, snapshot: structuredClone(layer),
          expected: JSON.stringify(layer), selected, pivot: { u: pivot.u, v: pivot.v },
          mirror: painted.mirror, changed: false, start, last: uv,
          pointer: e.pointerId, controlsEnabled: controls.enabled };
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }
      const target = handle.kind === "point" || handle.kind === "tangent"
        ? layer.points[handle.index]
        : layer.fields.find((f) => f.id === handle.fieldId);
      if (!target) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const controlsEnabled = controls.enabled;
      controls.enabled = false;
      if (handle.kind === "point" || handle.kind === "tangent") hooks.select(handle.index);
      else hooks.selectField(handle.fieldId!);
      drag = { handle, layer, target, last: handle.uv, pointer: e.pointerId,
        changed: false, controlsEnabled };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (shapeDrag) {
        if (e.pointerId !== shapeDrag.pointer) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (!validShape(shapeDrag)) { stopShape(); return; }
        const uv = hit(e.clientX, e.clientY), state = shapeDrag;
        if (!uv || !map.continuous(state.last, uv)) {
          hooks.message("Drag paused at the surface edge; return to the shape or Esc to cancel");
          return;
        }
        const current = canonical(uv, state.mirror);
        if (Math.hypot(uv.u - state.last.u, uv.v - state.last.v) < 1e-5) return;
        state.last = uv;
        if (state.kind === "rotate" && Math.hypot(current.u - state.pivot.u, current.v - state.pivot.v) < 1e-5) return;
        const transform = state.kind === "translate"
          ? { kind: "translate" as const, du: current.u - state.start.u, dv: current.v - state.start.v }
          : { kind: "rotate" as const, pivot: state.pivot,
              radians: Math.atan2(current.v - state.pivot.v, current.u - state.pivot.u)
                - Math.atan2(state.start.v - state.pivot.v, state.start.u - state.pivot.u) };
        applyShape(state, transformLayer(state.snapshot, transform));
        return;
      }
      if (!drag) {
        hovered = handleAt(e.clientX, e.clientY);
        const layer = hooks.layer(), uv = !hovered && enabled && layer?.enabled
          ? hit(e.clientX, e.clientY) : undefined;
        canvas.style.cursor = hovered || (uv && layer && shapeHit(layer, uv)) ? "grab" : "";
        return;
      }
      if (e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!validDrag()) { stop(); return; }
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
      const l = drag.layer;
      const h = drag.handle,
        u = h.mirror ? 1 - uv.u : uv.u,
        v = uv.v;
      if (h.kind === "point") {
        l.points[h.index].u = clamp(u);
        l.points[h.index].v = clamp(v);
      } else if (h.kind === "tangent") {
        // Keep knot identity stable so an in-progress gesture remains valid.
        Object.assign(l.points[h.index], moveTangent(l.points[h.index], h.side!, { u, v }));
      } else {
        const field = l.fields.find((f) => f.id === h.fieldId)!;
        if (h.kind === "origin") {
          field.u = clamp(u);
          field.v = clamp(v);
        } else {
          field.du = clamp(u - field.u, -0.1, 0.1);
          field.dv = clamp(v - field.v, -0.1, 0.1);
        }
      }
      drag.last = uv;
      hooks.change();
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (shapeDrag && e.pointerId === shapeDrag.pointer) {
        e.preventDefault(); e.stopImmediatePropagation(); stopShape(); return;
      }
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
    },
    true,
  );
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId === drag?.pointer) stop(true);
    if (e.pointerId === shapeDrag?.pointer) stopShape(true);
  }, true);
  canvas.addEventListener("lostpointercapture", (e) => {
    if (e.pointerId === drag?.pointer) stop(true);
    if (e.pointerId === shapeDrag?.pointer) stopShape(true);
  });
  canvas.addEventListener("wheel", (e) => {
    if (!enabled || !e.shiftKey) return;
    // A scale gesture never leaks through to camera zoom, including rejected edits.
    e.preventDefault(); e.stopImmediatePropagation();
    if (drag || shapeDrag || e.ctrlKey || e.altKey || e.metaKey) return;
    update();
    const layer = hooks.layer(), uv = hit(e.clientX, e.clientY), handle = handleAt(e.clientX, e.clientY);
    if (!layer?.enabled || !uv || !(handle || shapeHit(layer, uv))) return;
    const selected = hooks.selected(), pivot = layer.points[selected];
    if (!pivot) return;
    if (!wheel) wheel = { layer, snapshot: structuredClone(layer), expected: JSON.stringify(layer), selected,
      pivot: { u: pivot.u, v: pivot.v }, mirror: handle?.mirror ?? shapeHit(layer, uv)!.mirror,
      changed: false, factor: 1 };
    const factor = wheel.factor * wheelScaleFactor(e.deltaY, e.deltaMode);
    if (applyShape(wheel, transformLayer(wheel.snapshot, { kind: "scale", pivot: wheel.pivot, factor })))
      wheel.factor = factor;
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(() => finishWheel(), 250);
  }, { capture: true, passive: false });
  // Committing a wheel burst before focus moves keeps a later Escape in a text
  // field or the UV pane from cancelling an unrelated surface transaction.
  window.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) finishWheel();
  }, true);
  window.addEventListener("blur", () => { stop(true); stopShape(true); finishWheel(true); });
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        (drag || shapeDrag || wheel) &&
        (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === "z"))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        stop(true);
        stopShape(true);
        finishWheel(true);
      }
    },
    true,
  );
  return {
    setEnabled: (value: boolean) => {
      stop();
      stopShape();
      finishWheel();
      enabled = value;
      group.visible = value;
    },
    diagnostics: () => ({
      enabled,
      dragging: !!drag || !!shapeDrag,
      gesture: shapeDrag?.kind ?? (wheel ? "scale" : drag ? "handle" : null),
      pivot: shapeDrag?.pivot ?? wheel?.pivot ?? null,
      unmapped,
      unmappedTangents,
      tangentFallback: unmappedTangents
        ? "Some Bézier handles lie outside the eye plate; edit them in the UV pane."
        : null,
      selectedField: hooks.selectedField(),
      segments: segments.length,
      capacity: { handles: maxHandles, segments: maxSegments },
      overlay: { points: points.renderOrder, lines: lines.renderOrder,
        depthTest: pointMaterial.depthTest, depthWrite: pointMaterial.depthWrite },
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
          side: h.side,
          index: h.index,
          fieldId: h.fieldId,
          mirror: h.mirror,
          uv: h.uv,
          screen: { x, y },
          selectable: handleAt(x, y) === h,
          world: h.world.toArray(),
          headOcclusion: obstruction
            ? ray.ray.origin.distanceTo(h.world) - obstruction.distance
            : null,
        };
      }),
    }),
  };
}
