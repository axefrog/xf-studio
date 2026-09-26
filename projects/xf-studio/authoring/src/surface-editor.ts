import * as THREE from "three";
import { cancelsGesture } from "./gesture-cancel";
import { modifierKey, modifiersOf, pointerBinding, pointerInputOf, type EditorInputState,
  type GestureKind, type PointerTarget } from "./input-bindings";
import { isCameraEffect } from "./head-camera-input";
import { clamp, curve, MAX_FIELDS, type Layer } from "./engines/layered-makeup/recipe";
import { MAX_CURVE_POINTS, moveTangent, tangentEndpoint } from "./engines/layered-makeup/bezier-path";
import { shapeHit, shapeWheelScaleFactor, shiftWheelDelta, transformLayer } from "./engines/layered-makeup/shape-transform";
import type { LayeredMakeupRegion } from "./engines/layered-makeup/region";
import {
  SurfaceMap,
  anchorPosition,
  type Anchor,
  type UV,
} from "./surface-map";
import type { SceneHost } from "./platform/scene/scene-host";
import { tangentFrame, tangentWorld, tangentRayUV, type TangentFrame } from "./surface-tangent";
import { createSurfaceOcclusion } from "./surface-occlusion";
import type { StudioGestureProposal } from "./studio-application";
import type { ViewportHit } from "./viewport-attachment";

type Handle = {
  kind: "point" | "tangent" | "origin" | "field";
  side?: "in" | "out";
  index: number;
  fieldId?: string;
  mirror: boolean;
  uv: UV;
  anchor: Anchor;
  world: THREE.Vector3;
  projected?: {parent:UV; visible:boolean; frame?:TangentFrame};
};
type Hooks = {
  layer: () => Layer | undefined;
  /** Optional: every layer, back to front, so a context hit can name makeup the selection does not own. */
  layers?: () => readonly Layer[];
  selected: () => number;
  select: (i: number) => void;
  selectedField: () => string | undefined;
  selectField: (id: string) => void;
  begin: () => void;
  apply: (action: StudioGestureProposal) => boolean;
  cancel: () => void;
  finish?: () => void;
  message: (text: string) => void;
  /** Hover target, active gesture and editability, for hint strips and cursors (the presentation draws both). */
  input?: (state: EditorInputState) => void;
  /** The live feature's region: the layer models shape edits validate with and the mirror hit tests reflect across. */
  region: Pick<LayeredMakeupRegion, "models" | "mirror">;
};
const HANDLE_TARGET: Record<Handle["kind"], PointerTarget> = { point: "point", tangent: "tangent", origin: "warp-origin", field: "warp-vector" };

/** What the on-head editor uses of the loaded head: the scene host's view and input, and the layered-makeup surface it edits. */
export type SurfaceViewer = Pick<SceneHost, "renderer" | "scene" | "camera" | "head" | "eyes" | "controls"
  | "cameraInput" | "onFrame" | "requestRender"> & { plate: THREE.SkinnedMesh };

/** Face controls operate on the same recipe as the UV editor. No baked geometry edits. */
export function createSurfaceEditor(
  viewer: SurfaceViewer,
  hooks: Hooks,
) {
  const { renderer, scene, camera, plate, head, controls } = viewer,
    canvas = renderer.domElement;
  const listeners = new AbortController();
  const map = new SurfaceMap(plate.geometry),
    group = new THREE.Group();
  const headVisibility=createSurfaceOcclusion(head);
  const eyeVisibility=createSurfaceOcclusion(viewer.eyes);
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
  const tangentGeometry = pointGeometry.clone(), tangentLineGeometry = new THREE.BufferGeometry();
  tangentLineGeometry.setAttribute("position",new THREE.Float32BufferAttribute(new Float32Array(4*2*3),3).setUsage(THREE.DynamicDrawUsage));
  tangentGeometry.setDrawRange(0,0);tangentLineGeometry.setDrawRange(0,0);
  const tangentMaterial = pointMaterial.clone();
  tangentMaterial.depthTest=false;
  tangentMaterial.onBeforeCompile=pointMaterial.onBeforeCompile;
  const tangentPoints=new THREE.Points(tangentGeometry,tangentMaterial),
    tangentLines=new THREE.LineSegments(tangentLineGeometry,new THREE.LineBasicMaterial({
      color:0xb9d0c2,transparent:true,opacity:.65,depthTest:false,depthWrite:false}));
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
  tangentPoints.frustumCulled=tangentLines.frustumCulled=false;
  // Editor guides draw after the transparent makeup and detail cards (10–101).
  // Keep opaque head/eye depth occlusion, so far-side handles cannot show through
  // the face. This changes draw order, not their barycentric surface anchors.
  points.renderOrder = 1001;
  lines.renderOrder = 1000;
  // Tangents are projected vector UI, visible only when their real parent knot
  // faces the camera and is not hidden by the head/eyes. Endpoints may cross an eye hole.
  tangentPoints.renderOrder=1003;tangentLines.renderOrder=1002;
  group.add(points, lines, tangentPoints,tangentLines);
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
        grabOffset?:UV;
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
    if (cancel && old.changed && validShape(old)) hooks.cancel(); else if (old.changed) hooks.finish?.();
    publishInput();
  }
  function stopShape(cancel = false) {
    if (!shapeDrag) return;
    const old = shapeDrag;
    shapeDrag = undefined;
    controls.enabled = old.controlsEnabled;
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    if (cancel && old.changed && validShape(old)) hooks.cancel(); else if (old.changed) hooks.finish?.();
    publishInput();
  }
  function applyShape(state: ShapeGesture, next: Layer | null) {
    if (!next) {
      hooks.message("Shape limit reached; move back to continue or Esc to cancel");
      return false;
    }
    if (JSON.stringify(next) === state.expected) return true;
    if (!state.changed) { hooks.begin(); state.changed = true; }
    if (!hooks.apply({ kind: "shape.replace", next })) return false;
    // Detached geometry syncs lazily on read. Read it back before recording what this
    // gesture wrote, or the next validity check mistakes our own edit for a stale context.
    hooks.layer();
    state.expected = JSON.stringify(state.layer);
    return true;
  }
  let hovered: Handle | undefined,
    unmapped = 0,
    unmappedTangents = 0,
    tangentWarningKey = "";
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let hitRejection: {reason: string; plateDistance?: number; blockerDistance?: number} | undefined;
  let lastDragRejection: {reason: string; x: number; y: number; uv?: UV; from?: UV;
    plateDistance?: number; blockerDistance?: number} | null = null;

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
      parent?:UV,
    ) {
      const anchor = map.anchor(parent ?? uv);
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
          ...(parent ? {projected:{parent,visible:false}} : {}),
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
          handle("tangent", hooks.selected(), reflect(endpoint), mirror, undefined, side, reflect(selectedPoint));
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
      hooks.message("Some Bézier parent points have no eye-plate anchor · edit them in the UV pane");
    tangentWarningKey = warningKey;
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
    let anchoredCount=0,projectedCount=0;
    const parentFrames=new Map<string,{frame:TangentFrame|undefined;visible:boolean}>();
    const tangentLinesPosition=tangentLineGeometry.getAttribute("position");
    handles.forEach((h) => {
      let geometry=pointGeometry,index=anchoredCount;
      if(h.projected){
        const key=`${h.index}:${h.mirror}`;
        let parent=parentFrames.get(key);
        if(!parent){const frame=tangentFrame(plate.geometry,h.anchor,h.projected.parent,vertex);
          parent={frame,visible:!!frame&&parentVisible(frame)};parentFrames.set(key,parent);}
        const {frame}=parent;
        h.projected.frame=frame;
        h.projected.visible=parent.visible;
        if(!frame||!h.projected.visible)return;
        h.world.copy(tangentWorld(frame,h.uv));
        geometry=tangentGeometry;index=projectedCount++;
        tangentLinesPosition.setXYZ(index*2,frame.origin.x,frame.origin.y,frame.origin.z);
        tangentLinesPosition.setXYZ(index*2+1,h.world.x,h.world.y,h.world.z);
      }else {h.world.copy(anchorPosition(h.anchor, vertex, 0.0007));anchoredCount++;}
      const positions=geometry.getAttribute("position"),colors=geometry.getAttribute("color");
      positions.setXYZ(index, h.world.x, h.world.y, h.world.z);
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
      colors.setXYZ(index, c.r, c.g, c.b);
    });
    pointGeometry.setDrawRange(0,anchoredCount);tangentGeometry.setDrawRange(0,projectedCount);
    tangentLineGeometry.setDrawRange(0,projectedCount*2);tangentLinesPosition.needsUpdate=true;
    for(const geometry of [pointGeometry,tangentGeometry])
      for(const name of ["position","color"])geometry.getAttribute(name).needsUpdate=true;
    const p = lineGeometry.getAttribute("position");
    segments.forEach((pair, i) =>
      pair.forEach((a, k) => {
        const v = anchorPosition(a, vertex, 0.00055);
        p.setXYZ(i * 2 + k, v.x, v.y, v.z);
      }),
    );
    p.needsUpdate = true;
  }
  const offFrame = viewer.onFrame(update);
  function setRay(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    mouse.set(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
  }
  function parentVisible(frame:TangentFrame) {
    const projected=frame.origin.clone().project(camera);
    if(![projected.x,projected.y,projected.z].every(Number.isFinite)||
      projected.z < -1 || projected.z > 1 || Math.abs(projected.x)>1 || Math.abs(projected.y)>1)return false;
    mouse.set(projected.x,projected.y);ray.setFromCamera(mouse,camera);
    if(frame.normal.dot(ray.ray.direction)>=-1e-4)return false;
    const limit=ray.ray.origin.distanceTo(frame.origin)-.001;
    return !headVisibility.occluded(ray.ray,limit)&&!eyeVisibility.occluded(ray.ray,limit);
  }
  function projectedHit(h:Handle,x:number,y:number) {
    if(!h.projected)return;
    const frame=tangentFrame(plate.geometry,h.anchor,h.projected.parent,
      i=>plate.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(plate.matrixWorld));
    if(!frame||!parentVisible(frame)){hitRejection={reason:"tangent-parent-hidden-or-singular"};return;}
    setRay(x,y);
    const uv=tangentRayUV(frame,ray.ray);
    hitRejection=uv ? undefined : {reason:"tangent-plane-grazing"};
    return uv;
  }
  function hit(x: number, y: number) {
    hitRejection = undefined;
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
    if (!result?.uv) { hitRejection = {reason:"no-front-plate-hit"}; return; }
    head.computeBoundingSphere();
    const blocker = ray.intersectObjects([head, viewer.eyes], false)[0];
    if (blocker && blocker.distance < result.distance - 0.001) {
      hitRejection = {reason:blocker.object===head ? "head-occlusion" : "eye-occlusion",
        plateDistance:result.distance,blockerDistance:blocker.distance};
      return;
    }
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
      if(h.projected&&!h.projected.visible)continue;
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
    if(best.projected) return projectedHit(best,x,y) ? best : undefined;
    // Verify at the handle's centre, not at the edge of its clickable radius.
    const p = best.world.clone().project(camera),
      uv = hit(
        r.left + ((p.x + 1) * r.width) / 2,
        r.top + ((1 - p.y) * r.height) / 2,
      );
    if (!uv || Math.hypot(uv.u - best.uv.u, uv.v - best.uv.v) > 0.012) return;
    return best;
  }
  /** Visible character geometry (plate, skin, eyes, hair and other details) under the pointer. */
  function characterAt(x: number, y: number) {
    setRay(x, y);
    head.computeBoundingSphere();
    if (ray.intersectObjects([plate, head, viewer.eyes], false).length) return true;
    const shown = (object: THREE.Object3D | null): boolean => !object || object === scene || object.visible && shown(object.parent);
    const inGroup = (object: THREE.Object3D | null): boolean => !!object && (object === group || inGroup(object.parent));
    return ray.intersectObjects(scene.children, true).some(entry =>
      (entry.object as THREE.Mesh).isMesh && shown(entry.object) && !inGroup(entry.object));
  }
  /**
   * Context-menu classification, most specific first: a visible control of the selected layer
   * (surface controls on), then painted makeup (the selected layer, then the frontmost other
   * visible layer), then bare character geometry (`head`). No geometry at all is no hit (background).
   */
  function hitAt(clientX: number, clientY: number): ViewportHit | undefined {
    if (drag || shapeDrag || wheel) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientY < rect.top ||
      clientX >= rect.left + rect.width || clientY >= rect.top + rect.height) return;
    const layer = hooks.layer();
    const handle = enabled && layer?.enabled ? (update(), handleAt(clientX, clientY)) : undefined;
    if (layer && handle) {
      const hit = handle.kind === "point" ? { kind: "point" as const, layerId: layer.id, index: handle.index }
        : handle.kind === "tangent" ? { kind: "tangent" as const, layerId: layer.id,
          index: handle.index, side: handle.side === "in" ? "incoming" as const : "outgoing" as const }
        : { kind: "field" as const, layerId: layer.id, id: handle.fieldId! };
      return { hit, mirror: handle.mirror,
        affordance: handle.kind === "origin" ? "warp-origin" : handle.kind === "field" ? "warp-vector" : handle.kind };
    }
    const uv = hit(clientX, clientY);
    if (uv) {
      const others = [...hooks.layers?.() ?? []].reverse().filter(item => item.id !== layer?.id);
      for (const candidate of [...layer ? [layer] : [], ...others]) {
        const shape = shapeHit(candidate, uv, hooks.region.mirror);
        if (shape) return { hit: { kind: "shape", layerId: candidate.id }, mirror: shape.mirror, affordance: "shape" };
      }
    }
    return characterAt(clientX, clientY) ? { hit: { kind: "head" }, affordance: "empty" } : undefined;
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
    if (cancel && old.changed && mayCancel) hooks.cancel(); else if (old.changed) hooks.finish?.();
    publishInput();
  }
  /** Resolve what is under the pointer. Off makeup, or while editing is disabled, is `empty`. */
  function targetAt(x: number, y: number, needUV = false) {
    const layer = hooks.layer(), editable = enabled && !!layer?.enabled;
    if (!editable || !layer) return { target: "empty" as PointerTarget, editable, layer };
    const handle = handleAt(x, y), uv = !handle || needUV ? hit(x, y) : undefined;
    const painted = handle ? { mirror: handle.mirror } : uv ? shapeHit(layer, uv, hooks.region.mirror) : undefined;
    return { target: handle ? HANDLE_TARGET[handle.kind] : painted ? "shape" as PointerTarget : "empty" as PointerTarget,
      editable, layer, handle, uv, painted };
  }
  // The camera adapter resolves every press's binding against the same target as the editor.
  viewer.cameraInput?.setTargetResolver((x, y) => { update(); return targetAt(x, y).target; });
  let hoverTarget: PointerTarget | undefined, inputKey = "";
  function publishInput() {
    const gesture: GestureKind | undefined = shapeDrag?.kind ?? (drag ? "handle" : wheel ? "scale" : undefined);
    const state: EditorInputState = { target: hoverTarget, gesture, editable: enabled && !!hooks.layer()?.enabled };
    if (!hooks.input) return;
    const key = JSON.stringify(state);
    if (key !== inputKey) { inputKey = key; hooks.input(state); }
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      // Only a drag can edit. Every other press (right, middle, a second finger) is resolved by
      // head-camera-input.ts, which sets the orbit controls to exactly its bound camera effect.
      if (drag || shapeDrag || pointerInputOf(e) !== "drag") return;
      update();
      // Every drag resolves through the input catalogue. Camera bindings are left to the orbit
      // controls (configured for them); everything else, including a consumed no-op, never reaches them.
      const resolved = targetAt(e.clientX, e.clientY, e.shiftKey);
      const effect = pointerBinding("head", "drag", resolved.target, modifierKey(modifiersOf(e)))?.effect ?? "none";
      if (isCameraEffect(effect)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { layer, handle, painted } = resolved;
      if (effect === "none" || !layer || !painted) return;
      finishWheel();
      if (effect === "shape-translate" || effect === "shape-rotate") {
        const uv = resolved.uv ?? hit(e.clientX, e.clientY), selected = hooks.selected(), pivot = layer.points[selected];
        if (!uv || !pivot) return;
        const start = canonical(uv, painted.mirror);
        // Rotation at its pivot has no direction; consume it without moving/orbiting.
        if (effect === "shape-rotate" && Math.hypot(start.u - pivot.u, start.v - pivot.v) < 1e-5) {
          hooks.message("Rotate by dragging away from the selected point");
          return;
        }
        shapeDrag = { kind: effect === "shape-rotate" ? "rotate" : "translate", layer, snapshot: structuredClone(layer),
          expected: JSON.stringify(layer), selected, pivot: { u: pivot.u, v: pivot.v },
          mirror: painted.mirror, changed: false, start, last: uv,
          pointer: e.pointerId, controlsEnabled: controls.enabled };
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
        publishInput();
        return;
      }
      if (effect !== "handle-drag" || !handle) return;
      const target = handle.kind === "point" || handle.kind === "tangent"
        ? layer.points[handle.index]
        : layer.fields.find((f) => f.id === handle.fieldId);
      if (!target) return;
      const initialUV=handle.projected ? projectedHit(handle,e.clientX,e.clientY) : undefined;
      if(handle.projected&&!initialUV)return;
      const controlsEnabled = controls.enabled;
      controls.enabled = false;
      if (handle.kind === "point" || handle.kind === "tangent") hooks.select(handle.index);
      else hooks.selectField(handle.fieldId!);
      drag = { handle, layer, target, last: handle.uv, pointer: e.pointerId,
        changed: false, controlsEnabled,
        ...(initialUV?{grabOffset:{u:initialUV.u-handle.uv.u,v:initialUV.v-handle.uv.v}}:{}) };
      lastDragRejection = null;
      canvas.setPointerCapture(e.pointerId);
      publishInput();
    },
    { capture: true, signal: listeners.signal },
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
        applyShape(state, transformLayer(state.snapshot, transform, hooks.region.models));
        return;
      }
      if (!drag) {
        const resolved = targetAt(e.clientX, e.clientY);
        hovered = resolved.handle;
        hoverTarget = resolved.target;
        publishInput();
        return;
      }
      if (e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!validDrag()) { stop(); return; }
      let uv = drag.handle.projected ? projectedHit(drag.handle,e.clientX,e.clientY) : hit(e.clientX, e.clientY);
      if(uv&&drag.grabOffset)uv={u:uv.u-drag.grabOffset.u,v:uv.v-drag.grabOffset.v};
      if (!uv || (!drag.handle.projected&&!map.continuous(drag.last, uv))) {
        lastDragRejection = { ...(uv ? {reason:"uv-discontinuity"} : hitRejection ?? {reason:"no-hit"}),
          x:e.clientX,y:e.clientY,uv,from:{...drag.last} };
        hooks.message(
          drag.handle.projected ? "Tangent projection paused · turn the parent point toward you, or Esc to cancel"
            : "Drag paused at the surface edge · return to the handle, or Esc to cancel",
        );
        return;
      }
      lastDragRejection = null;
      if (Math.hypot(uv.u - drag.last.u, uv.v - drag.last.v) < 1e-5) return;
      if (!drag.changed) {
        hooks.begin();
        drag.changed = true;
      }
      const l = drag.layer;
      const h = drag.handle,
        u = h.mirror ? 1 - uv.u : uv.u,
        v = uv.v;
      let accepted = false;
      if (h.kind === "point") {
        accepted = hooks.apply({ kind: "point.replace", index: h.index, next: { u: clamp(u), v: clamp(v) } });
      } else if (h.kind === "tangent") {
        // Keep knot identity stable so an in-progress gesture remains valid.
        accepted = hooks.apply({ kind: "point.replace", index: h.index,
          next: moveTangent(l.points[h.index], h.side!, { u, v }) });
      } else {
        const field = l.fields.find((f) => f.id === h.fieldId)!;
        if (h.kind === "origin") {
          accepted = hooks.apply({ kind: "field.replace", fieldId: field.id, next: { u: clamp(u), v: clamp(v) } });
        } else {
          accepted = hooks.apply({ kind: "field.replace", fieldId: field.id,
            next: { du: clamp(u - field.u, -0.1, 0.1), dv: clamp(v - field.v, -0.1, 0.1) } });
        }
      }
      if (accepted) drag.last = uv;
    },
    { capture: true, signal: listeners.signal },
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (shapeDrag && e.pointerId === shapeDrag.pointer) {
        e.preventDefault(); e.stopImmediatePropagation(); stopShape(); rehover(e); return;
      }
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop(); rehover(e);
    },
    { capture: true, signal: listeners.signal },
  );
  /** After a gesture the geometry under a still pointer has changed; resolve it again. */
  function rehover(e: PointerEvent) {
    update();
    const resolved = targetAt(e.clientX, e.clientY);
    hovered = resolved.handle; hoverTarget = resolved.target;
    publishInput();
    // The release stops the event before the viewport's own pointer trigger sees it, and the head draws on
    // demand: ask for the frame that shows the new hover highlight (UI-47).
    viewer.requestRender?.();
  }
  canvas.addEventListener("pointerleave", () => {
    hovered = undefined; hoverTarget = undefined; publishInput();
  }, { signal: listeners.signal });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId === drag?.pointer) stop(true);
    if (e.pointerId === shapeDrag?.pointer) stopShape(true);
  }, { capture: true, signal: listeners.signal });
  canvas.addEventListener("lostpointercapture", (e) => {
    if (e.pointerId === drag?.pointer) stop(true);
    if (e.pointerId === shapeDrag?.pointer) stopShape(true);
  }, { signal: listeners.signal });
  canvas.addEventListener("wheel", (e) => {
    const mods = modifierKey(modifiersOf(e));
    if (wheel && !validShape(wheel)) finishWheel();
    // An open burst keeps scaling while Shift is held, even once the shrinking shape leaves the pointer.
    const continuing = !!wheel && mods === "shift";
    if (!continuing) update();
    const resolved = continuing ? undefined : targetAt(e.clientX, e.clientY, true);
    const effect = pointerBinding("head", "wheel", resolved?.target ?? "shape", mods)?.effect ?? "none";
    if (effect === "camera-zoom" && !drag && !shapeDrag) { finishWheel(); return; }
    // A scale gesture never leaks through to camera zoom, including rejected edits.
    e.preventDefault(); e.stopImmediatePropagation();
    if (effect !== "shape-scale" || drag || shapeDrag) return;
    if (!wheel) {
      const layer = resolved?.layer, painted = resolved?.painted, selected = hooks.selected(), pivot = layer?.points[selected];
      if (!layer || !painted || !pivot) return;
      wheel = { layer, snapshot: structuredClone(layer), expected: JSON.stringify(layer), selected,
        pivot: { u: pivot.u, v: pivot.v }, mirror: painted.mirror, changed: false, factor: 1 };
      publishInput();
    }
    const factor = wheel.factor * shapeWheelScaleFactor(shiftWheelDelta(e), e.deltaMode);
    if (applyShape(wheel, transformLayer(wheel.snapshot, { kind: "scale", pivot: wheel.pivot, factor }, hooks.region.models)))
      wheel.factor = factor;
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(() => finishWheel(), 250);
  }, { capture: true, passive: false, signal: listeners.signal });
  // Committing a wheel burst before focus moves keeps a later Escape in a text
  // field or the UV pane from cancelling an unrelated surface transaction.
  window.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) finishWheel();
  }, { capture: true, signal: listeners.signal });
  window.addEventListener("blur", () => { stop(true); stopShape(true); finishWheel(true); },
    { signal: listeners.signal });
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        (drag || shapeDrag || wheel) && cancelsGesture(e)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        stop(true);
        stopShape(true);
        finishWheel(true);
      }
    },
    { capture: true, signal: listeners.signal },
  );
  const cancelInput = () => { stop(true); stopShape(true); finishWheel(true); };
  function dispose() {
    cancelInput(); listeners.abort();
    viewer.cameraInput?.setTargetResolver(undefined);
    if (typeof offFrame === "function") offFrame();
    scene.remove(group);
    pointGeometry.dispose(); lineGeometry.dispose(); tangentGeometry.dispose(); tangentLineGeometry.dispose();
    pointMaterial.dispose(); tangentMaterial.dispose();
    (lines.material as THREE.Material).dispose(); (tangentLines.material as THREE.Material).dispose();
  }
  publishInput();
  return {
    resize: update, cancelInput, dispose, hitAt,
    inputCapture: () => !!drag || !!shapeDrag || !!wheel,
    setEnabled: (value: boolean) => {
      stop();
      stopShape();
      finishWheel();
      enabled = value;
      group.visible = value;
      if (!value) { hovered = undefined; if (hoverTarget) hoverTarget = "empty"; }
      publishInput();
      // The handles appear or vanish without a camera or recipe change: the head draws on demand.
      viewer.requestRender?.();
    },
    diagnostics: () => ({
      enabled,
      dragging: !!drag || !!shapeDrag,
      gesture: shapeDrag?.kind ?? (wheel ? "scale" : drag ? "handle" : null),
      pivot: shapeDrag?.pivot ?? wheel?.pivot ?? null,
      unmapped,
      unmappedTangents,
      lastDragRejection,
      headVisibility:headVisibility.diagnostics(),
      eyeVisibility:eyeVisibility.diagnostics(),
      tangentFallback: unmappedTangents
        ? "Some Bézier parent points have no eye-plate anchor; edit them in the UV pane."
        : null,
      selectedField: hooks.selectedField(),
      segments: segments.length,
      capacity: { handles: maxHandles, segments: maxSegments },
      overlay: { points: points.renderOrder, lines: lines.renderOrder,
        depthTest: pointMaterial.depthTest, depthWrite: pointMaterial.depthWrite,
        tangentPoints:tangentPoints.renderOrder,tangentLines:tangentLines.renderOrder,
        tangentDepthTest:tangentMaterial.depthTest,tangentVisibility:"real-parent-front-head-and-eyes" },
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
          projected:!!h.projected,
          parentUV:h.projected?.parent,
          parentVisible:h.projected?.visible,
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
