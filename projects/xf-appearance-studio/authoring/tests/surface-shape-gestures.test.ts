import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe, type Layer } from "../src/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";

test("surface shape gestures share one transaction, preserve mirror/pivot and reject stale or invalid edits", async () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
    camera.position.z = 2; camera.updateMatrixWorld();
    const mesh = () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
      return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
    };
    const plate = mesh(), head = mesh(), eyes = mesh();
    head.position.z = -.02; eyes.position.x = 5;
    scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
    let layer = initialRecipe().layers[0], selected = 0, frame = () => {};
    layer.pathMode = "bezier";
    layer.points = [[.2,.3], [.4,.3], [.4,.5], [.2,.5]].map(([u,v]) => ({u,v,weight:1,
      handles:{in:{u:0,v:0},out:{u:0,v:0},mode:"corner" as const}}));
    layer.fields = [];
    const original = structuredClone(layer), controls = { enabled: true }, messages: string[] = [];
    let checkpoints = 0, cancellations = 0, cameraEvents = 0, undo: Layer | undefined;
    const viewer = { renderer:{domElement:canvas}, scene,camera,plate,head,eyes,controls,
      onFrame:(fn:()=>void)=>{frame=fn;} };
    const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
      layer:()=>layer, selected:()=>selected, select:i=>{selected=i;}, selectedField:()=>undefined,selectField:()=>{},
      begin:()=>{checkpoints++;undo=structuredClone(layer);},apply:action=>applyAdapterProposal(layer,action),
      cancel:()=>{cancellations++;if(undo)Object.assign(layer,structuredClone(undo));},message:text=>messages.push(text),
    });
    canvas.addEventListener("pointerdown",()=>cameraEvents++);
    canvas.addEventListener("wheel",()=>cameraEvents++);
    const emit = (type:string,u:number,v:number,extra:Record<string,unknown>={}) => {
      const world=new THREE.Vector3(u-.5,v-.5,0).project(camera), e=new Event(type,{cancelable:true});
      Object.assign(e,{clientX:(world.x+1)*500,clientY:(1-world.y)*500,pointerId:1,button:0,...extra});
      canvas.dispatchEvent(e);return e;
    };
    const escape=()=>{const e=new Event("keydown",{cancelable:true});Object.assign(e,{key:"Escape"});fakeWindow.dispatchEvent(e);};
    frame();
    const mirroredPoint = editor.diagnostics().handles.find(h => h.kind === "point" && h.index === 0 && h.mirror)!;
    expect(editor.hitAt(mirroredPoint.screen.x, mirroredPoint.screen.y)).toMatchObject({
      hit: { kind: "point", layerId: layer.id, index: 0 }, mirror: true, affordance: "point" });
    const interior = new THREE.Vector3(.2, -.1, 0).project(camera);
    expect(editor.hitAt((interior.x + 1) * 500, (1 - interior.y) * 500)).toMatchObject({
      hit: { kind: "shape", layerId: layer.id }, mirror: true, affordance: "shape" });
    // Mirrored drag moves the canonical shape left as the visible shape moves right.
    emit("pointerdown",.7,.4);
    expect(editor.diagnostics().gesture).toBe("translate");
    expect(controls.enabled).toBe(false);
    emit("pointermove",.72,.41);
    expect(layer.points[0].u).toBeCloseTo(.18,8);
    expect(layer.points[0].v).toBeCloseTo(.31,8);
    emit("pointermove",.73,.415);
    expect(checkpoints).toBe(1);
    expect(layer.points[0].u).toBeCloseTo(.17,8);
    expect(cameraEvents).toBe(0);
    escape();
    expect(layer).toEqual(original);
    expect(controls.enabled).toBe(true);
    expect(cancellations).toBe(1);
    // A discontinuous surface jump freezes editing and resumes only near its last anchor.
    controls.enabled=false;
    emit("pointerdown",.3,.4);
    emit("pointermove",.5,.4);
    expect(layer).toEqual(original);
    expect(messages.at(-1)).toContain("surface edge");
    emit("pointermove",.32,.4);
    expect(layer.points[0].u).toBeCloseTo(.22,8);
    escape();expect(layer).toEqual(original);
    expect(controls.enabled).toBe(false);
    controls.enabled=true;
    // Shift drag rotates around the selected knot, including when starting over a different knot.
    emit("pointerdown",.4,.3,{shiftKey:true});
    expect(selected).toBe(0);
    expect(editor.diagnostics().gesture).toBe("rotate");
    emit("pointermove",.395,.34,{shiftKey:true});
    expect(layer.points[0].u).toBeCloseTo(.2,8);
    expect(layer.points[0].v).toBeCloseTo(.3,8);
    expect(layer.points[1].v).toBeGreaterThan(.3);
    expect(Math.hypot(layer.points[1].u-.2,layer.points[1].v-.3)).toBeCloseTo(.2,8);
    escape();
    expect(layer).toEqual(original);
    // Wheel burst is one Undo, scales around that same pivot and does not zoom the camera.
    const beforeWheel=checkpoints;
    const first=emit("wheel",.3,.4,{shiftKey:true,deltaY:-20,deltaMode:0});
    emit("wheel",.3,.4,{shiftKey:true,deltaY:-20,deltaMode:0});
    expect(first.defaultPrevented).toBe(true);
    expect(checkpoints).toBe(beforeWheel+1);
    expect(layer.points[0]).toEqual(original.points[0]);
    expect(layer.points[1].u).toBeCloseTo(.2 + .2 * 1.02 ** (1/3), 10);
    expect(layer.feather).toBeCloseTo(original.feather * 1.02 ** (1/3), 10);
    expect(editor.diagnostics().gesture).toBe("scale");
    expect(cameraEvents).toBe(0);
    escape();expect(layer).toEqual(original);
    // Moving focus to another editor commits the burst; its Escape cannot undo it.
    emit("wheel",.3,.4,{shiftKey:true,deltaY:-20,deltaMode:0});
    const committedWheel=structuredClone(layer), beforeExternalCancel=cancellations;
    fakeWindow.dispatchEvent(new Event("pointerdown"));
    expect(editor.diagnostics().gesture).toBe(null);
    escape();
    expect(cancellations).toBe(beforeExternalCancel);
    expect(layer).toEqual(committedWheel);
    Object.assign(layer,structuredClone(original));
    // Bounds reject the whole shape, retaining the last valid position.
    emit("pointerdown",.3,.4);
    let lastAccepted=structuredClone(layer);
    for(let u=.26;u>=.019;u-=.04){emit("pointermove",u,.4);if(layer.points[0].u>=0)lastAccepted=structuredClone(layer);}
    expect(layer.points[0].u).toBeGreaterThanOrEqual(0);
    expect(layer.points[1].u-layer.points[0].u).toBeCloseTo(.2,8);
    expect(messages.some(m=>m.includes("Shape limit"))).toBe(true);
    expect(layer).toEqual(lastAccepted);
    escape();expect(layer).toEqual(original);
    // An unrelated context replacement stops the gesture without undoing the new layer.
    emit("pointerdown",.3,.4);emit("pointermove",.31,.41);
    const cancellationsBefore=cancellations;
    layer=structuredClone(original);layer.name="Replacement";
    frame();escape();
    expect(layer.name).toBe("Replacement");
    expect(cancellations).toBe(cancellationsBefore);
    expect(editor.diagnostics().dragging).toBe(false);
    expect(controls.enabled).toBe(true);
    // Opaque occlusion prevents paint selection; Shift wheel still cannot zoom.
    head.position.z=.02;head.updateMatrixWorld();
    emit("pointerdown",.3,.4);
    expect(editor.diagnostics().dragging).toBe(false);
    const beforeOccluded=structuredClone(layer);
    expect(emit("wheel",.3,.4,{shiftKey:true,deltaY:-100,deltaMode:0}).defaultPrevented).toBe(true);
    expect(layer).toEqual(beforeOccluded);
    head.position.z=-.02;head.updateMatrixWorld();
    // A finished burst commits and the next burst opens a fresh history step.
    emit("wheel",.3,.4,{shiftKey:true,deltaY:-10,deltaMode:0});
    const beforeTimeout=checkpoints;
    await Bun.sleep(280);
    expect(editor.diagnostics().gesture).toBe(null);
    emit("wheel",.3,.4,{shiftKey:true,deltaY:-10,deltaMode:0});
    expect(checkpoints).toBe(beforeTimeout+1);
    escape();
  } finally {
    if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");
  }
});
