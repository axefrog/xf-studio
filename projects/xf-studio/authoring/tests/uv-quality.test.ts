import { expect, test } from "bun:test";
import { createUVEditor } from "../src/uv-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { defaultUVView } from "../src/uv-view";

const close = (actual: any[], expected: any[]) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => typeof value === "number" ? expect(value).toBeCloseTo(expected[i], 9) : expect(value).toBe(expected[i]));
};

test("UV tint samples actual mask dimensions into display-sized scratch without resampling native albedo", () => {
  const old={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  const displayDraws:any[][]=[], scratchDraws:any[][]=[];
  const context=(record:any[][])=>new Proxy({drawImage:(...args:any[])=>record.push(args)},
    {get:(target,key)=>Reflect.get(target,key)??(()=>{})});
  const display=context(displayDraws), scratch=context(scratchDraws), tinted:any={width:300,height:150,getContext:()=>scratch};
  const canvas:any={width:720,height:310,style:{},getContext:()=>display,
    getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000/(720/310)}),addEventListener(){}};
  Object.assign(globalThis,{document:{createElement:()=>tinted},window:{devicePixelRatio:2,addEventListener(){}},ResizeObserver:class{observe(){}}});
  try {
    const recipe=initialRecipe(), mask:any={width:4096,height:4096}, albedo:any={width:512,height:256};
    const element=()=>({setAttribute(){},disabled:false,textContent:""}) as any;
    const editor=createUVEditor(canvas,{both:element(),single:element(),other:element(),fit:element(),note:element()},
      {recipe:()=>recipe,layer:()=>recipe.layers[0],selected:()=>0,canvases:()=>[mask],albedo:()=>albedo,
        select(){},selectedField:()=>undefined,selectField(){},begin(){},apply:action=>applyAdapterProposal(recipe.layers[0],action),cancel(){},persist(){},message(){}},defaultUVView());
    editor.draw();
    const state=editor.diagnostics(), r=state.region, h=1000/(720/310);
    expect(tinted.width).toBe(canvas.width);expect(tinted.height).toBe(canvas.height);expect(tinted.width).toBe(2000);
    // The default crop lies inside the atlas: the whole pane samples the region directly.
    close(scratchDraws[0],[mask,r.u*4096,r.v*4096,r.w*4096,r.h*4096,0,0,tinted.width,tinted.height]);
    close(displayDraws[0],[albedo,r.u*512,r.v*256,r.w*512,r.h*256,0,0,1000,h]);
    close(displayDraws[1],[tinted,0,0,tinted.width,tinted.height,0,0,1000,h]);
    expect(mask.width).toBe(4096);expect(albedo.width).toBe(512);expect(albedo.height).toBe(256);
    expect(state.resolution.tintWidth).toBe(2000);
    // Zoomed out past the atlas edges, only the atlas is sampled; the stage shows around it.
    displayDraws.length=0; scratchDraws.length=0;
    expect(editor.navigate({kind:"zoom",factor:1/6})).toBe(true); editor.draw();
    const {scaleX:sx,scaleY:sy}=editor.diagnostics().resolution, out=editor.diagnostics().region, px=(u:number,v:number)=>({x:(u-out.u)/out.w*1000,y:(v-out.v)/out.h*h});
    expect(out.u).toBeLessThan(0); expect(out.u+out.w).toBeGreaterThan(1);
    const a0=px(Math.max(0,out.u),Math.max(0,out.v)), a1=px(1,Math.min(1,out.v+out.h));
    close(displayDraws.at(-2)!,[albedo,0,Math.max(0,out.v)*256,512,(Math.min(1,out.v+out.h)-Math.max(0,out.v))*256,a0.x,a0.y,a1.x-a0.x,a1.y-a0.y]);
    close(scratchDraws.at(-1)!,[mask,0,Math.max(0,out.v)*4096,4096,(Math.min(1,out.v+out.h)-Math.max(0,out.v))*4096,a0.x*sx,a0.y*sy,(a1.x-a0.x)*sx,(a1.y-a0.y)*sy]);
  } finally {Object.assign(globalThis,old);}
});
