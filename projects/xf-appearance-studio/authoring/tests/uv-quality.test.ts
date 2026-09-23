import { expect, test } from "bun:test";
import { createUVEditor } from "../src/uv-editor";
import { initialRecipe } from "../src/recipe";
import { defaultUVView } from "../src/uv-view";

test("UV tint samples actual mask dimensions into display-sized scratch without resampling native albedo", () => {
  const old={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  const displayDraws:any[][]=[], scratchDraws:any[][]=[];
  const context=(record:any[][])=>new Proxy({drawImage:(...args:any[])=>record.push(args)},
    {get:(target,key)=>Reflect.get(target,key)??(()=>{})});
  const display=context(displayDraws), scratch=context(scratchDraws), tinted:any={width:300,height:150,getContext:()=>scratch};
  const canvas:any={width:720,height:310,style:{aspectRatio:""},getContext:()=>display,
    getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000/(+canvas.style.aspectRatio||720/310)}),addEventListener(){}};
  Object.assign(globalThis,{document:{createElement:()=>tinted},window:{devicePixelRatio:2,addEventListener(){}},ResizeObserver:class{observe(){}}});
  try {
    const recipe=initialRecipe(), mask:any={width:4096,height:4096}, albedo:any={width:512,height:256};
    const element=()=>({setAttribute(){},disabled:false,textContent:""}) as any;
    const editor=createUVEditor(canvas,{both:element(),single:element(),other:element(),fit:element(),note:element()},
      {recipe:()=>recipe,layer:()=>recipe.layers[0],selected:()=>0,canvases:()=>[mask],albedo:()=>albedo,
        select(){},selectedField:()=>undefined,selectField(){},begin(){},change(){},cancel(){},persist(){},message(){}},defaultUVView());
    editor.draw();
    const state=editor.diagnostics(), r=state.region;
    expect(tinted.width).toBe(canvas.width);expect(tinted.height).toBe(canvas.height);expect(tinted.width).toBe(2000);
    expect(scratchDraws[0]).toEqual([mask,r.u*4096,r.v*4096,r.w*4096,r.h*4096,0,0,tinted.width,tinted.height]);
    expect(displayDraws[0]).toEqual([albedo,r.u*512,r.v*256,r.w*512,r.h*256,0,0,1000,1000/(720/310)]);
    expect(displayDraws[1]).toEqual([tinted,0,0,tinted.width,tinted.height,0,0,1000,1000/(720/310)]);
    expect(mask.width).toBe(4096);expect(albedo.width).toBe(512);expect(albedo.height).toBe(256);
    expect(state.resolution.tintWidth).toBe(2000);
  } finally {Object.assign(globalThis,old);}
});
