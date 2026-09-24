import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe } from "../src/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { SurfaceMap } from "../src/surface-map";

/** Real geometry/ray tests: the eye blocks painted-surface gestures, not an
 * existing anchored control. Head occlusion and plate/UV guards still apply. */
test("projected tangents cross eye holes while actual surface controls keep head, eye and UV limits", () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
    camera.position.z = 2; camera.updateMatrixWorld();
    const mesh = () => {
      const result = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
      return Object.assign(result, { computeBoundingSphere: () => result.geometry.computeBoundingSphere() });
    };
    const plate = mesh(), head = mesh(), eyes = mesh();
    // Eye covers the vector endpoints and the intervening hole, but leaves
    // their actual parent knots at u=.2/.8 unobstructed.
    eyes.geometry=new THREE.PlaneGeometry(.54,.4);eyes.position.y=-.1;
    const grid=new THREE.PlaneGeometry(1,1,10,10),indices=Array.from(grid.index!.array),uv=grid.getAttribute("uv");
    grid.setIndex(indices.filter((_,i)=>{const start=i-i%3,triangle=indices.slice(start,start+3);
      const u=triangle.reduce((s,v)=>s+uv.getX(v),0)/3,v=triangle.reduce((s,i)=>s+uv.getY(i),0)/3;
      return !(u>.28&&u<.65&&v>.25&&v<.7);}));
    plate.geometry=grid;
    expect(new SurfaceMap(grid).anchor({u:.5,v:.4})).toBeUndefined();
    head.position.z = -.02; eyes.position.z = .02;
    scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
    const layer = initialRecipe().layers[0];
    layer.fields = []; layer.symmetry = true;
    layer.points = [[.2,.3], [.4,.3], [.4,.5], [.2,.5]].map(([u,v]) => ({u,v,weight:1,
      handles:{in:{u:0,v:0},out:{u:0,v:0},mode:"corner" as const}}));
    layer.points[0].handles = {in:{u:-.04,v:-.01},out:{u:.04,v:.01},mode:"corner"};
    const controls = {enabled:true};
    let frame = () => {}, checkpoints = 0, changes = 0, cancellations = 0;
    let snapshot = structuredClone(layer);
    const messages: string[] = [];
    const viewer = { renderer:{domElement:canvas}, scene,camera,plate,head,eyes,controls,
      onFrame:(fn:()=>void)=>{frame=fn;} };
    const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
      layer:()=>layer,selected:()=>0,select:()=>{},selectedField:()=>undefined,selectField:()=>{},
      begin:()=>{checkpoints++;snapshot=structuredClone(layer);},
      apply:action=>{const changed=applyAdapterProposal(layer,action);if(changed)changes++;return changed;},
      cancel:()=>{cancellations++;Object.assign(layer,structuredClone(snapshot));},message:text=>messages.push(text),
    });
    let headRays=0,headBounds=0;
    const originalRaycast=head.raycast,originalBounds=head.computeBoundingSphere;
    head.raycast=function(ray,hits){headRays++;return originalRaycast.call(this,ray,hits);};
    head.computeBoundingSphere=()=>{headBounds++;originalBounds();};
    const emit = (type:string,x:number,y:number) => {
      const event = new Event(type,{cancelable:true});
      Object.assign(event,{clientX:x,clientY:y,pointerId:1,button:0});canvas.dispatchEvent(event);return event;
    };
    const atUV = (type:string,u:number,v:number) => {
      const screen = new THREE.Vector3(u-.5,v-.5,0).project(camera);
      return emit(type,(screen.x+1)*500,(1-screen.y)*500);
    };
    const escape = () => {
      const event = new Event("keydown",{cancelable:true});Object.assign(event,{key:"Escape"});fakeWindow.dispatchEvent(event);
    };
    frame();
    expect(headRays).toBe(0);expect(headBounds).toBe(0); // projected controls use cached deformed geometry
    expect(editor.diagnostics().headVisibility.refits).toBe(1);
    expect(editor.diagnostics().headVisibility.sampledVertices).toBe(head.geometry.getAttribute("position").count);
    const tangent = (mirror=false) => editor.diagnostics().handles.find(h=>h.kind==="tangent" && h.side==="out" && h.mirror===mirror)!;
    const original = structuredClone(layer);
    // The eye is substantially in front of the mapped plate. A generic shape
    // click must still pass through to the camera rather than select makeup.
    const shapeClick = atUV("pointerdown",.3,.4);
    expect(shapeClick.defaultPrevented).toBe(false);
    expect(editor.diagnostics().dragging).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(editor.diagnostics().handles.find(h=>h.kind==="point"&&h.index===0&&!h.mirror)!.selectable).toBe(true);
    // Moving the eye over the actual parent hides its projected arms and
    // prevents acquisition. Only endpoints, not parent anchors, ignore eyes.
    eyes.position.x=-.06;eyes.updateMatrixWorld();frame();
    let obscured=tangent();
    expect(obscured.parentVisible).toBe(false);expect(obscured.selectable).toBe(false);
    emit("pointerdown",obscured.screen.x,obscured.screen.y);
    expect(editor.diagnostics().dragging).toBe(false);
    expect(editor.diagnostics().handles.find(h=>h.kind==="point"&&h.index===0&&!h.mirror)!.selectable).toBe(false);
    eyes.position.x=0;eyes.updateMatrixWorld();frame();
    // The existing tangent itself has a legitimate plate anchor and is usable.
    let handle = tangent();
    expect(handle.selectable).toBe(true);
    expect(emit("pointerdown",handle.screen.x,handle.screen.y).defaultPrevented).toBe(true);
    expect(controls.enabled).toBe(false);
    expect(editor.diagnostics().gesture).toBe("handle");
    emit("pointermove",handle.screen.x+5,handle.screen.y+3);
    expect(changes).toBe(1);expect(checkpoints).toBe(1);
    expect(layer.points[0].handles!.out.u).toBeGreaterThan(.04);
    expect(layer.points[0].handles!.out.v).toBeLessThan(.01);
    // Vector controls can cross a genuine geometry hole without a fabricated
    // endpoint anchor or a discontinuity pause. Their real parent stays put.
    atUV("pointermove",.5,.4);
    expect(layer.points[0].handles!.out.u).toBeGreaterThan(.29);
    expect(layer.points[0].u).toBe(.2);expect(layer.points[0].v).toBe(.3);
    const edited = structuredClone(layer);
    // Nor may an active handle continue through an opaque head occluder.
    head.position.z=.04;head.updateMatrixWorld();
    emit("pointermove",handle.screen.x+8,handle.screen.y+4);
    expect(layer).toEqual(edited);
    escape();
    expect(layer).toEqual(original);expect(cancellations).toBe(1);
    expect(controls.enabled).toBe(true);expect(canvas.captures.size).toBe(0);
    frame();handle=tangent();
    expect(handle.selectable).toBe(false);
    emit("pointerdown",handle.screen.x,handle.screen.y);
    expect(editor.diagnostics().dragging).toBe(false);
    // Eye-overlapping mirrored handles retain canonical direction and one Undo.
    head.position.z=-.02;head.updateMatrixWorld();frame();handle=tangent(true);
    expect(handle.selectable).toBe(true);
    emit("pointerdown",handle.screen.x,handle.screen.y);
    emit("pointermove",handle.screen.x+5,handle.screen.y);
    expect(layer.points[0].handles!.out.u).toBeLessThan(.04);
    expect(checkpoints).toBe(2);
    emit("pointerup",handle.screen.x+5,handle.screen.y);
    expect(controls.enabled).toBe(true);expect(canvas.captures.size).toBe(0);
    // Actual knots still stop at that hole even after the eye moves away.
    Object.assign(layer,structuredClone(original));eyes.position.x=5;eyes.updateMatrixWorld();frame();
    const point=editor.diagnostics().handles.find(h=>h.kind==="point"&&h.index===0&&!h.mirror)!;
    emit("pointerdown",point.screen.x,point.screen.y);
    atUV("pointermove",.5,.4);
    expect(layer).toEqual(original);
    expect(editor.diagnostics().lastDragRejection?.reason).toBe("no-front-plate-hit");
    emit("pointerup",point.screen.x,point.screen.y);
    // Back-facing plate anchors remain unpickable even without an opaque head
    // in front; the editor does not turn into a through-the-face picker.
    plate.rotation.y=Math.PI;plate.updateMatrixWorld();
    head.position.x=5;head.updateMatrixWorld();
    frame();
    expect(editor.diagnostics().handles.filter(h=>h.kind==="tangent").every(h=>!h.selectable)).toBe(true);
    // Rendering keeps depth testing and the original physical anchor positions.
    expect(editor.diagnostics().overlay.depthTest).toBe(true);
    expect(editor.diagnostics().overlay.depthWrite).toBe(false);
    expect(editor.diagnostics().overlay.tangentDepthTest).toBe(false);
    plate.rotation.y=0;plate.position.x=10;plate.updateMatrixWorld();frame();
    expect(editor.diagnostics().handles.filter(h=>h.kind==="tangent").every(h=>h.parentVisible===false)).toBe(true);
  } finally {
    if(previousWindow)Object.defineProperty(globalThis,"window",previousWindow);else Reflect.deleteProperty(globalThis,"window");
  }
});
