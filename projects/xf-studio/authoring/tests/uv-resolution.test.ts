import { expect, test } from "bun:test";
import { canvasResolution } from "../src/canvas-resolution";
import { createUVEditor } from "../src/uv-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { defaultUVView, pixelToUV, uvToPixel } from "../src/uv-view";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";

test("fractional CSS dimensions and DPR cover exactly the drawing rectangle", () => {
  for (const width of [288.3,720,1400.25]) for (const dpr of [1,1.25,2,3]) {
    const r=canvasResolution(width,width*520/720,dpr);
    expect(r.pixelWidth).toBe(Math.round(width*dpr));
    expect(r.cssWidth*r.scaleX).toBeCloseTo(r.pixelWidth,10);
    expect(r.cssHeight*r.scaleY).toBeCloseTo(r.pixelHeight,10);
    expect(5*r.scaleX/r.pixelWidth*r.cssWidth).toBeCloseTo(5,12);
  }
  expect(canvasResolution(0,NaN,0)).toEqual({cssWidth:1,cssHeight:1,dpr:1,pixelWidth:1,pixelHeight:1,scaleX:1,scaleY:1});
});

test("UV resize sharpens backing buffer without resetting view or changing CSS-sized controls/picking", () => {
  const old={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  let cssWidth=720, bufferWidth=720, bufferHeight=310, writes=0, observer=()=>{};
  const transforms:number[][]=[], radii:number[]=[], listeners:Record<string,(e:any)=>void>={};
  let mediaChanged=()=>{};
  const context=new Proxy({setTransform:(...values:number[])=>transforms.push(values),arc:(_x:number,_y:number,r:number)=>radii.push(r)},
    {get:(target,key)=>Reflect.get(target,key)??(()=>{})});
  const canvas:any={style:{},clientLeft:1,clientTop:1,
    get width(){return bufferWidth;},set width(n:number){bufferWidth=n;writes++;},
    get height(){return bufferHeight;},set height(n:number){bufferHeight=n;writes++;},
    getContext:()=>context,getBoundingClientRect:()=>({left:10,top:20,width:cssWidth+2,height:cssWidth/(720/310)+2}),
    addEventListener:(kind:string,fn:(e:any)=>void)=>{listeners[kind]=fn;},
    setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}};
  const win:any={devicePixelRatio:2,addEventListener:(kind:string,fn:(e:any)=>void)=>{listeners[kind]=fn;},
    matchMedia:()=>({addEventListener:(_kind:string,fn:()=>void)=>{mediaChanged=fn;},removeEventListener(){}})};
  Object.assign(globalThis,{document:{createElement:()=>({getContext:()=>context})},window:win,
    ResizeObserver:class{constructor(fn:()=>void){observer=fn;}observe(){}}});
  try {
    const recipe=initialRecipe(),layer=recipe.layers[0];layer.pathMode="catmull-rom";layer.fields=[];
    layer.points.forEach(p=>delete p.handles);
    let selected=0,begins=0,persists=0;
    const element=()=>({setAttribute(){},disabled:false,textContent:""}) as any;
    const editor=createUVEditor(canvas,{both:element(),single:element(),other:element(),fit:element(),note:element()},
      {recipe:()=>recipe,layer:()=>layer,selected:()=>selected,select:i=>{selected=i;},selectedField:()=>undefined,selectField(){},
        canvases:()=>[],albedo:()=>undefined,begin:()=>begins++,apply:action=>applyAdapterProposal(layer,action),cancel(){},persist(){persists++;},message(){}},defaultUVView());
    editor.draw();
    expect(bufferWidth).toBe(1440);
    const saved=editor.snapshot(), firstWrites=writes;
    editor.draw();observer();
    expect(writes).toBe(firstWrites);
    expect(radii).toContain(5); // Radius passed in CSS units, transformed once by the context.
    cssWidth=1440;observer();
    expect(bufferWidth).toBe(2880);
    expect(editor.snapshot()).toEqual(saved);
    const atWide=editor.diagnostics();
    expect(atWide.resolution.cssWidth).toBe(1440);
    const p=atWide.handles.find(h=>h.kind==="point"&&h.index===0&&!h.mirror)!;
    const event=(x:number,y:number)=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){}});
    const original={...layer.points[0]};
    canvas.onpointerdown(event(p.screen.x,p.screen.y));
    canvas.onpointermove(event(p.screen.x+20,p.screen.y+12));
    expect(begins).toBe(1);
    expect(layer.points[0].u-original.u).toBeCloseTo(20/1440*saved.span,12);
    expect(layer.points[0].v-original.v).toBeCloseTo(12/1440*saved.span,12);
    canvas.onpointerup(event(p.screen.x+20,p.screen.y+12));
    // A DPR-only change updates resolution, leaves CSS/UV coordinates unchanged.
    const beforeDPR=editor.diagnostics();win.devicePixelRatio=1.25;mediaChanged();
    const afterDPR=editor.diagnostics();
    expect(bufferWidth).toBe(1800);
    expect(afterDPR.handles.map(h=>h.screen)).toEqual(beforeDPR.handles.map(h=>h.screen));
    expect(editor.snapshot()).toEqual(saved);
    const r=afterDPR.resolution, transform=transforms.at(-1)!;
    expect(transform[0]).toBe(r.scaleX);expect(transform[3]).toBe(r.scaleY);
    const uv={u:.36,v:.24}, px=uvToPixel(uv,afterDPR.region,r.cssWidth,r.cssHeight);
    const back=pixelToUV(px,afterDPR.region,r.cssWidth,r.cssHeight);
    expect(back.u).toBeCloseTo(uv.u,12);expect(back.v).toBeCloseTo(uv.v,12);
    const beforeCommand = persists;
    expect(editor.viewCommand("other")).toBe(false);
    expect(editor.viewCommand("single")).toBe(true);
    expect(editor.snapshot().mode).toBe("single");
    const firstSide = editor.snapshot().side;
    expect(editor.viewCommand("other")).toBe(true);
    expect(editor.snapshot().side).not.toBe(firstSide);
    expect(editor.viewCommand("fit")).toBe(true);
    expect(editor.viewCommand("both")).toBe(true);
    expect(editor.snapshot().mode).toBe("both");
    expect(persists).toBe(beforeCommand + 4);
  } finally {Object.assign(globalThis,old);}
});
